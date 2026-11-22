/**
 * TON read service: provider selection, caching, fallback and normalization.
 *
 * TON Center is the primary provider; TonAPI supplies prices/jetton metadata and is the
 * fallback for account/activity reads. Keys come from server config and are only placed in
 * provider headers. Errors are ProviderError (no upstream body, never a key).
 */
import { type TonActivityItem, type TonNetwork, type TonPortfolio } from '@onezerowallet/chain-ton';
import type { ServerConfig } from '../config';
import { providerBaseUrl } from '../config';
import { cached, TTL } from './cache';
import { ProviderError, type FetchLike } from './http';
import { buildPortfolio, mapTonApiActivity, mapTonCenterActivity } from './normalize';
import { TonApiClient, type TonApiJettonMeta, type TonApiPrice } from './tonapi';
import { TonCenterClient } from './toncenter';
import { NATIVE_TON, nativeAsset } from './token-registry';

export interface TonReadOptions {
  config: ServerConfig;
  fetchImpl?: FetchLike | undefined;
  now?: (() => number) | undefined;
  signal?: AbortSignal | undefined;
}

function toncenterKey(config: ServerConfig): string | undefined {
  return config.network === 'testnet' ? config.toncenterTestnetApiKey : config.toncenterApiKey;
}

function toncenter(config: ServerConfig, options: TonReadOptions): TonCenterClient {
  return new TonCenterClient({
    baseUrl: providerBaseUrl(config),
    apiKey: toncenterKey(config),
    fetchImpl: options.fetchImpl,
  });
}

function tonapi(config: ServerConfig, options: TonReadOptions): TonApiClient {
  return new TonApiClient({
    baseUrl: providerBaseUrl({ ...config, provider: 'tonapi' }),
    apiKey: config.tonapiApiKey,
    fetchImpl: options.fetchImpl,
  });
}

async function price(ta: TonApiClient, now: () => number): Promise<TonApiPrice> {
  return cached('tonapi:rates', TTL.priceMs, () => ta.rates(), now).catch(() => ({
    usd: null,
    change24h: null,
  }));
}

async function jettonMetadata(
  wallets: Array<{ jetton: string }>,
  ta: TonApiClient,
  now: () => number,
): Promise<Record<string, TonApiJettonMeta | null>> {
  const entries = await Promise.all(
    wallets.map(async (wallet) => {
      const meta = await cached(
        `tonapi:jetton:${wallet.jetton}`,
        TTL.jettonMetaMs,
        () => ta.jetton(wallet.jetton),
        now,
      ).catch(() => null);
      return [wallet.jetton, meta] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function getTonPortfolio(
  address: string,
  network: TonNetwork,
  options: TonReadOptions,
): Promise<TonPortfolio> {
  const now = options.now ?? Date.now;
  const key = `portfolio:${network}:${address}`;
  return cached(
    key,
    TTL.portfolioMs,
    async () => {
      const ta = tonapi(options.config, options);
      if (options.config.provider === 'tonapi') {
        const [account, p] = await Promise.all([ta.account(address), price(ta, now)]);
        const asset = nativeAsset(account.balanceRaw, p.usd);
        return {
          address,
          network,
          status: account.status,
          balanceRaw: asset.balanceRaw,
          balance: asset.balance,
          priceUsd: p.usd,
          change24h: p.change24h,
          totalUsd: asset.usdValue,
          assets: [asset],
          updatedAt: now(),
          source: 'tonapi' as const,
        };
      }

      const tc = toncenter(options.config, options);
      try {
        const account = await tc.accountInfo(address);
        const wallets = await tc.jettonWallets(address);
        const [metadata, p] = await Promise.all([jettonMetadata(wallets, ta, now), price(ta, now)]);
        return buildPortfolio({
          address,
          network,
          status: account.status,
          balanceRaw: account.balanceRaw,
          jettonWallets: wallets,
          metadata,
          price: p,
          updatedAt: now(),
        });
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        // Fallback: TonAPI native account + price (jetton balances are not mapped here).
        const [account, p] = await Promise.all([ta.account(address), price(ta, now)]);
        const asset = nativeAsset(account.balanceRaw, p.usd);
        return {
          address,
          network,
          status: account.status,
          balanceRaw: asset.balanceRaw,
          balance: asset.balance,
          priceUsd: p.usd,
          change24h: p.change24h,
          totalUsd: asset.usdValue,
          assets: [asset],
          updatedAt: now(),
          source: 'tonapi' as const,
        };
      }
    },
    now,
  );
}

export async function getTonActivity(
  address: string,
  network: TonNetwork,
  limit: number,
  options: TonReadOptions,
): Promise<TonActivityItem[]> {
  const now = options.now ?? Date.now;
  const capped = Math.max(1, Math.min(limit, 50));
  const key = `activity:${network}:${address}:${String(capped)}`;
  return cached(
    key,
    TTL.activityMs,
    async () => {
      const ta = tonapi(options.config, options);
      if (options.config.provider === 'tonapi') {
        return mapTonApiActivity(await ta.events(address, capped)).slice(0, capped);
      }

      const tc = toncenter(options.config, options);
      try {
        const wallets = await tc.jettonWallets(address);
        const [transactions, metadata] = await Promise.all([
          tc.transactions(address, capped),
          jettonMetadata(wallets, ta, now),
        ]);
        return mapTonCenterActivity(transactions, wallets, metadata).slice(0, capped);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        return mapTonApiActivity(await ta.events(address, capped)).slice(0, capped);
      }
    },
    now,
  );
}

export const NATIVE_TON_METADATA = NATIVE_TON;
