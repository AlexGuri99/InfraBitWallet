/**
 * GET /api/ton/activity?address=<ton address>&network=testnet&limit=20
 *
 * Normalized, sanitized activity (comments stripped of URLs, zero-value dust removed).
 */
import {
  getTonActivity,
  loadServerConfig,
  normalizeTonAddress,
  ProviderError,
  readLimit,
  readTonNetwork,
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
  res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=30');
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
  const address = normalizeTonAddress(first(req.query?.['address']));
  if (!address) {
    send(res, 400, { error: 'invalid_address' });
    return;
  }
  const network = readTonNetwork(first(req.query?.['network']) ?? loaded.config.network);
  if (!network || network !== loaded.config.network) {
    send(res, 400, { error: 'invalid_network' });
    return;
  }
  const limit = readLimit(first(req.query?.['limit']), 20, 50);
  try {
    const items = await getTonActivity(address, network, limit, { config: loaded.config });
    send(res, 200, { items });
  } catch (error) {
    if (error instanceof ProviderError) {
      send(res, 502, { error: 'upstream_unavailable' });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
