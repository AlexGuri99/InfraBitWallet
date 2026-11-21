/**
 * A10: the whole flow emits nothing secret to the console.
 *
 * Console is stubbed for the entire flow and restored in `finally`. The assertions check that
 * no logged string contains any word of the test phrase, the hex of the seed or a derived
 * private key, the passcode, or a long hex blob (which would indicate key material).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import {
  createSeal,
  changePasscode,
  enableBiometric,
  disableBiometric,
  type VaultSeal,
} from './vault';
import { unlockSession, unlockSessionWithBiometric, lockSession } from './session';
import { mnemonicToSeed } from './mnemonic';
import { deriveTonKey, deriveTronKey, deriveEvmKey } from './derivation';
import { InMemoryStorage } from './storage';
import { wipeStoredVault } from './session';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'logging passphrase 99';

afterEach(() => {
  lockSession();
});

describe('A10: no secret reaches the console across the full flow', () => {
  it('generate/seal/unseal/unlock/sign/reveal/biometric/change/wipe log nothing secret', async () => {
    const logs: string[] = [];
    const original = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };
    const capture = (...args: unknown[]): void => {
      logs.push(args.map((a) => String(a)).join(' '));
    };
    console.log = capture;
    console.warn = capture;
    console.error = capture;
    console.info = capture;
    console.debug = capture;

    try {
      const storage = new InMemoryStorage();
      const seal: VaultSeal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
      const withBio = await enableBiometric(seal, PASS);
      if (!withBio.ok) throw new Error('enable failed');
      await storage.set('vault_seal', JSON.stringify(withBio.seal));

      const unlocked = await unlockSession(withBio.seal, PASS, storage);
      if (!unlocked.success) throw new Error('unlock failed');
      const s = unlocked.session;
      s.getPublicInfo(0);
      s.signDigest('evm', 0, new Uint8Array(32).fill(7));
      await s.reauthenticate(PASS);
      s.revealMnemonic();
      s.lock();

      await unlockSessionWithBiometric(withBio.seal, withBio.token, storage);
      lockSession();

      const disabled = disableBiometric(withBio.seal);
      const changed = await changePasscode(
        disabled,
        PASS,
        'logging passphrase 100',
        undefined,
        FAST,
      );
      if (!changed.ok) throw new Error('change failed');
      await wipeStoredVault(storage);
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      console.info = original.info;
      console.debug = original.debug;
    }

    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const secrets = [
      PASS,
      'logging passphrase 100',
      bytesToHex(seed),
      bytesToHex(deriveTonKey(seed).privateKey),
      bytesToHex(deriveTronKey(seed).privateKey),
      bytesToHex(deriveEvmKey(seed).privateKey),
    ];
    const joined = logs.join('\n');
    for (const secret of secrets) expect(joined).not.toContain(secret);
    for (const word of MNEMONIC_12_HARDHAT.split(' ')) {
      expect(joined.toLowerCase()).not.toContain(word.toLowerCase());
    }
    // No long hex blobs (256-bit-ish key material) may appear either.
    expect(joined).not.toMatch(/[0-9a-f]{64,}/i);
  });
});
