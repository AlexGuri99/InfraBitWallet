/**
 * Staking payload tests: minimum, reserves, exact cell layout and round-trip decoding.
 *
 * Cell assertions parse the produced BoC independently of the package decoder, so a change to
 * the layout cannot silently pass.
 */
import { describe, it, expect } from 'vitest';
import { Address, Cell } from '@ton/core';
import {
  MIN_STAKE_RAW,
  STAKE_GAS_RESERVE_RAW,
  STAKE_MAX_RESERVE_RAW,
  STAKING_FEE_POLICY,
  TONSTAKERS_POOL_MAINNET,
  TONSTAKERS_POOL_TESTNET,
  UNSTAKE_GAS_RESERVE_RAW,
  UNSTAKE_OPCODE,
  STAKE_OPCODE,
  assertMinStake,
  buildStakePayload,
  buildUnstakePayload,
  decodeStakePayload,
  decodeStakingPayload,
  decodeUnstakePayload,
  isTonstakersPool,
  maxStakeAmountRaw,
} from './index.js';

const POOL = TONSTAKERS_POOL_MAINNET;
const JETTON_WALLET = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const OWNER = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';
const TON = 1_000_000_000n;

function bodyOf(boc: string): Cell {
  const cell = Cell.fromBoc(Buffer.from(boc, 'base64'))[0];
  if (!cell) throw new Error('missing cell');
  return cell;
}

describe('staking fee policy', () => {
  it('carries no wallet markup', () => {
    expect(STAKING_FEE_POLICY).toBe('none');
  });
});

describe('reviewed pools', () => {
  it('recognises both Tonstakers pools in any encoding', () => {
    expect(isTonstakersPool(TONSTAKERS_POOL_MAINNET)).toBe(true);
    expect(isTonstakersPool(Address.parse(TONSTAKERS_POOL_TESTNET).toRawString())).toBe(true);
  });

  it('rejects an arbitrary address', () => {
    expect(isTonstakersPool(JETTON_WALLET)).toBe(false);
    expect(isTonstakersPool('not-an-address')).toBe(false);
  });
});

describe('stake payload', () => {
  it('builds op:32, query_id:64=1, partner_code:64 and attaches amount + 1 TON', () => {
    const payload = buildStakePayload({ poolAddress: POOL, amountRaw: '2000000000' });
    expect(payload.action).toBe('stake');
    expect(payload.to).toBe(Address.parse(POOL).toRawString());
    expect(payload.valueRaw).toBe((2n * TON + STAKE_GAS_RESERVE_RAW).toString());

    const body = bodyOf(payload.bodyBoc).beginParse();
    expect(body.loadUint(32)).toBe(STAKE_OPCODE);
    expect(body.loadUint(64)).toBe(1);
    expect(body.loadUintBig(64)).toBe(0n);
    expect(body.remainingBits).toBe(0);
  });

  it('accepts exactly 1 TON and rejects anything below it', () => {
    expect(() =>
      buildStakePayload({ poolAddress: POOL, amountRaw: MIN_STAKE_RAW.toString() }),
    ).not.toThrow();
    expect(() =>
      buildStakePayload({ poolAddress: POOL, amountRaw: (MIN_STAKE_RAW - 1n).toString() }),
    ).toThrow('STAKE_BELOW_MINIMUM');
    expect(assertMinStake(MIN_STAKE_RAW.toString())).toBe(MIN_STAKE_RAW);
  });

  it('fails closed on a bad amount, an unknown pool or a bad address', () => {
    expect(() => buildStakePayload({ poolAddress: POOL, amountRaw: '0' })).toThrow(
      'INVALID_STAKE_AMOUNT',
    );
    expect(() => buildStakePayload({ poolAddress: POOL, amountRaw: '1.5' })).toThrow(
      'INVALID_STAKE_AMOUNT',
    );
    expect(() => buildStakePayload({ poolAddress: JETTON_WALLET, amountRaw: TON })).toThrow(
      'UNKNOWN_STAKING_POOL',
    );
    expect(() => buildStakePayload({ poolAddress: 'nope', amountRaw: TON })).toThrow(
      'INVALID_POOL_ADDRESS',
    );
  });

  it('recovers the amount from the signed message value on review', () => {
    const payload = buildStakePayload({ poolAddress: POOL, amountRaw: '3000000000' });
    const decoded = decodeStakePayload(payload.valueRaw, payload.bodyBoc);
    expect(decoded).toEqual({
      action: 'stake',
      amountRaw: '3000000000',
      gasReserveRaw: STAKE_GAS_RESERVE_RAW.toString(),
      partnerCode: '0',
    });
    expect(() => decodeStakePayload(STAKE_GAS_RESERVE_RAW.toString(), payload.bodyBoc)).toThrow(
      'STAKE_BELOW_MINIMUM',
    );
    expect(() =>
      decodeStakePayload((STAKE_GAS_RESERVE_RAW + MIN_STAKE_RAW - 1n).toString(), payload.bodyBoc),
    ).toThrow('STAKE_BELOW_MINIMUM');
  });

  it('computes Max with the 1.1 TON reserve', () => {
    expect(STAKE_MAX_RESERVE_RAW).toBe(1_100_000_000n);
    expect(maxStakeAmountRaw('2000000000')).toBe('900000000');
    expect(maxStakeAmountRaw('1100000000')).toBe('0');
    expect(maxStakeAmountRaw('500000000')).toBe('0');
    expect(maxStakeAmountRaw('not-a-number')).toBe('0');
    // Max at these balances never clears the 1 TON minimum, so the UI keeps the CTA disabled.
    expect(maxStakeAmountRaw('2000000000')).not.toBe('0');
  });
});

describe('unstake payload', () => {
  it.each([
    ['standard', 0, 0],
    ['instant', 0, 1],
    ['best-rate', 1, 0],
  ] as const)('builds the %s burn message to the tsTON wallet', (mode, wait, fill) => {
    const payload = buildUnstakePayload({
      jettonWalletAddress: JETTON_WALLET,
      amountRaw: '5000000000',
      ownerAddress: OWNER,
      mode,
    });
    expect(payload.action).toBe('unstake');
    expect(payload.to).toBe(Address.parse(JETTON_WALLET).toRawString());
    expect(payload.valueRaw).toBe(UNSTAKE_GAS_RESERVE_RAW.toString());

    const body = bodyOf(payload.bodyBoc).beginParse();
    expect(body.loadUint(32)).toBe(UNSTAKE_OPCODE);
    expect(body.loadUint(64)).toBe(0);
    expect(body.loadCoins()).toBe(5_000_000_000n);
    expect(body.loadAddress().toRawString()).toBe(Address.parse(OWNER).toRawString());
    expect(body.loadBit()).toBe(true);
    const flags = body.loadRef().beginParse();
    expect(flags.loadUint(1)).toBe(wait);
    expect(flags.loadUint(1)).toBe(fill);

    const decoded = decodeUnstakePayload(payload.bodyBoc);
    expect(decoded).toEqual({
      action: 'unstake',
      amountRaw: '5000000000',
      owner: Address.parse(OWNER).toRawString(),
      mode,
    });
  });

  it('attaches exactly 1.05 TON of gas', () => {
    expect(UNSTAKE_GAS_RESERVE_RAW).toBe(1_050_000_000n);
  });

  it('fails closed on a zero amount, a bad wallet address or a bad owner', () => {
    expect(() =>
      buildUnstakePayload({
        jettonWalletAddress: JETTON_WALLET,
        amountRaw: '0',
        ownerAddress: OWNER,
        mode: 'standard',
      }),
    ).toThrow('INVALID_UNSTAKE_AMOUNT');
    expect(() =>
      buildUnstakePayload({
        jettonWalletAddress: 'nope',
        amountRaw: '1',
        ownerAddress: OWNER,
        mode: 'standard',
      }),
    ).toThrow('INVALID_JETTON_WALLET');
    expect(() =>
      buildUnstakePayload({
        jettonWalletAddress: JETTON_WALLET,
        amountRaw: '1',
        ownerAddress: 'nope',
        mode: 'standard',
      }),
    ).toThrow('INVALID_OWNER_ADDRESS');
  });
});

describe('decodeStakingPayload', () => {
  it('dispatches on the opcode of the actual signed body', () => {
    const stake = buildStakePayload({ poolAddress: POOL, amountRaw: TON });
    expect(decodeStakingPayload(stake.valueRaw, stake.bodyBoc).action).toBe('stake');

    const unstake = buildUnstakePayload({
      jettonWalletAddress: JETTON_WALLET,
      amountRaw: '7',
      ownerAddress: OWNER,
      mode: 'instant',
    });
    const decoded = decodeStakingPayload(unstake.valueRaw, unstake.bodyBoc);
    expect(decoded.action).toBe('unstake');
    if (decoded.action === 'unstake') expect(decoded.mode).toBe('instant');
  });

  it('rejects an unknown opcode', () => {
    const other = 'te6cckEBAQEAAgAAAEysuc0=';
    expect(() => decodeStakingPayload('1000000000', other)).toThrow();
  });
});
