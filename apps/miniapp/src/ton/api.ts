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

export interface TonReadApi {
  getPortfolio(address: string, network: TonNetwork, signal?: AbortSignal): Promise<TonPortfolio>;
  getActivity(
    address: string,
    network: TonNetwork,
    limit: number,
    signal?: AbortSignal,
  ): Promise<TonActivityItem[]>;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

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

function isPortfolio(value: unknown): value is TonPortfolio {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { assets?: unknown }).assets)
  );
}

export function createTonReadApi(fetchImpl: FetchLike = fetch): TonReadApi {
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
  };
}
