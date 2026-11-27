/**
 * GET /api/ton/wallet-state?address=<ton address>&network=testnet
 *
 * Returns wallet status, balance and the V5R1 seqno needed to build the next transfer.
 */
import {
  guardTonRequest,
  getWalletState,
  loadServerConfig,
  normalizeTonAddress,
  ProviderError,
  readTonNetwork,
} from '@onezerowallet/api';

interface ApiRequest {
  headers?: Record<string, string | string[] | undefined> | undefined;
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
  res.setHeader('cache-control', 'no-store');
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
  if (!guardTonRequest(req, res, loaded.config, 'read').ok) return;
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
    send(res, 200, await getWalletState(address, network, { config: loaded.config }));
  } catch (error) {
    if (error instanceof ProviderError) {
      send(res, 502, { error: 'upstream_unavailable' });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
