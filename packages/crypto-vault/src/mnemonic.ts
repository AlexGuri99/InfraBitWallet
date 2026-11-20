/**
 * BIP-39 mnemonic generation, validation, and normalization.
 *
 * Uses @scure/bip39 (audited, dependency-free ESM library).
 * Uses crypto.getRandomValues for entropy (Web Crypto API).
 *
 * Sources:
 * - BIP-39 spec: https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
 * - @scure/bip39 docs: https://github.com/paulmillr/scure-bip39
 */
import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { bytesToHex } from '@noble/hashes/utils';

const WORDLIST = wordlist;

/** Supported mnemonic word counts */
export type MnemonicLength = 12 | 15 | 18 | 21 | 24;

/** Result of mnemonic validation */
export interface MnemonicValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Generate a cryptographically secure BIP-39 mnemonic phrase.
 *
 * Uses crypto.getRandomValues (Web Crypto API) for entropy.
 * 24 words = 256 bits of entropy + 8 bits checksum.
 *
 * @param length - Number of words (default 24)
 * @returns The mnemonic phrase as a space-joined string
 * @throws {Error} If crypto.getRandomValues is unavailable
 */
export function generateMnemonicPhrase(length: MnemonicLength = 24): string {
  const strength: Record<MnemonicLength, number> = {
    12: 128,
    15: 160,
    18: 192,
    21: 224,
    24: 256,
  };

  return generateMnemonic(WORDLIST, strength[length]);
}

/**
 * Normalize a mnemonic phrase for validation and seed generation.
 *
 * - Trim whitespace
 * - Collapse internal whitespace to single spaces
 * - Apply NFKD normalization (reduces Unicode equivalence issues)
 *
 * Reference: BIP-39 spec § "Mnemonic sentence to seed"
 */
export function normalizeMnemonic(phrase: string): string {
  return phrase
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFKD')
    .toLowerCase();
}

/**
 * Validate a BIP-39 mnemonic phrase.
 *
 * Checks:
 * 1. Non-empty input
 * 2. Valid word count (12, 15, 18, 21, or 24)
 * 3. All words in the BIP-39 English wordlist
 * 4. Valid checksum (BIP-39 algorithm)
 *
 * @param phrase - Raw mnemonic phrase (will be normalized)
 * @returns Validation result with errors array
 */
export function validateMnemonicPhrase(phrase: string): MnemonicValidation {
  const errors: string[] = [];
  const normalized = normalizeMnemonic(phrase);

  if (!normalized) {
    return { valid: false, errors: ['Mnemonic phrase is empty'] };
  }

  const words = normalized.split(' ');
  const validLengths = new Set([12, 15, 18, 21, 24]);

  if (!validLengths.has(words.length)) {
    errors.push(
      `Invalid word count: ${String(words.length)}. Expected 12, 15, 18, 21, or 24 words.`,
    );
  }

  const wordlistSet = new Set(WORDLIST);
  const unknownWords = words.filter((w) => !wordlistSet.has(w));
  if (unknownWords.length > 0) {
    errors.push(`Unknown words: ${unknownWords.slice(0, 3).join(', ')}${unknownWords.length > 3 ? '...' : ''}`);
  }

  if (errors.length === 0 && !validateMnemonic(normalized, WORDLIST)) {
    errors.push('Checksum validation failed');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Convert a validated, normalized mnemonic to a 64-byte seed (BIP-39).
 *
 * @param normalizedPhrase - Must be pre-normalized (call normalizeMnemonic + validateMnemonicPhrase first)
 * @param passphrase - Optional BIP-39 passphrase (empty string for standard)
 * @returns 64-byte Uint8Array seed
 */
export function mnemonicToSeed(normalizedPhrase: string, passphrase: string = ''): Uint8Array {
  return mnemonicToSeedSync(normalizedPhrase, passphrase);
}

/**
 * Zero-fill a Uint8Array.
 * Note: this is best-effort in JavaScript. The runtime may keep copies.
 * See docs/VAULT_DESIGN.md for limits.
 */
export function zeroFill(buf: Uint8Array): void {
  buf.fill(0);
}

export { bytesToHex };

/**
 * Generate a hex-encoded entropy string for TON-legacy wallet import.
 * Not a secret; used only for address derivation testing.
 */
export function seedToHex(seed: Uint8Array): string {
  return bytesToHex(seed);
}