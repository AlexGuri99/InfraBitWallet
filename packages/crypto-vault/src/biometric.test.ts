/**
 * A6: biometric wrap inside the vault module.
 *
 * The token is generated here and returned to the caller; this module never persists it. The
 * wrap is a second, independent encryption of the SAME vault key, so a successful unwrap still
 * has to decrypt and verify the seed/mnemonic.
 */
import { describe, it, expect } from 'vitest';
import { hexToBytes } from '@noble/hashes/utils';
import {
  createSeal,
  enableBiometric,
  disableBiometric,
  unlockWithBiometric,
  unsealVault,
  changePasscode,
  type VaultSeal,
} from './vault';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'session passphrase 123';
const DEVICE_SECRET = new Uint8Array(32).fill(0x11);

async function withBiometric(deviceSecret?: Uint8Array): Promise<{
  seal: VaultSeal;
  token: string;
}> {
  const base = await createSeal(MNEMONIC_12_HARDHAT, PASS, deviceSecret, FAST);
  const r = await enableBiometric(base, PASS, deviceSecret);
  if (!r.ok) throw new Error(`enableBiometric failed: ${r.error}`);
  return { seal: r.seal, token: r.token };
}

describe('A6: biometric wrap', () => {
  it('wrap/unwrap round trip returns the seed and phrase', async () => {
    const { seal, token } = await withBiometric();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const r = await unlockWithBiometric(seal, token);
    expect(r.success).toBe(true);
    if (r.success) expect(r.mnemonic).toBe(MNEMONIC_12_HARDHAT);
  });

  it('a wrong token fails with wrong_passcode (GCM cannot distinguish)', async () => {
    const { seal } = await withBiometric();
    const wrong = 'ff'.repeat(32);
    expect(await unlockWithBiometric(seal, wrong)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('a malformed token is rejected before any crypto runs', async () => {
    const { seal } = await withBiometric();
    for (const bad of ['', 'xyz', 'ab'.repeat(31), 'ab'.repeat(33)]) {
      expect(await unlockWithBiometric(seal, bad)).toEqual({
        success: false,
        error: 'invalid_biometric_token',
      });
    }
  });

  it('a tampered biometric blob fails with wrong_passcode', async () => {
    const { seal, token } = await withBiometric();
    const blob = hexToBytes(seal.biometricWrappedKey ?? '');
    blob[20] = (blob[20] ?? 0) ^ 0x01;
    const tampered: VaultSeal = {
      ...seal,
      biometricWrappedKey: Array.from(blob)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
    };
    expect(await unlockWithBiometric(tampered, token)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('stores its own IV in the blob; two wraps differ', async () => {
    const base = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    const a = await enableBiometric(base, PASS);
    const b = await enableBiometric(base, PASS);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // iv(12) || ct(32) || tag(16) = 60 bytes = 120 hex chars.
    expect(a.seal.biometricWrappedKey).toMatch(/^[0-9a-f]{120}$/);
    expect(a.seal.biometricWrappedKey).not.toBe(b.seal.biometricWrappedKey);
    expect(a.token).not.toBe(b.token);
  });

  it('enableBiometric with the wrong passcode fails with wrong_passcode', async () => {
    const base = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    expect(await enableBiometric(base, 'wrong passphrase')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
  });

  it('unlocking a seal with no biometric wrap reports biometric_not_enabled', async () => {
    const base = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    expect(await unlockWithBiometric(base, 'ab'.repeat(32))).toEqual({
      success: false,
      error: 'biometric_not_enabled',
    });
  });

  it('disableBiometric removes the wrap and the passcode still works', async () => {
    const { seal } = await withBiometric();
    const off = disableBiometric(seal);
    expect(off.biometricWrappedKey).toBeUndefined();
    expect((await unsealVault(off, PASS)).success).toBe(true);
    expect(off.passcodeWrappedKey).toBe(seal.passcodeWrappedKey);
  });

  it('a passcode change drops the old biometric wrap', async () => {
    const { seal, token } = await withBiometric();
    const changed = await changePasscode(seal, PASS, 'brand new passphrase 42', undefined, FAST);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.seal.biometricWrappedKey).toBeUndefined();
    expect(await unlockWithBiometric(changed.seal, token)).toEqual({
      success: false,
      error: 'biometric_not_enabled',
    });
  });
});

describe('A6: biometric wrap on a device-secret seal', () => {
  it('still requires the device secret (chosen behavior: device binding is not optional)', async () => {
    const { seal, token } = await withBiometric(DEVICE_SECRET);
    expect(await unlockWithBiometric(seal, token)).toEqual({
      success: false,
      error: 'device_secret_missing',
    });
    expect(await unlockWithBiometric(seal, token, new Uint8Array(32))).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
    expect((await unlockWithBiometric(seal, token, DEVICE_SECRET)).success).toBe(true);
  });

  it('enableBiometric without the device secret fails closed', async () => {
    const base = await createSeal(MNEMONIC_12_HARDHAT, PASS, DEVICE_SECRET, FAST);
    expect(await enableBiometric(base, PASS)).toEqual({
      ok: false,
      error: 'device_secret_missing',
    });
  });
});
