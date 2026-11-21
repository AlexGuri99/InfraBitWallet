/**
 * A7: passcode policy and the KDF benchmark helper.
 */
import { describe, it, expect } from 'vitest';
import { evaluatePasscodeStrength, measureKdf, KDF_BOUNDS } from './vault';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

describe('A7: passcode policy with a device secret', () => {
  it('accepts a 6+ digit PIN and rejects a 5-digit one', () => {
    expect(evaluatePasscodeStrength('482915', true)).toMatchObject({
      ok: true,
      kind: 'pin',
      unprotectedByDeviceSecret: false,
    });
    const short = evaluatePasscodeStrength('4829', true);
    expect(short.ok).toBe(false);
    expect(short.error).toMatch(/at least 6 digits/);
    expect(short.error).not.toContain('4829'); // never echo the input
  });

  it.each(['000000', '111111', '123456', '654321', '012345', '987654'])(
    'rejects weak PIN %s',
    (pin) => {
      const r = evaluatePasscodeStrength(pin, true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/too easy to guess/);
    },
  );

  it('accepts an 8+ character passphrase and rejects a 7-character one', () => {
    expect(evaluatePasscodeStrength('abcd1234', true).ok).toBe(true);
    expect(evaluatePasscodeStrength('abcd123', true).ok).toBe(false);
  });
});

describe('A7: passcode policy without a device secret', () => {
  it('requires 12+ characters and reports unprotectedByDeviceSecret', () => {
    const short = evaluatePasscodeStrength('short pass', false);
    expect(short.ok).toBe(false);
    expect(short.unprotectedByDeviceSecret).toBe(true);
    const ok = evaluatePasscodeStrength('a longer passphrase', false);
    expect(ok.ok).toBe(true);
    expect(ok.unprotectedByDeviceSecret).toBe(true);
    expect(ok.kind).toBe('passphrase');
  });

  it.each(['password12345', '123456789012', 'Qwerty123456', 'correcthorsebatterystaple'])(
    'rejects blocklisted passphrase %s',
    (pass) => {
      const r = evaluatePasscodeStrength(pass, false);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/too common/);
      expect(r.error).not.toContain(pass);
    },
  );
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
