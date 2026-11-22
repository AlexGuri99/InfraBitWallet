/** P2b write-path tests with a mocked upstream (no network, no keys). */
import { describe, it, expect } from 'vitest';
import { beginCell } from '@ton/core';
import { broadcastBoc, emulateBoc, getWalletState } from './write.js';
import type { FetchLike } from './http.js';
import type { ServerConfig } from '../config.js';

const ADDRESS = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';
const CONFIG: ServerConfig = {
  provider: 'toncenter',
  network: 'testnet',
  toncenterTestnetApiKey: 'k',
};

interface Call {
  url: string;
  method: string;
  body: string | undefined;
}

function mock(
  handler: (url: string, method: string) => { ok: boolean; status: number; body: unknown },
) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
    const res = handler(url, init?.method ?? 'GET');
    return Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body),
    });
  };
  return { fetchImpl, calls };
}

describe('wallet-state', () => {
  it('returns seqno 0 for uninit without calling runGetMethod', async () => {
    const { fetchImpl, calls } = mock((url) => {
      if (url.includes('/walletInformation'))
        return { ok: true, status: 200, body: { balance: '0', status: 'uninit' } };
      throw new Error(url);
    });
    const state = await getWalletState(ADDRESS, 'testnet', { config: CONFIG, fetchImpl });
    expect(state).toMatchObject({
      status: 'uninit',
      seqno: 0,
      balanceRaw: '0',
      source: 'toncenter',
    });
    expect(calls.some((call) => call.url.includes('runGetMethod'))).toBe(false);
  });

  it('reads the V5R1 seqno for an active wallet', async () => {
    const { fetchImpl } = mock((url) => {
      if (url.includes('/walletInformation'))
        return { ok: true, status: 200, body: { balance: '1000', status: 'active' } };
      if (url.includes('runGetMethod'))
        return { ok: true, status: 200, body: { stack: [{ type: 'num', value: '0x5' }] } };
      throw new Error(url);
    });
    const state = await getWalletState(ADDRESS, 'testnet', { config: CONFIG, fetchImpl });
    expect(state).toMatchObject({ status: 'active', seqno: 5, balanceRaw: '1000' });
  });

  it('falls back to TonAPI when Ton Center fails', async () => {
    const { fetchImpl } = mock((url) => {
      if (url.includes('/api/v3/')) return { ok: false, status: 500, body: {} };
      if (url.includes('/v2/accounts/'))
        return { ok: true, status: 200, body: { balance: 42, status: 'active' } };
      throw new Error(url);
    });
    const state = await getWalletState(ADDRESS, 'testnet', { config: CONFIG, fetchImpl });
    expect(state).toMatchObject({ status: 'active', seqno: 0, balanceRaw: '42', source: 'tonapi' });
  });
});

const EMULATED = {
  transactions: [
    {
      total_fees: '1000000',
      description: {
        compute_ph: { exit_code: 0, aborted: false },
        action: { success: true, result_code: 0 },
      },
      account_state_before: { balance: '1000000000' },
      account_state_after: { balance: '899000000' },
    },
  ],
};

describe('emulate', () => {
  it('normalizes fees, balance changes and warnings', async () => {
    const { fetchImpl } = mock((url) => {
      if (url.includes('emulateTrace')) return { ok: true, status: 200, body: EMULATED };
      throw new Error(url);
    });
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.estimatedFeeRaw).toBe('1000000');
    expect(result.willBounce).toBe(false);
    expect(result.balanceChanges[0]).toMatchObject({
      assetId: 'ton',
      symbol: 'TON',
      deltaRaw: '-101000000',
      decimals: 9,
    });
  });

  it('flags bounce prediction and exit codes', async () => {
    const bounce = {
      transactions: [
        {
          total_fees: '1',
          description: {
            compute_ph: { exit_code: 37, aborted: false },
            action: { success: true, result_code: 37 },
          },
          account_state_before: { balance: '10' },
          account_state_after: { balance: '9' },
        },
      ],
    };
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: bounce }));
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.willBounce).toBe(true);
    expect(result.exitCode).toBe(37);
    expect(result.warnings.join(' ')).toMatch(/bounce/i);
  });

  it('falls back to TonAPI when Ton Center emulation fails', async () => {
    const { fetchImpl } = mock((url) => {
      if (url.includes('emulateTrace')) return { ok: false, status: 500, body: {} };
      if (url.includes('/v2/wallet/emulate'))
        return { ok: true, status: 200, body: { result: EMULATED } };
      throw new Error(url);
    });
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.estimatedFeeRaw).toBe('1000000');
  });
});

describe('broadcast', () => {
  it('submits and returns the external message hash', async () => {
    const cell = beginCell().storeUint(0x1234, 16).endCell();
    const boc = cell.toBoc().toString('base64');
    const { fetchImpl, calls } = mock(() => ({ ok: true, status: 200, body: {} }));
    const result = await broadcastBoc(boc, { config: CONFIG, fetchImpl });
    expect(result.messageHash.hex).toBe(cell.hash().toString('hex'));
    expect(result.messageHash.base64).toBe(cell.hash().toString('base64'));
    expect(calls[0]?.url).toContain('/api/v3/message');
    expect(calls[0]?.body).toContain('"boc"');
  });

  it('falls back to TonAPI when Ton Center broadcast fails', async () => {
    const cell = beginCell().storeUint(1, 8).endCell();
    const boc = cell.toBoc().toString('base64');
    const { fetchImpl, calls } = mock((url) => ({
      ok: !url.includes('/api/v3/message'),
      status: url.includes('/api/v3/message') ? 500 : 200,
      body: {},
    }));
    const result = await broadcastBoc(boc, { config: CONFIG, fetchImpl });
    expect(result.messageHash.hex).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.some((call) => call.url.includes('/v2/blockchain/message'))).toBe(true);
  });
});
