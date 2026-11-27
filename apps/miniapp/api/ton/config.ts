/**
 * GET /api/ton/config — public, read-only network configuration for the Mini App.
 *
 * The static bundle has no build-time network switch, so the app asks the same-origin API which
 * network its calls must target. Only non-secret facts are returned: never an address, key or
 * provider URL.
 */
import {
  collectableSwapFeeBps,
  isReferralConfigured,
  loadServerConfig,
  stakingEnabledFor,
  swapEnabledFor,
} from '@onezerowallet/api';

interface ApiRequest {
  method?: string | undefined;
}

interface ApiResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function send(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // Network switch and fee policy may change with a deployment; never cache at the edge.
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (req.method !== undefined && req.method !== 'GET') {
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const loaded = loadServerConfig(process.env);
  if (!loaded.ok) {
    send(res, 500, { error: 'server_misconfigured' });
    return;
  }
  const { config } = loaded;
  send(res, 200, {
    network: config.network,
    swapEnabled: swapEnabledFor(config),
    stakingEnabled: stakingEnabledFor(config),
    swapFeeBps: collectableSwapFeeBps(config),
    referralConfigured: isReferralConfigured(config),
  });
}
