/**
 * GET /api/ton/staking/info?network=testnet|mainnet
 *
 * Same-origin proxy for Tonstakers pool metrics. The Mini App never calls TonAPI directly
 * (CSP `connect-src 'self'`). Testnet has no published Tonstakers metrics and fails closed with
 * `staking_unavailable`; mainnet is served only when the server runs with `TON_NETWORK=mainnet`.
 */
import { loadServerConfig, readTonNetwork, StakingError, StakingService } from '@onezerowallet/api';

interface ApiRequest {
  method?: string | undefined;
  query?: Record<string, string | string[] | undefined>;
}

interface ApiResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function send(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=120');
  res.end(JSON.stringify(body));
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== undefined && req.method !== 'GET') {
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const loaded = loadServerConfig(process.env);
  if (!loaded.ok) {
    send(res, 500, { error: 'server_misconfigured' });
    return;
  }
  const network = readTonNetwork(first(req.query?.['network']) ?? loaded.config.network);
  if (!network || network !== loaded.config.network) {
    send(res, 400, { error: 'invalid_network' });
    return;
  }
  try {
    send(res, 200, await new StakingService({ config: loaded.config }).info({ network }));
  } catch (error) {
    if (error instanceof StakingError) {
      send(res, error.code === 'invalid_request' ? 400 : 503, { error: error.code });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
