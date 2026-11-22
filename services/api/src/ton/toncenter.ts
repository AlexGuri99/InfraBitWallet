/**
 * TON Center API v3 client (read-only).
 *
 * Endpoints used (verified against testnet.toncenter.com on 2026-11-22):
 * - GET /api/v3/addressInformation?address=…            -> balance, status
 * - GET /api/v3/jetton/wallets?owner_address=…          -> jetton wallets
 * - GET /api/v3/transactions?account=…&limit=…          -> transactions + address_book
 *
 * The API key is sent only in the X-API-Key header (header name tracked in UNVERIFIED.md #23).
 */
import type { TonAccountStatus } from '@onezerowallet/chain-ton';
import { ProviderError, fetchJson, type FetchLike } from './http';

export interface TonCenterOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

export interface TonCenterAccountInfo {
  balanceRaw: string;
  status: TonAccountStatus;
}

export interface TonCenterJettonWallet {
  /** The user's jetton wallet contract address (appears as the transfer source). */
  address: string;
  /** The jetton master address. */
  jetton: string;
  balanceRaw: string;
}

export interface TonCenterMessage {
  source: string | null;
  destination: string | null;
  valueRaw: string;
  createdAt: number;
  body: string | null;
}

export interface TonCenterTransaction {
  hash: string;
  lt: string;
  now: number;
  totalFeesRaw: string;
  success: boolean;
  inMessage: TonCenterMessage | null;
  outMessages: TonCenterMessage[];
}

export interface TonCenterTransactions {
  transactions: TonCenterTransaction[];
  /** address -> user-friendly form (from the response's address_book). */
  addressBook: Record<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseStatus(value: unknown): TonAccountStatus {
  return value === 'active' || value === 'uninit' || value === 'frozen' || value === 'nonexist'
    ? value
    : 'nonexist';
}

function parseMessage(value: unknown): TonCenterMessage | null {
  const msg = asRecord(value);
  if (!msg) return null;
  const content = asRecord(msg['message_content']);
  return {
    source: asString(msg['source']),
    destination: asString(msg['destination']),
    valueRaw: asString(msg['value']) ?? '0',
    createdAt: asNumber(msg['created_at']) ?? 0,
    body: content ? asString(content['body']) : null,
  };
}

function parseTransaction(value: unknown): TonCenterTransaction | null {
  const tx = asRecord(value);
  if (!tx) return null;
  const hash = asString(tx['hash']);
  const lt = asString(tx['lt']);
  if (!hash || !lt) return null;
  const description = asRecord(tx['description']);
  const action = description ? asRecord(description['action']) : null;
  return {
    hash,
    lt,
    now: asNumber(tx['now']) ?? 0,
    totalFeesRaw: asString(tx['total_fees']) ?? '0',
    success: action ? action['success'] !== false : true,
    inMessage: parseMessage(tx['in_msg']),
    outMessages: asArray(tx['out_msgs'])
      .map((msg) => parseMessage(msg))
      .filter((msg): msg is TonCenterMessage => msg !== null),
  };
}

export class TonCenterClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly timeoutMs: number | undefined;

  constructor(options: TonCenterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs;
  }

  private get<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(params).toString();
    return fetchJson<T>('toncenter', `${this.baseUrl}/api/v3${path}?${query}`, {
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  async accountInfo(address: string): Promise<TonCenterAccountInfo> {
    const json = await this.get<unknown>('/addressInformation', { address });
    const record = asRecord(json);
    if (!record) throw new ProviderError('toncenter');
    return {
      balanceRaw: asString(record['balance']) ?? '0',
      status: parseStatus(record['status']),
    };
  }

  async jettonWallets(address: string): Promise<TonCenterJettonWallet[]> {
    const json = await this.get<unknown>('/jetton/wallets', {
      owner_address: address,
      exclude_zero_balance: 'true',
    });
    const record = asRecord(json);
    if (!record) throw new ProviderError('toncenter');
    return asArray(record['jetton_wallets']).flatMap((entry) => {
      const wallet = asRecord(entry);
      const jetton = wallet ? asString(wallet['jetton']) : null;
      const balance = wallet ? asString(wallet['balance']) : null;
      const address = wallet ? asString(wallet['address']) : null;
      return jetton && balance && address ? [{ address, jetton, balanceRaw: balance }] : [];
    });
  }

  async transactions(address: string, limit: number): Promise<TonCenterTransactions> {
    const json = await this.get<unknown>('/transactions', {
      account: address,
      limit: String(limit),
    });
    const record = asRecord(json);
    if (!record) throw new ProviderError('toncenter');
    const book = asRecord(record['address_book']) ?? {};
    const addressBook: Record<string, string> = {};
    for (const [key, entry] of Object.entries(book)) {
      const friendly = asRecord(entry)
        ? asString((entry as Record<string, unknown>)['user_friendly'])
        : null;
      if (friendly) addressBook[key] = friendly;
    }
    return {
      transactions: asArray(record['transactions'])
        .map((tx) => parseTransaction(tx))
        .filter((tx): tx is TonCenterTransaction => tx !== null),
      addressBook,
    };
  }
}
