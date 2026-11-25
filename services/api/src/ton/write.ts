/**
 * Write-path helpers for TON testnet: wallet state, pre-sign emulation and broadcast.
 *
 * Keys stay in provider headers. Responses are normalized and never include upstream bodies or
 * stack traces. Broadcast messages are signed BoCs from the client; this service cannot sign.
 *
 * Emulation response shapes verified 2026-11-25 against:
 * - https://testnet.toncenter.com/api/emulate/doc.json (endpoint/request schema)
 * - toncenter/ton-index-worker `ton-emulate-go/models/{response,models}.go` (response schema)
 * - https://testnet.tonapi.io/v2/openapi.json (`MessageConsequences`)
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

/** Parse a nano-unit amount that upstreams may send as a JSON number or a decimal string. */
function rawAmount(value: unknown): string | null {
  if (typeof value === 'string') return /^\d+$/.test(value) ? value : null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

/** Transaction owner: TON Center sends a string, TonAPI an AccountAddress object. */
function accountOf(tx: Record<string, unknown>): string | null {
  const direct = str(tx['account']);
  if (direct !== null) return direct;
  const account = record(tx['account']);
  return account ? str(account['address']) : null;
}

function isExternalIn(tx: Record<string, unknown>): boolean {
  const inMsg = record(tx['in_msg']);
  if (!inMsg) return false;
  return (
    inMsg['msg_type'] === 'ext_in_msg' || inMsg['source'] === null || inMsg['source'] === undefined
  );
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

interface EmulationTransaction {
  /** TON Center keys the transaction map by the hash it omits from each JSON object. */
  key: string | null;
  tx: Record<string, unknown>;
}

interface EmulationDoc {
  transactions: EmulationTransaction[];
  accountStates: Record<string, unknown>;
  rootTx: Record<string, unknown> | null;
}

/**
 * Normalize the two upstream shapes into one transaction list.
 *
 * TON Center `/api/emulate/v1/emulateTrace` returns
 * `{ mc_block_seqno, trace: { tx_hash, children }, transactions: Record<hash, Tx>, account_states }`
 * (verified against toncenter/ton-index-worker `ton-emulate-go/models`), while TonAPI
 * `/v2/wallet/emulate` returns `MessageConsequences` `{ trace: { transaction, children }, event, risk }`.
 * Both are accepted, plus an array-valued `transactions` field for defensive compatibility.
 */
function collectEmulation(raw: unknown): EmulationDoc {
  const outer = record(raw) ?? {};
  const inner = record(outer['result']) ?? outer;
  const transactions: EmulationTransaction[] = [];
  const seen = new Set<Record<string, unknown>>();
  const add = (key: string | null, value: unknown): void => {
    const tx = record(value);
    if (!tx || seen.has(tx)) return;
    seen.add(tx);
    transactions.push({ key, tx });
  };

  const field = inner['transactions'];
  if (Array.isArray(field)) {
    for (const entry of field) add(null, entry);
  } else {
    const map = record(field);
    if (map) for (const [key, value] of Object.entries(map)) add(key, value);
  }

  let rootTx: Record<string, unknown> | null = null;
  const walk = (node: unknown): void => {
    const value = record(node);
    if (!value) return;
    const tx = record(value['transaction']);
    if (tx) {
      add(null, tx);
      rootTx = rootTx ?? tx;
    }
    for (const child of list(value['children'])) walk(child);
  };
  walk(inner['trace']);
  if (inner['transaction']) walk(inner);

  const trace = record(inner['trace']);
  const rootKey = trace ? str(trace['tx_hash']) : null;
  const keyedRoot = rootKey
    ? (transactions.find((entry) => entry.key === rootKey)?.tx ?? null)
    : null;
  return {
    transactions,
    accountStates: record(inner['account_states']) ?? {},
    rootTx: keyedRoot ?? rootTx,
  };
}

function readCompute(tx: Record<string, unknown>): Record<string, unknown> | null {
  const description = record(tx['description']);
  return record(description?.['compute_ph']) ?? record(tx['compute_phase']);
}

function readAction(tx: Record<string, unknown>): Record<string, unknown> | null {
  const description = record(tx['description']);
  return record(description?.['action']) ?? record(tx['action_phase']);
}

function isAborted(tx: Record<string, unknown>): boolean {
  const description = record(tx['description']);
  const action = readAction(tx);
  return (
    tx['aborted'] === true ||
    description?.['aborted'] === true ||
    (action !== null && action['success'] === false)
  );
}

function readExitCode(tx: Record<string, unknown>): number | null {
  const compute = readCompute(tx);
  if (!compute || compute['skipped'] === true || compute['type'] === 'skipped') return null;
  return num(compute['exit_code']);
}

/**
 * Bounce phase, if the transaction's inbound message was returned to its sender.
 * TON Center emits `description.bounce: { type: "ok" | "nofunds" | "negfunds" }`; TonAPI emits
 * `bounce_phase: "TrPhaseBounceOk" | "TrPhaseBounceNofunds" | "TrPhaseBounceNegfunds"`.
 */
function readBouncePhase(tx: Record<string, unknown>): string | null {
  const description = record(tx['description']);
  const legacy = record(description?.['bounce']);
  if (legacy) return str(legacy['type']);
  return str(tx['bounce_phase']);
}

/** Reason a compute phase was skipped, normalized across both provider spellings. */
function readSkipReason(tx: Record<string, unknown>): string | null {
  const compute = readCompute(tx);
  if (!compute) return null;
  const skipped = compute['skipped'] === true || compute['type'] === 'skipped';
  if (!skipped) return null;
  return str(compute['reason']) ?? str(compute['skip_reason']);
}

/** `no_state` in TON Center, `cskip_no_state` in TonAPI. */
function isNoStateSkip(tx: Record<string, unknown>): boolean {
  const reason = readSkipReason(tx);
  return reason === 'no_state' || reason === 'cskip_no_state';
}

/**
 * A non-bounceable transfer to an `uninit` account is credited without running code, so its
 * child transaction is marked `aborted` with a skipped `no_state` compute phase. That is a
 * successful send, not a failure — provided nothing else in that transaction failed.
 */
function isHarmlessUninitCredit(tx: Record<string, unknown>): boolean {
  if (readBouncePhase(tx) !== null) return false;
  const exitCode = readExitCode(tx);
  if (exitCode !== null && exitCode !== 0) return false;
  const action = readAction(tx);
  if (action) {
    const resultCode = num(action['result_code']);
    if (action['success'] === false) return false;
    if (resultCode !== null && resultCode !== 0) return false;
  }
  if (isNoStateSkip(tx)) return true;
  // Some providers omit compute_ph entirely for a credit to a never-initialized account.
  const status = str(tx['orig_status']) ?? str(tx['end_status']);
  return readCompute(tx) === null && !action && (status === 'uninit' || status === 'nonexist');
}

/**
 * Balance delta for one transaction's own account.
 *
 * Prefers TON Center's before/after account-state hashes resolved through the `account_states`
 * map (exact), then the legacy inline `account_state_before/after` objects, and finally derives
 * the delta from the message values and fees (`in - out - total_fees`), which is exact for every
 * account a transaction touches and is the only signal TonAPI exposes.
 */
function balanceDelta(
  tx: Record<string, unknown>,
  accountStates: Record<string, unknown>,
): bigint | null {
  const beforeHash = str(tx['account_state_hash_before']);
  const afterHash = str(tx['account_state_hash_after']);
  if (beforeHash !== null && afterHash !== null) {
    const before = record(accountStates[beforeHash]);
    const after = record(accountStates[afterHash]);
    const beforeRaw = before ? rawAmount(before['balance']) : null;
    const afterRaw = after ? rawAmount(after['balance']) : null;
    if (beforeRaw !== null && afterRaw !== null) return BigInt(afterRaw) - BigInt(beforeRaw);
  }
  const beforeState = record(tx['account_state_before']);
  const afterState = record(tx['account_state_after']);
  const beforeRaw = beforeState ? rawAmount(beforeState['balance']) : null;
  const afterRaw = afterState ? rawAmount(afterState['balance']) : null;
  if (beforeRaw !== null && afterRaw !== null) return BigInt(afterRaw) - BigInt(beforeRaw);

  const inMsg = record(tx['in_msg']);
  let incoming = 0n;
  if (inMsg && inMsg['value'] !== null && inMsg['value'] !== undefined) {
    const raw = rawAmount(inMsg['value']);
    if (raw === null) return null;
    incoming = BigInt(raw);
  }
  let outgoing = 0n;
  for (const entry of list(tx['out_msgs'])) {
    const msg = record(entry);
    const raw = msg ? rawAmount(msg['value']) : null;
    if (raw === null) return null;
    outgoing += BigInt(raw);
  }
  return incoming - outgoing - BigInt(rawAmount(tx['total_fees']) ?? '0');
}

function mapEmulation(raw: unknown): EmulationResult {
  const doc = collectEmulation(raw);
  if (doc.transactions.length === 0) {
    logEmptyEmulation(raw);
    return {
      ok: false,
      estimatedFeeRaw: '0',
      balanceChanges: [],
      warnings: ['Emulation returned no transactions'],
      willBounce: false,
    };
  }

  const rootTx =
    doc.rootTx ??
    doc.transactions.find((entry) => isExternalIn(entry.tx))?.tx ??
    doc.transactions[0]?.tx ??
    null;
  const rootAccount = rootTx ? accountOf(rootTx) : null;

  let fees = 0n;
  let walletDelta = 0n;
  const warnings: string[] = [];
  let firstExit: number | undefined;
  let willBounce = false;
  let aborted = false;
  let destroyed = false;

  for (const { tx } of doc.transactions) {
    fees += BigInt(rawAmount(tx['total_fees']) ?? '0');
    const description = record(tx['description']);
    if (tx['destroyed'] === true || description?.['destroyed'] === true) destroyed = true;

    // Strict fail-closed signals: any non-zero exit/action code, or a bounced message, fails
    // emulation no matter which account produced it.
    const exitCode = readExitCode(tx);
    if (exitCode !== null && exitCode !== 0) {
      if (firstExit === undefined) firstExit = exitCode;
      aborted = true;
    }
    const action = readAction(tx);
    const resultCode = action ? num(action['result_code']) : null;
    if (resultCode !== null && resultCode !== 0) aborted = true;
    const bouncePhase = readBouncePhase(tx);
    if (bouncePhase !== null) {
      willBounce = true;
      aborted = true;
    }
    // Kept from the original heuristic: action result_code 37 (insufficient funds) means the
    // outbound message could not be fully funded and will bounce.
    if (resultCode === 37) willBounce = true;

    // The sender tx aborted, or a child aborted for a reason other than an uninit credit.
    if (isAborted(tx) && (tx === rootTx || !isHarmlessUninitCredit(tx))) aborted = true;

    const account = accountOf(tx);
    if (rootAccount === null || account === rootAccount) {
      walletDelta += balanceDelta(tx, doc.accountStates) ?? 0n;
    }
  }

  const balanceChanges: EmulationBalanceChange[] = [];
  if (walletDelta !== 0n) {
    balanceChanges.push({
      assetId: 'ton',
      symbol: 'TON',
      deltaRaw: walletDelta.toString(),
      decimals: 9,
    });
  }

  if (aborted) warnings.push('Emulation aborted');
  if (willBounce) warnings.push('Transfer may bounce');
  if (destroyed) warnings.push('Account destroyed');
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

/**
 * Shape-only diagnostics for upstream schema drift. Never logs the BoC, addresses, message
 * bodies or hashes — only the top-level keys, so a Vercel log line cannot leak a transfer.
 */
function logEmptyEmulation(raw: unknown): void {
  const root = record(raw);
  const inner = root ? (record(root['result']) ?? root) : null;
  console.warn('[ton/emulate] upstream response contained no transactions', {
    keys: inner ? Object.keys(inner).slice(0, 16) : [],
    traceKeys:
      inner && record(inner['trace']) ? Object.keys(record(inner['trace']) ?? {}).slice(0, 8) : [],
  });
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
