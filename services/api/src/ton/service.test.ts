/**
 * P2a API tests with a mocked upstream. No network, no keys: the fake fetch asserts that the
 * key is sent only as a header and that responses are normalized into TON read models.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Address, beginCell } from '@ton/core';
import { getTonActivity, getTonPortfolio } from './service';
import { clearCache } from './cache';
import { ProviderError, type FetchLike } from './http';
import { normalizeTonAddress, readLimit, readTonNetwork } from './validation';
import type { ServerConfig } from '../config';

const ADDRESS = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';
const OTHER = '0:1111111111111111111111111111111111111111111111111111111111111111';
const JETTON = '-1:27b3b038792c090b59897fbd890c4f5bc8a63d9ffc716f5861968972f617908b';
const CONFIG: ServerConfig = {
  provider: 'toncenter',
  network: 'testnet',
  toncenterTestnetApiKey: 'test-key',
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

function mockFetch(handler: (url: string) => unknown): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const body = handler(decodeURIComponent(url));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  };
  return { fetchImpl, calls };
}

function accountInfo(balance: string, status: string): unknown {
  return { balance, status };
}

function jettonWallets(): unknown {
  return {
    jetton_wallets: [
      {
        address: '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        jetton: JETTON,
        owner: ADDRESS,
        balance: '2500000',
      },
    ],
    address_book: {},
  };
}

function jettonMeta(): unknown {
  return {
    metadata: { symbol: 'USDT', name: 'Tether USD', decimals: '6' },
    verification: 'none',
  };
}

function rates(usd = 1.5): unknown {
  return {
    rates: { TON: { prices: { USD: usd }, diff_24h: { USD: '+2.00%' } } },
  };
}

function textBody(comment: string): string {
  return beginCell().storeUint(0, 32).storeStringTail(comment).endCell().toBoc().toString('base64');
}

function jettonInBody(amount: bigint): string {
  return beginCell()
    .storeUint(0x178d4519, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(OTHER))
    .storeAddress(Address.parse(ADDRESS))
    .storeCoins(0)
    .endCell()
    .toBoc()
    .toString('base64');
}

function transactions(): unknown {
  const base = {
    lt: '1',
    now: 1_700_000_000,
    total_fees: '1000000',
    description: { action: { success: true } },
    out_msgs: [],
  };
  return {
    transactions: [
      {
        ...base,
        hash: 'hash-in',
        in_msg: {
          source: OTHER,
          destination: ADDRESS,
          value: '2000000000',
          created_at: 1_700_000_000,
          message_content: { body: textBody('pay at https://scam.example now') },
        },
      },
      {
        ...base,
        hash: 'hash-out',
        lt: '2',
        in_msg: null,
        out_msgs: [
          {
            source: ADDRESS,
            destination: OTHER,
            value: '500000000',
            created_at: 1_700_000_001,
            message_content: { body: textBody('thanks') },
          },
        ],
      },
      {
        ...base,
        hash: 'hash-dust',
        lt: '3',
        in_msg: {
          source: OTHER,
          destination: ADDRESS,
          value: '0',
          message_content: { body: textBody('https://spam') },
        },
      },
      {
        ...base,
        hash: 'hash-jetton',
        lt: '4',
        in_msg: {
          source: '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          destination: ADDRESS,
          value: '0',
          message_content: { body: jettonInBody(5_000_000n) },
        },
      },
    ],
    address_book: { [OTHER]: { user_friendly: 'UQOtherFriendly' } },
  };
}

beforeEach(() => {
  clearCache();
});

describe('TON portfolio normalization', () => {
  it('returns TON (never GRAM), BigInt-formatted balances, jettons and USD totals', async () => {
    const { fetchImpl, calls } = mockFetch((url) => {
      if (url.includes('/addressInformation')) return accountInfo('1500000000', 'active');
      if (url.includes('/jetton/wallets')) return jettonWallets();
      if (url.includes('/v2/rates')) return rates();
      if (url.includes('/v2/jettons/')) return jettonMeta();
      throw new Error(`unexpected ${url}`);
    });
    const portfolio = await getTonPortfolio(ADDRESS, 'testnet', { config: CONFIG, fetchImpl });
    expect(portfolio.source).toBe('toncenter');
    expect(portfolio.status).toBe('active');
    expect(portfolio.balanceRaw).toBe('1500000000');
    expect(portfolio.balance).toBe('1.5');
    expect(portfolio.priceUsd).toBe(1.5);
    expect(portfolio.change24h).toBe(2);
    expect(portfolio.totalUsd).toBe(2.25);
    const [native, jetton] = portfolio.assets;
    expect(native?.symbol).toBe('TON');
    expect(native?.name).toBe('Toncoin');
    expect(native?.usdValue).toBe(2.25);
    expect(jetton?.symbol).toBe('USDT');
    expect(jetton?.name).toBe('Tether USD');
    expect(jetton?.balance).toBe('2.5');
    expect(jetton?.usdValue).toBeNull();
    // The key is a header, never a URL, and the base URL is testnet.
    expect(calls.some((call) => call.url.includes('test-key'))).toBe(false);
    expect(
      calls
        .filter((call) => call.url.includes('/api/v3'))
        .every((call) => call.headers['X-API-Key'] === 'test-key'),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.url.includes('/api/v3'))
        .every((call) => call.url.startsWith('https://testnet.toncenter.com/')),
    ).toBe(true);
  });

  it('falls back to TonAPI when TON Center fails (native account + price)', async () => {
    const fetchImpl: FetchLike = (url) => {
      if (url.includes('/api/v3/addressInformation')) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      if (url.includes('/v2/accounts/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ balance: 3000000000, status: 'active' }),
        });
      }
      if (url.includes('/v2/rates')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rates(2)) });
      }
      throw new ProviderError('tonapi');
    };
    const portfolio = await getTonPortfolio(ADDRESS, 'testnet', { config: CONFIG, fetchImpl });
    expect(portfolio.source).toBe('tonapi');
    expect(portfolio.balance).toBe('3');
    expect(portfolio.totalUsd).toBe(6);
    expect(portfolio.assets).toHaveLength(1);
  });
});

describe('TON activity normalization', () => {
  it('maps native and jetton transfers, neutralizes comments and filters dust', async () => {
    const { fetchImpl } = mockFetch((url) => {
      if (url.includes('/transactions')) return transactions();
      if (url.includes('/jetton/wallets')) return jettonWallets();
      if (url.includes('/v2/jettons/')) return jettonMeta();
      if (url.includes('/v2/rates')) return rates();
      throw new Error(`unexpected ${url}`);
    });
    const items = await getTonActivity(ADDRESS, 'testnet', 20, { config: CONFIG, fetchImpl });
    const ids = items.map((item) => item.id);
    expect(ids).not.toContain('hash-dust:3:in');
    const incoming = items.find((item) => item.id === 'hash-in:1:in');
    expect(incoming).toMatchObject({
      direction: 'in',
      standard: 'native',
      symbol: 'TON',
      amount: '2',
      amountRaw: '2000000000',
      counterparty: 'UQOtherFriendly',
      fee: '0.001',
      status: 'ok',
    });
    expect(incoming?.comment).toBe('pay at [link removed] now');

    const outgoing = items.find((item) => item.id === 'hash-out:2:out:0');
    expect(outgoing).toMatchObject({
      direction: 'out',
      amount: '0.5',
      counterparty: 'UQOtherFriendly',
    });

    const jetton = items.find((item) => item.id === 'hash-jetton:4:jin');
    expect(jetton).toMatchObject({
      standard: 'jetton',
      symbol: 'USDT',
      decimals: 6,
      amount: '5',
      amountRaw: '5000000',
    });
  });

  it('falls back to TonAPI events when TON Center fails', async () => {
    const fetchImpl: FetchLike = (url) => {
      if (url.includes('/api/v3/transactions')) {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      }
      if (url.includes('/events')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              events: [
                {
                  event_id: 'evt1',
                  timestamp: 1_700_000_000,
                  actions: [
                    {
                      type: 'TonTransfer',
                      status: 'ok',
                      TonTransfer: {
                        sender: { address: OTHER, is_scam: false },
                        recipient: { address: ADDRESS, is_scam: false },
                        amount: 1000000000,
                        comment: 'hello https://scam',
                      },
                    },
                  ],
                },
              ],
            }),
        });
      }
      if (url.includes('/jetton/wallets')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ jetton_wallets: [] }),
        });
      }
      throw new ProviderError('tonapi');
    };
    const items = await getTonActivity(ADDRESS, 'testnet', 20, { config: CONFIG, fetchImpl });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      direction: 'in',
      amount: '1',
      comment: 'hello [link removed]',
    });
  });
});

describe('query validation', () => {
  it('normalizes raw and user-friendly TON addresses, rejecting everything else', () => {
    expect(normalizeTonAddress(ADDRESS)).toBe(ADDRESS);
    expect(normalizeTonAddress('0QDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY')).toMatch(/^0:/);
    expect(normalizeTonAddress('not-an-address')).toBeNull();
    expect(normalizeTonAddress(42)).toBeNull();
  });

  it('reads network and limit strictly', () => {
    expect(readTonNetwork('testnet')).toBe('testnet');
    expect(readTonNetwork('mainnet')).toBe('mainnet');
    expect(readTonNetwork('devnet')).toBeNull();
    expect(readLimit('10', 20, 50)).toBe(10);
    expect(readLimit('999', 20, 50)).toBe(50);
    expect(readLimit('-1', 20, 50)).toBe(20);
    expect(readLimit(undefined, 20, 50)).toBe(20);
  });
});
