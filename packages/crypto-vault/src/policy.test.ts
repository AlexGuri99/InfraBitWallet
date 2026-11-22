/**
 * A7 passcode policy — temporarily a 4-digit numeric PIN in every environment.
 *
 * The relaxation is recorded in docs/DECISIONS.md / THREAT_MODEL.md / UNVERIFIED.md: a 4-digit
 * PIN without a device secret is brute-forceable offline if the envelope is copied.
 */
import { describe, it, expect } from 'vitest';
import { evaluatePasscodeStrength, measureKdf, KDF_BOUNDS } from './vault';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

describe('A7: 4-digit PIN policy', () => {
  it.each([true, false])('accepts a non-trivial 4-digit PIN (deviceSecret=%s)', (hasSecret) => {
    const result = evaluatePasscodeStrength('2580', hasSecret);
    expect(result).toMatchObject({
      ok: true,
      kind: 'pin',
      minLength: 4,
      unprotectedByDeviceSecret: !hasSecret,
    });
    expect(result.error).toBeUndefined();
  });

  it.each(['1234', '4321', '2345', '0123', '0000', '9999'])('rejects weak PIN %s', (pin) => {
    for (const hasSecret of [true, false]) {
      const r = evaluatePasscodeStrength(pin, hasSecret);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/too easy to guess/);
      expect(r.error).not.toContain(pin);
    }
  });

  it.each(['123', '12345', 'abcd', '12a4', '', '2580 '])(
    'rejects non-4-digit input %j',
    (value) => {
      const r = evaluatePasscodeStrength(value, true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/4-digit PIN/);
    },
  );

  it('reports unprotectedByDeviceSecret so the UI can warn', () => {
    expect(evaluatePasscodeStrength('2580', false).unprotectedByDeviceSecret).toBe(true);
    expect(evaluatePasscodeStrength('2580', true).unprotectedByDeviceSecret).toBe(false);
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
