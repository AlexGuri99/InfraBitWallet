/**
 * Tonstakers liquid-staking payload builder (pure, offline).
 *
 * Sources, verified 2026-11-26:
 * - `tonstakers/tonstakers-sdk` `src/constants.ts` (MIT): pool addresses, `PAYLOAD_STAKE`
 *   `0x47d54391`, `PAYLOAD_UNSTAKE` `0x595f07bc`, `STAKE_FEE_RES = 1` TON,
 *   `UNSTAKE_FEE_RES = 1.05` TON, `RECOMMENDED_FEE_RESERVE = 1.1` TON.
 * - `tonstakers/tonstakers-sdk` `src/tonstakers.ts` (MIT): exact cell layout for stake
 *   (`op:32, query_id:64 (=1), partner_code:64`) and unstake (`op:32, query_id:64 (=0),
 *   amount:coins, owner:address, maybe_ref{ wait_till_round_end:1, fill_or_kill:1 }`).
 * - `ton-blockchain/liquid-staking-contract` `contracts/op-codes.func`: `pool::deposit`
 *   `0x47d54391`, `jetton::burn` `0x595f07bc`.
 * - `ton-blockchain/liquid-staking-contract` `contracts/pool.func`: deposits derive the amount
 *   from the message value (`msg_value - DEPOSIT_FEE`) and only parse the `(op, query_id)`
 *   header; the unused gas reserve is refunded.
 * - Live TonAPI (2026-11-26): `GET /v2/staking/pool/<pool>` reports implementation "Tonstakers",
 *   `verified: true`, jetton master `0:bdf3fa…`.
 *
 * The builder never probes the network and never accepts a caller-supplied pool: it fails closed
 * unless the destination is one of the two reviewed Tonstakers pools below.
 */
import { Address, beginCell, Cell } from '@ton/core';
import { Buffer } from 'buffer';

/** `pool::deposit` (verified above). */
export const STAKE_OPCODE = 0x47d54391;
/** `jetton::burn` used by tsTON unstaking (verified above). */
export const UNSTAKE_OPCODE = 0x595f07bc;

/** Reviewed Tonstakers pool on mainnet (tonstakers-sdk constants; live TonAPI 2026-11-26). */
export const TONSTAKERS_POOL_MAINNET = 'EQCkWxfyhAkim3g2DjKQQg8T5P4g-Q1-K_jErGcDJZ4i-vqR';
/** Reviewed Tonstakers pool on testnet (tonstakers-sdk constants). */
export const TONSTAKERS_POOL_TESTNET = 'kQANFsYyYn-GSZ4oajUJmboDURZU-udMHf9JxzO4vYM_hFP3';

/** Minimum stake enforced by the wallet UI and this builder. */
export const MIN_STAKE_TON = 1n;
export const MIN_STAKE_RAW = MIN_STAKE_TON * 1_000_000_000n;

/** Attached gas for a deposit (the pool refunds the unused part). */
export const STAKE_GAS_RESERVE_RAW = 1_000_000_000n;
/** Reserve kept back when tapping Max on a stake (deposit gas plus a small buffer). */
export const STAKE_MAX_RESERVE_RAW = 1_100_000_000n;
/** Attached gas for an unstake (burn) message. */
export const UNSTAKE_GAS_RESERVE_RAW = 1_050_000_000n;

/** Wallet-side markup policy: Tonstakers liquid staking carries **no** wallet fee. */
export type StakingFeePolicy = 'none' | 'provider_revenue_share' | 'explicit_fee';
export const STAKING_FEE_POLICY: StakingFeePolicy = 'none';

/** Unstake modes supported by the Tonstakers burn message. */
export type UnstakeMode = 'standard' | 'instant' | 'best-rate';

const UNSTAKE_FLAGS: Record<UnstakeMode, { waitTillRoundEnd: boolean; fillOrKill: boolean }> = {
  standard: { waitTillRoundEnd: false, fillOrKill: false },
  instant: { waitTillRoundEnd: false, fillOrKill: true },
  'best-rate': { waitTillRoundEnd: true, fillOrKill: false },
};

export type StakingAction = 'stake' | 'unstake';

export interface StakingPayload {
  action: StakingAction;
  /** Internal-message destination: the pool for a stake, the tsTON jetton wallet for a burn. */
  to: string;
  /** Attached nanoTON (stake amount + reserve, or the unstake gas reserve). */
  valueRaw: string;
  /** Base64 BoC of the internal message body. */
  bodyBoc: string;
}

export interface BuildStakeInput {
  /** Pool address from the reviewed server config (mainnet or testnet constant). */
  poolAddress: string;
  amountRaw: string | bigint;
  /** Attribution code; 0 when this wallet has no partner agreement. */
  partnerCode?: number | bigint | undefined;
}

export interface BuildUnstakeInput {
  /** The user's own tsTON jetton wallet (from portfolio metadata). */
  jettonWalletAddress: string;
  amountRaw: string | bigint;
  ownerAddress: string;
  mode: UnstakeMode;
}

function rawAddress(address: string, code: string): string {
  try {
    return Address.parse(address).toRawString();
  } catch {
    throw new Error(code);
  }
}

function requireDigits(value: string | bigint, code: string): bigint {
  const text = typeof value === 'bigint' ? value.toString() : value;
  if (!/^\d+$/.test(text) || text === '0') throw new Error(code);
  return BigInt(text);
}

/** True when the address is one of the two reviewed Tonstakers pools (any encoding). */
export function isTonstakersPool(address: string): boolean {
  try {
    const raw = Address.parse(address).toRawString();
    return (
      raw === Address.parse(TONSTAKERS_POOL_MAINNET).toRawString() ||
      raw === Address.parse(TONSTAKERS_POOL_TESTNET).toRawString()
    );
  } catch {
    return false;
  }
}

/**
 * Enforce the 1 TON minimum. Returns the validated amount in nanoTON.
 * Fails closed on non-integer input and on anything below `MIN_STAKE_RAW`.
 */
export function assertMinStake(amountRaw: string | bigint): bigint {
  const amount = requireDigits(amountRaw, 'INVALID_STAKE_AMOUNT');
  if (amount < MIN_STAKE_RAW) throw new Error('STAKE_BELOW_MINIMUM');
  return amount;
}

/** Largest stake that still leaves the 1.1 TON gas reserve behind (BigInt). */
export function maxStakeAmountRaw(balanceRaw: string | bigint): string {
  const text = typeof balanceRaw === 'bigint' ? balanceRaw.toString() : balanceRaw;
  if (!/^\d+$/.test(text)) return '0';
  const balance = BigInt(text);
  return balance > STAKE_MAX_RESERVE_RAW ? (balance - STAKE_MAX_RESERVE_RAW).toString() : '0';
}

/**
 * Build the `pool::deposit` internal message for a stake.
 *
 * The attached value is `amount + 1 TON`; the pool keeps one TON for gas and refunds the rest, so
 * the deposit amount is recovered exactly from the message value on review.
 */
export function buildStakePayload(input: BuildStakeInput): StakingPayload {
  const to = rawAddress(input.poolAddress, 'INVALID_POOL_ADDRESS');
  if (!isTonstakersPool(to)) throw new Error('UNKNOWN_STAKING_POOL');
  const amount = assertMinStake(input.amountRaw);
  const partnerCode = BigInt(input.partnerCode ?? 0);
  if (partnerCode < 0n || partnerCode > 0xffff_ffff_ffff_ffffn) {
    throw new Error('INVALID_PARTNER_CODE');
  }
  const body = beginCell()
    .storeUint(STAKE_OPCODE, 32)
    .storeUint(1, 64) // query_id: Tonstakers SDK uses 1 for deposits
    .storeUint(partnerCode, 64)
    .endCell();
  return {
    action: 'stake',
    to,
    valueRaw: (amount + STAKE_GAS_RESERVE_RAW).toString(),
    bodyBoc: body.toBoc().toString('base64'),
  };
}

/**
 * Build the tsTON burn message for an unstake: `op:32, query_id:64=0, amount:coins,
 * owner:address, maybe_ref{wait_till_round_end:1, fill_or_kill:1}`.
 *
 * `standard` = normal withdrawal NFT at the round rate, `instant` = fill-or-kill against the
 * pool's instant liquidity, `best-rate` = wait for the next round (Tonstakers "best rate").
 */
export function buildUnstakePayload(input: BuildUnstakeInput): StakingPayload {
  const to = rawAddress(input.jettonWalletAddress, 'INVALID_JETTON_WALLET');
  const owner = rawAddress(input.ownerAddress, 'INVALID_OWNER_ADDRESS');
  const amount = requireDigits(input.amountRaw, 'INVALID_UNSTAKE_AMOUNT');
  const flags = UNSTAKE_FLAGS[input.mode];
  const body = beginCell()
    .storeUint(UNSTAKE_OPCODE, 32)
    .storeUint(0, 64) // query_id
    .storeCoins(amount)
    .storeAddress(Address.parse(owner))
    .storeMaybeRef(
      beginCell()
        .storeUint(flags.waitTillRoundEnd ? 1 : 0, 1)
        .storeUint(flags.fillOrKill ? 1 : 0, 1)
        .endCell(),
    )
    .endCell();
  return {
    action: 'unstake',
    to,
    valueRaw: UNSTAKE_GAS_RESERVE_RAW.toString(),
    bodyBoc: body.toBoc().toString('base64'),
  };
}

export interface DecodedStakePayload {
  action: 'stake';
  /** Recovered from the signed message value minus the 1 TON deposit gas reserve. */
  amountRaw: string;
  gasReserveRaw: string;
  partnerCode: string;
}

export interface DecodedUnstakePayload {
  action: 'unstake';
  amountRaw: string;
  owner: string;
  mode: UnstakeMode;
}

export type DecodedStakingPayload = DecodedStakePayload | DecodedUnstakePayload;

function firstCell(bodyBoc: string): Cell {
  const cells = Cell.fromBoc(Buffer.from(bodyBoc, 'base64'));
  const cell = cells[0];
  if (!cell) throw new Error('INVALID_BOC');
  return cell;
}

/**
 * Decode the actual stake body that will be signed. The amount is not in the body, so the
 * caller passes the signed message value; anything that does not leave at least the deposit gas
 * reserve, or falls below the 1 TON minimum, is rejected.
 */
export function decodeStakePayload(
  valueRaw: string | bigint,
  bodyBoc: string,
): DecodedStakePayload {
  const body = firstCell(bodyBoc).beginParse();
  if (body.loadUint(32) !== STAKE_OPCODE) throw new Error('UNKNOWN_STAKING_OPCODE');
  body.loadUint(64); // query_id
  const partnerCode = body.loadUintBig(64);
  const value = requireDigits(valueRaw, 'INVALID_MESSAGE_VALUE');
  if (value <= STAKE_GAS_RESERVE_RAW) throw new Error('STAKE_BELOW_MINIMUM');
  const amount = assertMinStake(value - STAKE_GAS_RESERVE_RAW);
  return {
    action: 'stake',
    amountRaw: amount.toString(),
    gasReserveRaw: STAKE_GAS_RESERVE_RAW.toString(),
    partnerCode: partnerCode.toString(),
  };
}

/** Decode the actual tsTON burn body that will be signed (never UI state). */
export function decodeUnstakePayload(bodyBoc: string): DecodedUnstakePayload {
  const body = firstCell(bodyBoc).beginParse();
  if (body.loadUint(32) !== UNSTAKE_OPCODE) throw new Error('UNKNOWN_STAKING_OPCODE');
  body.loadUint(64); // query_id
  const amount = body.loadCoins();
  if (amount === 0n) throw new Error('INVALID_UNSTAKE_AMOUNT');
  const owner = body.loadAddress();
  let mode: UnstakeMode = 'standard';
  if (body.loadBit()) {
    const flags = body.loadRef().beginParse();
    const waitTillRoundEnd = flags.loadUint(1) === 1;
    const fillOrKill = flags.loadUint(1) === 1;
    mode =
      waitTillRoundEnd && !fillOrKill
        ? 'best-rate'
        : fillOrKill && !waitTillRoundEnd
          ? 'instant'
          : 'standard';
    if (waitTillRoundEnd && fillOrKill) throw new Error('INVALID_UNSTAKE_FLAGS');
  }
  return { action: 'unstake', amountRaw: amount.toString(), owner: owner.toRawString(), mode };
}

/** Decode whichever staking body was signed, dispatching on its opcode. */
export function decodeStakingPayload(
  valueRaw: string | bigint,
  bodyBoc: string,
): DecodedStakingPayload {
  const op = firstCell(bodyBoc).beginParse().loadUint(32);
  if (op === STAKE_OPCODE) return decodeStakePayload(valueRaw, bodyBoc);
  if (op === UNSTAKE_OPCODE) return decodeUnstakePayload(bodyBoc);
  throw new Error('UNKNOWN_STAKING_OPCODE');
}
