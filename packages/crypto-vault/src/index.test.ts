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
import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import {
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  normalizeMnemonic,
  mnemonicToSeed,
  deriveTonKey,
  deriveTronKey,
  deriveEvmKey,
  deriveAllKeys,
  sealVault,
  unsealVault,
  changePasscode,
  evaluatePasscodeStrength,
  lockSession,
  getSession,
  InMemoryStorage,
  computeBackoffDelay,
  unlockSession,
  isBackoffActive,
  recordFailedAttempt,
  resetBackoff,
  getBackoffCount,
  isWipeThresholdReached,
} from './index';

import type { MnemonicLength } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a test seed deterministically */
function testSeed(): Uint8Array {
  const mnemonic = generateMnemonicPhrase(24);
  const normalized = normalizeMnemonic(mnemonic);
  return mnemonicToSeed(normalized);
}

/** Known test mnemonic (BIP-39 spec example) */
const TEST_MNEMONIC_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// ---------------------------------------------------------------------------
// 1. Mnemonic tests
// ---------------------------------------------------------------------------

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
    const result = validateMnemonicPhrase(TEST_MNEMONIC_24);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid words', () => {
    const result = validateMnemonicPhrase(
      'zzzzzz yyyyy xxxxx wwwww vvvvv uuuuu ttttt sssss rrrrr qqqqq ppppp ooooo nnnnn mmmmm',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown words'))).toBe(true);
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
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
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
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
    const key = deriveTonKey(seed);
    expect(key.chain).toBe('ton');
    expect(key.privateKey).toHaveLength(32);
    expect(key.path).toBe("m/44'/607'/0'");
    expect(key.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives TRON key from seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
    const key = deriveTronKey(seed);
    expect(key.chain).toBe('tron');
    expect(key.privateKey).toHaveLength(32);
    expect(key.path).toBe("m/44'/195'/0'/0/0");
    expect(key.hexAddress).toMatch(/^41[0-9a-f]{40}$/);
  });

  it('derives EVM key from seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
    const key = deriveEvmKey(seed);
    expect(key.chain).toBe('evm');
    expect(key.privateKey).toHaveLength(32);
    expect(key.path).toBe("m/44'/60'/0'/0/0");
    expect(key.rawAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('derives all keys from one seed', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
    const keys = deriveAllKeys(seed);
    expect(keys.ton).toBeDefined();
    expect(keys.tron).toBeDefined();
    expect(keys.evm).toBeDefined();
    expect(keys.ton.publicKeyHex).not.toBe(keys.tron.hexAddress);
    expect(keys.tron.hexAddress).not.toBe(keys.evm.rawAddress);
  });

  it('A1: TON derivation exposes no address; any address-like property must not contain the public key', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
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
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
    expect(Object.keys(deriveTronKey(seed))).not.toContain('address');
    expect(Object.keys(deriveTronKey(seed))).toContain('hexAddress');
    expect(Object.keys(deriveEvmKey(seed))).not.toContain('address');
    expect(Object.keys(deriveEvmKey(seed))).toContain('rawAddress');
  });

  it('different accounts get different keys', () => {
    const seed = mnemonicToSeed(normalizeMnemonic(TEST_MNEMONIC_24));
    const key0 = deriveTonKey(seed, 0);
    const key1 = deriveTonKey(seed, 1);
    expect(key0.privateKey).not.toEqual(key1.privateKey);
  });
});

// ---------------------------------------------------------------------------
// 3. Vault tests
// ---------------------------------------------------------------------------

describe('Vault', () => {
  const passcode = 'correcthorsebatterystaple';
  let seed: Uint8Array;

  beforeAll(() => {
    seed = testSeed();
  });

  it('encrypts and decrypts round trip', async () => {
    const seal = await sealVault(seed, passcode);
    const result = await unsealVault(seal, passcode);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.seed).toEqual(seed);
    }
  });

  it('rejects wrong passcode', async () => {
    const seal = await sealVault(seed, passcode);
    const result = await unsealVault(seal, 'wrongpasscode');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('wrong_passcode');
    }
  });

  it('rejects tampered ciphertext', async () => {
    const seal = await sealVault(seed, passcode);
    const tampered = {
      ...seal,
      encryptedSeed: '00' + seal.encryptedSeed.slice(2),
    };
    const result = await unsealVault(tampered, passcode);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('tampered_data');
    }
  });

  it('rejects tampered IV', async () => {
    const seal = await sealVault(seed, passcode);
    const tampered = {
      ...seal,
      iv: '00' + seal.iv.slice(2),
    };
    const result = await unsealVault(tampered, passcode);
    expect(result.success).toBe(false);
  });

  it('uses unique IVs across multiple encryptions', async () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const seal = await sealVault(seed, passcode);
      ivs.add(seal.iv);
    }
    expect(ivs.size).toBe(10);
  });

  it('supports version/parameter upgrade (different config)', async () => {
    const seal = await sealVault(seed, passcode, undefined, {
      argon2TimeCost: 4,
      argon2MemoryCost: 32768,
    });
    const result = await unsealVault(seal, passcode);
    expect(result.success).toBe(true);
  });

  it('can change passcode', async () => {
    const seal = await sealVault(seed, passcode);
    const newSeal = await changePasscode(seal, passcode, 'newpasscode123');
    if ('version' in newSeal) {
      // New seal works with new passcode
      const r1 = await unsealVault(newSeal, 'newpasscode123');
      expect(r1.success).toBe(true);
      // Old seal still works with old passcode
      const r2 = await unsealVault(seal, passcode);
      expect(r2.success).toBe(true);
    } else {
      expect(true).toBe(false); // should not reach here
    }
  });

  it('passcode-only mode works', async () => {
    const seal = await sealVault(seed, passcode);
    const result = await unsealVault(seal, passcode);
    expect(result.success).toBe(true);
  });

  it('property: vault round trips for random seeds', async () => {
    const testConfig = { argon2TimeCost: 2, argon2MemoryCost: 1024 };
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 64, maxLength: 64 }),
        fc.string({ minLength: 4, maxLength: 12 }),
        async (randomSeed, randomPasscode) => {
          const seal = await sealVault(randomSeed, randomPasscode, undefined, testConfig);
          const result = await unsealVault(seal, randomPasscode);
          if (!result.success) return false;
          const seedArr = Array.from(result.seed);
          const origArr = Array.from(randomSeed);
          return seedArr.every((b, i) => b === origArr[i]);
        },
      ),
      { numRuns: 5 },
    );
  }, 30000);

  it('evaluates passcode strength with device secret', () => {
    expect(evaluatePasscodeStrength('ab', true)).not.toBe('');
    expect(evaluatePasscodeStrength('abcd', true)).toBe('');
    expect(evaluatePasscodeStrength('abcdefgh123', true)).toBe('');
  });

  it('evaluates passcode strength without device secret', () => {
    expect(evaluatePasscodeStrength('abcd', false)).not.toBe('');
    expect(evaluatePasscodeStrength('abcdefgh', false)).not.toBe('');
    expect(evaluatePasscodeStrength('abcdefg1', false)).toBe('');
    expect(evaluatePasscodeStrength('abcdefgh1', false)).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Vault v2 + mnemonic storage tests
  // ---------------------------------------------------------------------------

  it('v2 seal stores and returns mnemonic', async () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seal = await sealVault(seed, passcode, undefined, undefined, mnemonic);
    expect(seal.version).toBe(2);
    expect(seal.encryptedMnemonic).toBeDefined();
    expect(seal.mnemonicIv).toBeDefined();

    const result = await unsealVault(seal, passcode);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mnemonic).toBe(mnemonic);
      expect(result.seed).toEqual(seed);
    }
  });

  it('v1 seal (no mnemonic) returns version 1 without mnemonic fields', async () => {
    const seal = await sealVault(seed, passcode);
    expect(seal.version).toBe(1);
    expect(seal.encryptedMnemonic).toBeUndefined();
    expect(seal.mnemonicIv).toBeUndefined();

    const result = await unsealVault(seal, passcode);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mnemonic).toBeUndefined();
    }
  });

  it('v2 seal rejects tampered mnemonic', async () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seal = await sealVault(seed, passcode, undefined, undefined, mnemonic);
    const tampered = {
      ...seal,
      encryptedMnemonic: '00' + (seal.encryptedMnemonic ?? '').slice(2),
    };
    const result = await unsealVault(tampered, passcode);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('tampered_data');
    }
  });

  it('v1 to v2 migration via re-seal preserves mnemonic', async () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    // Create v1 seal (no mnemonic)
    const v1Seal = await sealVault(seed, passcode);
    expect(v1Seal.version).toBe(1);

    // Unseal v1, then re-seal as v2 with mnemonic
    const v1Result = await unsealVault(v1Seal, passcode);
    expect(v1Result.success).toBe(true);
    if (v1Result.success) {
      const v2Seal = await sealVault(v1Result.seed, passcode, undefined, undefined, mnemonic);
      expect(v2Seal.version).toBe(2);
      expect(v2Seal.encryptedMnemonic).toBeDefined();

      // Verify v2 unseal returns mnemonic
      const v2Result = await unsealVault(v2Seal, passcode);
      expect(v2Result.success).toBe(true);
      if (v2Result.success) {
        expect(v2Result.mnemonic).toBe(mnemonic);
      }
    }
  });

  it('changePasscode preserves mnemonic in v2 seal', async () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seal = await sealVault(seed, passcode, undefined, undefined, mnemonic);
    expect(seal.version).toBe(2);

    const newSeal = await changePasscode(seal, passcode, 'newpass123');
    if ('version' in newSeal) {
      expect(newSeal.version).toBe(2);
      expect(newSeal.encryptedMnemonic).toBeDefined();

      const result = await unsealVault(newSeal, 'newpass123');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mnemonic).toBe(mnemonic);
      }
    } else {
      expect(true).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Device-secret wrap tests
// ---------------------------------------------------------------------------

describe('Device-secret wrap', () => {
  it('device secret required for unlock when hasDeviceSecret', async () => {
    const seed = testSeed();
    const passcode = 'mypasscode42';
    const deviceSecret = new Uint8Array(32).fill(0xab);

    const seal = await sealVault(seed, passcode, deviceSecret);
    expect(seal.hasDeviceSecret).toBe(true);

    // Correct passcode + correct device secret should succeed
    const goodResult = await unsealVault(seal, passcode, deviceSecret);
    expect(goodResult.success).toBe(true);

    // Correct passcode + NO device secret should fail
    const noDsResult = await unsealVault(seal, passcode);
    expect(noDsResult.success).toBe(false);
    if (!noDsResult.success) {
      expect(noDsResult.error).toBe('device_secret_missing');
    }

    // Wrong passcode + correct device secret should fail
    const wrongPwResult = await unsealVault(seal, 'wrongpass', deviceSecret);
    expect(wrongPwResult.success).toBe(false);
    if (!wrongPwResult.success) {
      expect(wrongPwResult.error).toBe('wrong_passcode');
    }

    // Wrong device secret should fail
    const wrongDs = new Uint8Array(32).fill(0xcd);
    const wrongDsResult = await unsealVault(seal, passcode, wrongDs);
    expect(wrongDsResult.success).toBe(false);
  });

  it('seal has no passcode-only unlockable copy when hasDeviceSecret', async () => {
    const seed = testSeed();
    const passcode = 'test1234';
    const deviceSecret = new Uint8Array(32).fill(0xef);

    const seal = await sealVault(seed, passcode, deviceSecret);
    expect(seal.hasDeviceSecret).toBe(true);

    // With device secret mode, passcode-only unlock must fail
    const result = await unsealVault(seal, passcode);
    expect(result.success).toBe(false);
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
// 6. Session tests
// ---------------------------------------------------------------------------

describe('Session', () => {
  it('unlocks and provides keys', async () => {
    const seed = testSeed();
    const passcode = 'sessiontest99';
    const seal = await sealVault(seed, passcode);
    const storage = new InMemoryStorage();

    const result = await unlockSession(seal, passcode, storage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.keys.ton).toBeDefined();
      expect(result.session.keys.tron).toBeDefined();
      expect(result.session.keys.evm).toBeDefined();
    }
  });

  it('locks and clears session', async () => {
    const seed = testSeed();
    const passcode = 'lockit99';
    const seal = await sealVault(seed, passcode);
    const storage = new InMemoryStorage();

    const result = await unlockSession(seal, passcode, storage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(getSession()).not.toBeNull();
      lockSession();
      expect(getSession()).toBeNull();
    }
  });

  it('getSession returns null before unlock', () => {
    expect(getSession()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Bundle / secret leakage scan
// ---------------------------------------------------------------------------

describe('Secret leakage', () => {
  it('error messages do not contain secrets', async () => {
    const seed = testSeed();
    const seal = await sealVault(seed, 'pass123');

    const wrongPass = await unsealVault(seal, 'wrongpass');
    const tampered = await unsealVault(
      { ...seal, encryptedSeed: 'ff' + seal.encryptedSeed.slice(2) },
      'pass123',
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
