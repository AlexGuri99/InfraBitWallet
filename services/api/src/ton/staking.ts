/**
 * Tonstakers liquid-staking info proxy (server-only).
 *
 * The Mini App never calls TonAPI directly (`connect-src 'self'`), and the pool address is always
 * the reviewed Tonstakers constant — never a provider-supplied one.
 *
 * Sources, verified 2026-11-26:
 * - `tonstakers/tonstakers-sdk` `src/tonstakers.ts` (MIT): pool info via
 *   `GET /v2/staking/pool/{account_id}`, rates from pool `total_balance`/`supply`, instant
 *   liquidity from the pool account balance.
 * - TonAPI OpenAPI (`tonapi.io/v2/openapi.json`): `GET /v2/staking/pool/{account_id}` → PoolInfo
 *   (`apy`, `total_amount`, `current_nominators`, `verified`, `liquid_jetton_master`);
 *   `GET /v2/jettons/{account_id}` → `total_supply` (string), `metadata`.
 * - Live TonAPI mainnet (2026-11-26): implementation "Tonstakers", `verified: true`, tsTON master
 *   `0:bdf3fa…`, APY ≈ 12.8%.
 *
 * No testnet metrics API is documented for the Tonstakers pool, so testnet fails closed with
 * `staking_unavailable` rather than inventing numbers. Mainnet is wired behind the existing
 * `TON_NETWORK=mainnet` switch (CLAUDE.md §6).
 *
 * TonAPI serializes `total_amount` as a JSON number, which is imprecise above 2^53; the value is
 * display-only (TVL and rate), never used to build a message. The jetton supply is a string and
 * stays exact.
 */
import type { TonNetwork } from '@onezerowallet/chain-ton';
import { TONSTAKERS_POOL_MAINNET } from '@onezerowallet/staking-ton';
import type { ServerConfig } from '../config.js';
import { ProviderError, fetchJson, type FetchLike } from './http.js';
import { normalizeTonAddress } from './validation.js';

export type StakingErrorCode = 'invalid_request' | 'staking_unavailable';

export class StakingError extends Error {
  readonly code: StakingErrorCode;

  constructor(code: StakingErrorCode) {
    super(code);
    this.name = 'StakingError';
    this.code = code;
  }
}

/** Documented mainnet TonAPI base (testnet carries no Tonstakers metrics). */
export const TONAPI_MAINNET_URL = 'https://tonapi.io' as const;

export interface StakingInfo {
  network: TonNetwork;
  /** Reviewed Tonstakers pool, raw form. */
  poolAddress: string;
  /** tsTON jetton master, raw form. */
  tsTonMasterAddress: string;
  tsTonSymbol: string;
  tsTonDecimals: number;
  /** APY in percent. */
  apy: number;
  /** Total TON accounted by the pool, nanoTON (display only; see module note). */
  tvlRaw: string;
  stakers: number;
  /** TON currently available for instant unstake, nanoTON. */
  instantLiquidityRaw: string;
  /** TON per 1 tsTON (`total_amount / supply`). */
  exchangeRate: number;
  verified: boolean;
  updatedAt: number;
}

export class StakingService {
  private readonly config: ServerConfig;
  private readonly fetchImpl: FetchLike | undefined;

  constructor(options: { config: ServerConfig; fetchImpl?: FetchLike | undefined }) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl;
  }

  private get<T>(path: string): Promise<T> {
    // TonAPI works keyless but is rate-limited; a configured key stays in the header only.
    return fetchJson<T>('tonapi', `${TONAPI_MAINNET_URL}${path}`, {
      headers: this.config.tonapiApiKey
        ? { Authorization: `Bearer ${this.config.tonapiApiKey}` }
        : {},
      fetchImpl: this.fetchImpl,
    });
  }

  async info(request: { network: string }): Promise<StakingInfo> {
    if (request.network !== this.config.network) throw new StakingError('invalid_request');
    // Testnet metrics are not published; never fabricate them.
    if (this.config.network !== 'mainnet') throw new StakingError('staking_unavailable');

    const poolAddress = normalizeTonAddress(TONSTAKERS_POOL_MAINNET);
    if (!poolAddress) throw new StakingError('staking_unavailable');

    let poolJson: unknown;
    try {
      poolJson = await this.get<unknown>(
        `/v2/staking/pool/${encodeURIComponent(TONSTAKERS_POOL_MAINNET)}`,
      );
    } catch (error) {
      if (error instanceof ProviderError) throw new StakingError('staking_unavailable');
      throw error;
    }

    const root = record(poolJson);
    const implementation = root ? record(root['implementation']) : null;
    const pool = root ? record(root['pool']) : null;
    if (!root || !pool) throw new StakingError('staking_unavailable');
    // Fail closed unless the provider describes the reviewed Tonstakers pool.
    if (!implementation || implementation['name'] !== 'Tonstakers') {
      throw new StakingError('staking_unavailable');
    }
    if (pool['verified'] !== true) throw new StakingError('staking_unavailable');

    const tsTonMasterAddress = normalizeTonAddress(pool['liquid_jetton_master']);
    if (!tsTonMasterAddress) throw new StakingError('staking_unavailable');

    const apy = number(pool['apy']);
    const totalAmount = amount(pool['total_amount']);
    const stakers = number(pool['current_nominators']);
    if (apy === null || totalAmount === null || stakers === null) {
      throw new StakingError('staking_unavailable');
    }

    let jettonJson: unknown;
    let accountJson: unknown;
    try {
      [jettonJson, accountJson] = await Promise.all([
        this.get<unknown>(`/v2/jettons/${encodeURIComponent(tsTonMasterAddress)}`),
        this.get<unknown>(`/v2/accounts/${encodeURIComponent(TONSTAKERS_POOL_MAINNET)}`),
      ]);
    } catch (error) {
      if (error instanceof ProviderError) throw new StakingError('staking_unavailable');
      throw error;
    }

    // The jetton endpoint must describe the same tsTON master the pool reports.
    const jetton = record(jettonJson);
    if (!jetton || normalizeTonAddress(jetton['address']) !== tsTonMasterAddress) {
      throw new StakingError('staking_unavailable');
    }
    const supplyRaw = digits(jetton['total_supply']);
    if (!supplyRaw || supplyRaw === '0') throw new StakingError('staking_unavailable');
    const metadata = record(jetton['metadata']);
    const tsTonSymbol = metadata ? str(metadata['symbol']) : null;
    const tsTonDecimals = metadata ? Number.parseInt(str(metadata['decimals']) ?? '', 10) : NaN;
    if (!tsTonSymbol || !Number.isInteger(tsTonDecimals) || tsTonDecimals < 0) {
      throw new StakingError('staking_unavailable');
    }

    const account = record(accountJson);
    const balanceRaw = account ? digits(account['balance']) : null;
    if (!account || balanceRaw === null) throw new StakingError('staking_unavailable');

    const supply = Number(supplyRaw);
    const exchangeRate = supply > 0 ? Number(totalAmount) / supply : 0;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new StakingError('staking_unavailable');
    }

    return {
      network: this.config.network,
      poolAddress,
      tsTonMasterAddress,
      tsTonSymbol,
      tsTonDecimals,
      apy,
      tvlRaw: totalAmount,
      stakers,
      instantLiquidityRaw: balanceRaw,
      exchangeRate,
      verified: true,
      updatedAt: Date.now(),
    };
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** A non-negative integer amount as a decimal string (TonAPI mixes numbers and strings). */
function amount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  return digits(value);
}

function digits(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
