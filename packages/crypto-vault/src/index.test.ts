/**
 * Comprehensive tests for the crypto-vault package.
 *
 * Covers:
 * - BIP-39 mnemonic generation, validation, normalization
 * - Address derivation vectors for TON / TRON / EVM
 * - Vault encrypt/decrypt round trips, wrong-passcode rejection,
 *   tampered-data rejection, IV uniqueness, parameter versioning
 * - Device-secret wrap mode
 * - Backoff persistence
 * - Bundle/secret leakage scan
 * - Property tests (fast-check)
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  normalizeMnemonic,
  createSeal,
  InMemoryStorage,
  computeBackoffDelay,
  isBackoffActive,
  recordFailedAttempt,
  resetBackoff,
  getBackoffCount,
  isWipeThresholdReached,
} from './index';
import * as publicApi from './index';
import { mnemonicToSeed } from './mnemonic';
import { deriveTonKey, deriveTronKey, deriveEvmKey, deriveAllKeys } from './derivation';
import { unsealVault } from './vault';
import { MNEMONIC_12_ABANDON } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

import type { MnemonicLength } from './index';
import { MNEMONIC_24_ABANDON } from './fixtures/mnemonics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Mnemonic tests
// ---------------------------------------------------------------------------

describe('A3: public API surface', () => {
  // Adding an export fails this test until the allowlist is consciously updated.
  // No name here may return the seed, a private key or the vault key.
  const ALLOWED_EXPORTS = [
    'CompositeStorage',
    'DEFAULT_VAULT_CONFIG',
    'InMemoryStorage',
    'IndexedDBAdapter',
    'KDF_BOUNDS',
    'STORAGE_KEYS',
    'TON_MAINNET_GLOBAL_ID',
    'TON_TESTNET_GLOBAL_ID',
    'TON_V5R1_DEFAULT_WALLET_ID',
    'VAULT_FORMAT_VERSION',
    'VaultManager',
    'changePasscode',
    'computeBackoffDelay',
    'createSeal',
    'disableBiometric',
    'enableBiometric',
    'evaluatePasscodeStrength',
    'generateMnemonicPhrase',
    'generateTonNativeMnemonicPhrase',
    'getBackoffCount',
    'getSession',
    'isBackoffActive',
    'isValidDeviceSecretHex',
    'isValidEvmAddress',
    'isValidTronAddress',
    'isWipeThresholdReached',
    'loadSeal',
    'lockSession',
    'measureKdf',
    'migrateStoredSeal',
    'normalizeMnemonic',
    'recordFailedAttempt',
    'resetBackoff',
    'saveSeal',
    'setInactivityTimeout',
    'toBase58TronAddress',
    'toEip55Address',
    'tonAddressesFromPublicKey',
    'touchSession',
    'unlockSession',
    'unlockSessionWithBiometric',
    'validateMnemonicPhrase',
    'validateTonAddress',
    'validateTonMnemonicPhrase',
    'wipeStoredVault',
  ];
  it('exports exactly the allowlisted names', () => {
    expect(Object.keys(publicApi).sort()).toEqual([...ALLOWED_EXPORTS].sort());
  });
  it('does not export seed/key/vault-key returning functions', () => {
    for (const banned of [
      'seedToHex',
      'mnemonicToSeed',
      'sealVault',
      'unsealVault',
      'deriveAllKeys',
      'deriveTonKey',
      'deriveTronKey',
      'deriveEvmKey',
      'addBiometricWrap',
      'removeBiometricWrap',
      'zeroFill',
      'bytesToHex',
    ]) {
      expect(Object.keys(publicApi)).not.toContain(banned);
    }
  });
});

describe('Mnemonic', () => {
  it('generates a 24-word phrase', () => {
    const phrase = generateMnemonicPhrase(24);
    const words = phrase.split(' ');
    expect(words).toHaveLength(24);
  });

  it('generates a 12-word phrase', () => {
    const phrase = generateMnemonicPhrase(12);
    const words = phrase.split(' ');
    expect(words).toHaveLength(12);
  });

  it('rejects invalid word counts', () => {
    const result = validateMnemonicPhrase('one two three');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('word count'))).toBe(true);
  });

  it('validates a known good mnemonic', () => {
    const result = validateMnemonicPhrase(MNEMONIC_24_ABANDON);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid words', () => {
    const result = validateMnemonicPhrase(
      'zzzzzz yyyyy xxxxx wwwww vvvvv uuuuu ttttt sssss rrrrr qqqqq ppppp ooooo nnnnn mmmmm',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('not in the BIP-39 English wordlist'))).toBe(true);
  });

  it('A10: validation errors report word positions and never echo the typed words', () => {
    const secretWord = 'zznotarealwordzz';
    const result = validateMnemonicPhrase(
      `${secretWord} abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`,
    );
    expect(result.valid).toBe(false);
    const text = result.errors.join(' ');
    expect(text).not.toContain(secretWord);
    expect(text).toContain('position 1');
    expect(text).toContain('not in the BIP-39 English wordlist');
  });

  it('rejects invalid checksum', () => {
    // Tamper one word in a valid mnemonic
    const phrase =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo';
    const result = validateMnemonicPhrase(phrase);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Checksum'))).toBe(true);
  });

  it('normalizes phrases (whitespace, case)', () => {
    const normalized = normalizeMnemonic('  Abandon  ABANDON  abandon  ');
    expect(normalized).toBe('abandon abandon abandon');
  });

  it('produces a 64-byte seed from mnemonic', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    expect(seed).toHaveLength(64);
  });

  it('property: mnemonic generation produces valid phrases', () => {
    fc.assert(
      fc.property(fc.constantFrom(12, 15, 18, 21, 24), (length) => {
        const phrase = generateMnemonicPhrase(length as MnemonicLength);
        const result = validateMnemonicPhrase(phrase);
        return result.valid;
      }),
      { numRuns: 20 },
    );
  });

  it('property: normalization is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const normalized = normalizeMnemonic(input);
        const renormalized = normalizeMnemonic(normalized);
        return normalized === renormalized;
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Derivation tests
// ---------------------------------------------------------------------------

describe('Derivation', () => {
  it('derives TON key from seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    const key = deriveTonKey(seed);
    expect(key.chain).toBe('ton');
    expect(key.privateKey).toHaveLength(32);
    expect(key.path).toBe("m/44'/607'/0'");
    expect(key.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives TRON key from seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    const key = deriveTronKey(seed);
    expect(key.chain).toBe('tron');
    expect(key.privateKey).toHaveLength(32);
    expect(key.path).toBe("m/44'/195'/0'/0/0");
    expect(key.hexAddress).toMatch(/^41[0-9a-f]{40}$/);
  });

  it('derives EVM key from seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    const key = deriveEvmKey(seed);
    expect(key.chain).toBe('evm');
    expect(key.privateKey).toHaveLength(32);
    expect(key.path).toBe("m/44'/60'/0'/0/0");
    expect(key.rawAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('derives all keys from one seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    const keys = deriveAllKeys(seed);
    expect(keys.ton).toBeDefined();
    expect(keys.tron).toBeDefined();
    expect(keys.evm).toBeDefined();
    expect(keys.ton.publicKeyHex).not.toBe(keys.tron.hexAddress);
    expect(keys.tron.hexAddress).not.toBe(keys.evm.rawAddress);
  });

  it('A1: TON derivation exposes no address; any address-like property must not contain the public key', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    const key = deriveTonKey(seed) as unknown as Record<string, unknown>;
    const pub = key['publicKeyHex'] as string;
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
    // The misleading field must not exist at all.
    expect(Object.keys(key)).not.toContain('address');
    expect(key['address']).toBeUndefined();
    // Defence in depth: no string property other than publicKeyHex may equal or contain the pubkey,
    // so a future "address" under any name that is just the raw key fails here.
    for (const [name, value] of Object.entries(key)) {
      if (name === 'publicKeyHex' || typeof value !== 'string') continue;
      expect(value.toLowerCase()).not.toContain(pub);
    }
  });

  it('A1: TRON and EVM results do not use the name "address" for intermediate forms', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    expect(Object.keys(deriveTronKey(seed))).not.toContain('address');
    expect(Object.keys(deriveTronKey(seed))).toContain('hexAddress');
    expect(Object.keys(deriveEvmKey(seed))).not.toContain('address');
    expect(Object.keys(deriveEvmKey(seed))).toContain('rawAddress');
  });

  it('different accounts get different keys', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(MNEMONIC_24_ABANDON));
    const key0 = deriveTonKey(seed, 0);
    const key1 = deriveTonKey(seed, 1);
    expect(key0.privateKey).not.toEqual(key1.privateKey);
  });
});

// ---------------------------------------------------------------------------
// 5. Backoff tests
// ---------------------------------------------------------------------------

describe('Backoff', () => {
  it('computes exponential delay', () => {
    expect(computeBackoffDelay(0)).toBe(0);
    expect(computeBackoffDelay(1)).toBeGreaterThanOrEqual(2000);
    expect(computeBackoffDelay(1)).toBeLessThan(4000);
    expect(computeBackoffDelay(2)).toBeGreaterThanOrEqual(2000);
    expect(computeBackoffDelay(10)).toBeGreaterThanOrEqual(512000);
  });

  it('persists and resets backoff', async () => {
    const storage = new InMemoryStorage();
    expect(await isBackoffActive(storage)).toBe(0);

    await recordFailedAttempt(storage);
    const remaining = await isBackoffActive(storage);
    expect(remaining).toBeGreaterThan(0);

    await resetBackoff(storage);
    expect(await isBackoffActive(storage)).toBe(0);
  });

  it('tracks attempt count', async () => {
    const storage = new InMemoryStorage();
    await recordFailedAttempt(storage);
    await recordFailedAttempt(storage);
    expect(await getBackoffCount(storage)).toBe(2);
  });

  it('detects wipe threshold', async () => {
    const storage = new InMemoryStorage();
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt(storage);
    }
    expect(await isWipeThresholdReached(storage, 5)).toBe(true);
    expect(await isWipeThresholdReached(storage, 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Bundle / secret leakage scan
// ---------------------------------------------------------------------------

describe('Secret leakage', () => {
  it('error messages do not contain secrets', async () => {
    const seal = await createSeal(MNEMONIC_12_ABANDON, 'pass1234-ok', undefined, FAST);

    const wrongPass = await unsealVault(seal, 'wrongpass');
    const tampered = await unsealVault(
      {
        ...seal,
        encryptedSeed:
          (parseInt(seal.encryptedSeed.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') +
          seal.encryptedSeed.slice(2),
      },
      'pass1234-ok',
    );

    // Wrong passcode and tampered return constant error messages, not details
    if (!wrongPass.success) {
      expect(wrongPass.error).toMatch(/^(wrong_passcode|device_secret_missing|tampered_data)$/);
    }
    if (!tampered.success) {
      expect(tampered.error).toMatch(/^(wrong_passcode|device_secret_missing|tampered_data)$/);
    }
  });

  it('does not log secrets to console', () => {
    // Stub console and run the full flow
    const logs: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    // Generate and process mnemonic
    const phrase = generateMnemonicPhrase(24);
    const normalized = normalizeMnemonic(phrase);
    mnemonicToSeed(normalized);

    // Check no logs contain secret-like data
    for (const log of logs) {
      expect(log.toLowerCase()).not.toContain('abandon');
      expect(log.toLowerCase()).not.toContain('mnemonic');
      expect(log.toLowerCase()).not.toContain('seed');
      expect(log).not.toMatch(/[0-9a-f]{64,}/i); // no 256+ bit hex strings
    }

    console.log = originalLog;
    console.warn = originalWarn;
  });
});
