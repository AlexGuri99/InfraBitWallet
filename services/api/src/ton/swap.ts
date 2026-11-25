/**
 * STON.fi DEX v2 swap proxy (server-only).
 *
 * The Mini App never calls STON.fi directly, so `connect-src 'self'` stays intact and the
 * reviewed referral address never reaches the client unless it is needed for the payload.
 *
 * Sources (verified 2026-11-25):
 * - docs.ston.fi "Setup and environments (DEX v2)": `api.ston.fi` serves MAINNET data only;
 *   testnet swaps need configured contracts and an operator-supplied quote source.
 * - docs.ston.fi "Swap": simulate → build with the returned router metadata.
 * - `@ston-fi/api` typings for the `simulateSwap`/assets response fields.
 *
 * Fees are BASIS POINTS: `referral_fee_bps: 35` = 0.35%. Never pips.
 */
import {
  SWAP_FEE_BPS,
  assertReferralFeeBps,
  minReceivedRaw,
  type SwapDirection,
} from '@onezerowallet/swap-ton';
import { STON_MAINNET_API_URL, type ServerConfig } from '../config.js';
import { ProviderError, fetchJson, type FetchLike } from './http.js';
import { normalizeTonAddress } from './validation.js';

export type SwapErrorCode = 'invalid_request' | 'swap_unavailable' | 'unsupported_dex' | 'no_route';

export class SwapError extends Error {
  readonly code: SwapErrorCode;

  constructor(code: SwapErrorCode) {
    super(code);
    this.name = 'SwapError';
    this.code = code;
  }
}

export interface SwapAsset {
  /** Asset address used by the provider, or "native" for TON. */
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: 'native' | 'jetton';
  contractAddress: string;
  imageUrl: string | null;
  /** False for community/blacklisted listings. */
  verified: boolean;
}

export interface SwapRouterMeta {
  address: string;
  majorVersion: number;
  minorVersion: number;
  routerType: string;
  ptonMasterAddress: string;
  ptonWalletAddress: string;
  ptonVersion: string;
  poolAddress: string;
}

export interface SwapQuote {
  network: ServerConfig['network'];
  offer: { address: string; units: string };
  ask: { address: string; units: string; minUnits: string };
  /** Minimum after the user's slippage; never larger than the provider's own min. */
  minReceivedRaw: string;
  slippageBps: number;
  priceImpact: number | null;
  swapRate: number | null;
  providerMinUnits: string;
  /** Policy fee in basis points actually collected (0 when no referral address is set). */
  feeBps: number;
  feeUnits: string;
  /** Reviewed referral address; null when the fee is not collected. */
  referralAddress: string | null;
  router: SwapRouterMeta;
  direction: SwapDirection;
  /** The user's jetton wallet for a jetton offer, when the caller supplied it. */
  offerJettonWalletAddress: string | null;
  /** Jetton wallet that receives the ask tokens (used to build the SWAP body). */
  askJettonWalletAddress: string;
  gas: {
    gasBudget: string | null;
    forwardGas: string | null;
    estimatedGasConsumption: string | null;
  };
  quotedAt: number;
}

export class SwapService {
  private readonly config: ServerConfig;
  private readonly fetchImpl: FetchLike | undefined;

  constructor(options: { config: ServerConfig; fetchImpl?: FetchLike | undefined }) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl;
  }

  /** Base URL for the configured network; testnet fails closed unless explicitly configured. */
  private apiBaseUrl(): string {
    if (this.config.network === 'mainnet') {
      return this.config.stonApiBaseUrl ?? STON_MAINNET_API_URL;
    }
    if (!this.config.stonTestnetApiBaseUrl) throw new SwapError('swap_unavailable');
    return this.config.stonTestnetApiBaseUrl;
  }

  private get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const base = this.apiBaseUrl().replace(/\/+$/, '');
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    return fetchJson<T>('stonfi', `${base}${path}${query}`, { fetchImpl: this.fetchImpl });
  }

  /** POST with the query-string parameters STON.fi expects (verified live 2026-11-25). */
  private post(path: string, params: Record<string, string>): Promise<unknown> {
    const base = this.apiBaseUrl().replace(/\/+$/, '');
    return fetchJson<unknown>(
      'stonfi',
      `${base}${path}?${new URLSearchParams(params).toString()}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        fetchImpl: this.fetchImpl,
      },
    );
  }

  async assets(): Promise<SwapAsset[]> {
    const json = await this.get<unknown>('/v1/assets');
    const record =
      typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
    const list = Array.isArray(record['asset_list']) ? record['asset_list'] : [];
    const assets: SwapAsset[] = [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const asset = entry as Record<string, unknown>;
      const contract =
        typeof asset['contract_address'] === 'string' ? asset['contract_address'] : '';
      const symbol = typeof asset['symbol'] === 'string' ? asset['symbol'] : '';
      const decimals = typeof asset['decimals'] === 'number' ? asset['decimals'] : null;
      const kindRaw = asset['kind'];
      if (!contract || !symbol || decimals === null) continue;
      if (asset['blacklisted'] === true || asset['deprecated'] === true) continue;
      if (kindRaw !== 'Ton' && kindRaw !== 'Wton' && kindRaw !== 'Jetton') continue;
      const isNative = kindRaw === 'Ton';
      const name =
        typeof asset['display_name'] === 'string' && asset['display_name'] !== ''
          ? asset['display_name']
          : symbol;
      const imageUrl = typeof asset['image_url'] === 'string' ? asset['image_url'] : null;
      assets.push({
        id: isNative ? 'native' : contract,
        symbol,
        name,
        decimals,
        kind: isNative ? 'native' : 'jetton',
        contractAddress: contract,
        imageUrl,
        verified: asset['community'] !== true && asset['blacklisted'] !== true,
      });
    }
    // Native TON first, then stablecoins, then the rest by symbol.
    return assets.sort((a, b) => {
      if (a.kind === 'native') return -1;
      if (b.kind === 'native') return 1;
      return a.symbol.localeCompare(b.symbol);
    });
  }

  async quote(request: {
    network: string;
    offerAsset: string;
    askAsset: string;
    offerKind: 'native' | 'jetton';
    askKind: 'native' | 'jetton';
    offerUnits: string;
    slippageBps: number;
    userAddress: string;
    offerJettonWallet?: string | undefined;
  }): Promise<SwapQuote> {
    if (request.network !== this.config.network) throw new SwapError('invalid_request');
    const offerAddress = normalizeTonAddress(request.offerAsset);
    const askAddress = normalizeTonAddress(request.askAsset);
    const userAddress = normalizeTonAddress(request.userAddress);
    if (!offerAddress || !askAddress || !userAddress) throw new SwapError('invalid_request');
    if (offerAddress === askAddress) throw new SwapError('invalid_request');
    if (request.offerKind === request.askKind && request.offerKind === 'native') {
      throw new SwapError('invalid_request');
    }
    if (!/^\d{1,40}$/.test(request.offerUnits) || request.offerUnits === '0') {
      throw new SwapError('invalid_request');
    }
    if (
      !Number.isInteger(request.slippageBps) ||
      request.slippageBps < 10 ||
      request.slippageBps > 500
    ) {
      throw new SwapError('invalid_request');
    }
    const offerJettonWallet = request.offerJettonWallet
      ? normalizeTonAddress(request.offerJettonWallet)
      : null;
    if (request.offerJettonWallet && !offerJettonWallet) throw new SwapError('invalid_request');

    const referralAddress = this.config.stonReferralAddress
      ? normalizeTonAddress(this.config.stonReferralAddress)
      : null;
    // 35 bps, validated against the 1% hard cap; no referral address means no fee is collected.
    const feeBps = referralAddress !== null ? assertReferralFeeBps(SWAP_FEE_BPS) : 0;

    const params: Record<string, string> = {
      offer_address: offerAddress,
      ask_address: askAddress,
      units: request.offerUnits,
      // STON.fi takes a fraction (0.01 = 1%).
      slippage_tolerance: (request.slippageBps / 10_000).toString(),
      dex_v2: 'true',
    };
    if (referralAddress) {
      params['referral_address'] = referralAddress;
      params['referral_fee_bps'] = String(feeBps);
    }

    let raw: unknown;
    try {
      raw = await this.post('/v1/swap/simulate', params);
    } catch (error) {
      if (error instanceof ProviderError) throw new SwapError('swap_unavailable');
      throw error;
    }
    const record =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    if (!record) throw new SwapError('swap_unavailable');

    const router = record['router'] as Record<string, unknown> | undefined;
    const majorVersion =
      typeof router?.['major_version'] === 'number' ? router['major_version'] : 0;
    const minorVersion =
      typeof router?.['minor_version'] === 'number' ? router['minor_version'] : 0;
    const routerAddress = normalizeTonAddress(record['router_address']);
    if (!router || !routerAddress || majorVersion !== 2) throw new SwapError('unsupported_dex');
    if (this.config.stonAllowedRouters && this.config.stonAllowedRouters.length > 0) {
      const allowed = this.config.stonAllowedRouters
        .map((entry) => normalizeTonAddress(entry))
        .filter((entry): entry is string => entry !== null);
      if (!allowed.includes(routerAddress)) throw new SwapError('unsupported_dex');
    }

    const askUnits = readDigits(record['ask_units']);
    const providerMin = readDigits(record['min_ask_units']);
    if (askUnits === null || providerMin === null || askUnits === '0') {
      throw new SwapError('no_route');
    }
    // Independent slippage math; take the stricter of the two minima.
    const computedMin = minReceivedRaw(askUnits, request.slippageBps);
    const minReceived = BigInt(computedMin) < BigInt(providerMin) ? computedMin : providerMin;
    if (minReceived === '0') throw new SwapError('no_route');

    const ptonMasterAddress = normalizeTonAddress(router['pton_master_address']);
    const ptonWalletAddress = normalizeTonAddress(router['pton_wallet_address']);
    const askJettonWalletAddress = normalizeTonAddress(record['ask_jetton_wallet']);
    if (!ptonMasterAddress || !ptonWalletAddress || !askJettonWalletAddress) {
      throw new SwapError('swap_unavailable');
    }
    const gasParams =
      typeof record['gas_params'] === 'object' && record['gas_params'] !== null
        ? (record['gas_params'] as Record<string, unknown>)
        : undefined;

    return {
      network: this.config.network,
      offer: { address: offerAddress, units: request.offerUnits },
      ask: { address: askAddress, units: askUnits, minUnits: minReceived },
      minReceivedRaw: minReceived,
      slippageBps: request.slippageBps,
      priceImpact: readNumber(record['price_impact']),
      swapRate: readNumber(record['swap_rate']),
      providerMinUnits: providerMin,
      feeBps,
      feeUnits: referralAddress ? (readDigits(record['fee_units']) ?? '0') : '0',
      referralAddress,
      router: {
        address: routerAddress,
        majorVersion,
        minorVersion,
        routerType: typeof router['router_type'] === 'string' ? router['router_type'] : '',
        ptonMasterAddress,
        ptonWalletAddress,
        ptonVersion: typeof router['pton_version'] === 'string' ? router['pton_version'] : '',
        poolAddress: normalizeTonAddress(record['pool_address']) ?? '',
      },
      direction: directionOf(request.offerKind, request.askKind),
      offerJettonWalletAddress: offerJettonWallet,
      askJettonWalletAddress,
      gas: {
        gasBudget: readDigits(gasParams?.['gas_budget']),
        forwardGas: readDigits(gasParams?.['forward_gas']),
        estimatedGasConsumption: readDigits(gasParams?.['estimated_gas_consumption']),
      },
      quotedAt: Date.now(),
    };
  }
}

function directionOf(offer: 'native' | 'jetton', ask: 'native' | 'jetton'): SwapDirection {
  if (offer === 'native') return 'ton->jetton';
  if (ask === 'native') return 'jetton->ton';
  return 'jetton->jetton';
}

function readDigits(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
