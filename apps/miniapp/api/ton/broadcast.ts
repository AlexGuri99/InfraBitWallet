/**
 * POST /api/ton/broadcast  { boc, network }
 *
 * Submits the client-signed external message. The service cannot sign anything.
 */
import {
  broadcastBoc,
  loadServerConfig,
  ProviderError,
  readTonNetwork,
  validateBocBase64,
} from '@onezerowallet/api';

interface ApiRequest {
  method?: string | undefined;
  body?: unknown;
}

interface ApiResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function send(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'object' && body !== null) return body as Record<string, unknown>;
  if (typeof body === 'string' && body.length <= 200_000) {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== undefined && req.method !== 'POST') {
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const loaded = loadServerConfig(process.env);
  if (!loaded.ok) {
    send(res, 500, { error: 'server_misconfigured' });
    return;
  }
  const body = readBody(req.body);
  const boc = validateBocBase64(body?.['boc']);
  if (!boc) {
    send(res, 400, { error: 'invalid_boc' });
    return;
  }
  const network = readTonNetwork(body?.['network'] ?? loaded.config.network);
  if (!network || network !== loaded.config.network) {
    send(res, 400, { error: 'invalid_network' });
    return;
  }
  try {
    send(res, 200, await broadcastBoc(boc, { config: loaded.config }));
  } catch (error) {
    if (error instanceof ProviderError) {
      send(res, 502, { error: 'upstream_unavailable' });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
