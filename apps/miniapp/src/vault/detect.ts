/**
 * Account-type detection for imports.
 *
 * 12-word phrases are always BIP-39. 24-word phrases are checked against both schemes: the same
 * words can be valid in both and then derive different keys (~1 in 256 BIP-39 phrases also pass
 * the TON seed check), so that case needs an explicit user choice.
 *
 * Validators are injectable so the ambiguous case can be tested deterministically.
 */
import {
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
  type AccountType,
} from '@onezerowallet/crypto-vault';

export type PhraseDetection =
  | { kind: 'resolved'; accountType: AccountType }
  | { kind: 'ambiguous' }
  | { kind: 'invalid'; message: string };

export interface DetectOptions {
  /** User explicitly forced the TON-native reading. */
  forceTonNative?: boolean;
  validateBip39?: (phrase: string) => boolean;
  validateTon?: (phrase: string) => Promise<boolean> | boolean;
}

export function phraseWordCount(phrase: string): number {
  return phrase.trim() === '' ? 0 : phrase.trim().split(/\s+/).length;
}

export async function detectAccountType(
  phrase: string,
  options: DetectOptions = {},
): Promise<PhraseDetection> {
  const validation = validateMnemonicPhrase(phrase);
  const bip39Valid = options.validateBip39 ? options.validateBip39(phrase) : validation.valid;
  const words = phraseWordCount(phrase);
  const tonValid =
    words === 24
      ? await (options.validateTon
          ? options.validateTon(phrase)
          : validateTonMnemonicPhrase(phrase))
      : false;

  if (options.forceTonNative) {
    return tonValid
      ? { kind: 'resolved', accountType: 'ton-native-only' }
      : { kind: 'invalid', message: 'The phrase is not a valid TON-native mnemonic.' };
  }

  if (words !== 12 && words !== 24) {
    return { kind: 'invalid', message: 'Enter 12 or 24 words.' };
  }
  if (bip39Valid && tonValid) return { kind: 'ambiguous' };
  if (bip39Valid) return { kind: 'resolved', accountType: 'bip39-multichain' };
  if (tonValid) return { kind: 'resolved', accountType: 'ton-native-only' };
  // Position-only errors; they never echo the words.
  return {
    kind: 'invalid',
    message: validation.errors[0] ?? 'The phrase is not a valid mnemonic.',
  };
}
