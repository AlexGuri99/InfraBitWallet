/**
 * Write-path helpers for TON testnet: wallet state, pre-sign emulation and broadcast.
 *
 * Keys stay in provider headers. Responses are normalized and never include upstream bodies or
 * stack traces. Broadcast messages are signed BoCs from the client; this service cannot sign.
 */
import { Cell } from '@ton/core';
import { Buffer } from 'node:buffer';
import type { TonAccountStatus, TonNetwork } from '@onezerowallet/chain-ton';
import type { ServerConfig } from '../config.js';
import { providerBaseUrl } from '../config.js';
import { ProviderError, type FetchLike } from './http.js';
import { TonApiClient } from './tonapi.js';
import { TonCenterClient } from './toncenter.js';

export interface WriteOptions {
  config: ServerConfig;
  fetchImpl?: FetchLike | undefined;
}

export interface WalletState {
  address: string;
  network: TonNetwork;
  status: TonAccountStatus;
  seqno: number;
  balanceRaw: string;
  source: 'toncenter' | 'tonapi';
}

export interface EmulationBalanceChange {
  assetId: string;
  symbol: string;
  deltaRaw: string;
  decimals: number;
}

export interface EmulationResult {
  ok: boolean;
  estimatedFeeRaw: string;
  balanceChanges: EmulationBalanceChange[];
  warnings: string[];
  willBounce: boolean;
  exitCode?: number | undefined;
}

export interface BroadcastResult {
  messageHash: { hex: string; base64: string };
}

function toncenter(config: ServerConfig, options: WriteOptions): TonCenterClient {
  return new TonCenterClient({
    baseUrl: providerBaseUrl(config),
    apiKey: config.network === 'testnet' ? config.toncenterTestnetApiKey : config.toncenterApiKey,
    fetchImpl: options.fetchImpl,
  });
}

function tonapi(config: ServerConfig, options: WriteOptions): TonApiClient {
  return new TonApiClient({
    baseUrl: providerBaseUrl({ ...config, provider: 'tonapi' }),
    apiKey: config.tonapiApiKey,
    fetchImpl: options.fetchImpl,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function getWalletState(
  address: string,
  network: TonNetwork,
  options: WriteOptions,
): Promise<WalletState> {
  const tc = toncenter(options.config, options);
  try {
    const info = await tc.walletInfo(address);
    if (info.status !== 'active') {
      return {
        address,
        network,
        status: info.status,
        seqno: 0,
        balanceRaw: info.balanceRaw,
        source: 'toncenter',
      };
    }
    const seqno = await tc.seqno(address);
    if (seqno === null) throw new ProviderError('toncenter');
    return {
      address,
      network,
      status: info.status,
      seqno,
      balanceRaw: info.balanceRaw,
      source: 'toncenter',
    };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    // TonAPI exposes status/balance but not runGetMethod; seqno 0 is returned so the client can
    // refuse to sign for an active wallet with an unknown seqno.
    const account = await tonapi(options.config, options).account(address);
    return {
      address,
      network,
      status: account.status,
      seqno: 0,
      balanceRaw: account.balanceRaw,
      source: 'tonapi',
    };
  }
}

function mapEmulation(raw: unknown): EmulationResult {
  const rootRecord = record(raw);
  const inner =
    rootRecord && record(rootRecord['result']) ? record(rootRecord['result']) : rootRecord;
  const transactions = inner ? list(inner['transactions']) : [];
  if (transactions.length === 0) {
    return {
      ok: false,
      estimatedFeeRaw: '0',
      balanceChanges: [],
      warnings: ['Emulation returned no transactions'],
      willBounce: false,
    };
  }

  let fees = 0n;
  const warnings: string[] = [];
  const balanceChanges: EmulationBalanceChange[] = [];
  let firstExit: number | undefined;
  let willBounce = false;
  let aborted = false;

  for (const entry of transactions) {
    const tx = record(entry);
    if (!tx) continue;
    const fee = str(tx['total_fees']);
    if (fee && /^\d+$/.test(fee)) fees += BigInt(fee);
    const description = record(tx['description']);
    const compute = description ? record(description['compute_ph']) : null;
    const action = description ? record(description['action']) : null;
    const exitCode = compute ? num(compute['exit_code']) : null;
    if (exitCode !== null && exitCode !== 0 && firstExit === undefined) firstExit = exitCode;
    if (compute && compute['aborted'] === true) aborted = true;
    if (action && action['result_code'] === 37) willBounce = true;
    if (action && action['success'] === false) aborted = true;
    const before = record(tx['account_state_before']);
    const after = record(tx['account_state_after']);
    const beforeBalance = before ? str(before['balance']) : null;
    const afterBalance = after ? str(after['balance']) : null;
    if (
      beforeBalance &&
      afterBalance &&
      /^\d+$/.test(beforeBalance) &&
      /^\d+$/.test(afterBalance)
    ) {
      const delta = BigInt(afterBalance) - BigInt(beforeBalance);
      if (delta !== 0n) {
        balanceChanges.push({
          assetId: 'ton',
          symbol: 'TON',
          deltaRaw: delta.toString(),
          decimals: 9,
        });
      }
    }
  }

  if (aborted) warnings.push('Emulation aborted');
  if (willBounce) warnings.push('Transfer may bounce');
  if (firstExit !== undefined && firstExit !== 0) warnings.push(`Exit code ${String(firstExit)}`);

  return {
    ok: !aborted,
    estimatedFeeRaw: fees.toString(),
    balanceChanges,
    warnings,
    willBounce,
    exitCode: firstExit,
  };
}

export async function emulateBoc(boc: string, options: WriteOptions): Promise<EmulationResult> {
  try {
    return mapEmulation(await toncenter(options.config, options).emulate(boc));
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return mapEmulation(await tonapi(options.config, options).emulate(boc));
  }
}

export async function broadcastBoc(boc: string, options: WriteOptions): Promise<BroadcastResult> {
  const cells = Cell.fromBoc(Buffer.from(boc, 'base64'));
  const cell = cells[0];
  if (!cell) throw new ProviderError('toncenter');
  const hash = cell.hash();
  try {
    await toncenter(options.config, options).sendMessage(boc);
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    await tonapi(options.config, options).sendMessage(boc);
  }
  return { messageHash: { hex: hash.toString('hex'), base64: hash.toString('base64') } };
}
