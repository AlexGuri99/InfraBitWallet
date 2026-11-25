/** P2b write-path tests with a mocked upstream (no network, no keys). */
import { describe, it, expect, vi } from 'vitest';
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

/**
 * Real TON Center `/api/emulate/v1/emulateTrace` shape, verified against
 * toncenter/ton-index-worker `ton-emulate-go/models` (response.go + models.go, 2026-11-25):
 * `transactions` is a `Record<base64 hash, Tx>`, `account_states` is a
 * `Record<base64 hash, AccountState>`, and balances are resolved through the
 * `account_state_hash_before/after` fields. `total_fees` is a JSON number.
 */
const WALLET = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';
const DESTINATION = '0:1111111111111111111111111111111111111111111111111111111111111111';
const JETTON_WALLET = '0:2222222222222222222222222222222222222222222222222222222222222222';

function tonCenterTx(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    account: WALLET,
    lt: '100',
    now: 1700000000,
    orig_status: 'active',
    end_status: 'active',
    in_msg: {
      hash: 'aW49',
      source: null,
      destination: WALLET,
      value: null,
      bounce: false,
      bounced: false,
    },
    out_msgs: [
      { hash: 'b3V0', source: WALLET, destination: DESTINATION, value: 1000000000, bounce: true },
    ],
    total_fees: 3600000,
    account_state_hash_before: 'YmVmb3Jl',
    account_state_hash_after: 'YWZ0ZXI=',
    description: {
      credit_first: true,
      storage_ph: { storage_fees_collected: 100000, status_change: 'unchanged' },
      credit_ph: { credit: 0 },
      compute_ph: { skipped: false, success: true, exit_code: 0, gas_fees: 2000000 },
      action: { success: true, valid: true, result_code: 0, tot_actions: 1 },
      aborted: false,
      destroyed: false,
    },
    ...overrides,
  };
}

function tonCenterTrace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mc_block_seqno: 987654,
    trace: {
      tx_hash: 'cm9vdA==',
      in_msg_hash: 'aW49',
      children: [{ tx_hash: 'Y2hpbGQ=', in_msg_hash: 'b3V0', children: [] }],
    },
    transactions: {
      'cm9vdA==': tonCenterTx({}),
      'Y2hpbGQ=': tonCenterTx({
        account: DESTINATION,
        orig_status: 'uninit',
        end_status: 'active',
        out_msgs: [],
        total_fees: 1000000,
        account_state_hash_before: 'Y2hpbGRiZWZvcmU=',
        account_state_hash_after: 'Y2hpbGRhZnRlcg==',
        description: {
          credit_first: false,
          compute_ph: { skipped: false, success: true, exit_code: 0 },
          action: { success: true, result_code: 0 },
          aborted: false,
          destroyed: false,
        },
      }),
    },
    account_states: {
      YmVmb3Jl: { balance: 5000000000, account_status: 'active' },
      'YWZ0ZXI=': { balance: 3996400000, account_status: 'active' },
      'Y2hpbGRiZWZvcmU=': { balance: 0, account_status: 'uninit' },
      'Y2hpbGRhZnRlcg==': { balance: 999000000, account_status: 'active' },
    },
    rand_seed: 'seed',
    ...overrides,
  };
}

/** Real TonAPI `MessageConsequences` shape from /v2/openapi.json (trace rooted at the wallet). */
function tonApiConsequences(): Record<string, unknown> {
  return {
    trace: {
      emulated: true,
      interfaces: ['wallet'],
      transaction: {
        account: { address: WALLET, is_scam: false, is_wallet: true },
        hash: 'root',
        lt: 100,
        utime: 1700000000,
        orig_status: 'active',
        end_status: 'active',
        success: true,
        aborted: false,
        destroyed: false,
        total_fees: 4000000,
        end_balance: 3996000000,
        transaction_type: 'TransOrd',
        in_msg: {
          msg_type: 'ext_in_msg',
          source: null,
          destination: { address: WALLET, is_scam: false, is_wallet: true },
          value: 0,
          bounce: false,
          bounced: false,
          fwd_fee: 0,
          ihr_fee: 0,
          import_fee: 0,
          created_at: 1700000000,
          created_lt: 100,
          ihr_disabled: false,
          hash: 'aW4=',
        },
        out_msgs: [
          {
            msg_type: 'int_msg',
            source: { address: WALLET, is_scam: false, is_wallet: true },
            destination: { address: JETTON_WALLET, is_scam: false, is_wallet: false },
            value: 1000000000,
            bounce: true,
            bounced: false,
            fwd_fee: 1000000,
            ihr_fee: 0,
            import_fee: 0,
            created_at: 1700000000,
            created_lt: 101,
            ihr_disabled: false,
            hash: 'b3V0',
          },
        ],
        compute_phase: { skipped: false, success: true, exit_code: 0 },
        action_phase: {
          success: true,
          result_code: 0,
          total_actions: 1,
          skipped_actions: 0,
          fwd_fees: 1000000,
          total_fees: 2000000,
        },
      },
      children: [
        {
          interfaces: ['jetton_wallet'],
          transaction: {
            account: { address: JETTON_WALLET, is_scam: false, is_wallet: false },
            hash: 'child',
            lt: 101,
            utime: 1700000000,
            orig_status: 'active',
            end_status: 'active',
            success: true,
            aborted: false,
            destroyed: false,
            total_fees: 500000,
            end_balance: 999500000,
            transaction_type: 'TransOrd',
            in_msg: { msg_type: 'int_msg', value: 1000000000 },
            out_msgs: [],
            compute_phase: { skipped: false, success: true, exit_code: 0 },
            action_phase: { success: true, result_code: 0 },
          },
        },
      ],
    },
    event: { account: { address: WALLET }, actions: [] },
    risk: { gram: 0, jettons: [], nfts: [], total_equivalent: 0 },
  };
}

describe('emulate', () => {
  it('parses the real TON Center transaction map and account_states deltas', async () => {
    const { fetchImpl } = mock((url) => {
      if (url.includes('emulateTrace')) return { ok: true, status: 200, body: tonCenterTrace() };
      throw new Error(url);
    });
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(true);
    // Fees are summed across the trace (wallet 3.6M + child 1M).
    expect(result.estimatedFeeRaw).toBe('4600000');
    expect(result.willBounce).toBe(false);
    expect(result.exitCode).toBeUndefined();
    // Only the wallet account's delta is reported; the destination's credit is not ours.
    expect(result.balanceChanges).toEqual([
      { assetId: 'ton', symbol: 'TON', deltaRaw: '-1003600000', decimals: 9 },
    ]);
  });

  it('parses an uninit V5R1 first-deploy trace (wallet deploying itself)', async () => {
    const trace = tonCenterTrace({
      trace: { tx_hash: 'cm9vdA==', in_msg_hash: 'aW49', children: [] },
      transactions: {
        'cm9vdA==': tonCenterTx({
          orig_status: 'uninit',
          end_status: 'active',
          total_fees: 1050000,
          description: {
            credit_first: true,
            compute_ph: { skipped: false, success: true, exit_code: 0 },
            action: { success: true, result_code: 0 },
            aborted: false,
            destroyed: false,
          },
        }),
      },
      account_states: {
        YmVmb3Jl: { balance: 2000000000, account_status: 'uninit' },
        'YWZ0ZXI=': { balance: 998950000, account_status: 'active' },
      },
    });
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: trace }));
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.estimatedFeeRaw).toBe('1050000');
    expect(result.balanceChanges).toEqual([
      { assetId: 'ton', symbol: 'TON', deltaRaw: '-1001050000', decimals: 9 },
    ]);
    expect(result.warnings.join(' ')).not.toMatch(/destroyed/i);
  });

  it('flags bounce prediction and exit codes from the real description', async () => {
    const trace = tonCenterTrace({
      trace: { tx_hash: 'cm9vdA==', in_msg_hash: 'aW49', children: [] },
      transactions: {
        'cm9vdA==': tonCenterTx({
          total_fees: 1,
          out_msgs: [],
          account_state_hash_before: 'YmVmb3Jl',
          account_state_hash_after: 'YWZ0ZXI=',
          description: {
            credit_first: true,
            compute_ph: { skipped: false, success: true, exit_code: 37 },
            action: { success: true, result_code: 37 },
            aborted: false,
            destroyed: false,
          },
        }),
      },
      account_states: {
        YmVmb3Jl: { balance: 10, account_status: 'active' },
        'YWZ0ZXI=': { balance: 9, account_status: 'active' },
      },
    });
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: trace }));
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.willBounce).toBe(true);
    expect(result.exitCode).toBe(37);
    expect(result.warnings.join(' ')).toMatch(/bounce/i);
  });

  it('fails closed when description.aborted is set', async () => {
    const trace = tonCenterTrace({
      trace: { tx_hash: 'cm9vdA==', in_msg_hash: 'aW49', children: [] },
      transactions: {
        'cm9vdA==': tonCenterTx({
          description: {
            credit_first: true,
            compute_ph: { skipped: false, success: false, exit_code: 9 },
            action: { success: false, valid: false, result_code: 34 },
            aborted: true,
            destroyed: false,
          },
        }),
      },
    });
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: trace }));
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/aborted/i);
  });

  it('fails closed and logs only shape when no transactions are returned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetchImpl } = mock(() => ({
      ok: true,
      status: 200,
      body: { mc_block_seqno: 1, transactions: {}, account_states: {}, rand_seed: 's' },
    }));
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.estimatedFeeRaw).toBe('0');
    expect(result.warnings).toEqual(['Emulation returned no transactions']);
    expect(warn).toHaveBeenCalledWith(
      '[ton/emulate] upstream response contained no transactions',
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('falls back to TonAPI and parses the MessageConsequences trace shape', async () => {
    const { fetchImpl } = mock((url) => {
      if (url.includes('emulateTrace')) return { ok: false, status: 500, body: {} };
      if (url.includes('/v2/wallet/emulate'))
        return { ok: true, status: 200, body: tonApiConsequences() };
      throw new Error(url);
    });
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(true);
    // Root tx 4M + jetton-wallet child 0.5M.
    expect(result.estimatedFeeRaw).toBe('4500000');
    // Wallet delta derived from in - out - fees; the child's credit is excluded.
    expect(result.balanceChanges).toEqual([
      { assetId: 'ton', symbol: 'TON', deltaRaw: '-1004000000', decimals: 9 },
    ]);
  });

  it('accepts string-encoded fees for backward compatibility', async () => {
    const trace = tonCenterTrace({
      trace: { tx_hash: 'cm9vdA==', in_msg_hash: 'aW49', children: [] },
      transactions: { 'cm9vdA==': tonCenterTx({ total_fees: '3600000' }) },
    });
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: trace }));
    const result = await emulateBoc('te6ccgEBAQEAAgAAAA==', { config: CONFIG, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.estimatedFeeRaw).toBe('3600000');
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
