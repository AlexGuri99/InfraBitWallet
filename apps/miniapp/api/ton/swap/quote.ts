/**
 * POST /api/ton/swap/quote  { network, offerAsset, askAsset, offerKind, askKind, offerUnits,
 *                             slippageBps, userAddress, offerJettonWallet? }
 *
 * Same-origin STON.fi DEX v2 simulation proxy. The referral address and fee stay server-side;
 * the response carries only what the review screen needs.
 */
import {
  guardTonRequest,
  loadServerConfig,
  ProviderError,
  readTonNetwork,
  SwapError,
  SwapService,
} from '@onezerowallet/api';

interface ApiRequest {
  headers?: Record<string, string | string[] | undefined> | undefined;
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
  if (typeof body === 'string' && body.length <= 20_000) {
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

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function kind(value: unknown): 'native' | 'jetton' | null {
  return value === 'native' || value === 'jetton' ? value : null;
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
  if (!guardTonRequest(req, res, loaded.config, 'heavy').ok) return;
  const body = readBody(req.body);
  const network = readTonNetwork(body?.['network'] ?? loaded.config.network);
  const offerAsset = str(body?.['offerAsset']);
  const askAsset = str(body?.['askAsset']);
  const offerKind = kind(body?.['offerKind']);
  const askKind = kind(body?.['askKind']);
  const offerUnits = str(body?.['offerUnits']);
  const userAddress = str(body?.['userAddress']);
  const slippageBps = body?.['slippageBps'];
  const offerJettonWallet = str(body?.['offerJettonWallet']) ?? undefined;
  if (
    !network ||
    network !== loaded.config.network ||
    !offerAsset ||
    !askAsset ||
    !offerKind ||
    !askKind ||
    !offerUnits ||
    !userAddress ||
    typeof slippageBps !== 'number'
  ) {
    send(res, 400, { error: 'invalid_request' });
    return;
  }
  try {
    const quote = await new SwapService({ config: loaded.config }).quote({
      network,
      offerAsset,
      askAsset,
      offerKind,
      askKind,
      offerUnits,
      slippageBps,
      userAddress,
      ...(offerJettonWallet ? { offerJettonWallet } : {}),
    });
    send(res, 200, quote);
  } catch (error) {
    if (error instanceof SwapError) {
      send(res, error.code === 'invalid_request' ? 400 : 503, { error: error.code });
      return;
    }
    if (error instanceof ProviderError) {
      send(res, 502, { error: 'upstream_unavailable' });
      return;
    }
    send(res, 500, { error: 'internal_error' });
  }
}
