/**
 * GET /api/ton/swap/assets?network=testnet|mainnet
 *
 * Same-origin proxy for STON.fi DEX v2 swappable assets. The Mini App never calls STON.fi
 * directly (CSP `connect-src 'self'`), and provider errors are clean.
 */
import {
  loadServerConfig,
  ProviderError,
  readTonNetwork,
  SwapError,
  SwapService,
} from '@onezerowallet/api';

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
    const assets = await new SwapService({ config: loaded.config }).assets();
    send(res, 200, { network, assets });
  } catch (error) {
    if (error instanceof ProviderError) {
      send(res, 502, { error: 'upstream_unavailable' });
      return;
    }
    if (error instanceof SwapError) {
      send(res, 503, { error: error.code });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
