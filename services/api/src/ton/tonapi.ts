/**
 * TonAPI v2 client (read-only), used for prices/jetton metadata and as a fallback provider.
 *
 * Verified against testnet.tonapi.io on 2026-11-22:
 * - GET /v2/rates?tokens=ton&currencies=usd
 * - GET /v2/jettons/{master}
 * - GET /v2/accounts/{address}
 * - GET /v2/accounts/{address}/events?limit=…
 *
 * The key (when configured) is sent only as Authorization: Bearer.
 */
import type { TonAccountStatus } from '@onezerowallet/chain-ton';
import { ProviderError, fetchJson, type FetchLike } from './http.js';

export interface TonApiOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

export interface TonApiPrice {
  usd: number | null;
  change24h: number | null;
}

export interface TonApiJettonMeta {
  symbol: string;
  name: string;
  decimals: number;
  isScam: boolean;
}

export interface TonApiEventTransfer {
  direction: 'in' | 'out';
  amountRaw: string;
  counterparty: string;
  comment: string | null;
  symbol: string | null;
  decimals: number | null;
  standard: 'native' | 'jetton';
  isScam: boolean;
  isBounce: boolean;
}

export interface TonApiEvent {
  eventId: string;
  timestamp: number;
  hash: string;
  status: 'ok' | 'failed' | 'pending';
  transfers: TonApiEventTransfer[];
}

export interface TonApiAccount {
  balanceRaw: string;
  status: TonAccountStatus;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Parse "+3.05%" / "−4.48%" (U+2212) into a number. */
export function parseChange(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace('−', '-').replace('%', '').trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapStatus(value: unknown): TonAccountStatus {
  return value === 'active' || value === 'uninit' || value === 'frozen' || value === 'nonexist'
    ? value
    : 'nonexist';
}

export class TonApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: TonApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs;
  }

  private get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    return fetchJson<T>('tonapi', `${this.baseUrl}${path}${query}`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  async rates(): Promise<TonApiPrice> {
    const json = await this.get<unknown>('/v2/rates', { tokens: 'ton', currencies: 'usd' });
    const rates = record(json) ? record((record(json) as Record<string, unknown>)['rates']) : null;
    const ton = rates ? record(rates['TON']) : null;
    const prices = ton ? record(ton['prices']) : null;
    const diff = ton ? record(ton['diff_24h']) : null;
    return {
      usd: prices ? num(prices['USD']) : null,
      change24h: diff ? parseChange(diff['USD']) : null,
    };
  }

  async jetton(master: string): Promise<TonApiJettonMeta> {
    const json = await this.get<unknown>(`/v2/jettons/${encodeURIComponent(master)}`);
    const meta = record(json)
      ? record((record(json) as Record<string, unknown>)['metadata'])
      : null;
    return {
      symbol: (meta ? str(meta['symbol']) : null) ?? 'JETTON',
      name: (meta ? str(meta['name']) : null) ?? 'Unknown jetton',
      decimals: Number.parseInt((meta ? str(meta['decimals']) : null) ?? '9', 10) || 9,
      isScam: record(json)?.['verification'] === 'blacklist',
    };
  }

  async account(address: string): Promise<TonApiAccount> {
    const json = await this.get<unknown>(`/v2/accounts/${encodeURIComponent(address)}`);
    const account = record(json);
    if (!account) throw new ProviderError('tonapi');
    return {
      balanceRaw: typeof account['balance'] === 'number' ? String(account['balance']) : '0',
      status: mapStatus(account['status']),
    };
  }

  async events(address: string, limit: number): Promise<TonApiEvent[]> {
    const json = await this.get<unknown>(`/v2/accounts/${encodeURIComponent(address)}/events`, {
      limit: String(limit),
    });
    const root = record(json);
    if (!root) throw new ProviderError('tonapi');
    const self = address.toLowerCase();
    return list(root['events']).flatMap((entry) => {
      const event = record(entry);
      const id = event ? str(event['event_id']) : null;
      if (!event || !id) return [];
      const transfers: TonApiEventTransfer[] = [];
      for (const actionEntry of list(event['actions'])) {
        const action = record(actionEntry);
        if (!action) continue;
        const type = str(action['type']);
        if (type === 'TonTransfer') {
          const transfer = record(action['TonTransfer']);
          const sender = transfer ? record(transfer['sender']) : null;
          const recipient = transfer ? record(transfer['recipient']) : null;
          const amount = transfer ? num(transfer['amount']) : null;
          const from = sender ? str(sender['address']) : null;
          const to = recipient ? str(recipient['address']) : null;
          if (!transfer || amount === null || !from || !to) continue;
          const incoming = to.toLowerCase() === self;
          transfers.push({
            direction: incoming ? 'in' : 'out',
            amountRaw: String(amount),
            counterparty: incoming ? from : to,
            comment: str(transfer['comment']),
            symbol: 'TON',
            decimals: 9,
            standard: 'native',
            isScam: sender ? sender['is_scam'] === true : false,
            isBounce: transfer['bounced'] === true,
          });
        } else if (type === 'JettonTransfer') {
          const transfer = record(action['JettonTransfer']);
          const sender = transfer ? record(transfer['sender']) : null;
          const recipient = transfer ? record(transfer['recipient']) : null;
          const jetton = transfer ? record(transfer['jetton']) : null;
          const amount = transfer ? str(transfer['amount']) : null;
          const from = sender ? str(sender['address']) : null;
          const to = recipient ? str(recipient['address']) : null;
          if (!transfer || !amount || !from || !to) continue;
          const incoming = to.toLowerCase() === self;
          transfers.push({
            direction: incoming ? 'in' : 'out',
            amountRaw: amount,
            counterparty: incoming ? from : to,
            comment: str(transfer['comment']),
            symbol: jetton ? str(jetton['symbol']) : null,
            decimals: jetton ? (num(jetton['decimals']) ?? 9) : 9,
            standard: 'jetton',
            isScam: sender ? sender['is_scam'] === true : false,
            isBounce: transfer['bounced'] === true,
          });
        }
      }
      return [
        {
          eventId: id,
          timestamp: num(event['timestamp']) ?? 0,
          hash: id,
          status: event['in_progress'] === true ? 'pending' : 'ok',
          transfers,
        },
      ];
    });
  }
}
