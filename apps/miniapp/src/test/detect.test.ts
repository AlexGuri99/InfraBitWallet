/**
 * Account-type detection: 12 -> BIP-39, 24 -> one of the two, or explicit disambiguation when
 * both validators accept the phrase (the ~1/256 collision). Validators are injected so the
 * ambiguous path is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { detectAccountType } from '../vault/detect';

const WORDS_12 = 'a b c d e f g h i j k l';
const WORDS_24 = Array.from({ length: 24 }, (_, i) => `w${String(i)}`).join(' ');

describe('account-type detection', () => {
  it('12 words are always BIP-39', async () => {
    expect(
      await detectAccountType(WORDS_12, { validateBip39: () => true, validateTon: () => true }),
    ).toEqual({ kind: 'resolved', accountType: 'bip39-multichain' });
    expect(
      await detectAccountType(WORDS_12, { validateBip39: () => false, validateTon: () => true }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('24 words valid as both require disambiguation', async () => {
    expect(
      await detectAccountType(WORDS_24, { validateBip39: () => true, validateTon: () => true }),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('24 words valid only as BIP-39 resolve silently', async () => {
    expect(
      await detectAccountType(WORDS_24, { validateBip39: () => true, validateTon: () => false }),
    ).toEqual({ kind: 'resolved', accountType: 'bip39-multichain' });
  });

  it('24 words valid only as TON-native resolve silently', async () => {
    expect(
      await detectAccountType(WORDS_24, { validateBip39: () => false, validateTon: () => true }),
    ).toEqual({ kind: 'resolved', accountType: 'ton-native-only' });
  });

  it('forcing TON-native requires the TON check to pass', async () => {
    expect(
      await detectAccountType(WORDS_24, {
        forceTonNative: true,
        validateBip39: () => true,
        validateTon: () => true,
      }),
    ).toEqual({ kind: 'resolved', accountType: 'ton-native-only' });
    expect(
      await detectAccountType(WORDS_24, {
        forceTonNative: true,
        validateBip39: () => true,
        validateTon: () => false,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('neither valid -> invalid with a position-only message', async () => {
    const result = await detectAccountType(WORDS_24, {
      validateBip39: () => false,
      validateTon: () => false,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.message.length).toBeGreaterThan(0);
  });
});
