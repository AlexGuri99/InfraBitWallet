/**
 * A7 passcode policy — 6-digit numeric PIN (mainnet hardening, 2026-11-27).
 *
 * Deployments with a device secret use the PIN as an on-device factor; without one the copied
 * envelope remains offline-attackable, so Argon2id + backoff + six digits are the defence.
 */
import { describe, it, expect } from 'vitest';
import { evaluatePasscodeStrength, measureKdf, KDF_BOUNDS } from './vault';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

describe('A7: 6-digit PIN policy', () => {
  it.each([true, false])('accepts a non-trivial 6-digit PIN (deviceSecret=%s)', (hasSecret) => {
    const result = evaluatePasscodeStrength('258036', hasSecret);
    expect(result).toMatchObject({
      ok: true,
      kind: 'pin',
      minLength: 6,
      unprotectedByDeviceSecret: !hasSecret,
    });
    expect(result.error).toBeUndefined();
  });

  it.each(['123456', '654321', '234567', '012345', '000000', '999999'])(
    'rejects weak PIN %s',
    (pin) => {
      for (const hasSecret of [true, false]) {
        const r = evaluatePasscodeStrength(pin, hasSecret);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/too easy to guess/);
        expect(r.error).not.toContain(pin);
      }
    },
  );

  it.each(['123', '12345', '1234567', 'abcd', '12a4', '', '258036 '])(
    'rejects non-6-digit input %j',
    (value) => {
      const r = evaluatePasscodeStrength(value, true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/6-digit PIN/);
    },
  );

  it('reports unprotectedByDeviceSecret so the UI can warn', () => {
    expect(evaluatePasscodeStrength('258036', false).unprotectedByDeviceSecret).toBe(true);
    expect(evaluatePasscodeStrength('258036', true).unprotectedByDeviceSecret).toBe(false);
  });
});

describe('A7: measureKdf', () => {
  it('returns a finite time and echoes the parameters used', async () => {
    const m = await measureKdf(FAST, 2);
    expect(Number.isFinite(m.ms)).toBe(true);
    expect(m.ms).toBeGreaterThanOrEqual(0);
    expect(m).toMatchObject({
      argon2TimeCost: FAST.argon2TimeCost,
      argon2MemoryCost: FAST.argon2MemoryCost,
      argon2Parallelism: FAST.argon2Parallelism,
    });
  });

  it('rejects out-of-bounds parameters before running', async () => {
    await expect(
      measureKdf({ argon2MemoryCost: KDF_BOUNDS.argon2MemoryCost.max + 1 }),
    ).rejects.toThrow('INVALID_KDF_PARAMS');
  });
});
