/**
 * Same-origin client for the read proxy. The Mini App never sees provider API keys: it calls
 * `/api/ton/*` only, so CSP `connect-src` stays 'self'.
 */
import type { TonActivityItem, TonNetwork, TonPortfolio } from '@onezerowallet/chain-ton';

export type TonApiErrorCode = 'invalid_address' | 'offline' | 'bad_response';

export class TonApiError extends Error {
  readonly code: TonApiErrorCode;

  constructor(code: TonApiErrorCode) {
    super(code);
    this.name = 'TonApiError';
    this.code = code;
  }
}

export interface WalletStatePayload {
  address: string;
  network: TonNetwork;
  status: 'uninit' | 'active' | 'frozen' | 'nonexist';
  seqno: number;
  balanceRaw: string;
  source: 'toncenter' | 'tonapi';
}

export interface EmulationPayload {
  ok: boolean;
  estimatedFeeRaw: string;
  balanceChanges: Array<{ assetId: string; symbol: string; deltaRaw: string; decimals: number }>;
  warnings: string[];
  willBounce: boolean;
  exitCode?: number | undefined;
}

export interface BroadcastPayload {
  messageHash: { hex: string; base64: string };
}

export interface SwapAssetPayload {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  kind: 'native' | 'jetton';
  contractAddress: string;
  imageUrl: string | null;
  verified: boolean;
}

export interface SwapQuoteRequestPayload {
  network: TonNetwork;
  offerAsset: string;
  askAsset: string;
  offerKind: 'native' | 'jetton';
  askKind: 'native' | 'jetton';
  offerUnits: string;
  slippageBps: number;
  userAddress: string;
  offerJettonWallet?: string | undefined;
}

export interface SwapQuotePayload {
  network: TonNetwork;
  offer: { address: string; units: string };
  ask: { address: string; units: string; minUnits: string };
  minReceivedRaw: string;
  slippageBps: number;
  priceImpact: number | null;
  swapRate: number | null;
  providerMinUnits: string;
  feeBps: number;
  feeUnits: string;
  referralAddress: string | null;
  router: {
    address: string;
    majorVersion: number;
    minorVersion: number;
    routerType: string;
    ptonMasterAddress: string;
    ptonWalletAddress: string;
    ptonVersion: string;
    poolAddress: string;
  };
  direction: 'ton->jetton' | 'jetton->ton' | 'jetton->jetton';
  offerJettonWalletAddress: string | null;
  askJettonWalletAddress: string;
  gas: {
    gasBudget: string | null;
    forwardGas: string | null;
    estimatedGasConsumption: string | null;
  };
  quotedAt: number;
}

export interface StakingInfoPayload {
  network: TonNetwork;
  poolAddress: string;
  tsTonMasterAddress: string;
  tsTonSymbol: string;
  tsTonDecimals: number;
  apy: number;
  tvlRaw: string;
  stakers: number;
  instantLiquidityRaw: string;
  exchangeRate: number;
  verified: boolean;
  updatedAt: number;
}

export interface TonSwapApi {
  getSwapAssets(network: TonNetwork, signal?: AbortSignal): Promise<SwapAssetPayload[]>;
  getSwapQuote(request: SwapQuoteRequestPayload, signal?: AbortSignal): Promise<SwapQuotePayload>;
}

export interface TonStakeApi {
  getStakingInfo(network: TonNetwork, signal?: AbortSignal): Promise<StakingInfoPayload>;
}

export interface TonWriteApi {
  getWalletState(
    address: string,
    network: TonNetwork,
    signal?: AbortSignal,
  ): Promise<WalletStatePayload>;
  emulate(boc: string, network: TonNetwork, signal?: AbortSignal): Promise<EmulationPayload>;
  broadcast(boc: string, network: TonNetwork, signal?: AbortSignal): Promise<BroadcastPayload>;
}

export interface TonReadApi {
  getPortfolio(address: string, network: TonNetwork, signal?: AbortSignal): Promise<TonPortfolio>;
  getActivity(
    address: string,
    network: TonNetwork,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TonActivityItem[]>;
}

type FetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

async function readJson(url: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, signal ? { signal } : {});
  } catch {
    throw new TonApiError('offline');
  }
  if (!response.ok) throw new TonApiError('offline');
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TonApiError('bad_response');
  }
}

async function postJson(
  url: string,
  body: unknown,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new TonApiError('offline');
  }
  if (!response.ok) throw new TonApiError('offline');
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TonApiError('bad_response');
  }
}

function isPortfolio(value: unknown): value is TonPortfolio {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { assets?: unknown }).assets)
  );
}

export function createTonReadApi(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi {
  return {
    async getPortfolio(address, network, signal) {
      const query = new URLSearchParams({ address, network }).toString();
      const json = await readJson(`/api/ton/portfolio?${query}`, fetchImpl, signal);
      if (!isPortfolio(json)) throw new TonApiError('bad_response');
      return json;
    },
    async getActivity(address, network, limit, signal) {
      const query = new URLSearchParams({
        address,
        network,
        limit: String(limit),
      }).toString();
      const json = await readJson(`/api/ton/activity?${query}`, fetchImpl, signal);
      const items = (json as { items?: unknown }).items;
      if (!Array.isArray(items)) throw new TonApiError('bad_response');
      return items as TonActivityItem[];
    },
    async getWalletState(address, network, signal) {
      const query = new URLSearchParams({ address, network }).toString();
      return (await readJson(
        `/api/ton/wallet-state?${query}`,
        fetchImpl,
        signal,
      )) as WalletStatePayload;
    },
    async emulate(boc, network, signal) {
      const json = await postJson('/api/ton/emulate', { boc, network }, fetchImpl, signal);
      return json as EmulationPayload;
    },
    async broadcast(boc, network, signal) {
      const json = await postJson('/api/ton/broadcast', { boc, network }, fetchImpl, signal);
      return json as BroadcastPayload;
    },
    async getSwapAssets(network, signal) {
      const query = new URLSearchParams({ network }).toString();
      const json = await readJson(`/api/ton/swap/assets?${query}`, fetchImpl, signal);
      const assets = (json as { assets?: unknown }).assets;
      if (!Array.isArray(assets)) throw new TonApiError('bad_response');
      return assets as SwapAssetPayload[];
    },
    async getSwapQuote(request, signal) {
      const json = await postJson('/api/ton/swap/quote', request, fetchImpl, signal);
      if (typeof json !== 'object' || json === null || !('minReceivedRaw' in json)) {
        throw new TonApiError('bad_response');
      }
      return json as SwapQuotePayload;
    },
    async getStakingInfo(network, signal) {
      const query = new URLSearchParams({ network }).toString();
      const json = await readJson(`/api/ton/staking/info?${query}`, fetchImpl, signal);
      if (typeof json !== 'object' || json === null || !('exchangeRate' in json)) {
        throw new TonApiError('bad_response');
      }
      return json as StakingInfoPayload;
    },
  };
}
