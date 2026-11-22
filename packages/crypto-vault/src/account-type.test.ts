/**
 * B2: TON-native-only accounts vs BIP-39 multichain accounts.
 *
 * Vector: @ton/crypto (MIT) mnemonic.spec.js test vector 1 — a valid TON-native 24-word phrase
 * with its Ed25519 secret key (64 bytes: 32 private + 32 public). Fetched from the installed
 * package; the same vector is published in the @ton/crypto repository.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createSeal, unsealVault, VAULT_FORMAT_VERSION } from './vault';
import {
  generateTonNativeMnemonicPhrase,
  mnemonicToSeed,
  normalizeMnemonic,
  tonNativeMnemonicToSeed,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { deriveTonKey } from './derivation';
import { unlockSession, lockSession, getSession } from './session';
import { VaultManager } from './vault-manager';
import { InMemoryStorage } from './storage';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = '2580';

const TON_NATIVE_MNEMONIC = [
  'hospital',
  'stove',
  'relief',
  'fringe',
  'tongue',
  'always',
  'charge',
  'angry',
  'urge',
  'sentence',
  'again',
  'match',
  'nerve',
  'inquiry',
  'senior',
  'coconut',
  'label',
  'tumble',
  'carry',
  'category',
  'beauty',
  'bean',
  'road',
  'solution',
].join(' ');

/** 64-byte Ed25519 secret key from the vector: private (32) || public (32). */
const TON_NATIVE_KEY =
  '9d659a6c2234db7f6e4f977e6e8653b9f5946d557163f31034011375d8f3f97df6c450a16bb1c514e22f1977e390a3025599aa1e7b00068a6aacf2119484c1bd';

afterEach(() => {
  lockSession();
});

describe('B2: TON-native derivation (official vector)', () => {
  it('validates the TON-native phrase', async () => {
    expect(await validateTonMnemonicPhrase(TON_NATIVE_MNEMONIC)).toBe(true);
    expect(await validateTonMnemonicPhrase(MNEMONIC_12_HARDHAT)).toBe(false);
  });

  it('derives the published key pair', async () => {
    const seed = await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC);
    const key = deriveTonKey(seed, 0, 'ton-native-only');
    expect(bytesToHex(key.privateKey)).toBe(TON_NATIVE_KEY.slice(0, 64));
    expect(key.publicKeyHex).toBe(TON_NATIVE_KEY.slice(64));
    expect(key.path).toBe('ton-native');
  });

  it('rejects account indexes other than 0', async () => {
    const seed = await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC);
    expect(() => deriveTonKey(seed, 1, 'ton-native-only')).toThrow('TON_NATIVE_SINGLE_ACCOUNT');
  });

  it('the same words are a different key under BIP-39 (not interchangeable)', async () => {
    const nativeSeed = await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC);
    const bipSeed = mnemonicToSeed(normalizeMnemonic(TON_NATIVE_MNEMONIC));
    expect(bytesToHex(nativeSeed)).not.toBe(bytesToHex(bipSeed));
    // TON mnemonics are not BIP-39: validation and AAD differ.
    expect(validateMnemonicPhrase(normalizeMnemonic(TON_NATIVE_MNEMONIC)).valid).toBe(false);
  });
});

describe('B2: seal round trip with accountType', () => {
  it('ton-native seal stores the account type and verifies the phrase', async () => {
    const seal = await createSeal(TON_NATIVE_MNEMONIC, PASS, undefined, FAST, 'ton-native-only');
    expect(seal.version).toBe(VAULT_FORMAT_VERSION);
    expect(seal.accountType).toBe('ton-native-only');
    const r = await unsealVault(seal, PASS);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(bytesToHex(r.seed)).toBe(bytesToHex(await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC)));
  });

  it('bip39 createSeal rejects a TON-native phrase', async () => {
    await expect(
      createSeal(TON_NATIVE_MNEMONIC, PASS, undefined, FAST, 'bip39-multichain'),
    ).rejects.toThrow('INVALID_MNEMONIC');
  });

  it('ton-native createSeal rejects a BIP-39 phrase', async () => {
    await expect(
      createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST, 'ton-native-only'),
    ).rejects.toThrow('INVALID_MNEMONIC');
  });

  it('changing accountType fails authentication (AAD binds it)', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    expect(await unsealVault({ ...seal, accountType: 'ton-native-only' }, PASS)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('generates a valid TON-native phrase', async () => {
    const phrase = await generateTonNativeMnemonicPhrase();
    expect(phrase.split(' ')).toHaveLength(24);
    expect(await validateTonMnemonicPhrase(phrase)).toBe(true);
  });
});

describe('B2: session and manager expose only TON for native accounts', () => {
  it('session: TON only, signing limited to ton/account 0', async () => {
    const seal = await createSeal(TON_NATIVE_MNEMONIC, PASS, undefined, FAST, 'ton-native-only');
    const storage = new InMemoryStorage();
    const unlocked = await unlockSession(seal, PASS, storage);
    if (!unlocked.success) throw new Error('unlock failed');
    const s = unlocked.session;

    const info = s.getPublicInfo(0);
    expect(info?.accountType).toBe('ton-native-only');
    expect(info?.tron).toBeUndefined();
    expect(info?.evm).toBeUndefined();
    expect(info?.ton.publicKeyHex).toBe(TON_NATIVE_KEY.slice(64));
    expect(s.getPublicInfo(1)).toBeNull();

    expect(s.signDigest('ton', 0, new Uint8Array(32).fill(1)).ok).toBe(true);
    expect(s.signDigest('evm', 0, new Uint8Array(32).fill(1))).toEqual({
      ok: false,
      error: 'invalid_chain',
    });
    expect(s.signDigest('ton', 1, new Uint8Array(32).fill(1))).toEqual({
      ok: false,
      error: 'invalid_account',
    });
    expect(getSession()).toBe(s);
  });

  it('VaultManager imports a TON-native wallet as TON-only', async () => {
    const manager = new VaultManager({
      sealStorage: new InMemoryStorage(),
      config: FAST,
    });
    const imported = await manager.importWallet(TON_NATIVE_MNEMONIC, PASS, {
      accountType: 'ton-native-only',
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.seal.accountType).toBe('ton-native-only');

    const unlocked = await manager.unlock(PASS);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    const info = unlocked.session.getPublicInfo(0);
    expect(info?.ton.publicKeyHex).toBe(TON_NATIVE_KEY.slice(64));
    expect(info?.evm).toBeUndefined();
  });

  it('VaultManager rejects an invalid TON-native phrase without throwing', async () => {
    const manager = new VaultManager({ sealStorage: new InMemoryStorage(), config: FAST });
    const r = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS, {
      accountType: 'ton-native-only',
    });
    expect(r).toEqual({ ok: false, error: 'invalid_mnemonic' });
  });
});
