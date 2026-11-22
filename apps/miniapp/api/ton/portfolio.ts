/**
 * GET /api/ton/portfolio?address=<ton address>&network=testnet
 *
 * Same-origin serverless proxy. API keys stay server-side; the Mini App only talks to `/api/*`
 * (CSP connect-src stays 'self'). Errors are clean and never include upstream bodies or keys.
 */
import { loadServerConfig } from '../../../../services/api/src/config';
import { getTonPortfolio } from '../../../../services/api/src/ton/service';
import { normalizeTonAddress, readTonNetwork } from '../../../../services/api/src/ton/validation';
import { ProviderError } from '../../../../services/api/src/ton/http';

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
  try {
    const portfolio = await getTonPortfolio(address, network, { config: loaded.config });
    send(res, 200, portfolio);
  } catch (error) {
    if (error instanceof ProviderError) {
      send(res, 502, { error: 'upstream_unavailable' });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
