/**
 * swap-ton tests — fee/slippage policy and offline payload construction.
 *
 * Addresses are the official testnet DEX v2.1 values from docs.ston.fi "Swap → Testnet swaps"
 * (router kQALh-…, pTON kQACS3…, jettons TesREED/TestBlue). They are only used as opaque,
 * well-formed addresses here; nothing in this file talks to the network.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_SWAP_FEE_BPS,
  SWAP_FEE_BPS,
  assertReferralFeeBps,
  minReceivedRaw,
  buildSwapPayload,
  decodeSwapPayload,
  type SwapRouterInfo,
} from './index.js';

const TESTNET_ROUTER = 'kQALh-JBBIKK7gr0o4AVf9JZnEsFndqO0qTCyT-D-yBsWk0v';
const TESTNET_PTON_MASTER = 'kQACS30DNoUQ7NfApPvzh7eBmSZ9L4ygJ-lkNWtba8TQT-Px';
const TESREED = 'kQDLvsZol3juZyOAVG8tWsJntOxeEZWEaWCbbSjYakQpuYN5';
const TESTBLUE = 'kQB_TOJSB7q3-Jm1O8s0jKFtqLElZDPjATs5uJGsujcjznq3';
const USER = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';
const USER_JETTON_WALLET = '0:1111111111111111111111111111111111111111111111111111111111111111';
/** Stand-in for the router's own pTON wallet (quote.router.ptonWalletAddress). */
const ROUTER_PTON_WALLET = '0:2222222222222222222222222222222222222222222222222222222222222222';

const ROUTER: SwapRouterInfo = {
  address: TESTNET_ROUTER,
  majorVersion: 2,
  minorVersion: 1,
  routerType: 'ConstantProduct',
  ptonMasterAddress: TESTNET_PTON_MASTER,
  ptonWalletAddress: ROUTER_PTON_WALLET,
};

describe('fee policy (basis points, never pips)', () => {
  it('pins the policy at 35 bps and caps at 100 bps (1%)', () => {
    expect(SWAP_FEE_BPS).toBe(35);
    expect(MAX_SWAP_FEE_BPS).toBe(100);
    expect(assertReferralFeeBps(35)).toBe(35);
    expect(assertReferralFeeBps(0)).toBe(0);
    expect(assertReferralFeeBps(100)).toBe(100);
  });

  it('rejects pips, negatives and non-integers', () => {
    expect(() => assertReferralFeeBps(101)).toThrow('REFERRAL_FEE_BPS_OUT_OF_RANGE');
    expect(() => assertReferralFeeBps(3500)).toThrow('REFERRAL_FEE_BPS_OUT_OF_RANGE');
    expect(() => assertReferralFeeBps(-1)).toThrow('REFERRAL_FEE_BPS_OUT_OF_RANGE');
    expect(() => assertReferralFeeBps(35.5)).toThrow('REFERRAL_FEE_BPS_OUT_OF_RANGE');
  });
});

describe('slippage minimum received', () => {
  it('floors ask * (10000 - slippage) / 10000 with integer math', () => {
    expect(minReceivedRaw('1000000', 0)).toBe('1000000');
    expect(minReceivedRaw('1000000', 50)).toBe('995000');
    expect(minReceivedRaw('1000000', 100)).toBe('990000');
    expect(minReceivedRaw('1000000', 300)).toBe('970000');
    expect(minReceivedRaw('999999', 300)).toBe('969999'); // 969999.03 floored
    expect(minReceivedRaw('1', 100)).toBe('0');
  });

  it('rejects malformed amounts and out-of-range slippage', () => {
    expect(() => minReceivedRaw('1.5', 100)).toThrow('INVALID_ASK_UNITS');
    expect(() => minReceivedRaw('1000', -1)).toThrow('INVALID_SLIPPAGE_BPS');
    expect(() => minReceivedRaw('1000', 10_001)).toThrow('INVALID_SLIPPAGE_BPS');
  });
});

describe('swap payload construction', () => {
  it('builds a TON -> jetton swap through the router pTON wallet', async () => {
    const payload = await buildSwapPayload({
      router: ROUTER,
      direction: 'ton->jetton',
      userWalletAddress: USER,
      offer: { kind: 'native' },
      askJettonWalletAddress: TESTBLUE,
      offerAmountRaw: '1000000000',
      minAskAmountRaw: '990000',
    });
    expect(payload.direction).toBe('ton->jetton');
    expect(payload.to).toBe(ROUTER_PTON_WALLET);
    // 1 TON offer + 0.3 forward gas + 0.01 pTON transfer gas.
    expect(payload.valueRaw).toBe('1310000000');
    expect(decodeSwapPayload(payload.bodyBoc, 'ton->jetton')).toEqual({
      direction: 'ton->jetton',
      offerAmountRaw: '1000000000',
      minAskAmountRaw: '990000',
      referralValueBps: 35,
    });
  });

  it('builds a jetton -> TON swap from the user jetton wallet', async () => {
    const payload = await buildSwapPayload({
      router: ROUTER,
      direction: 'jetton->ton',
      userWalletAddress: USER,
      offer: { kind: 'jetton', address: TESREED, walletAddress: USER_JETTON_WALLET },
      askJettonWalletAddress: ROUTER_PTON_WALLET,
      offerAmountRaw: '2500000',
      minAskAmountRaw: '900000000',
    });
    expect(payload.to).toBe(USER_JETTON_WALLET);
    expect(payload.valueRaw).toBe('300000000'); // 0.3 TON gas budget
    expect(decodeSwapPayload(payload.bodyBoc, 'jetton->ton')).toEqual({
      direction: 'jetton->ton',
      offerAmountRaw: '2500000',
      minAskAmountRaw: '900000000',
      referralValueBps: 35,
    });
  });

  it('builds a jetton -> jetton swap with the ask wallet from the quote', async () => {
    const payload = await buildSwapPayload({
      router: ROUTER,
      direction: 'jetton->jetton',
      userWalletAddress: USER,
      offer: { kind: 'jetton', address: TESREED, walletAddress: USER_JETTON_WALLET },
      askJettonWalletAddress: TESTBLUE,
      offerAmountRaw: '2500000',
      minAskAmountRaw: '1000',
      referralAddress: USER,
    });
    expect(payload.to).toBe(USER_JETTON_WALLET);
    expect(payload.valueRaw).toBe('300000000');
    expect(decodeSwapPayload(payload.bodyBoc, 'jetton->jetton').referralValueBps).toBe(35);
  });

  it('fails closed on bad input', async () => {
    const base = {
      router: ROUTER,
      userWalletAddress: USER,
      offer: { kind: 'native' as const },
      askJettonWalletAddress: TESTBLUE,
      offerAmountRaw: '1',
      minAskAmountRaw: '1',
    };
    await expect(
      buildSwapPayload({ ...base, direction: 'ton->jetton', offerAmountRaw: '0' }),
    ).rejects.toThrow('INVALID_OFFER_AMOUNT');
    await expect(
      buildSwapPayload({
        ...base,
        direction: 'ton->jetton',
        minAskAmountRaw: '0',
      }),
    ).rejects.toThrow('INVALID_MIN_ASK_AMOUNT');
    await expect(
      buildSwapPayload({
        ...base,
        direction: 'jetton->ton',
        offer: { kind: 'jetton', address: TESREED },
      }),
    ).rejects.toThrow('MISSING_OFFER_JETTON_WALLET');
    await expect(
      buildSwapPayload({
        ...base,
        direction: 'ton->jetton',
        router: { ...ROUTER, majorVersion: 1 },
      }),
    ).rejects.toThrow('UNSUPPORTED_DEX_VERSION');
  });
});
