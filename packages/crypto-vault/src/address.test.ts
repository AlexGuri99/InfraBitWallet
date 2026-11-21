/**
 * B1: user-facing addresses with published vectors and independent cross-checks.
 *
 * Sources:
 * - EIP-55 vectors: https://eips.ethereum.org/EIPS/eip-55 (fetched 2026-11-21)
 * - TON address formats: docs.ton.org internal address formats (flags 0x11/0x51/+0x80)
 * - Wallet V5R1: @ton/ton (MIT) WalletContractV5R1
 * - TRON: TronWeb (MIT) as a second implementation
 */
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { TronWeb } from 'tronweb';
import { Address } from '@ton/core';
import {
  toEip55Address,
  isValidEvmAddress,
  toBase58TronAddress,
  isValidTronAddress,
  tonAddressesFromPublicKey,
  tonRawAddressViaStateInit,
  validateTonAddress,
  TON_V5R1_DEFAULT_WALLET_ID,
} from './address';
import { deriveTronKey, deriveEvmKey, deriveTonKey } from './derivation';
import { mnemonicToSeed } from './mnemonic';
import {
  HARDHAT_FIRST_ADDRESS,
  MNEMONIC_12_HARDHAT,
  MNEMONIC_24_ABANDON,
} from './fixtures/mnemonics';

const seedOf = (m: string): Uint8Array => mnemonicToSeed(m);

describe('B1: EVM EIP-55 (official vectors)', () => {
  it.each([
    '0x52908400098527886E0F7030069857D2E4169EE7',
    '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
  ])('all-uppercase vector %s', (expected) => {
    expect(toEip55Address(expected)).toBe(expected);
  });

  it.each([
    '0xde709f2102306220921060314715629080e2fb77',
    '0x27b1fdb04752bbc536007a920d24acb045561c26',
  ])('all-lowercase vector %s', (expected) => {
    expect(toEip55Address(expected)).toBe(expected);
  });

  it.each([
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ])('mixed-case vector %s', (expected) => {
    expect(toEip55Address(expected.toLowerCase())).toBe(expected);
  });

  it("matches the published Hardhat first account for m/44'/60'/0'/0/0", () => {
    const raw = deriveEvmKey(seedOf(MNEMONIC_12_HARDHAT)).rawAddress;
    expect(toEip55Address(raw)).toBe(HARDHAT_FIRST_ADDRESS);
  });

  it('cross-checks with viem', () => {
    for (const m of [MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON]) {
      const raw = deriveEvmKey(seedOf(m)).rawAddress;
      expect(toEip55Address(raw)).toBe(getAddress(raw));
    }
  });

  it('validates checksummed, all-lower and all-upper; rejects a bad checksum', () => {
    expect(isValidEvmAddress(HARDHAT_FIRST_ADDRESS)).toBe(true);
    expect(isValidEvmAddress(HARDHAT_FIRST_ADDRESS.toLowerCase())).toBe(true);
    expect(isValidEvmAddress(HARDHAT_FIRST_ADDRESS.toUpperCase().replace('0X', '0x'))).toBe(true);
    const broken = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92267';
    expect(isValidEvmAddress(broken)).toBe(false);
    expect(isValidEvmAddress('0x1234')).toBe(false);
  });
});

describe('B1: TRON base58check address', () => {
  const key = (m: string): ReturnType<typeof deriveTronKey> => deriveTronKey(seedOf(m));

  it.each([MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON])('matches TronWeb for %#', (m) => {
    const address = toBase58TronAddress(key(m).hexAddress);
    const tw = TronWeb.fromMnemonic(m, "m/44'/195'/0'/0/0");
    expect(address).toBe(tw.address);
    expect(address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(isValidTronAddress(address)).toBe(true);
  });

  it('round trips hex -> base58 -> hex', () => {
    const hex = key(MNEMONIC_12_HARDHAT).hexAddress;
    const address = toBase58TronAddress(hex);
    expect(TronWeb.address.toHex(address).toLowerCase()).toBe(hex);
  });

  it('rejects malformed hex and bad base58check', () => {
    expect(() => toBase58TronAddress('41')).toThrow('INVALID_TRON_HEX_ADDRESS');
    expect(() => toBase58TronAddress('51' + 'ab'.repeat(20))).toThrow();
    expect(isValidTronAddress('T' + '1'.repeat(33))).toBe(false);
    expect(isValidTronAddress('0x' + 'ab'.repeat(20))).toBe(false);
    // Flip one character of a valid address: the checksum must fail.
    const valid = toBase58TronAddress(key(MNEMONIC_12_HARDHAT).hexAddress);
    const flipped = valid.slice(0, 10) + (valid[10] === 'A' ? 'B' : 'A') + valid.slice(11);
    expect(isValidTronAddress(flipped)).toBe(false);
  });
});

describe('B1: TON Wallet V5R1 address', () => {
  const pub = deriveTonKey(seedOf(MNEMONIC_12_HARDHAT)).publicKeyHex;

  it('matches an independent StateInit hash construction (cross-check)', () => {
    const forms = tonAddressesFromPublicKey(pub);
    expect(forms.raw).toBe(tonRawAddressViaStateInit(pub));
    // Testnet must use a different global id.
    expect(tonRawAddressViaStateInit(pub, -3)).not.toBe(forms.raw);
  });

  it('uses the documented default wallet ids', () => {
    // @ton/ton WalletV5R1WalletId: global_id ^ context, -239 mainnet / -3 testnet,
    // workchain 0, wallet_version 0, subwallet 0.
    expect(TON_V5R1_DEFAULT_WALLET_ID).toEqual({ mainnet: 2147483409, testnet: 2147483645 });
  });

  it('exposes raw, bounceable (EQ), non-bounceable (UQ) and testnet (kQ/0Q) forms', () => {
    const forms = tonAddressesFromPublicKey(pub);
    expect(forms.raw).toMatch(/^0:[0-9a-f]{64}$/);
    expect(forms.bounceable.startsWith('EQ')).toBe(true);
    expect(forms.nonBounceable.startsWith('UQ')).toBe(true);
    expect(forms.testnetBounceable.startsWith('kQ')).toBe(true);
    expect(forms.testnetNonBounceable.startsWith('0Q')).toBe(true);
    // Mainnet forms decode back to the mainnet hash; testnet forms to the testnet hash.
    const testnetRaw = tonRawAddressViaStateInit(pub, -3);
    expect(testnetRaw).not.toBe(forms.raw);
    for (const form of [forms.raw, forms.bounceable, forms.nonBounceable]) {
      expect(Address.parse(form).toRawString()).toBe(forms.raw);
    }
    for (const form of [forms.testnetBounceable, forms.testnetNonBounceable]) {
      expect(Address.parse(form).toRawString()).toBe(testnetRaw);
    }
  });

  it('different account indexes give different addresses', () => {
    const pub1 = deriveTonKey(seedOf(MNEMONIC_12_HARDHAT), 1).publicKeyHex;
    expect(tonAddressesFromPublicKey(pub1).raw).not.toBe(tonAddressesFromPublicKey(pub).raw);
  });

  it('validates raw and user-friendly forms; flags testnet', () => {
    const forms = tonAddressesFromPublicKey(pub);
    for (const form of [forms.raw, forms.bounceable, forms.nonBounceable]) {
      const r = validateTonAddress(form);
      expect(r.valid).toBe(true);
      expect(r.raw).toBe(forms.raw);
    }
    expect(validateTonAddress(forms.testnetNonBounceable).testnet).toBe(true);
    expect(validateTonAddress(forms.testnetBounceable).testnet).toBe(true);
    expect(validateTonAddress(forms.nonBounceable).testnet).toBeUndefined();
    for (const bad of ['', 'EQ', '0:' + 'zz'.repeat(32), 'not-an-address']) {
      expect(validateTonAddress(bad).valid).toBe(false);
    }
  });

  it('parses a published address literal from the @ton/ton V5R1 spec', () => {
    // Source: ton-org/ton src/wallets/v5r1/WalletContractV5R1.spec.ts (fetched 2026-11-21).
    const published = 'EQCqe9WqFhS8AfVGDP2xQiTLjbeolhLGsvIbbgQ6C3XT5gGs';
    const r = validateTonAddress(published);
    expect(r.valid).toBe(true);
    expect(Address.parse(published).toString({ bounceable: true, urlSafe: true })).toBe(published);
  });
});
