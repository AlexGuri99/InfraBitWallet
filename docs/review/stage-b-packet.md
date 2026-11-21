# Stage B review packet

Generated from branch stage-a-fixes. Full source of every security-relevant file changed or added in Stage B.

## packages/crypto-vault/src/index.ts

```typescript
/**
 * @onezerowallet/crypto-vault public API.
 *
 * RULE: nothing exported here may return the seed, a private key or the vault key. Functions
 * that necessarily handle key material (`unsealVault`, `sealVault`, `derive*`, `mnemonicToSeed`)
 * stay module-internal. index.test.ts enforces an explicit allowlist of export names, so adding
 * an export fails CI until someone consciously updates the list.
 */

export {
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  normalizeMnemonic,
  generateTonNativeMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
export type { MnemonicLength, MnemonicValidation } from './mnemonic';
export type { AccountType } from './account-type';

export {
  createSeal,
  changePasscode,
  evaluatePasscodeStrength,
  measureKdf,
  enableBiometric,
  disableBiometric,
  DEFAULT_VAULT_CONFIG,
  KDF_BOUNDS,
  VAULT_FORMAT_VERSION,
} from './vault';
export type {
  VaultConfig,
  VaultSeal,
  PasscodePolicy,
  KdfMeasurement,
  ChangePasscodeResult,
  EnableBiometricResult,
} from './vault';

export {
  unlockSession,
  unlockSessionWithBiometric,
  lockSession,
  touchSession,
  getSession,
  setInactivityTimeout,
  wipeStoredVault,
} from './session';
export type {
  VaultSession,
  UnlockResult,
  UnlockOptions,
  ReauthResult,
  RevealResult,
  PublicAccountInfo,
  SigningRequest,
} from './session';

export {
  computeBackoffDelay,
  isBackoffActive,
  recordFailedAttempt,
  resetBackoff,
  isWipeThresholdReached,
  getBackoffCount,
} from './backoff';

export {
  toEip55Address,
  isValidEvmAddress,
  toBase58TronAddress,
  isValidTronAddress,
  tonAddressesFromPublicKey,
  validateTonAddress,
  TON_MAINNET_GLOBAL_ID,
  TON_TESTNET_GLOBAL_ID,
  TON_V5R1_DEFAULT_WALLET_ID,
} from './address';
export type { TonAddressForms, TonAddressValidation } from './address';

export { InMemoryStorage, CompositeStorage, STORAGE_KEYS } from './storage';
export type { StorageAdapter } from './storage';

export { IndexedDBAdapter } from './indexeddb';
export type { IndexedDbAdapterOptions } from './indexeddb';

export { saveSeal, loadSeal, migrateStoredSeal } from './seal-store';
export type { SaveSealResult, LoadSealResult, MigrateStoredResult } from './seal-store';

export { isValidDeviceSecretHex } from './device-secret';

export { VaultManager } from './vault-manager';
export type { VaultManagerOptions, CreateWalletResult } from './vault-manager';
```

## packages/crypto-vault/src/address.ts

```typescript
/**
 * User-facing address forms (B1).
 *
 * - EVM: EIP-55 checksummed address.
 * - TRON: base58check ("T…") from the 0x41-prefixed 21-byte form.
 * - TON: Wallet V5R1 address (hash of the wallet contract StateInit) in raw and user-friendly
 *   bounceable/non-bounceable forms, mainnet and testnet.
 *
 * Sources (fetched 2026-11-21):
 * - EIP-55: https://eips.ethereum.org/EIPS/eip-55
 * - TON address formats: https://docs.ton.org/v3/documentation/smart-contracts/addresses/address-formats
 *   Raw = "workchain:account_id"; user-friendly = flags(1)+workchain(1)+account(32)+CRC16(2),
 *   base64url. Flags: 0x11 bounceable, 0x51 non-bounceable, +0x80 testnet-only.
 *   "Use non-bounceable addresses for wallet contracts so funds can be credited even if the
 *   recipient is uninitialized."
 * - TON Wallet V5R1: @ton/ton (MIT) WalletContractV5R1; wallet id = global_id ^ context,
 *   global_id -239 mainnet / -3 testnet, default workchain 0, subwallet 0.
 * - Base58check: @scure/base (MIT), double SHA-256, 4-byte checksum.
 * - TRON hex address: 0x41 + last 20 bytes of keccak256(uncompressed pubkey[1:]).
 */
// Order matters: the buffer polyfill and zod's jitless config must run before @ton modules load.
import './buffer-polyfill';
import './zod-jitless';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { Address, contractAddress } from '@ton/core';
import { WalletContractV5R1 } from '@ton/ton';
import { Buffer as NodeBuffer } from 'buffer';

const base58check = createBase58check(sha256);

// ---------------------------------------------------------------------------
// EVM — EIP-55
// ---------------------------------------------------------------------------

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 checksum for a 20-byte address given in lowercase hex (with or without 0x). */
export function toEip55Address(address: string): string {
  const raw = address.startsWith('0x') ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(raw)) throw new Error('INVALID_EVM_ADDRESS');
  const lower = raw.toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = lower[i] ?? '';
    const nibble = Number.parseInt(hash[i] ?? '0', 16);
    out += nibble >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

/**
 * Validate an EVM address. Digits and prefix are checked; an all-lower or all-upper address is
 * accepted (no checksum information), a mixed-case address must match EIP-55.
 */
export function isValidEvmAddress(address: string): boolean {
  if (!EVM_ADDRESS.test(address)) return false;
  const raw = address.slice(2);
  if (raw === raw.toLowerCase() || raw === raw.toUpperCase()) return true;
  return toEip55Address(address) === address;
}

// ---------------------------------------------------------------------------
// TRON — base58check
// ---------------------------------------------------------------------------

/**
 * Base58check "T…" address from the 21-byte 0x41-prefixed hex form
 * (e.g. "41" + 40 hex chars). Throws on a malformed input.
 */
export function toBase58TronAddress(hexAddress: string): string {
  if (!/^41[0-9a-fA-F]{40}$/.test(hexAddress)) throw new Error('INVALID_TRON_HEX_ADDRESS');
  return base58check.encode(hexToBytes(hexAddress.toLowerCase()));
}

/** Validate a base58check TRON address: decodes to 21 bytes starting with 0x41. */
export function isValidTronAddress(address: string): boolean {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  try {
    const bytes = base58check.decode(address);
    return bytes.length === 21 && bytes[0] === 0x41;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// TON — Wallet V5R1 addresses
// ---------------------------------------------------------------------------

export const TON_MAINNET_GLOBAL_ID = -239;
export const TON_TESTNET_GLOBAL_ID = -3;

export interface TonAddressForms {
  /** "workchain:account_id" */
  raw: string;
  /** Mainnet, requires bounces (EQ…). */
  bounceable: string;
  /** Mainnet, permits non-bounceable messages (UQ…). */
  nonBounceable: string;
  /** Testnet-only, requires bounces (kQ…). */
  testnetBounceable: string;
  /** Testnet-only, permits non-bounceable messages (0Q…). */
  testnetNonBounceable: string;
}

/** Stable label for the default V5R1 wallet id: mainnet, workchain 0, subwallet 0. */
export const TON_V5R1_DEFAULT_WALLET_ID = {
  mainnet: 2147483409,
  testnet: 2147483645,
} as const;

function createV5R1(publicKeyHex: string, networkGlobalId: number): WalletContractV5R1 {
  const publicKey = NodeBuffer.from(hexToBytes(publicKeyHex.toLowerCase()));
  return WalletContractV5R1.create({
    workchain: 0,
    publicKey,
    walletId: { networkGlobalId },
  });
}

/**
 * All address forms for an Ed25519 public key using Wallet V5R1 (mainnet and testnet).
 * Account index is NOT part of the address: each derived key has its own address with
 * subwallet number 0.
 */
export function tonAddressesFromPublicKey(publicKeyHex: string): TonAddressForms {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) throw new Error('INVALID_TON_PUBLIC_KEY');
  const main = createV5R1(publicKeyHex, TON_MAINNET_GLOBAL_ID).address;
  const test = createV5R1(publicKeyHex, TON_TESTNET_GLOBAL_ID).address;
  return {
    raw: main.toRawString(),
    bounceable: main.toString({ bounceable: true, urlSafe: true }),
    nonBounceable: main.toString({ bounceable: false, urlSafe: true }),
    testnetBounceable: test.toString({ bounceable: true, urlSafe: true, testOnly: true }),
    testnetNonBounceable: test.toString({ bounceable: false, urlSafe: true, testOnly: true }),
  };
}

/**
 * Independent cross-check of tonAddressesFromPublicKey: rebuild the wallet StateInit and hash it
 * with contractAddress. Used in tests to catch a wallet-id or serialization mistake.
 * Exported for tests only (not part of the package's public API).
 */
export function tonRawAddressViaStateInit(
  publicKeyHex: string,
  networkGlobalId: number = TON_MAINNET_GLOBAL_ID,
): string {
  const contract = createV5R1(publicKeyHex, networkGlobalId);
  return contractAddress(0, { code: contract.init.code, data: contract.init.data }).toRawString();
}

export interface TonAddressValidation {
  valid: boolean;
  /** Raw "workchain:hex" form when valid. */
  raw?: string;
  /** Whether the input declared the testnet-only flag (user-friendly forms only). */
  testnet?: boolean | undefined;
}

/**
 * Validate a TON address in raw or user-friendly form. Uses @ton/core parsing, which verifies
 * the CRC16 checksum of user-friendly forms.
 */
export function validateTonAddress(input: string): TonAddressValidation {
  if (typeof input !== 'string' || input.trim() === '') return { valid: false };
  try {
    const address = Address.parse(input.trim());
    const testnet = /^[k0]/.test(input.trim()) && !input.trim().includes(':') ? true : undefined;
    return { valid: true, raw: address.toRawString(), testnet };
  } catch {
    return { valid: false };
  }
}
```

## packages/crypto-vault/src/account-type.ts

```typescript
/**
 * Account type stored (and authenticated) in the seal.
 *
 * - `bip39-multichain`: the phrase is a BIP-39 mnemonic. One BIP-39 seed derives every chain:
 *   TON via SLIP-10 m/44'/607'/N', TRON m/44'/195'/N'/0/0, EVM m/44'/60'/N'/0/0.
 * - `ton-native-only`: the phrase is a TON-native 24-word mnemonic (BIP-39-style wordlist with
 *   TON's own "TON seed version" check). It only produces a TON Ed25519 key via
 *   @ton/crypto mnemonicToPrivateKey; no TRON/EVM accounts exist.
 *
 * These are NOT interchangeable: the same words produce different keys under BIP-39 and under
 * the TON-native derivation (different PBKDF2 salts). See docs/DECISIONS.md.
 */
export type AccountType = 'bip39-multichain' | 'ton-native-only';

export const DEFAULT_ACCOUNT_TYPE: AccountType = 'bip39-multichain';

export function isAccountType(value: unknown): value is AccountType {
  return value === 'bip39-multichain' || value === 'ton-native-only';
}
```

## packages/crypto-vault/src/mnemonic.ts

```typescript
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
import {
  mnemonicNew as tonMnemonicNewImpl,
  mnemonicToSeed as tonMnemonicToSeedImpl,
  mnemonicValidate as tonMnemonicValidateImpl,
} from '@ton/crypto';

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
  return phrase.trim().replace(/\s+/g, ' ').normalize('NFKD').toLowerCase();
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
  // Report POSITIONS only. Never echo a user-typed word: the phrase is the master secret and a
  // validation error must not end up in logs, analytics or crash reports.
  const unknownPositions: number[] = [];
  words.forEach((w, index) => {
    if (!wordlistSet.has(w)) unknownPositions.push(index + 1);
  });
  if (unknownPositions.length > 0) {
    const shown = unknownPositions.slice(0, 5).join(', ');
    const more =
      unknownPositions.length > 5 ? ` and ${String(unknownPositions.length - 5)} more` : '';
    errors.push(
      `Word${unknownPositions.length > 1 ? 's' : ''} at position${unknownPositions.length > 1 ? 's' : ''} ${shown}${more} not in the BIP-39 English wordlist`,
    );
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

// ---------------------------------------------------------------------------
// TON-native mnemonics (B2)
// ---------------------------------------------------------------------------
//
// TON's own 24-word scheme uses the BIP-39 English wordlist but NOT the BIP-39 checksum and NOT
// the BIP-39 seed derivation. Source (MIT): @ton/crypto mnemonic/mnemonic.js, which mirrors
// ton-blockchain/ton tonlib/tonlib/keys/Mnemonic.cpp:
//   entropy = HMAC-SHA512(words joined, password || "")
//   valid   = PBKDF2-SHA512(entropy, "TON seed version", 100000/256, 64)[0] === 0
//   seed    = PBKDF2-SHA512(entropy, "TON default seed", 100000, 64)
//   key     = Ed25519 from seed[0..32]
// Exported for the TON-native-only account path; never used for a bip39-multichain account.

/** Generate a TON-native 24-word phrase (the library retries until the TON seed check passes). */
export async function generateTonNativeMnemonicPhrase(): Promise<string> {
  const words = await tonMnemonicNewImpl(24);
  return words.join(' ');
}

/** TON-native validation (not a BIP-39 checksum check). */
export async function validateTonMnemonicPhrase(phrase: string): Promise<boolean> {
  const words = normalizeMnemonic(phrase).split(' ');
  if (words.length !== 24) return false;
  return tonMnemonicValidateImpl(words);
}

/**
 * 64-byte seed used by TON-native accounts: PBKDF2-SHA512(entropy, "TON default seed", 100000).
 * The Ed25519 private key is seed[0..32].
 */
export async function tonNativeMnemonicToSeed(phrase: string): Promise<Uint8Array> {
  const words = normalizeMnemonic(phrase).split(' ');
  const seed = await tonMnemonicToSeedImpl(words, 'TON default seed', '');
  return new Uint8Array(seed);
}
```

## packages/crypto-vault/src/derivation.ts

```typescript
/**
 * Multi-chain key derivation from a single BIP-39 seed.
 *
 * Supported chains:
 * - TON:  m/44'/607'/0'  (Ed25519, SLIP-10)
 * - TRON: m/44'/195'/0'/0/0 (secp256k1, BIP-32)
 * - EVM:  m/44'/60'/0'/0/0  (secp256k1, BIP-32)
 *
 * Sources:
 * - SLIP-10 Ed25519 derivation: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 * - SLIP-44 coin types: https://github.com/satoshilabs/slips/blob/master/slip-0044.md
 * - TON V5R1 address: https://docs.ton.org/contracts/standard/wallets/v5 (fetched 2026-11-20)
 * - BIP-44: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
 */
import { HDKey } from '@scure/bip32';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';
import { DEFAULT_ACCOUNT_TYPE, type AccountType } from './account-type';

// ---------------------------------------------------------------------------
// SLIP-10 Ed25519 derivation
// ---------------------------------------------------------------------------

interface Slip10Key {
  privateKey: Uint8Array;
  chainCode: Uint8Array;
}

/**
 * Derive an Ed25519 key pair using SLIP-10.
 * See: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 */
export function deriveSlip10Node(seed: Uint8Array, path: string): Slip10Key {
  if (!path.startsWith('m/')) {
    throw new Error(`Invalid SLIP-10 path: ${path}. Must start with "m/".`);
  }

  const segments = path.slice(2).split('/');
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32, 64);

  for (const segment of segments) {
    let index: number;
    if (segment.endsWith("'")) {
      index = parseInt(segment.slice(0, -1), 10) + 0x80000000;
    } else {
      throw new Error(`SLIP-10 Ed25519 only supports hardened derivation: ${segment}`);
    }

    const data = new Uint8Array(33 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);

    const Ichild = hmac(sha512, chainCode, data);
    key = Ichild.slice(0, 32);
    chainCode = Ichild.slice(32, 64);
  }

  return { privateKey: key, chainCode };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface DerivedKeyBase {
  path: string;
  privateKey: Uint8Array;
}

/**
 * TON key material. There is deliberately NO `address` field: a TON wallet address is the
 * hash of the wallet contract's StateInit (code + data incl. the public key), not the
 * public key itself. Sending funds to `0:<publicKeyHex>` would lose them. Real address
 * computation (WalletContractV5R1) is Stage B.
 */
export interface DerivedTonKey extends DerivedKeyBase {
  chain: 'ton';
  /** Ed25519 public key, 32 bytes, lowercase hex. NOT an address. */
  publicKeyHex: string;
}

/** TRON key material. `hexAddress` is an intermediate form, not a user-facing address. */
export interface DerivedTronKey extends DerivedKeyBase {
  chain: 'tron';
  /** secp256k1 compressed public key (33 bytes), hex. NOT an address. */
  publicKeyHex: string;
  /** 0x41 prefix + last 20 bytes of keccak256(pubkey[1:]), hex. Base58check T... form is Stage B. */
  hexAddress: string;
}

/** EVM key material. `rawAddress` is lowercase and NOT EIP-55 checksummed (Stage B). */
export interface DerivedEvmKey extends DerivedKeyBase {
  chain: 'evm';
  /** secp256k1 compressed public key (33 bytes), hex. NOT an address. */
  publicKeyHex: string;
  /** 0x + 20 bytes hex, lowercase, no checksum. */
  rawAddress: string;
}

export type DerivedKey = DerivedTonKey | DerivedTronKey | DerivedEvmKey;

/**
 * Derive a TON Ed25519 key pair.
 *
 * Path: m/44'/607'/0'  (SLIP-10, Ed25519)
 * Returns the public key only; the wallet address is computed in Stage B.
 *
 * Source: SLIP-44 coin type 607
 */
export function deriveTonKey(
  seed: Uint8Array,
  accountIndex: number = 0,
  accountType: AccountType = DEFAULT_ACCOUNT_TYPE,
): DerivedTonKey {
  if (accountType === 'ton-native-only') {
    // TON-native key: Ed25519 secret key is the first 32 bytes of the TON seed
    // (@ton/crypto mnemonicToPrivateKey -> keyPairFromSeed(seed[0..32])). No HD path exists,
    // and the phrase maps to exactly one account.
    if (accountIndex !== 0) throw new Error('TON_NATIVE_SINGLE_ACCOUNT');
    const privateKey = seed.slice(0, 32);
    return {
      chain: 'ton',
      path: 'ton-native',
      privateKey,
      publicKeyHex: bytesToHex(ed25519.getPublicKey(privateKey)),
    };
  }
  const path = `m/44'/607'/${String(accountIndex)}'`;
  const { privateKey } = deriveSlip10Node(seed, path);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    chain: 'ton',
    path,
    privateKey,
    publicKeyHex: bytesToHex(publicKey),
  };
}

/**
 * Derive a TRON secp256k1 key pair.
 *
 * Path: m/44'/195'/0'/0/0 (BIP-32, secp256k1)
 * hexAddress: 41 + keccak256(publicKey[1:])[-20:] (intermediate form; base58check is Stage B)
 *
 * Sources:
 * - SLIP-44 coin type 195 (TRX)
 * - TRON accounts: https://developers.tron.network/docs/account
 */
export function deriveTronKey(seed: Uint8Array, accountIndex: number = 0): DerivedTronKey {
  const path = `m/44'/195'/${String(accountIndex)}'/0/0`;
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(path);
  if (!child.privateKey) {
    throw new Error(`Failed to derive TRON key at ${path}`);
  }

  const publicKey = secp256k1.getPublicKey(child.privateKey, false); // uncompressed (65 bytes)
  const pubKeyBytes = publicKey.slice(1); // remove 0x04 prefix
  const hash = keccak_256(pubKeyBytes);
  const tronHexAddress = `41${bytesToHex(hash.slice(-20))}`;

  return {
    chain: 'tron',
    path,
    privateKey: child.privateKey,
    publicKeyHex: bytesToHex(secp256k1.getPublicKey(child.privateKey, true)),
    hexAddress: tronHexAddress,
  };
}

/**
 * Derive an Ethereum secp256k1 key pair.
 *
 * Path: m/44'/60'/0'/0/0 (BIP-32, secp256k1)
 * rawAddress: 0x + keccak256(publicKey[1:])[-20:] (lowercase, no EIP-55 checksum; Stage B)
 *
 * Sources:
 * - BIP-44: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
 * - EIP-55: https://eips.ethereum.org/EIPS/eip-55
 * - SLIP-44 coin type 60
 */
export function deriveEvmKey(seed: Uint8Array, accountIndex: number = 0): DerivedEvmKey {
  const path = `m/44'/60'/${String(accountIndex)}'/0/0`;
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(path);
  if (!child.privateKey) {
    throw new Error(`Failed to derive EVM key at ${path}`);
  }

  const publicKey = secp256k1.getPublicKey(child.privateKey, false);
  const pubKeyBytes = publicKey.slice(1);
  const hash = keccak_256(pubKeyBytes);
  const ethAddress = `0x${bytesToHex(hash.slice(-20))}`;

  return {
    chain: 'evm',
    path,
    privateKey: child.privateKey,
    publicKeyHex: bytesToHex(secp256k1.getPublicKey(child.privateKey, true)),
    rawAddress: ethAddress,
  };
}

export interface DerivedKeys {
  ton: DerivedTonKey;
  tron: DerivedTronKey;
  evm: DerivedEvmKey;
}

/**
 * Derive keys for all supported chains from a single BIP-39 seed.
 */
export function deriveAllKeys(seed: Uint8Array, accountIndex: number = 0): DerivedKeys {
  return {
    ton: deriveTonKey(seed, accountIndex),
    tron: deriveTronKey(seed, accountIndex),
    evm: deriveEvmKey(seed, accountIndex),
  };
}

export { bytesToHex } from '@noble/hashes/utils';
```

## packages/crypto-vault/src/vault.ts

```typescript
/**
 * Vault module — encrypts/decrypts the BIP-39 seed and mnemonic under a random vault key.
 *
 * Seal format (version 4):
 * - A random 256-bit vault key encrypts the seed and the mnemonic (AES-256-GCM, WebCrypto),
 *   each with its own random 96-bit IV.
 * - The vault key is wrapped by a key derived from the passcode (Argon2id). When the seal has
 *   a device secret, the Argon2id output is combined with the device secret using the
 *   conventional HKDF-SHA256 form (RFC 5869): IKM is a length-prefixed concatenation of the
 *   two, salt is a fixed domain-separation string, info is a role label. No stored copy of the
 *   vault key opens with the passcode alone in that case.
 * - An optional biometric wrap stores the vault key encrypted under a key derived from the
 *   Telegram biometric token (HKDF-SHA256, distinct info string). The token itself is NEVER
 *   stored by this module; the caller keeps it via BiometricManager.updateBiometricToken.
 * - EVERY ciphertext (seed, mnemonic, wrapped vault key, biometric wrap) is authenticated with
 *   AAD that is RECOMPUTED at open time from: format version, Argon2id parameters, the
 *   device-secret flag and a role label ("vault-key" | "seed" | "mnemonic" | "biometric-key").
 *   Nothing in the seal supplies the AAD. A ciphertext moved to another role, or opened under a
 *   different version or parameter set, fails GCM authentication.
 *   Note: for the Argon2id parameters the key derivation output also changes, so a parameter
 *   edit is first seen as a failed key unwrap ("wrong_passcode"); the AAD binding is the
 *   second line of defence and is tested directly in vault.test.ts.
 * - The mnemonic is required. After decryption the mnemonic must regenerate the stored seed
 *   (BIP-39, empty passphrase; passphrases are not supported).
 * - Parameters are bounds-checked BEFORE Argon2id runs (see KDF_BOUNDS).
 *
 * Format history:
 * - v1/v2: stored `aad` (JSON), key wrap without AAD. v1 has no stored mnemonic.
 * - v3: recomputed AAD, but the device-secret combination used the *unconventional*
 *   `HKDF(ikm=passcodeKey, salt=deviceSecret, info=label)` form.
 * - v4: conventional HKDF (this file) + optional biometric wrap.
 * migrateLegacySeal() upgrades v1–v3; the old combination is used only to open a v3 seal and
 * nothing legacy is ever written back.
 *
 * Sources:
 * - AES-GCM: NIST SP 800-38D; Web Crypto: https://www.w3.org/TR/WebCryptoAPI/
 * - Argon2id: RFC 9106; HKDF: RFC 5869 — https://www.rfc-editor.org/rfc/rfc5869
 * - hash-wasm: https://github.com/Daninet/hash-wasm (MIT)
 * - Telegram BiometricManager / SecureStorage: https://core.telegram.org/bots/webapps
 *   (fetched 2026-11-21: BiometricManager since Bot API 7.2; SecureStorage since 9.0,
 *   Keychain on iOS / Keystore on Android, up to 10 items per bot per user)
 */
import { argon2id } from 'hash-wasm';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import {
  mnemonicToSeed,
  normalizeMnemonic,
  tonNativeMnemonicToSeed,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { DEFAULT_ACCOUNT_TYPE, isAccountType, type AccountType } from './account-type';

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

export interface VaultConfig {
  argon2TimeCost?: number;
  argon2MemoryCost?: number;
  argon2Parallelism?: number;
}

export const DEFAULT_VAULT_CONFIG: Required<VaultConfig> = {
  argon2TimeCost: 3,
  argon2MemoryCost: 65536,
  argon2Parallelism: 1,
};

/** Current seal format version. */
export const VAULT_FORMAT_VERSION = 5;

/**
 * Accepted Argon2id parameter ranges. These numbers are OUR choice, not an external
 * standard (see docs/UNVERIFIED.md). The minimum prevents a tampered/legacy seal from
 * downgrading the KDF; the maximum prevents a hostile seal from exhausting memory/CPU.
 * memoryCost is in KiB (19456 = 19 MiB, 262144 = 256 MiB).
 */
export const KDF_BOUNDS = {
  argon2TimeCost: { min: 2, max: 10 },
  argon2MemoryCost: { min: 19456, max: 262144 },
  argon2Parallelism: { min: 1, max: 4 },
} as const;

/** Fixed domain-separation salt for the device-secret HKDF (RFC 5869 style, not a secret). */
export const HKDF_SALT = 'onezerowallet/vault/v4/hkdf-salt';
export const HKDF_INFO_VAULT_KEY = 'vault-key-wrap';
export const HKDF_INFO_BIOMETRIC = 'biometric-vault-key-wrap';
/** Salt for the biometric-token HKDF (distinct domain). */
export const BIOMETRIC_HKDF_SALT = 'onezerowallet/vault/v4/biometric-salt';

const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEVICE_SECRET_BYTES = 32;
const BIOMETRIC_TOKEN_BYTES = 32;
const SEED_BYTES = 64;
const GCM_TAG_BYTES = 16;
const WRAPPED_KEY_BYTES = IV_BYTES + 32 + GCM_TAG_BYTES;
const SEED_CT_BYTES = SEED_BYTES + GCM_TAG_BYTES;
const MNEMONIC_CT_MIN_BYTES = 1 + GCM_TAG_BYTES;
const MNEMONIC_CT_MAX_BYTES = 1024;

/**
 * VaultSeal v4 — the persisted envelope (all binary fields are hex strings).
 * There is deliberately no `aad` field: AAD is recomputed (see header).
 */
export interface VaultSeal {
  version: number;
  /** Which derivation the phrase belongs to; authenticated in the AAD. */
  accountType: AccountType;
  /** Vault key wrapped by the passcode (or passcode+device secret) key: iv(12) || ct(32) || tag(16). */
  passcodeWrappedKey: string;
  /** True if the device secret is required. */
  hasDeviceSecret: boolean;
  /** Optional biometric wrap of the vault key: iv(12) || ct(32) || tag(16). */
  biometricWrappedKey?: string;
  /** AES-GCM encrypted 64-byte seed (+ tag). */
  encryptedSeed: string;
  /** IV for encryptedSeed (12 bytes). */
  iv: string;
  /** AES-GCM encrypted mnemonic (UTF-8, + tag). */
  encryptedMnemonic: string;
  /** IV for encryptedMnemonic (12 bytes). */
  mnemonicIv: string;
  /** Argon2id salt (16 bytes). */
  passcodeSalt: string;
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
}

/**
 * Pre-v4 seal (versions 1–3). v1/v2 carry a stored `aad` and a wrap without AAD;
 * v3 has no `aad` but used the old HKDF combination. Migration input only.
 */
export interface LegacyVaultSeal {
  version: number;
  /** Absent before v5; migrations default to 'bip39-multichain'. */
  accountType?: AccountType;
  passcodeWrappedKey: string;
  hasDeviceSecret: boolean;
  biometricWrappedKey?: string;
  encryptedSeed: string;
  iv: string;
  aad?: string;
  passcodeSalt: string;
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
  encryptedMnemonic?: string;
  mnemonicIv?: string;
}

export type VaultUnsealError =
  | 'wrong_passcode'
  | 'device_secret_missing'
  | 'tampered_data'
  | 'kdf_unavailable'
  | 'malformed_seal'
  | 'unsupported_version'
  | 'invalid_params'
  | 'seed_mnemonic_mismatch'
  | 'biometric_not_enabled'
  | 'invalid_biometric_token';

export type VaultUnlockResult =
  | { success: true; seed: Uint8Array; mnemonic: string }
  | { success: false; error: VaultUnsealError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strict hex parser: returns null for non-strings, odd length, non-hex chars or wrong length. */
function parseHex(hex: unknown, exactBytes?: number): Uint8Array<ArrayBuffer> | null {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return null;
  }
  const n = hex.length / 2;
  if (exactBytes !== undefined && n !== exactBytes) return null;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** 4-byte big-endian length prefix, so HKDF IKM components cannot be shifted into each other. */
function lengthPrefixed(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, false);
  out.set(b, 4);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function paramsInBounds(c: Required<VaultConfig>): boolean {
  return (['argon2TimeCost', 'argon2MemoryCost', 'argon2Parallelism'] as const).every(
    (k) => Number.isInteger(c[k]) && c[k] >= KDF_BOUNDS[k].min && c[k] <= KDF_BOUNDS[k].max,
  );
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

async function aesEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad as BufferSource },
    cryptoKey,
    plaintext as BufferSource,
  );
  return { ciphertext: new Uint8Array(encrypted), iv };
}

/** Throws (DOMException OperationError) if authentication fails. */
async function aesDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
    cryptoKey,
    ciphertext as BufferSource,
  );
  return new Uint8Array(decrypted);
}

// ---------------------------------------------------------------------------
// AAD
// ---------------------------------------------------------------------------

export type AadRole = 'vault-key' | 'seed' | 'mnemonic' | 'biometric-key';

/**
 * Build the AAD for one ciphertext. Always called with values the verifier trusts
 * (the format version it supports and the parameters it already bounds-checked).
 * Exported for tests only; not part of the package's public API (index.ts).
 */
export function buildAad(
  role: AadRole,
  version: number,
  hasDeviceSecret: boolean,
  params: Required<VaultConfig>,
  accountType: AccountType = DEFAULT_ACCOUNT_TYPE,
): Uint8Array {
  const parts = [
    'onezerowallet/vault',
    `role=${role}`,
    `v=${String(version)}`,
    `t=${String(params.argon2TimeCost)}`,
    `m=${String(params.argon2MemoryCost)}`,
    `p=${String(params.argon2Parallelism)}`,
    `ds=${hasDeviceSecret ? '1' : '0'}`,
  ];
  // v5 binds the account type. Older versions never had the field, so omitting it keeps their
  // AAD byte-identical for decryption.
  if (version >= 5) parts.push(`at=${accountType}`);
  return new TextEncoder().encode(parts.join('|'));
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/** Argon2id. Returns null if WebAssembly is unavailable; callers MUST fail closed. */
async function derivePasscodeKey(
  passcode: string,
  salt: Uint8Array,
  params: Required<VaultConfig>,
): Promise<Uint8Array | null> {
  try {
    return await argon2id({
      password: passcode.normalize('NFKD'),
      salt,
      parallelism: params.argon2Parallelism,
      iterations: params.argon2TimeCost,
      memorySize: params.argon2MemoryCost,
      hashLength: 32,
      outputType: 'binary',
    });
  } catch {
    return null;
  }
}

/**
 * Combine the Argon2id output with the device secret using the conventional HKDF-SHA256 form
 * (RFC 5869): IKM = len(passcodeKey) || passcodeKey || len(deviceSecret) || deviceSecret,
 * salt = fixed domain-separation string, info = role label.
 * Exported for tests only; not part of the package's public API (index.ts).
 */
export function combineWithDeviceSecret(
  passcodeKey: Uint8Array,
  deviceSecret: Uint8Array,
): Uint8Array {
  const ikm = concat(lengthPrefixed(passcodeKey), lengthPrefixed(deviceSecret));
  try {
    return hkdf(sha256, ikm, new TextEncoder().encode(HKDF_SALT), HKDF_INFO_VAULT_KEY, 32);
  } finally {
    ikm.fill(0);
  }
}

/** v3's unconventional combination. Used ONLY to open a legacy v3 seal. */
function legacyV3Combine(passcodeKey: Uint8Array, deviceSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, passcodeKey, deviceSecret, 'onezerowallet-vault-combined', 32);
}

/**
 * Key that wraps the vault key with a biometric token (HKDF-SHA256, distinct domain). When the
 * seal also has a device secret it is mixed into the IKM, so the biometric wrap still needs the
 * device binding and a wrong device secret fails GCM authentication.
 */
function biometricWrapKeyFromToken(token: Uint8Array, deviceSecret?: Uint8Array): Uint8Array {
  const ikm =
    deviceSecret === undefined
      ? token
      : concat(lengthPrefixed(token), lengthPrefixed(deviceSecret));
  try {
    return hkdf(
      sha256,
      ikm,
      new TextEncoder().encode(BIOMETRIC_HKDF_SALT),
      HKDF_INFO_BIOMETRIC,
      32,
    );
  } finally {
    if (deviceSecret !== undefined) ikm.fill(0);
  }
}

async function deriveWrappingKey(
  passcode: string,
  salt: Uint8Array,
  params: Required<VaultConfig>,
  deviceSecret: Uint8Array | undefined,
): Promise<Uint8Array | null> {
  const passcodeKey = await derivePasscodeKey(passcode, salt, params);
  if (passcodeKey === null) return null;
  if (deviceSecret === undefined) return passcodeKey;
  const combined = combineWithDeviceSecret(passcodeKey, deviceSecret);
  passcodeKey.fill(0);
  return combined;
}

async function deriveLegacyV3WrappingKey(
  passcode: string,
  salt: Uint8Array,
  params: Required<VaultConfig>,
  deviceSecret: Uint8Array | undefined,
): Promise<Uint8Array | null> {
  const passcodeKey = await derivePasscodeKey(passcode, salt, params);
  if (passcodeKey === null) return null;
  if (deviceSecret === undefined) return passcodeKey;
  const combined = legacyV3Combine(passcodeKey, deviceSecret);
  passcodeKey.fill(0);
  return combined;
}

// ---------------------------------------------------------------------------
// Seal parsing (strict; nothing is trusted from storage)
// ---------------------------------------------------------------------------

interface ParsedSeal {
  version: number;
  accountType: AccountType;
  hasDeviceSecret: boolean;
  params: Required<VaultConfig>;
  salt: Uint8Array;
  wrappedKey: Uint8Array;
  biometricWrappedKey: Uint8Array | null;
  seedIv: Uint8Array;
  seedCt: Uint8Array;
  mnemonicIv: Uint8Array;
  mnemonicCt: Uint8Array;
}

type ParseFailure = {
  ok: false;
  error: 'malformed_seal' | 'unsupported_version' | 'invalid_params';
};

function readParams(s: Record<string, unknown>): Required<VaultConfig> | null {
  const t = s['argon2TimeCost'];
  const m = s['argon2MemoryCost'];
  const p = s['argon2Parallelism'];
  if (typeof t !== 'number' || typeof m !== 'number' || typeof p !== 'number') return null;
  return {
    argon2TimeCost: t,
    argon2MemoryCost: m,
    argon2Parallelism: p,
  };
}

/** Parse the v3–v5 field set (v5 adds a required account type; v4+ may carry a biometric wrap). */
function parseSealBody(s: Record<string, unknown>, version: number): ParsedSeal | null {
  const hasDeviceSecret = s['hasDeviceSecret'];
  if (typeof hasDeviceSecret !== 'boolean') return null;

  const rawAccountType = s['accountType'];
  const accountType: AccountType | 'invalid' =
    version >= 5
      ? isAccountType(rawAccountType)
        ? rawAccountType
        : 'invalid'
      : DEFAULT_ACCOUNT_TYPE;
  if (accountType === 'invalid') return null;

  const params = readParams(s);
  if (params === null) return null;

  const salt = parseHex(s['passcodeSalt'], SALT_BYTES);
  const wrappedKey = parseHex(s['passcodeWrappedKey'], WRAPPED_KEY_BYTES);
  const seedIv = parseHex(s['iv'], IV_BYTES);
  const seedCt = parseHex(s['encryptedSeed'], SEED_CT_BYTES);
  const mnemonicIv = parseHex(s['mnemonicIv'], IV_BYTES);
  const mnemonicCt = parseHex(s['encryptedMnemonic']);
  if (!salt || !wrappedKey || !seedIv || !seedCt || !mnemonicIv || !mnemonicCt) return null;
  if (mnemonicCt.length < MNEMONIC_CT_MIN_BYTES || mnemonicCt.length > MNEMONIC_CT_MAX_BYTES) {
    return null;
  }

  const bioRaw = s['biometricWrappedKey'];
  const bio = bioRaw === undefined ? null : parseHex(bioRaw, WRAPPED_KEY_BYTES);
  if (bioRaw !== undefined && !bio) return null;

  // Bounds are checked before any KDF work.
  if (!paramsInBounds(params)) return null;

  return {
    version,
    accountType,
    hasDeviceSecret,
    params,
    salt,
    wrappedKey,
    biometricWrappedKey: bio,
    seedIv,
    seedCt,
    mnemonicIv,
    mnemonicCt,
  };
}

function parseSeal(input: unknown): { ok: true; seal: ParsedSeal } | ParseFailure {
  const malformed: ParseFailure = { ok: false, error: 'malformed_seal' };
  if (typeof input !== 'object' || input === null) return malformed;
  const s = input as Record<string, unknown>;

  const version = s['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) return malformed;
  if (version !== VAULT_FORMAT_VERSION) return { ok: false, error: 'unsupported_version' };

  const body = parseSealBody(s, version);
  if (body === null) {
    // Distinguish an out-of-bounds parameter set from a malformed envelope so callers and tests
    // can assert the specific reason.
    const params = readParams(s);
    if (params !== null && !paramsInBounds(params)) return { ok: false, error: 'invalid_params' };
    return malformed;
  }
  return { ok: true, seal: body };
}

// ---------------------------------------------------------------------------
// Seal / unseal
// ---------------------------------------------------------------------------

/**
 * Low-level seal. INTERNAL: not exported from index.ts. It does not check that `mnemonic`
 * matches `seed` (unsealVault does); use createSeal for the public path.
 *
 * @throws Error('INVALID_KDF_PARAMS' | 'INVALID_SEED_LENGTH' | 'INVALID_DEVICE_SECRET_LENGTH' | 'KDF_UNAVAILABLE')
 */
export async function sealVault(
  seed: Uint8Array,
  mnemonic: string,
  passcode: string,
  deviceSecret?: Uint8Array,
  config?: VaultConfig,
  accountType: AccountType = DEFAULT_ACCOUNT_TYPE,
): Promise<VaultSeal> {
  const params = { ...DEFAULT_VAULT_CONFIG, ...config };
  if (!paramsInBounds(params)) throw new Error('INVALID_KDF_PARAMS');
  if (seed.length !== SEED_BYTES) throw new Error('INVALID_SEED_LENGTH');
  if (deviceSecret !== undefined && deviceSecret.length !== DEVICE_SECRET_BYTES) {
    throw new Error('INVALID_DEVICE_SECRET_LENGTH');
  }
  const hasDeviceSecret = deviceSecret !== undefined;
  const version = VAULT_FORMAT_VERSION;

  const vaultKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let wrappingKey: Uint8Array | null = null;
  try {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    wrappingKey = await deriveWrappingKey(passcode, salt, params, deviceSecret);
    if (wrappingKey === null) throw new Error('KDF_UNAVAILABLE');

    const seedEnc = await aesEncrypt(
      seed,
      vaultKey,
      buildAad('seed', version, hasDeviceSecret, params, accountType),
    );
    const mnemonicEnc = await aesEncrypt(
      new TextEncoder().encode(mnemonic),
      vaultKey,
      buildAad('mnemonic', version, hasDeviceSecret, params, accountType),
    );
    const wrapEnc = await aesEncrypt(
      vaultKey,
      wrappingKey,
      buildAad('vault-key', version, hasDeviceSecret, params, accountType),
    );

    return {
      version,
      accountType,
      passcodeWrappedKey: bytesToHex(concat(wrapEnc.iv, wrapEnc.ciphertext)),
      hasDeviceSecret,
      encryptedSeed: bytesToHex(seedEnc.ciphertext),
      iv: bytesToHex(seedEnc.iv),
      encryptedMnemonic: bytesToHex(mnemonicEnc.ciphertext),
      mnemonicIv: bytesToHex(mnemonicEnc.iv),
      passcodeSalt: bytesToHex(salt),
      argon2TimeCost: params.argon2TimeCost,
      argon2MemoryCost: params.argon2MemoryCost,
      argon2Parallelism: params.argon2Parallelism,
    };
  } finally {
    vaultKey.fill(0);
    wrappingKey?.fill(0);
  }
}

/**
 * Public entry point for creating a seal from a mnemonic phrase. The seed is derived inside
 * this module and never returned. Throws Error('INVALID_MNEMONIC') if the phrase is invalid.
 */
export async function createSeal(
  mnemonic: string,
  passcode: string,
  deviceSecret?: Uint8Array,
  config?: VaultConfig,
  accountType: AccountType = DEFAULT_ACCOUNT_TYPE,
): Promise<VaultSeal> {
  const normalized = normalizeMnemonic(mnemonic);
  let seed: Uint8Array;
  if (accountType === 'ton-native-only') {
    if (!(await validateTonMnemonicPhrase(normalized))) throw new Error('INVALID_MNEMONIC');
    seed = await tonNativeMnemonicToSeed(normalized);
  } else {
    if (!validateMnemonicPhrase(normalized).valid) throw new Error('INVALID_MNEMONIC');
    seed = mnemonicToSeed(normalized);
  }
  try {
    return await sealVault(seed, normalized, passcode, deviceSecret, config, accountType);
  } finally {
    seed.fill(0);
  }
}

/**
 * Decrypt the seed and mnemonic using an already-unwrapped vault key. Verifies that the
 * mnemonic regenerates the seed. Returns a fresh seed buffer (the caller owns it).
 */
async function openPayload(p: ParsedSeal, vaultKey: Uint8Array): Promise<VaultUnlockResult> {
  let seed: Uint8Array;
  let mnemonicBytes: Uint8Array;
  try {
    seed = await aesDecrypt(
      p.seedCt,
      vaultKey,
      p.seedIv,
      buildAad('seed', p.version, p.hasDeviceSecret, p.params, p.accountType),
    );
    mnemonicBytes = await aesDecrypt(
      p.mnemonicCt,
      vaultKey,
      p.mnemonicIv,
      buildAad('mnemonic', p.version, p.hasDeviceSecret, p.params, p.accountType),
    );
  } catch {
    return { success: false, error: 'tampered_data' };
  }

  let mnemonic: string;
  try {
    mnemonic = new TextDecoder('utf-8', { fatal: true }).decode(mnemonicBytes);
  } catch {
    seed.fill(0);
    return { success: false, error: 'tampered_data' };
  } finally {
    mnemonicBytes.fill(0);
  }

  const normalized = normalizeMnemonic(mnemonic);
  const derived =
    p.accountType === 'ton-native-only'
      ? await tonNativeMnemonicToSeed(normalized)
      : mnemonicToSeed(normalized);
  const matches = constantTimeEqual(derived, seed);
  derived.fill(0);
  if (!matches) {
    seed.fill(0);
    return { success: false, error: 'seed_mnemonic_mismatch' };
  }
  return { success: true, seed, mnemonic };
}

/**
 * Open a v4 seal. INTERNAL: returns the seed, so it is not exported from index.ts.
 * Checks, in order: seal shape/version, parameter bounds (all BEFORE Argon2id), device
 * secret presence, key unwrap, seed and mnemonic decryption, and finally that the mnemonic
 * regenerates the seed.
 */
export async function unsealVault(
  seal: VaultSeal,
  passcode: string,
  deviceSecret?: Uint8Array,
): Promise<VaultUnlockResult> {
  const parsed = parseSeal(seal);
  if (!parsed.ok) return { success: false, error: parsed.error };
  const p = parsed.seal;

  if (
    p.hasDeviceSecret &&
    (deviceSecret === undefined || deviceSecret.length !== DEVICE_SECRET_BYTES)
  ) {
    return { success: false, error: 'device_secret_missing' };
  }

  let wrappingKey: Uint8Array | null = null;
  let vaultKey: Uint8Array | null = null;
  try {
    wrappingKey = await deriveWrappingKey(
      passcode,
      p.salt,
      p.params,
      p.hasDeviceSecret ? deviceSecret : undefined,
    );
    if (wrappingKey === null) return { success: false, error: 'kdf_unavailable' };

    try {
      vaultKey = await aesDecrypt(
        p.wrappedKey.slice(IV_BYTES),
        wrappingKey,
        p.wrappedKey.slice(0, IV_BYTES),
        buildAad('vault-key', p.version, p.hasDeviceSecret, p.params, p.accountType),
      );
    } catch {
      // GCM cannot tell a wrong passcode from a modified wrapped key.
      return { success: false, error: 'wrong_passcode' };
    }

    return await openPayload(p, vaultKey);
  } finally {
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Biometrics (A6)
// ---------------------------------------------------------------------------

export type EnableBiometricResult =
  { ok: true; seal: VaultSeal; token: string } | { ok: false; error: VaultUnsealError };

/**
 * Add a biometric wrap to a seal. Unwraps the vault key with the passcode (and device secret
 * if required), generates a fresh 32-byte biometric token, wraps the vault key with a key
 * derived from that token via HKDF-SHA256 (random IV stored in the blob, role-labelled AAD),
 * and returns the new seal plus the token.
 *
 * The token is NOT persisted by this module. The caller must store it with
 * BiometricManager.updateBiometricToken (Telegram keeps it in device secure storage, gated by
 * a successful biometric check — https://core.telegram.org/bots/webapps).
 */
export async function enableBiometric(
  seal: VaultSeal,
  passcode: string,
  deviceSecret?: Uint8Array,
): Promise<EnableBiometricResult> {
  const parsed = parseSeal(seal);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const p = parsed.seal;
  if (
    p.hasDeviceSecret &&
    (deviceSecret === undefined || deviceSecret.length !== DEVICE_SECRET_BYTES)
  ) {
    return { ok: false, error: 'device_secret_missing' };
  }

  let wrappingKey: Uint8Array | null = null;
  let vaultKey: Uint8Array | null = null;
  let bioKey: Uint8Array | null = null;
  try {
    wrappingKey = await deriveWrappingKey(
      passcode,
      p.salt,
      p.params,
      p.hasDeviceSecret ? deviceSecret : undefined,
    );
    if (wrappingKey === null) return { ok: false, error: 'kdf_unavailable' };
    try {
      vaultKey = await aesDecrypt(
        p.wrappedKey.slice(IV_BYTES),
        wrappingKey,
        p.wrappedKey.slice(0, IV_BYTES),
        buildAad('vault-key', p.version, p.hasDeviceSecret, p.params, p.accountType),
      );
    } catch {
      return { ok: false, error: 'wrong_passcode' };
    }

    const token = globalThis.crypto.getRandomValues(new Uint8Array(BIOMETRIC_TOKEN_BYTES));
    bioKey = biometricWrapKeyFromToken(token, p.hasDeviceSecret ? deviceSecret : undefined);
    const wrapEnc = await aesEncrypt(
      vaultKey,
      bioKey,
      buildAad('biometric-key', p.version, p.hasDeviceSecret, p.params, p.accountType),
    );
    return {
      ok: true,
      seal: { ...seal, biometricWrappedKey: bytesToHex(concat(wrapEnc.iv, wrapEnc.ciphertext)) },
      token: bytesToHex(token),
    };
  } finally {
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
    bioKey?.fill(0);
  }
}

/** Remove the biometric wrap. The vault key is unchanged, so the passcode still works. */
export function disableBiometric(seal: VaultSeal): VaultSeal {
  const next: VaultSeal = { ...seal };
  delete next.biometricWrappedKey;
  return next;
}

/**
 * Open a seal using a biometric token previously returned by enableBiometric(). When the seal
 * has a device secret, that secret is still required: the biometric factor is an additional
 * convenience gate, not a replacement for device binding (documented in VAULT_DESIGN.md).
 */
export async function unlockWithBiometric(
  seal: VaultSeal,
  tokenHex: string,
  deviceSecret?: Uint8Array,
): Promise<VaultUnlockResult> {
  const parsed = parseSeal(seal);
  if (!parsed.ok) return { success: false, error: parsed.error };
  const p = parsed.seal;
  if (p.biometricWrappedKey === null) {
    return { success: false, error: 'biometric_not_enabled' };
  }
  if (
    p.hasDeviceSecret &&
    (deviceSecret === undefined || deviceSecret.length !== DEVICE_SECRET_BYTES)
  ) {
    return { success: false, error: 'device_secret_missing' };
  }
  const token = parseHex(tokenHex, BIOMETRIC_TOKEN_BYTES);
  if (token === null) return { success: false, error: 'invalid_biometric_token' };

  let bioKey: Uint8Array | null = null;
  let vaultKey: Uint8Array | null = null;
  try {
    bioKey = biometricWrapKeyFromToken(token, p.hasDeviceSecret ? deviceSecret : undefined);
    try {
      vaultKey = await aesDecrypt(
        p.biometricWrappedKey.slice(IV_BYTES),
        bioKey,
        p.biometricWrappedKey.slice(0, IV_BYTES),
        buildAad('biometric-key', p.version, p.hasDeviceSecret, p.params, p.accountType),
      );
    } catch {
      return { success: false, error: 'wrong_passcode' };
    }
    return await openPayload(p, vaultKey);
  } finally {
    bioKey?.fill(0);
    vaultKey?.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Passcode change
// ---------------------------------------------------------------------------

export type ChangePasscodeResult =
  { ok: true; seal: VaultSeal } | { ok: false; error: VaultUnsealError };

/**
 * Re-seal under a new passcode. The vault key is regenerated (new salt, new IVs) and any
 * biometric wrap is dropped: its token was bound to the old vault key, so it must be
 * re-enabled by the caller after a successful passcode change.
 */
export async function changePasscode(
  seal: VaultSeal,
  oldPasscode: string,
  newPasscode: string,
  deviceSecret?: Uint8Array,
  config?: VaultConfig,
): Promise<ChangePasscodeResult> {
  const unsealed = await unsealVault(seal, oldPasscode, deviceSecret);
  if (!unsealed.success) return { ok: false, error: unsealed.error };
  try {
    const next = await sealVault(
      unsealed.seed,
      unsealed.mnemonic,
      newPasscode,
      deviceSecret,
      config,
      seal.accountType,
    );
    return { ok: true, seal: next };
  } finally {
    unsealed.seed.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Legacy (v1–v3) migration
// ---------------------------------------------------------------------------

export type MigrateError = VaultUnsealError | 'mnemonic_required';
export type MigrateResult = { ok: true; seal: VaultSeal } | { ok: false; error: MigrateError };

function legacyFailure(error: MigrateError): MigrateResult {
  return { ok: false, error };
}

/**
 * Migrate a v1, v2 or v3 seal to the current format.
 *
 * - v1: stored `aad`, no stored mnemonic, so the caller must supply the recovery phrase; it must
 *   regenerate the stored seed ('seed_mnemonic_mismatch' otherwise, 'mnemonic_required' if absent).
 * - v2: stored `aad` + its own mnemonic.
 * - v3: recomputed AAD + the old device-secret combination; needs no phrase.
 * The legacy Argon2id parameters must satisfy KDF_BOUNDS (checked before any KDF work).
 * Legacy biometric wraps were non-functional or bound to the old vault key and are dropped.
 */
export async function migrateLegacySeal(
  legacy: LegacyVaultSeal,
  passcode: string,
  deviceSecret?: Uint8Array,
  mnemonic?: string,
): Promise<MigrateResult> {
  const s = legacy as unknown as Record<string, unknown>;

  const version = s['version'];
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) {
    return legacyFailure('unsupported_version');
  }
  const accountType: AccountType = isAccountType(s['accountType'])
    ? s['accountType']
    : DEFAULT_ACCOUNT_TYPE;
  const hasDeviceSecret = s['hasDeviceSecret'];
  if (typeof hasDeviceSecret !== 'boolean') return legacyFailure('malformed_seal');
  const params = readParams(s);
  if (params === null) return legacyFailure('malformed_seal');

  const salt = parseHex(s['passcodeSalt'], SALT_BYTES);
  const wrappedKey = parseHex(s['passcodeWrappedKey'], WRAPPED_KEY_BYTES);
  const seedIv = parseHex(s['iv'], IV_BYTES);
  const seedCt = parseHex(s['encryptedSeed'], SEED_CT_BYTES);
  let storedAad: Uint8Array | null = null;
  if (version === 1 || version === 2) {
    const aad = parseHex(s['aad']);
    if (!aad || aad.length > 256) return legacyFailure('malformed_seal');
    storedAad = aad;
  }
  if (!salt || !wrappedKey || !seedIv || !seedCt) return legacyFailure('malformed_seal');

  let storedMnemonicIv: Uint8Array | null = null;
  let storedMnemonicCt: Uint8Array | null = null;
  if (version === 2 || version === 3 || version === 4) {
    storedMnemonicIv = parseHex(s['mnemonicIv'], IV_BYTES);
    storedMnemonicCt = parseHex(s['encryptedMnemonic']);
    if (
      !storedMnemonicIv ||
      !storedMnemonicCt ||
      storedMnemonicCt.length < MNEMONIC_CT_MIN_BYTES ||
      storedMnemonicCt.length > MNEMONIC_CT_MAX_BYTES
    ) {
      return legacyFailure('malformed_seal'); // no silent downgrade
    }
  }
  if (!paramsInBounds(params)) return legacyFailure('invalid_params');
  if (
    hasDeviceSecret &&
    (deviceSecret === undefined || deviceSecret.length !== DEVICE_SECRET_BYTES)
  ) {
    return legacyFailure('device_secret_missing');
  }

  let wrappingKey: Uint8Array | null = null;
  let vaultKey: Uint8Array | null = null;
  let seed: Uint8Array | null = null;
  try {
    // v1–v3 used the old combination; v4 is the first to use conventional HKDF.
    wrappingKey =
      version === 4
        ? await deriveWrappingKey(
            passcode,
            salt,
            params,
            hasDeviceSecret ? deviceSecret : undefined,
          )
        : await deriveLegacyV3WrappingKey(
            passcode,
            salt,
            params,
            hasDeviceSecret ? deviceSecret : undefined,
          );
    if (wrappingKey === null) return legacyFailure('kdf_unavailable');

    try {
      vaultKey = await aesDecrypt(
        wrappedKey.slice(IV_BYTES),
        wrappingKey,
        wrappedKey.slice(0, IV_BYTES),
        version >= 3 ? buildAad('vault-key', version, hasDeviceSecret, params) : new Uint8Array(0),
      );
    } catch {
      return legacyFailure('wrong_passcode');
    }

    let recovered: string | undefined;
    try {
      const seedAad =
        version >= 3
          ? buildAad('seed', version, hasDeviceSecret, params)
          : (storedAad as Uint8Array);
      seed = await aesDecrypt(seedCt, vaultKey, seedIv, seedAad);
      if (storedMnemonicCt && storedMnemonicIv) {
        const mnAad =
          version >= 3
            ? buildAad('mnemonic', version, hasDeviceSecret, params)
            : (storedAad as Uint8Array);
        const bytes = await aesDecrypt(storedMnemonicCt, vaultKey, storedMnemonicIv, mnAad);
        recovered = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        bytes.fill(0);
      }
    } catch {
      return legacyFailure('tampered_data');
    }

    const phrase = recovered ?? mnemonic;
    if (phrase === undefined) return legacyFailure('mnemonic_required');
    const normalized = normalizeMnemonic(phrase);
    if (!validateMnemonicPhrase(normalized).valid) return legacyFailure('mnemonic_required');
    const derived = mnemonicToSeed(normalized);
    const matches = constantTimeEqual(derived, seed);
    derived.fill(0);
    if (!matches) return legacyFailure('seed_mnemonic_mismatch');

    const newSeal = await sealVault(seed, normalized, passcode, deviceSecret, params, accountType);
    return { ok: true, seal: newSeal };
  } finally {
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
    seed?.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Passcode policy (A7)
// ---------------------------------------------------------------------------

/**
 * Result of evaluating a passcode. `unprotectedByDeviceSecret` is true when no device secret is
 * available: the seal can then be attacked offline if its ciphertext is copied, so the UI MUST
 * show a warning.
 */
export interface PasscodePolicy {
  ok: boolean;
  /** Human-readable reason when `ok` is false. Never contains the passcode. */
  error?: string;
  /** True when the vault has no device-secret factor (weaker protection, show a warning). */
  unprotectedByDeviceSecret: boolean;
  /** What kind of input the policy treated this as. */
  kind: 'pin' | 'passphrase';
  minLength: number;
}

const PASSPHRASE_BLOCKLIST = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwertyuiop',
  'qwertyuiop123',
  'qwerty123456',
  'password12345',
  'letmein',
  'iloveyou',
  'admin',
  'welcome',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'trustno1',
  '123456789',
  '1234567890',
  '123456789012',
  'abcdefgh',
  'abcd1234',
  'correcthorsebatterystaple',
]);

/** True for a PIN that is all one digit or a straight ascending/descending run. */
function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const ascending = '01234567890123456789';
  const descending = '98765432109876543210';
  return ascending.includes(pin) || descending.includes(pin);
}

/**
 * Passcode policy.
 *
 * - With a device secret: a 6+ digit PIN or an 8+ character passphrase, trivially weak PINs
 *   rejected. The PIN is only as strong as the secrecy of the device secret (Keychain/Keystore).
 * - Without a device secret: at least 12 characters and not on a small embedded blocklist.
 *   The UI must surface `unprotectedByDeviceSecret`.
 *
 * Argon2id parameters are NOT part of this policy; measure them with measureKdf().
 */
export function evaluatePasscodeStrength(
  passcode: string,
  hasDeviceSecretWrap: boolean,
): PasscodePolicy {
  const isPin = /^\d+$/.test(passcode);
  const unprotectedByDeviceSecret = !hasDeviceSecretWrap;

  if (hasDeviceSecretWrap) {
    if (isPin) {
      if (passcode.length < 6) {
        return {
          ok: false,
          error: 'PIN must be at least 6 digits',
          unprotectedByDeviceSecret,
          kind: 'pin',
          minLength: 6,
        };
      }
      if (isWeakPin(passcode)) {
        return {
          ok: false,
          error: 'PIN is too easy to guess (repeated or sequential digits)',
          unprotectedByDeviceSecret,
          kind: 'pin',
          minLength: 6,
        };
      }
      return { ok: true, unprotectedByDeviceSecret, kind: 'pin', minLength: 6 };
    }
    if (passcode.length < 8) {
      return {
        ok: false,
        error: 'Passcode must be at least 8 characters',
        unprotectedByDeviceSecret,
        kind: 'passphrase',
        minLength: 8,
      };
    }
    return { ok: true, unprotectedByDeviceSecret, kind: 'passphrase', minLength: 8 };
  }

  if (passcode.length < 12) {
    return {
      ok: false,
      error: 'Without device-secret locking, use a passphrase of at least 12 characters',
      unprotectedByDeviceSecret,
      kind: 'passphrase',
      minLength: 12,
    };
  }
  if (PASSPHRASE_BLOCKLIST.has(passcode.trim().toLowerCase())) {
    return {
      ok: false,
      error: 'This passphrase is too common; choose another',
      unprotectedByDeviceSecret,
      kind: 'passphrase',
      minLength: 12,
    };
  }
  return { ok: true, unprotectedByDeviceSecret, kind: 'passphrase', minLength: 12 };
}

// ---------------------------------------------------------------------------
// KDF benchmark helper (A7)
// ---------------------------------------------------------------------------

export interface KdfMeasurement {
  /** Wall-clock time of one Argon2id derivation, in milliseconds. */
  ms: number;
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
}

/**
 * Measure an Argon2id derivation so the app can choose parameters on first setup, within
 * KDF_BOUNDS. Runs with a fixed non-secret password and a random salt; the result is timing
 * data only and reveals nothing about the user's passcode. Throws Error('KDF_UNAVAILABLE') if
 * WebAssembly is unavailable.
 *
 * The timing is device- and WebView-specific; do not treat it as a constant.
 */
export async function measureKdf(
  config?: VaultConfig,
  rounds: number = 1,
): Promise<KdfMeasurement> {
  const params = { ...DEFAULT_VAULT_CONFIG, ...config };
  if (!paramsInBounds(params)) throw new Error('INVALID_KDF_PARAMS');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const start = performance.now();
  for (let i = 0; i < Math.max(1, Math.floor(rounds)); i++) {
    const key = await derivePasscodeKey('kdf-benchmark-not-a-secret', salt, params);
    if (key === null) throw new Error('KDF_UNAVAILABLE');
    key.fill(0);
  }
  const ms = (performance.now() - start) / Math.max(1, Math.floor(rounds));
  return {
    ms,
    argon2TimeCost: params.argon2TimeCost,
    argon2MemoryCost: params.argon2MemoryCost,
    argon2Parallelism: params.argon2Parallelism,
  };
}
```

## packages/crypto-vault/src/session.ts

```typescript
/**
 * Session handling — lifecycle of decrypted key material.
 *
 * Design (A2/A8):
 * - Private keys and the seed live ONLY in the closure created by createSession(). The public
 *   session object has functions only: getPublicInfo, signDigest, reauthenticate,
 *   revealMnemonic, lock. No key bytes, seed or mnemonic are properties of anything returned.
 * - Only the 64-byte seed is retained while unlocked. A private key is derived for the single
 *   signing call and zero-filled immediately after.
 * - The mnemonic is NOT retained while unlocked. reauthenticate(passcode) re-opens the seal
 *   (fresh Argon2id check); the phrase is then held for the re-auth window (default 60 s) and
 *   handed out by exactly one revealMnemonic() call, which clears it.
 * - lock() zero-fills the seed and clears the window.
 * - Unlock attempts require storage (fail closed) and use the persisted backoff in backoff.ts.
 *   Only a wrong passcode counts. `rate_limited` carries retryAfterMs.
 * - An optional wipe threshold (disabled by default) deletes the stored seal and device secret
 *   when it is reached, and returns a `wiped` result.
 *
 * What JavaScript cannot guarantee: zero-fill is best effort. The engine may have copied
 * buffers (JIT, GC moves), the mnemonic is an immutable string that cannot be wiped, and a
 * compromised page or extension can read the closure's values. See docs/VAULT_DESIGN.md.
 *
 * signDigest signs whatever 32 bytes it is given. Callers (chain adapters) MUST build the
 * payload themselves and show a human-readable preview of it before calling.
 */
import type { StorageAdapter } from './storage';
import { STORAGE_KEYS } from './storage';
import { deriveTonKey, deriveTronKey, deriveEvmKey } from './derivation';
import { toBase58TronAddress, toEip55Address, tonAddressesFromPublicKey } from './address';
import type { AccountType } from './account-type';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { unsealVault, unlockWithBiometric } from './vault';
import type { VaultSeal, VaultUnsealError } from './vault';
import { isBackoffActive, recordFailedAttempt, resetBackoff } from './backoff';

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type Chain = 'ton' | 'tron' | 'evm';

/** Public material for one account on every chain. Nothing here is secret. */
export interface PublicAccountInfo {
  accountIndex: number;
  accountType: AccountType;
  ton: {
    path: string;
    publicKeyHex: string;
    /** Wallet V5R1 mainnet raw "0:<hex>". */
    addressRaw: string;
    /** Wallet V5R1 mainnet, bounceable (EQ…). */
    addressBounceable: string;
    /** Wallet V5R1 mainnet, non-bounceable (UQ…). */
    addressNonBounceable: string;
    /** Wallet V5R1 testnet-only, non-bounceable (0Q…). */
    addressTestnetNonBounceable: string;
  };
  /** Absent for ton-native-only accounts. */
  tron?: { path: string; publicKeyHex: string; hexAddress: string; address: string } | undefined;
  /** Absent for ton-native-only accounts. */
  evm?: { path: string; publicKeyHex: string; rawAddress: string; address: string } | undefined;
}

export type SignError = 'locked' | 'invalid_chain' | 'invalid_digest' | 'invalid_account';
export type SignResult = { ok: true; signature: Uint8Array } | { ok: false; error: SignError };

export type ReauthResult =
  | { ok: true }
  | {
      ok: false;
      error: 'locked' | 'rate_limited' | 'wiped' | 'storage_required' | VaultUnsealError;
      retryAfterMs?: number;
    };

export type RevealResult =
  { ok: true; mnemonic: string } | { ok: false; error: 'locked' | 'reauth_required' };

/**
 * TODO(P2 chain adapters): adapters build a SigningRequest from the ACTUAL payload to be signed
 * (never from UI state) and the UI must show `summary` before signDigest is called. Today the
 * session accepts a bare digest, which is blind signing; this interface is the contract that
 * will replace it.
 */
export interface SigningRequest {
  chain: Chain;
  accountIndex: number;
  /** 32-byte digest derived from `payloadHex` by the adapter. */
  digest: Uint8Array;
  /** Hex of the exact payload that was hashed into `digest`. */
  payloadHex: string;
  /** Human-readable description generated from the payload, e.g. "Send 1.5 GRAM to UQ...". */
  summary: string;
}

export interface VaultSession {
  getPublicInfo(accountIndex?: number): PublicAccountInfo | null;
  /** Ed25519 (TON, 64-byte signature) or recoverable secp256k1 (TRON/EVM, r||s||recovery = 65 bytes). */
  signDigest(chain: Chain, accountIndex: number, digest: Uint8Array): SignResult;
  /** Fresh passcode check. Opens the re-auth window for one revealMnemonic() call. */
  reauthenticate(passcode: string): Promise<ReauthResult>;
  /** Returns the phrase once per successful reauthenticate(), then clears the window. */
  revealMnemonic(): RevealResult;
  lock(): void;
}

export interface UnlockOptions {
  /** Re-auth window in ms (default 60000). */
  reauthWindowMs?: number | undefined;
  /** Delete the stored seal + device secret after this many consecutive wrong passcodes. 0/undefined = disabled. */
  wipeAfterFailures?: number | undefined;
}

export type UnlockResult =
  | { success: true; session: VaultSession }
  | {
      success: false;
      error: VaultUnsealError | 'rate_limited' | 'wiped' | 'storage_required';
      /** Only for 'rate_limited'. */
      retryAfterMs?: number;
    };

export const DEFAULT_REAUTH_WINDOW_MS = 60_000;
const MAX_ACCOUNT_INDEX = 0x7fffffff;
const CHAINS: readonly Chain[] = ['ton', 'tron', 'evm'];

let activeSession: VaultSession | null = null;
let activeLock: (() => void) | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let inactivityTimeoutMs: number = 300000; // 5 minutes default
let visibilityHandler: (() => void) | null = null;

/** Set the auto-lock inactivity timeout. */
export function setInactivityTimeout(ms: number): void {
  inactivityTimeoutMs = ms;
}

function resetInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (activeSession && inactivityTimeoutMs > 0) {
    inactivityTimer = setTimeout(() => {
      lockSession();
    }, inactivityTimeoutMs);
  }
}

function addVisibilityListener(): void {
  removeVisibilityListener();
  if (typeof document === 'undefined') return;
  visibilityHandler = () => {
    if (document.hidden) lockSession();
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

function removeVisibilityListener(): void {
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  visibilityHandler = null;
}

/** Strict device-secret read: exactly 64 hex chars -> 32 bytes, otherwise undefined. */
function readDeviceSecretHex(hex: string | null): Uint8Array | undefined {
  if (hex === null || !/^[0-9a-fA-F]{64}$/.test(hex)) return undefined;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function loadDeviceSecret(
  seal: VaultSeal,
  storage: StorageAdapter,
): Promise<Uint8Array | undefined> {
  if (!seal.hasDeviceSecret) return undefined;
  const secret = readDeviceSecretHex(await storage.get(STORAGE_KEYS.DEVICE_SECRET));
  return secret;
}

/** Delete everything the vault persists. Called only when the user (or a wipe threshold) asks. */
export async function wipeStoredVault(storage: StorageAdapter): Promise<void> {
  await storage.delete(STORAGE_KEYS.SEAL);
  await storage.delete(STORAGE_KEYS.DEVICE_SECRET);
  await resetBackoff(storage);
}

function publicInfoFor(
  seed: Uint8Array,
  accountIndex: number,
  accountType: AccountType,
): PublicAccountInfo {
  const ton = deriveTonKey(seed, accountIndex, accountType);
  const tonAddresses = tonAddressesFromPublicKey(ton.publicKeyHex);
  const info: PublicAccountInfo = {
    accountIndex,
    accountType,
    ton: {
      path: ton.path,
      publicKeyHex: ton.publicKeyHex,
      addressRaw: tonAddresses.raw,
      addressBounceable: tonAddresses.bounceable,
      addressNonBounceable: tonAddresses.nonBounceable,
      addressTestnetNonBounceable: tonAddresses.testnetNonBounceable,
    },
  };
  ton.privateKey.fill(0);

  // A TON-native phrase has no TRON/EVM accounts: those derivations would silently produce
  // unrelated keys that the user never backed up under that scheme.
  if (accountType === 'bip39-multichain') {
    const tron = deriveTronKey(seed, accountIndex);
    const evm = deriveEvmKey(seed, accountIndex);
    info.tron = {
      path: tron.path,
      publicKeyHex: tron.publicKeyHex,
      hexAddress: tron.hexAddress,
      address: toBase58TronAddress(tron.hexAddress),
    };
    info.evm = {
      path: evm.path,
      publicKeyHex: evm.publicKeyHex,
      rawAddress: evm.rawAddress,
      address: toEip55Address(evm.rawAddress),
    };
    tron.privateKey.fill(0);
    evm.privateKey.fill(0);
  }
  return info;
}

function createSession(
  seed: Uint8Array,
  seal: VaultSeal,
  storage: StorageAdapter,
  reauthWindowMs: number,
  wipeAfterFailures: number,
): VaultSession {
  const state = { locked: false };
  // A function call (not a property read) so the type checker does not narrow the flag across awaits.
  const isLocked = (): boolean => state.locked;
  let revealable: { mnemonic: string; expiresAt: number } | null = null;
  const publicCache = new Map<number, PublicAccountInfo>();

  const validAccount = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i <= MAX_ACCOUNT_INDEX;

  const lock = (): void => {
    if (state.locked) return;
    state.locked = true;
    seed.fill(0);
    revealable = null;
    publicCache.clear();
    if (activeLock === lock) {
      activeLock = null;
      activeSession = null;
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      removeVisibilityListener();
    }
  };

  const recordAttempt = async (): Promise<ReauthResult | null> => {
    const { count } = await recordFailedAttempt(storage);
    if (wipeAfterFailures > 0 && count >= wipeAfterFailures) {
      await wipeStoredVault(storage);
      lock();
      return { ok: false, error: 'wiped' };
    }
    return null;
  };

  const session: VaultSession = {
    getPublicInfo(accountIndex = 0) {
      if (isLocked() || !validAccount(accountIndex)) return null;
      if (seal.accountType === 'ton-native-only' && accountIndex !== 0) return null;
      let info = publicCache.get(accountIndex);
      if (!info) {
        info = publicInfoFor(seed, accountIndex, seal.accountType);
        publicCache.set(accountIndex, info);
      }
      return structuredClone(info);
    },

    signDigest(chain, accountIndex, digest) {
      if (isLocked()) return { ok: false, error: 'locked' };
      if (!(CHAINS as readonly string[]).includes(chain)) {
        return { ok: false, error: 'invalid_chain' };
      }
      if (seal.accountType === 'ton-native-only' && chain !== 'ton') {
        return { ok: false, error: 'invalid_chain' };
      }
      if (!validAccount(accountIndex)) return { ok: false, error: 'invalid_account' };
      if (seal.accountType === 'ton-native-only' && accountIndex !== 0) {
        return { ok: false, error: 'invalid_account' };
      }
      if (!(digest instanceof Uint8Array) || digest.length !== 32) {
        return { ok: false, error: 'invalid_digest' };
      }
      touchSession();
      const key =
        chain === 'ton'
          ? deriveTonKey(seed, accountIndex, seal.accountType)
          : chain === 'tron'
            ? deriveTronKey(seed, accountIndex)
            : deriveEvmKey(seed, accountIndex);
      try {
        if (chain === 'ton') {
          return { ok: true, signature: ed25519.sign(digest, key.privateKey) };
        }
        const sig = secp256k1.sign(digest, key.privateKey, { lowS: true });
        const out = new Uint8Array(65);
        out.set(sig.toBytes('compact'), 0);
        out[64] = sig.recovery;
        return { ok: true, signature: out };
      } finally {
        key.privateKey.fill(0);
      }
    },

    async reauthenticate(passcode) {
      if (isLocked()) return { ok: false, error: 'locked' };
      revealable = null;
      const remaining = await isBackoffActive(storage);
      if (remaining > 0) return { ok: false, error: 'rate_limited', retryAfterMs: remaining };
      const deviceSecret = await loadDeviceSecret(seal, storage);
      const result = await unsealVault(seal, passcode, deviceSecret);
      if (isLocked()) {
        if (result.success) result.seed.fill(0);
        return { ok: false, error: 'locked' };
      }
      if (!result.success) {
        if (result.error === 'wrong_passcode') {
          const wiped = await recordAttempt();
          if (wiped) return wiped;
        }
        return { ok: false, error: result.error };
      }
      result.seed.fill(0);
      await resetBackoff(storage);
      revealable = { mnemonic: result.mnemonic, expiresAt: Date.now() + reauthWindowMs };
      return { ok: true };
    },

    revealMnemonic() {
      if (isLocked()) return { ok: false, error: 'locked' };
      const window = revealable;
      revealable = null; // one use, even if expired
      if (!window || Date.now() > window.expiresAt) {
        return { ok: false, error: 'reauth_required' };
      }
      return { ok: true, mnemonic: window.mnemonic };
    },

    lock,
  };

  activeLock = lock;
  return Object.freeze(session);
}

/** Guard the active session so re-auth cannot proceed across a lock. */
function openSession(
  seed: Uint8Array,
  seal: VaultSeal,
  storage: StorageAdapter,
  options: UnlockOptions,
): UnlockResult {
  lockSession();
  const session = createSession(
    seed,
    seal,
    storage,
    options.reauthWindowMs ?? DEFAULT_REAUTH_WINDOW_MS,
    options.wipeAfterFailures ?? 0,
  );
  activeSession = session;
  resetInactivityTimer();
  addVisibilityListener();
  return { success: true, session };
}

/**
 * Unlock the vault with a passcode and create a session. Only one session is active: unlocking
 * replaces (and locks) a previous one. Storage is mandatory and enforces the persisted backoff.
 */
export async function unlockSession(
  seal: VaultSeal,
  passcode: string,
  storage: StorageAdapter | undefined,
  options: UnlockOptions = {},
): Promise<UnlockResult> {
  if (!storage) return { success: false, error: 'storage_required' }; // fail closed
  const remaining = await isBackoffActive(storage);
  if (remaining > 0) return { success: false, error: 'rate_limited', retryAfterMs: remaining };

  const deviceSecret = await loadDeviceSecret(seal, storage);
  const result = await unsealVault(seal, passcode, deviceSecret);
  if (!result.success) {
    if (result.error === 'wrong_passcode') {
      const { count } = await recordFailedAttempt(storage);
      if ((options.wipeAfterFailures ?? 0) > 0 && count >= (options.wipeAfterFailures ?? 0)) {
        await wipeStoredVault(storage);
        return { success: false, error: 'wiped' };
      }
    }
    return { success: false, error: result.error };
  }
  await resetBackoff(storage);
  return openSession(result.seed, seal, storage, options);
}

/**
 * Unlock with a biometric token returned by enableBiometric(). The device secret (if the seal
 * requires one) is read from storage exactly as for passcode unlock.
 */
export async function unlockSessionWithBiometric(
  seal: VaultSeal,
  token: string,
  storage: StorageAdapter | undefined,
  options: UnlockOptions = {},
): Promise<UnlockResult> {
  if (!storage) return { success: false, error: 'storage_required' };
  const remaining = await isBackoffActive(storage);
  if (remaining > 0) return { success: false, error: 'rate_limited', retryAfterMs: remaining };
  const deviceSecret = await loadDeviceSecret(seal, storage);
  const result = await unlockWithBiometric(seal, token, deviceSecret);
  if (!result.success) return { success: false, error: result.error };
  await resetBackoff(storage);
  return openSession(result.seed, seal, storage, options);
}

/** Lock the active session (zero-fills the seed, clears the re-auth window). */
export function lockSession(): void {
  activeLock?.();
}

/** Reset the inactivity timer. Call on user interaction. */
export function touchSession(): void {
  if (activeSession) resetInactivityTimer();
}

/** The current session, or null if locked. */
export function getSession(): VaultSession | null {
  return activeSession;
}
```

## packages/crypto-vault/src/seal-store.ts

```typescript
/**
 * Seal persistence (A9): schema-validated save/load plus migration wiring.
 *
 * Everything read from storage is untrusted: it is parsed as JSON and validated with zod before
 * it reaches the crypto code. A malformed or unknown-version envelope is rejected, never
 * guessed at. Legacy envelopes (v1–v3) are returned to the caller so they can be migrated with
 * the passcode, and are never written back unchanged.
 */
import { z } from './zod-jitless';
import type { StorageAdapter } from './storage';
import { STORAGE_KEYS } from './storage';
import {
  migrateLegacySeal,
  VAULT_FORMAT_VERSION,
  type LegacyVaultSeal,
  type MigrateError,
  type VaultSeal,
} from './vault';

function hexBytes(bytes: number) {
  return z.string().regex(new RegExp(`^[0-9a-fA-F]{${String(bytes * 2)}}$`));
}

const paraParams = {
  argon2TimeCost: z.number().int().positive(),
  argon2MemoryCost: z.number().int().positive(),
  argon2Parallelism: z.number().int().positive(),
};

/** Current (v4) envelope. `biometricWrappedKey` is optional. */
const accountTypeSchema = z.enum(['bip39-multichain', 'ton-native-only']);

export const VaultSealSchema = z
  .object({
    version: z.literal(VAULT_FORMAT_VERSION),
    accountType: accountTypeSchema,
    passcodeWrappedKey: hexBytes(60),
    hasDeviceSecret: z.boolean(),
    biometricWrappedKey: hexBytes(60).optional(),
    encryptedSeed: hexBytes(80),
    iv: hexBytes(12),
    encryptedMnemonic: z
      .string()
      .regex(/^[0-9a-fA-F]+$/)
      .refine((s) => s.length % 2 === 0 && s.length >= 34 && s.length <= 2048),
    mnemonicIv: hexBytes(12),
    passcodeSalt: hexBytes(16),
    ...paraParams,
  })
  .strict();

/** Legacy envelope shape (v1–v3). Used only to hand data to the migration function. */
export const LegacyVaultSealSchema = z.looseObject({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  accountType: accountTypeSchema.optional(),
  passcodeWrappedKey: hexBytes(60),
  hasDeviceSecret: z.boolean(),
  biometricWrappedKey: hexBytes(60).optional(),
  encryptedSeed: hexBytes(80),
  iv: hexBytes(12),
  aad: z.string().optional(),
  passcodeSalt: hexBytes(16),
  ...paraParams,
  encryptedMnemonic: z.string().optional(),
  mnemonicIv: hexBytes(12).optional(),
});

const AnySealSchema = z.union([VaultSealSchema, LegacyVaultSealSchema]);

export type SaveSealResult =
  { ok: true } | { ok: false; error: 'invalid_seal' | 'storage_required' };

/** Validate and persist a current-format seal. Only the envelope (ciphertext) is stored. */
export async function saveSeal(
  storage: StorageAdapter | undefined,
  seal: VaultSeal,
): Promise<SaveSealResult> {
  if (!storage) return { ok: false, error: 'storage_required' };
  const parsed = VaultSealSchema.safeParse(seal);
  if (!parsed.success) return { ok: false, error: 'invalid_seal' };
  await storage.set(STORAGE_KEYS.SEAL, JSON.stringify(parsed.data));
  return { ok: true };
}

export type LoadSealResult =
  | { ok: true; seal: VaultSeal }
  | {
      ok: false;
      error: 'no_seal' | 'malformed_seal' | 'unsupported_version';
      /** Present for 'unsupported_version': the parsed legacy envelope awaits migration. */
      legacy?: LegacyVaultSeal;
    };

/** Load and validate the stored envelope. Nothing is trusted until zod accepts it. */
export async function loadSeal(storage: StorageAdapter | undefined): Promise<LoadSealResult> {
  if (!storage) return { ok: false, error: 'no_seal' };
  const raw = await storage.get(STORAGE_KEYS.SEAL);
  if (raw === null) return { ok: false, error: 'no_seal' };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'malformed_seal' };
  }

  const parsed = AnySealSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'malformed_seal' };

  if (parsed.data.version === VAULT_FORMAT_VERSION) {
    return { ok: true, seal: parsed.data as VaultSeal };
  }
  return {
    ok: false,
    error: 'unsupported_version',
    legacy: parsed.data as unknown as LegacyVaultSeal,
  };
}

export type MigrateStoredResult =
  | { ok: true; migrated: boolean; seal: VaultSeal }
  | { ok: false; error: MigrateError | 'no_seal' | 'malformed_seal' };

/**
 * Load the stored envelope and, if it is legacy, migrate it with the user's passcode and save
 * the result. A current seal is returned unchanged with `migrated: false`.
 */
export async function migrateStoredSeal(
  storage: StorageAdapter | undefined,
  passcode: string,
  deviceSecret?: Uint8Array,
  mnemonic?: string,
): Promise<MigrateStoredResult> {
  const loaded = await loadSeal(storage);
  if (loaded.ok) return { ok: true, migrated: false, seal: loaded.seal };
  if (loaded.error !== 'unsupported_version' || !loaded.legacy) {
    return { ok: false, error: loaded.error };
  }
  const migrated = await migrateLegacySeal(loaded.legacy, passcode, deviceSecret, mnemonic);
  if (!migrated.ok) return { ok: false, error: migrated.error };
  const saved = await saveSeal(storage, migrated.seal);
  if (!saved.ok) return { ok: false, error: 'malformed_seal' };
  return { ok: true, migrated: true, seal: migrated.seal };
}
```

## packages/crypto-vault/src/vault-manager.ts

```typescript
/**
 * VaultManager (A9) — ties the seal store, the device secret and the session together.
 *
 * Layout:
 * - The sealed envelope (ciphertext) and backoff state live in `sealStorage` (IndexedDB).
 * - The device secret lives in `secureStorage` (Telegram SecureStorage), routed by a
 *   CompositeStorage so session code can read it without knowing the split.
 *
 * The manager never returns the seed, a private key or the vault key. The mnemonic is only
 * generated here (createWallet) or accepted for import; it is not retained.
 *
 * Device secret loss: if `secureStorage` is cleared by the OS/Telegram while the seal requires a
 * device secret, unlocking fails with `device_secret_missing` and the passcode alone cannot open
 * the seal. The only recovery is importing the recovery phrase again (importWallet) after a
 * wipe. This is deliberate and tested.
 */
import type { StorageAdapter } from './storage';
import { CompositeStorage, STORAGE_KEYS } from './storage';
import {
  changePasscode as resealWithPasscode,
  createSeal,
  disableBiometric as removeBiometricWrap,
  enableBiometric as addBiometricWrap,
  evaluatePasscodeStrength,
  unsealVault,
  type ChangePasscodeResult,
  type PasscodePolicy,
  type VaultConfig,
  type VaultSeal,
} from './vault';
import {
  generateMnemonicPhrase,
  generateTonNativeMnemonicPhrase,
  normalizeMnemonic,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { DEFAULT_ACCOUNT_TYPE, type AccountType } from './account-type';
import { createDeviceSecret, deleteDeviceSecret, readDeviceSecret } from './device-secret';
import { loadSeal, migrateStoredSeal, saveSeal, type MigrateStoredResult } from './seal-store';
import {
  getSession as getActiveSession,
  lockSession,
  unlockSession,
  unlockSessionWithBiometric,
  wipeStoredVault,
  type UnlockOptions,
  type UnlockResult,
  type VaultSession,
} from './session';

export interface VaultManagerOptions {
  /** IndexedDB (or equivalent) for the seal ciphertext and backoff state. */
  sealStorage: StorageAdapter | undefined;
  /** SecureStorage (or equivalent) for the device secret. Optional: without it no device factor. */
  secureStorage?: StorageAdapter | undefined;
  /** Argon2id config for new seals. Tests should pass a fast config. */
  config?: VaultConfig | undefined;
  /** Wipe after this many consecutive wrong passcodes. 0/undefined = disabled. */
  wipeAfterFailures?: number | undefined;
  /** Re-auth window for revealMnemonic, in ms. */
  reauthWindowMs?: number | undefined;
}

export type CreateWalletResult =
  | { ok: true; seal: VaultSeal; mnemonic?: string }
  | {
      ok: false;
      error: 'vault_exists' | 'weak_passcode' | 'invalid_mnemonic' | 'storage_error';
      message?: string | undefined;
    };

export class VaultManager {
  private readonly composite: CompositeStorage;
  private readonly sealStorage: StorageAdapter;
  private readonly secureStorage: StorageAdapter | undefined;
  private readonly options: VaultManagerOptions;

  constructor(options: VaultManagerOptions) {
    const sealStorage = options.sealStorage;
    if (!sealStorage) throw new Error('STORAGE_REQUIRED');
    this.options = options;
    this.sealStorage = sealStorage;
    this.secureStorage = options.secureStorage;
    // Only the device secret is routed to secure storage; everything else stays bulk.
    this.composite = new CompositeStorage(options.secureStorage ?? sealStorage, sealStorage, [
      STORAGE_KEYS.DEVICE_SECRET,
    ]);
  }

  /** True when a seal is stored (current or legacy). */
  async hasVault(): Promise<boolean> {
    return (await this.sealStorage.get(STORAGE_KEYS.SEAL)) !== null;
  }

  /** True when a device factor will be used (secure storage configured). */
  get usesDeviceSecret(): boolean {
    return this.secureStorage !== undefined;
  }

  /** Evaluate the policy for a passcode at the manager's current factor level. */
  evaluatePasscode(passcode: string): PasscodePolicy {
    return evaluatePasscodeStrength(passcode, this.usesDeviceSecret);
  }

  private unlockOptions(): UnlockOptions {
    return {
      reauthWindowMs: this.options.reauthWindowMs,
      wipeAfterFailures: this.options.wipeAfterFailures,
    };
  }

  /** Create a new wallet. The generated phrase (if any) is returned ONCE for backup. */
  async createWallet(
    passcode: string,
    mnemonic?: string,
    options: { accountType?: AccountType | undefined } = {},
  ): Promise<CreateWalletResult> {
    if (await this.hasVault()) return { ok: false, error: 'vault_exists' };

    const policy = this.evaluatePasscode(passcode);
    if (!policy.ok) {
      return { ok: false, error: 'weak_passcode', message: policy.error };
    }

    const accountType = options.accountType ?? DEFAULT_ACCOUNT_TYPE;
    let phrase: string;
    let generated = false;
    if (mnemonic === undefined) {
      phrase =
        accountType === 'ton-native-only'
          ? await generateTonNativeMnemonicPhrase()
          : generateMnemonicPhrase(24);
      generated = true;
    } else {
      phrase = normalizeMnemonic(mnemonic);
      const valid =
        accountType === 'ton-native-only'
          ? await validateTonMnemonicPhrase(phrase)
          : validateMnemonicPhrase(phrase).valid;
      if (!valid) return { ok: false, error: 'invalid_mnemonic' };
    }

    let deviceSecret: Uint8Array | undefined;
    if (this.secureStorage) {
      deviceSecret = await createDeviceSecret(this.secureStorage);
    }
    try {
      const seal = await createSeal(
        phrase,
        passcode,
        deviceSecret,
        this.options.config,
        accountType,
      );
      const saved = await saveSeal(this.sealStorage, seal);
      if (!saved.ok) return { ok: false, error: 'storage_error' };
      return generated ? { ok: true, seal, mnemonic: phrase } : { ok: true, seal };
    } finally {
      deviceSecret?.fill(0);
    }
  }

  /** Import an existing wallet. The phrase must be valid for the chosen account type. */
  async importWallet(
    mnemonic: string,
    passcode: string,
    options: { accountType?: AccountType | undefined } = {},
  ): Promise<CreateWalletResult> {
    return this.createWallet(passcode, mnemonic, options);
  }

  /** Unlock with a passcode. Legacy seals report unsupported_version until migrated. */
  async unlock(passcode: string): Promise<UnlockResult> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) {
      if (loaded.error === 'unsupported_version') {
        return { success: false, error: 'unsupported_version' };
      }
      return { success: false, error: 'malformed_seal' };
    }
    return unlockSession(loaded.seal, passcode, this.composite, this.unlockOptions());
  }

  /** Unlock with the token returned by enableBiometric(). */
  async unlockWithBiometric(token: string): Promise<UnlockResult> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) {
      if (loaded.error === 'unsupported_version') {
        return { success: false, error: 'unsupported_version' };
      }
      return { success: false, error: 'malformed_seal' };
    }
    return unlockSessionWithBiometric(loaded.seal, token, this.composite, this.unlockOptions());
  }

  /** Current session (null when locked). */
  getSession(): VaultSession | null {
    // Imported lazily to keep the manager thin.
    return getActiveSession();
  }

  lock(): void {
    lockSession();
  }

  /**
   * Re-seal under a new passcode. Any biometric wrap is dropped by the rotation; if biometrics
   * were enabled, a fresh wrap is created and the new token returned so the caller can store it.
   */
  async changePasscode(
    oldPasscode: string,
    newPasscode: string,
  ): Promise<
    | { ok: true; seal: VaultSeal; biometricToken?: string | undefined }
    | { ok: false; error: string; message?: string | undefined }
  > {
    const policy = this.evaluatePasscode(newPasscode);
    if (!policy.ok) return { ok: false, error: 'weak_passcode', message: policy.error };

    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const hadBiometric = loaded.seal.biometricWrappedKey !== undefined;

    const resealed: ChangePasscodeResult = await resealWithPasscode(
      loaded.seal,
      oldPasscode,
      newPasscode,
      deviceSecret ?? undefined,
      this.options.config,
    );
    deviceSecret?.fill(0);
    if (!resealed.ok) return { ok: false, error: resealed.error };

    let seal = resealed.seal;
    let biometricToken: string | undefined;
    if (hadBiometric) {
      const secret = await readDeviceSecret(this.composite);
      const enabled = await addBiometricWrap(seal, newPasscode, secret ?? undefined);
      secret?.fill(0);
      if (!enabled.ok) return { ok: false, error: enabled.error };
      seal = enabled.seal;
      biometricToken = enabled.token;
    }

    const saved = await saveSeal(this.sealStorage, seal);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, seal, ...(biometricToken ? { biometricToken } : {}) };
  }

  /**
   * Enable biometrics. Returns a token the caller MUST store via
   * BiometricManager.updateBiometricToken. The passcode is required.
   */
  async enableBiometric(
    passcode: string,
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const enabled = await addBiometricWrap(loaded.seal, passcode, deviceSecret ?? undefined);
    deviceSecret?.fill(0);
    if (!enabled.ok) return { ok: false, error: enabled.error };

    const saved = await saveSeal(this.sealStorage, enabled.seal);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, token: enabled.token };
  }

  /** Disable biometrics. Requires the passcode (documented: biometrics are a convenience). */
  async disableBiometric(passcode: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const check = await unsealVault(loaded.seal, passcode, deviceSecret ?? undefined);
    deviceSecret?.fill(0);
    if (!check.success) return { ok: false, error: check.error };
    check.seed.fill(0);

    const saved = await saveSeal(this.sealStorage, removeBiometricWrap(loaded.seal));
    return saved.ok ? { ok: true } : { ok: false, error: saved.error };
  }

  /** Upgrade a stored legacy (v1–v3) seal to the current format. */
  async migrate(passcode: string, mnemonic?: string): Promise<MigrateStoredResult> {
    const deviceSecret = await readDeviceSecret(this.composite);
    const result = await migrateStoredSeal(
      this.sealStorage,
      passcode,
      deviceSecret ?? undefined,
      mnemonic,
    );
    deviceSecret?.fill(0);
    return result;
  }

  /** Delete the seal and device secret, then lock. Cannot be undone without the phrase. */
  async wipe(): Promise<void> {
    lockSession();
    await wipeStoredVault(this.composite);
    await deleteDeviceSecret(this.secureStorage ?? this.sealStorage);
  }
}
```

## packages/crypto-vault/src/buffer-polyfill.ts

```typescript
/**
 * Browser Buffer polyfill for @ton/core and @ton/ton.
 *
 * Both libraries use Node's global `Buffer` in functions (Address.toString, Cell BOC
 * serialization, WalletContractV5R1.create). Vite/esbuild do not inject Node globals, so the
 * vault bundle in a browser would throw `Buffer is not defined`. `buffer` is the standard
 * userland implementation (MIT, same code Node exposes).
 *
 * Imported first from address.ts so the global exists before any @ton call.
 */
import { Buffer as NodeBuffer } from 'buffer';

const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof NodeBuffer };
if (typeof globalWithBuffer.Buffer === 'undefined') {
  globalWithBuffer.Buffer = NodeBuffer;
}

export {};
```

## packages/crypto-vault/src/zod-jitless.ts

```typescript
/**
 * Configure zod for a strict CSP before any @ton module that may use it is evaluated.
 *
 * zod's validator JIT calls `Function("")` as a capability probe; under a CSP without
 * 'unsafe-eval' Chromium reports that as a script-src violation. `jitless` makes zod take the
 * non-JIT path. This module must be imported BEFORE @ton/ton (which depends on zod) so the
 * global config is set before zod's lazy `allowsEval` probe runs.
 *
 * Source: zod v4 global config (`z.config({ jitless })`).
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
```

## packages/crypto-vault/src/address.test.ts

```typescript
/**
 * B1: user-facing addresses with published vectors and independent cross-checks.
 *
 * Sources:
 * - EIP-55 vectors: https://eips.ethereum.org/EIPS/eip-55 (fetched 2026-11-21)
 * - TON address formats: docs.ton.org internal address formats (flags 0x11/0x51/+0x80)
 * - Wallet V5R1: @ton/ton (MIT) WalletContractV5R1
 * - TRON: TronWeb (MIT) as a second implementation
 */
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { TronWeb } from 'tronweb';
import { Address } from '@ton/core';
import {
  toEip55Address,
  isValidEvmAddress,
  toBase58TronAddress,
  isValidTronAddress,
  tonAddressesFromPublicKey,
  tonRawAddressViaStateInit,
  validateTonAddress,
  TON_V5R1_DEFAULT_WALLET_ID,
} from './address';
import { deriveTronKey, deriveEvmKey, deriveTonKey } from './derivation';
import { mnemonicToSeed } from './mnemonic';
import {
  HARDHAT_FIRST_ADDRESS,
  MNEMONIC_12_HARDHAT,
  MNEMONIC_24_ABANDON,
} from './fixtures/mnemonics';

const seedOf = (m: string): Uint8Array => mnemonicToSeed(m);

describe('B1: EVM EIP-55 (official vectors)', () => {
  it.each([
    '0x52908400098527886E0F7030069857D2E4169EE7',
    '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
  ])('all-uppercase vector %s', (expected) => {
    expect(toEip55Address(expected)).toBe(expected);
  });

  it.each([
    '0xde709f2102306220921060314715629080e2fb77',
    '0x27b1fdb04752bbc536007a920d24acb045561c26',
  ])('all-lowercase vector %s', (expected) => {
    expect(toEip55Address(expected)).toBe(expected);
  });

  it.each([
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ])('mixed-case vector %s', (expected) => {
    expect(toEip55Address(expected.toLowerCase())).toBe(expected);
  });

  it("matches the published Hardhat first account for m/44'/60'/0'/0/0", () => {
    const raw = deriveEvmKey(seedOf(MNEMONIC_12_HARDHAT)).rawAddress;
    expect(toEip55Address(raw)).toBe(HARDHAT_FIRST_ADDRESS);
  });

  it('cross-checks with viem', () => {
    for (const m of [MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON]) {
      const raw = deriveEvmKey(seedOf(m)).rawAddress;
      expect(toEip55Address(raw)).toBe(getAddress(raw));
    }
  });

  it('validates checksummed, all-lower and all-upper; rejects a bad checksum', () => {
    expect(isValidEvmAddress(HARDHAT_FIRST_ADDRESS)).toBe(true);
    expect(isValidEvmAddress(HARDHAT_FIRST_ADDRESS.toLowerCase())).toBe(true);
    expect(isValidEvmAddress(HARDHAT_FIRST_ADDRESS.toUpperCase().replace('0X', '0x'))).toBe(true);
    const broken = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92267';
    expect(isValidEvmAddress(broken)).toBe(false);
    expect(isValidEvmAddress('0x1234')).toBe(false);
  });
});

describe('B1: TRON base58check address', () => {
  const key = (m: string): ReturnType<typeof deriveTronKey> => deriveTronKey(seedOf(m));

  it.each([MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON])('matches TronWeb for %#', (m) => {
    const address = toBase58TronAddress(key(m).hexAddress);
    const tw = TronWeb.fromMnemonic(m, "m/44'/195'/0'/0/0");
    expect(address).toBe(tw.address);
    expect(address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(isValidTronAddress(address)).toBe(true);
  });

  it('round trips hex -> base58 -> hex', () => {
    const hex = key(MNEMONIC_12_HARDHAT).hexAddress;
    const address = toBase58TronAddress(hex);
    expect(TronWeb.address.toHex(address).toLowerCase()).toBe(hex);
  });

  it('rejects malformed hex and bad base58check', () => {
    expect(() => toBase58TronAddress('41')).toThrow('INVALID_TRON_HEX_ADDRESS');
    expect(() => toBase58TronAddress('51' + 'ab'.repeat(20))).toThrow();
    expect(isValidTronAddress('T' + '1'.repeat(33))).toBe(false);
    expect(isValidTronAddress('0x' + 'ab'.repeat(20))).toBe(false);
    // Flip one character of a valid address: the checksum must fail.
    const valid = toBase58TronAddress(key(MNEMONIC_12_HARDHAT).hexAddress);
    const flipped = valid.slice(0, 10) + (valid[10] === 'A' ? 'B' : 'A') + valid.slice(11);
    expect(isValidTronAddress(flipped)).toBe(false);
  });
});

describe('B1: TON Wallet V5R1 address', () => {
  const pub = deriveTonKey(seedOf(MNEMONIC_12_HARDHAT)).publicKeyHex;

  it('matches an independent StateInit hash construction (cross-check)', () => {
    const forms = tonAddressesFromPublicKey(pub);
    expect(forms.raw).toBe(tonRawAddressViaStateInit(pub));
    // Testnet must use a different global id.
    expect(tonRawAddressViaStateInit(pub, -3)).not.toBe(forms.raw);
  });

  it('uses the documented default wallet ids', () => {
    // @ton/ton WalletV5R1WalletId: global_id ^ context, -239 mainnet / -3 testnet,
    // workchain 0, wallet_version 0, subwallet 0.
    expect(TON_V5R1_DEFAULT_WALLET_ID).toEqual({ mainnet: 2147483409, testnet: 2147483645 });
  });

  it('exposes raw, bounceable (EQ), non-bounceable (UQ) and testnet (kQ/0Q) forms', () => {
    const forms = tonAddressesFromPublicKey(pub);
    expect(forms.raw).toMatch(/^0:[0-9a-f]{64}$/);
    expect(forms.bounceable.startsWith('EQ')).toBe(true);
    expect(forms.nonBounceable.startsWith('UQ')).toBe(true);
    expect(forms.testnetBounceable.startsWith('kQ')).toBe(true);
    expect(forms.testnetNonBounceable.startsWith('0Q')).toBe(true);
    // Mainnet forms decode back to the mainnet hash; testnet forms to the testnet hash.
    const testnetRaw = tonRawAddressViaStateInit(pub, -3);
    expect(testnetRaw).not.toBe(forms.raw);
    for (const form of [forms.raw, forms.bounceable, forms.nonBounceable]) {
      expect(Address.parse(form).toRawString()).toBe(forms.raw);
    }
    for (const form of [forms.testnetBounceable, forms.testnetNonBounceable]) {
      expect(Address.parse(form).toRawString()).toBe(testnetRaw);
    }
  });

  it('different account indexes give different addresses', () => {
    const pub1 = deriveTonKey(seedOf(MNEMONIC_12_HARDHAT), 1).publicKeyHex;
    expect(tonAddressesFromPublicKey(pub1).raw).not.toBe(tonAddressesFromPublicKey(pub).raw);
  });

  it('validates raw and user-friendly forms; flags testnet', () => {
    const forms = tonAddressesFromPublicKey(pub);
    for (const form of [forms.raw, forms.bounceable, forms.nonBounceable]) {
      const r = validateTonAddress(form);
      expect(r.valid).toBe(true);
      expect(r.raw).toBe(forms.raw);
    }
    expect(validateTonAddress(forms.testnetNonBounceable).testnet).toBe(true);
    expect(validateTonAddress(forms.testnetBounceable).testnet).toBe(true);
    expect(validateTonAddress(forms.nonBounceable).testnet).toBeUndefined();
    for (const bad of ['', 'EQ', '0:' + 'zz'.repeat(32), 'not-an-address']) {
      expect(validateTonAddress(bad).valid).toBe(false);
    }
  });

  it('parses a published address literal from the @ton/ton V5R1 spec', () => {
    // Source: ton-org/ton src/wallets/v5r1/WalletContractV5R1.spec.ts (fetched 2026-11-21).
    const published = 'EQCqe9WqFhS8AfVGDP2xQiTLjbeolhLGsvIbbgQ6C3XT5gGs';
    const r = validateTonAddress(published);
    expect(r.valid).toBe(true);
    expect(Address.parse(published).toString({ bounceable: true, urlSafe: true })).toBe(published);
  });
});
```

## packages/crypto-vault/src/account-type.test.ts

```typescript
/**
 * B2: TON-native-only accounts vs BIP-39 multichain accounts.
 *
 * Vector: @ton/crypto (MIT) mnemonic.spec.js test vector 1 — a valid TON-native 24-word phrase
 * with its Ed25519 secret key (64 bytes: 32 private + 32 public). Fetched from the installed
 * package; the same vector is published in the @ton/crypto repository.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createSeal, unsealVault, VAULT_FORMAT_VERSION } from './vault';
import {
  generateTonNativeMnemonicPhrase,
  mnemonicToSeed,
  normalizeMnemonic,
  tonNativeMnemonicToSeed,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { deriveTonKey } from './derivation';
import { unlockSession, lockSession, getSession } from './session';
import { VaultManager } from './vault-manager';
import { InMemoryStorage } from './storage';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'account type passphrase 1';

const TON_NATIVE_MNEMONIC = [
  'hospital',
  'stove',
  'relief',
  'fringe',
  'tongue',
  'always',
  'charge',
  'angry',
  'urge',
  'sentence',
  'again',
  'match',
  'nerve',
  'inquiry',
  'senior',
  'coconut',
  'label',
  'tumble',
  'carry',
  'category',
  'beauty',
  'bean',
  'road',
  'solution',
].join(' ');

/** 64-byte Ed25519 secret key from the vector: private (32) || public (32). */
const TON_NATIVE_KEY =
  '9d659a6c2234db7f6e4f977e6e8653b9f5946d557163f31034011375d8f3f97df6c450a16bb1c514e22f1977e390a3025599aa1e7b00068a6aacf2119484c1bd';

afterEach(() => {
  lockSession();
});

describe('B2: TON-native derivation (official vector)', () => {
  it('validates the TON-native phrase', async () => {
    expect(await validateTonMnemonicPhrase(TON_NATIVE_MNEMONIC)).toBe(true);
    expect(await validateTonMnemonicPhrase(MNEMONIC_12_HARDHAT)).toBe(false);
  });

  it('derives the published key pair', async () => {
    const seed = await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC);
    const key = deriveTonKey(seed, 0, 'ton-native-only');
    expect(bytesToHex(key.privateKey)).toBe(TON_NATIVE_KEY.slice(0, 64));
    expect(key.publicKeyHex).toBe(TON_NATIVE_KEY.slice(64));
    expect(key.path).toBe('ton-native');
  });

  it('rejects account indexes other than 0', async () => {
    const seed = await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC);
    expect(() => deriveTonKey(seed, 1, 'ton-native-only')).toThrow('TON_NATIVE_SINGLE_ACCOUNT');
  });

  it('the same words are a different key under BIP-39 (not interchangeable)', async () => {
    const nativeSeed = await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC);
    const bipSeed = mnemonicToSeed(normalizeMnemonic(TON_NATIVE_MNEMONIC));
    expect(bytesToHex(nativeSeed)).not.toBe(bytesToHex(bipSeed));
    // TON mnemonics are not BIP-39: validation and AAD differ.
    expect(validateMnemonicPhrase(normalizeMnemonic(TON_NATIVE_MNEMONIC)).valid).toBe(false);
  });
});

describe('B2: seal round trip with accountType', () => {
  it('ton-native seal stores the account type and verifies the phrase', async () => {
    const seal = await createSeal(TON_NATIVE_MNEMONIC, PASS, undefined, FAST, 'ton-native-only');
    expect(seal.version).toBe(VAULT_FORMAT_VERSION);
    expect(seal.accountType).toBe('ton-native-only');
    const r = await unsealVault(seal, PASS);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(bytesToHex(r.seed)).toBe(bytesToHex(await tonNativeMnemonicToSeed(TON_NATIVE_MNEMONIC)));
  });

  it('bip39 createSeal rejects a TON-native phrase', async () => {
    await expect(
      createSeal(TON_NATIVE_MNEMONIC, PASS, undefined, FAST, 'bip39-multichain'),
    ).rejects.toThrow('INVALID_MNEMONIC');
  });

  it('ton-native createSeal rejects a BIP-39 phrase', async () => {
    await expect(
      createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST, 'ton-native-only'),
    ).rejects.toThrow('INVALID_MNEMONIC');
  });

  it('changing accountType fails authentication (AAD binds it)', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    expect(await unsealVault({ ...seal, accountType: 'ton-native-only' }, PASS)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('generates a valid TON-native phrase', async () => {
    const phrase = await generateTonNativeMnemonicPhrase();
    expect(phrase.split(' ')).toHaveLength(24);
    expect(await validateTonMnemonicPhrase(phrase)).toBe(true);
  });
});

describe('B2: session and manager expose only TON for native accounts', () => {
  it('session: TON only, signing limited to ton/account 0', async () => {
    const seal = await createSeal(TON_NATIVE_MNEMONIC, PASS, undefined, FAST, 'ton-native-only');
    const storage = new InMemoryStorage();
    const unlocked = await unlockSession(seal, PASS, storage);
    if (!unlocked.success) throw new Error('unlock failed');
    const s = unlocked.session;

    const info = s.getPublicInfo(0);
    expect(info?.accountType).toBe('ton-native-only');
    expect(info?.tron).toBeUndefined();
    expect(info?.evm).toBeUndefined();
    expect(info?.ton.publicKeyHex).toBe(TON_NATIVE_KEY.slice(64));
    expect(s.getPublicInfo(1)).toBeNull();

    expect(s.signDigest('ton', 0, new Uint8Array(32).fill(1)).ok).toBe(true);
    expect(s.signDigest('evm', 0, new Uint8Array(32).fill(1))).toEqual({
      ok: false,
      error: 'invalid_chain',
    });
    expect(s.signDigest('ton', 1, new Uint8Array(32).fill(1))).toEqual({
      ok: false,
      error: 'invalid_account',
    });
    expect(getSession()).toBe(s);
  });

  it('VaultManager imports a TON-native wallet as TON-only', async () => {
    const manager = new VaultManager({
      sealStorage: new InMemoryStorage(),
      config: FAST,
    });
    const imported = await manager.importWallet(TON_NATIVE_MNEMONIC, PASS, {
      accountType: 'ton-native-only',
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.seal.accountType).toBe('ton-native-only');

    const unlocked = await manager.unlock(PASS);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    const info = unlocked.session.getPublicInfo(0);
    expect(info?.ton.publicKeyHex).toBe(TON_NATIVE_KEY.slice(64));
    expect(info?.evm).toBeUndefined();
  });

  it('VaultManager rejects an invalid TON-native phrase without throwing', async () => {
    const manager = new VaultManager({ sealStorage: new InMemoryStorage(), config: FAST });
    const r = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS, {
      accountType: 'ton-native-only',
    });
    expect(r).toEqual({ ok: false, error: 'invalid_mnemonic' });
  });
});
```

## packages/crypto-vault/src/vault.test.ts

```typescript
/**
 * Vault seal tests (A4, A10 tamper-by-XOR). Every negative test asserts the SPECIFIC error,
 * so it cannot pass because of an unrelated failure.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { argon2id } from 'hash-wasm';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  sealVault,
  unsealVault,
  createSeal,
  changePasscode,
  migrateLegacySeal,
  combineWithDeviceSecret,
  buildAad,
  KDF_BOUNDS,
  VAULT_FORMAT_VERSION,
  type VaultSeal,
  type LegacyVaultSeal,
} from './vault';
import { mnemonicToSeed, normalizeMnemonic } from './mnemonic';
import {
  MNEMONIC_12_ABANDON,
  MNEMONIC_12_HARDHAT,
  MNEMONIC_24_ABANDON,
} from './fixtures/mnemonics';

vi.mock('hash-wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hash-wasm')>();
  return { ...actual, argon2id: vi.fn(actual.argon2id) };
});

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'correct horse battery staple';
const DEVICE_SECRET = new Uint8Array(32).fill(0xab);

/** Flip one bit with XOR (never "set to a constant", which is a no-op 1 time in 256). */
function flipBit(hex: string, byteIndex = 0): string {
  const b = hexToBytes(hex);
  b[byteIndex] = (b[byteIndex] ?? 0) ^ 0x01;
  return bytesToHex(b);
}

function seedOf(m: string): Uint8Array {
  return mnemonicToSeed(normalizeMnemonic(m));
}

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, usage);
}

async function gcmEncrypt(pt: Uint8Array, key: Uint8Array, aad: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad as BufferSource },
    await aesKey(key, ['encrypt']),
    pt as BufferSource,
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** Test-side re-implementation of key unwrap, so tests can forge VALID-key / WRONG-AAD seals. */
async function openVaultKey(seal: VaultSeal, passcode: string, ds?: Uint8Array) {
  const pk = await argon2id({
    password: passcode.normalize('NFKD'),
    salt: hexToBytes(seal.passcodeSalt),
    parallelism: seal.argon2Parallelism,
    iterations: seal.argon2TimeCost,
    memorySize: seal.argon2MemoryCost,
    hashLength: 32,
    outputType: 'binary',
  });
  const wrapping = ds ? combineWithDeviceSecret(pk, ds) : pk;
  const wrapped = hexToBytes(seal.passcodeWrappedKey);
  const params = {
    argon2TimeCost: seal.argon2TimeCost,
    argon2MemoryCost: seal.argon2MemoryCost,
    argon2Parallelism: seal.argon2Parallelism,
  };
  const vk = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: wrapped.slice(0, 12),
      additionalData: buildAad(
        'vault-key',
        seal.version,
        seal.hasDeviceSecret,
        params,
      ) as BufferSource,
    },
    await aesKey(wrapping, ['decrypt']),
    wrapped.slice(12),
  );
  return { vaultKey: new Uint8Array(vk), params };
}

describe('A4: seal round trip', () => {
  let seal: VaultSeal;
  beforeAll(async () => {
    seal = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
  });

  it('round trips seed and mnemonic', async () => {
    const r = await unsealVault(seal, PASS);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.mnemonic).toBe(MNEMONIC_12_ABANDON);
      expect(r.seed).toEqual(seedOf(MNEMONIC_12_ABANDON));
    }
  });

  it('seal has no stored aad field', () => {
    expect(Object.keys(seal)).not.toContain('aad');
  });

  it('wrong passcode -> wrong_passcode', async () => {
    expect(await unsealVault(seal, 'nope nope nope')).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('IVs are unique across seals and within a seal', async () => {
    const seals = await Promise.all(
      [1, 2, 3, 4].map(() => createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST)),
    );
    const all = seals.flatMap((s) => [s.iv, s.mnemonicIv, s.passcodeWrappedKey.slice(0, 24)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('createSeal rejects an invalid mnemonic', async () => {
    await expect(createSeal('abandon '.repeat(11) + 'zoo', PASS, undefined, FAST)).rejects.toThrow(
      'INVALID_MNEMONIC',
    );
  });
});

describe('A4: AAD binding and tamper detection (each asserts the specific error)', () => {
  let seal: VaultSeal;
  beforeAll(async () => {
    seal = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
  });

  it('changing version -> unsupported_version (no decrypt attempted)', async () => {
    for (const v of [1, 2, 3, 4, 6, 0, -1]) {
      expect(await unsealVault({ ...seal, version: v }, PASS)).toEqual({
        success: false,
        error: 'unsupported_version',
      });
    }
  });

  it('AAD binds version: a seed ciphertext made under another version fails with tampered_data', async () => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      seedOf(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('seed', 99, false, params),
    );
    const r = await unsealVault(
      { ...seal, encryptedSeed: bytesToHex(forged.ct), iv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it.each([
    ['argon2TimeCost', FAST.argon2TimeCost + 1],
    ['argon2MemoryCost', FAST.argon2MemoryCost + 1024],
    ['argon2Parallelism', 2],
  ] as const)(
    'changing %s -> wrong_passcode (KDF output and AAD both change)',
    async (field, value) => {
      expect(await unsealVault({ ...seal, [field]: value }, PASS)).toEqual({
        success: false,
        error: 'wrong_passcode',
      });
    },
  );

  it.each([
    ['argon2TimeCost', FAST.argon2TimeCost + 1],
    ['argon2MemoryCost', FAST.argon2MemoryCost + 1024],
    ['argon2Parallelism', 2],
  ] as const)('AAD binds %s independently of the KDF output', async (field, value) => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      seedOf(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('seed', seal.version, false, { ...params, [field]: value }),
    );
    const r = await unsealVault(
      { ...seal, encryptedSeed: bytesToHex(forged.ct), iv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it('AAD binds the role: seed bytes encrypted under the mnemonic role -> tampered_data', async () => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      seedOf(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('mnemonic', seal.version, false, params),
    );
    const r = await unsealVault(
      { ...seal, encryptedSeed: bytesToHex(forged.ct), iv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it('AAD binds the role: mnemonic encrypted under the seed role -> tampered_data', async () => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      new TextEncoder().encode(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('seed', seal.version, false, params),
    );
    const r = await unsealVault(
      { ...seal, encryptedMnemonic: bytesToHex(forged.ct), mnemonicIv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it('flipping one bit of encryptedSeed / iv / encryptedMnemonic / mnemonicIv -> tampered_data', async () => {
    for (const field of ['encryptedSeed', 'iv', 'encryptedMnemonic', 'mnemonicIv'] as const) {
      const r = await unsealVault({ ...seal, [field]: flipBit(seal[field], 3) }, PASS);
      expect(r, field).toEqual({ success: false, error: 'tampered_data' });
    }
  });

  it('flipping one bit of the wrapped key -> wrong_passcode (GCM cannot distinguish)', async () => {
    expect(
      await unsealVault(
        { ...seal, passcodeWrappedKey: flipBit(seal.passcodeWrappedKey, 20) },
        PASS,
      ),
    ).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('removing mnemonic fields from a seal -> malformed_seal (no silent downgrade)', async () => {
    const noMn: Record<string, unknown> = { ...seal };
    delete noMn['encryptedMnemonic'];
    delete noMn['mnemonicIv'];
    expect(await unsealVault(noMn as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'malformed_seal',
    });
  });

  it('mnemonic that does not regenerate the seed -> seed_mnemonic_mismatch', async () => {
    const mismatched = await sealVault(
      seedOf(MNEMONIC_12_ABANDON),
      MNEMONIC_12_HARDHAT,
      PASS,
      undefined,
      FAST,
    );
    expect(await unsealVault(mismatched, PASS)).toEqual({
      success: false,
      error: 'seed_mnemonic_mismatch',
    });
  });

  it.each([
    ['non-hex salt', { passcodeSalt: 'zz'.repeat(16) }],
    ['short salt', { passcodeSalt: 'ab'.repeat(8) }],
    ['odd-length iv', { iv: 'abc' }],
    ['non-string field', { encryptedSeed: 42 }],
  ])('malformed hex (%s) -> malformed_seal', async (_name, patch) => {
    expect(await unsealVault({ ...seal, ...patch } as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'malformed_seal',
    });
  });

  it('non-object seal -> malformed_seal', async () => {
    expect(await unsealVault(null as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'malformed_seal',
    });
  });
});

describe('A4: KDF bounds are enforced BEFORE Argon2 runs', () => {
  it.each([
    ['timeCost too low', { argon2TimeCost: KDF_BOUNDS.argon2TimeCost.min - 1 }],
    ['timeCost too high', { argon2TimeCost: KDF_BOUNDS.argon2TimeCost.max + 1 }],
    ['memory too low', { argon2MemoryCost: KDF_BOUNDS.argon2MemoryCost.min - 1 }],
    ['memory too high (DoS)', { argon2MemoryCost: 4_000_000 }],
    ['parallelism too high', { argon2Parallelism: KDF_BOUNDS.argon2Parallelism.max + 1 }],
    ['non-integer', { argon2TimeCost: 2.5 }],
  ])('%s -> invalid_params and argon2id is never called', async (_n, patch) => {
    const seal = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
    vi.mocked(argon2id).mockClear();
    const r = await unsealVault({ ...seal, ...patch }, PASS);
    expect(r).toEqual({ success: false, error: 'invalid_params' });
    expect(argon2id).not.toHaveBeenCalled();
  });

  it('sealVault refuses out-of-range parameters', async () => {
    await expect(
      sealVault(seedOf(MNEMONIC_12_ABANDON), MNEMONIC_12_ABANDON, PASS, undefined, {
        argon2TimeCost: 1,
      }),
    ).rejects.toThrow('INVALID_KDF_PARAMS');
  });
});

describe('A4: device secret', () => {
  let seal: VaultSeal;
  beforeAll(async () => {
    seal = await createSeal(MNEMONIC_24_ABANDON, PASS, DEVICE_SECRET, FAST);
  });

  it('passcode + device secret opens it', async () => {
    expect((await unsealVault(seal, PASS, DEVICE_SECRET)).success).toBe(true);
  });
  it('missing device secret -> device_secret_missing, and argon2id is not called', async () => {
    vi.mocked(argon2id).mockClear();
    expect(await unsealVault(seal, PASS)).toEqual({
      success: false,
      error: 'device_secret_missing',
    });
    expect(argon2id).not.toHaveBeenCalled();
  });
  it('wrong-length device secret -> device_secret_missing', async () => {
    expect(await unsealVault(seal, PASS, new Uint8Array(5))).toEqual({
      success: false,
      error: 'device_secret_missing',
    });
  });
  it('wrong device secret -> wrong_passcode', async () => {
    expect(await unsealVault(seal, PASS, new Uint8Array(32).fill(0xcd))).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });
  it('right device secret, wrong passcode -> wrong_passcode', async () => {
    expect(await unsealVault(seal, 'wrong', DEVICE_SECRET)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });
  it('flipping hasDeviceSecret to false does not give a passcode-only path', async () => {
    const r = await unsealVault({ ...seal, hasDeviceSecret: false }, PASS);
    expect(r).toEqual({ success: false, error: 'wrong_passcode' });
  });
});

describe('A10: changePasscode returns a discriminated result', () => {
  it('re-seals with a fresh vault key, salt and IVs; old passcode stops working on the new seal', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    const result = await changePasscode(seal, PASS, 'another passphrase 987', undefined, FAST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ns = result.seal;
    expect(ns.passcodeSalt).not.toBe(seal.passcodeSalt);
    expect(ns.passcodeWrappedKey).not.toBe(seal.passcodeWrappedKey);
    expect(ns.encryptedSeed).not.toBe(seal.encryptedSeed);
    expect((await unsealVault(ns, 'another passphrase 987')).success).toBe(true);
    expect(await unsealVault(ns, PASS)).toEqual({ success: false, error: 'wrong_passcode' });
  });
  it('wrong old passcode returns { ok: false, error }', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    expect(await changePasscode(seal, 'bad', 'long enough pass 123', undefined, FAST)).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
  });
  it('drops any biometric wrap (the vault key rotates)', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    const withBio: VaultSeal = { ...seal, biometricWrappedKey: '00'.repeat(60) };
    const result = await changePasscode(withBio, PASS, 'another passphrase 987', undefined, FAST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seal.biometricWrappedKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Legacy migration. The legacy writer is re-implemented here exactly as the old code did:
// stored aad (JSON), no AAD on the key wrap, version 1 without / version 2 with a mnemonic.
// ---------------------------------------------------------------------------
async function makeLegacySeal(
  version: 1 | 2,
  mnemonic: string,
  passcode: string,
  ds?: Uint8Array,
): Promise<LegacyVaultSeal> {
  const params = FAST;
  const seed = seedOf(mnemonic);
  const vaultKey = crypto.getRandomValues(new Uint8Array(32));
  const aad = new TextEncoder().encode(
    JSON.stringify({
      v: version,
      t: params.argon2TimeCost,
      m: params.argon2MemoryCost,
      p: params.argon2Parallelism,
    }),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pk = await argon2id({
    password: passcode.normalize('NFKD'),
    salt,
    parallelism: params.argon2Parallelism,
    iterations: params.argon2TimeCost,
    memorySize: params.argon2MemoryCost,
    hashLength: 32,
    outputType: 'binary',
  });
  const wrapping = ds ? hkdf(sha256, pk, ds, 'onezerowallet-vault-combined', 32) : pk;
  const seedEnc = await gcmEncrypt(seed, vaultKey, aad);
  const wrapEnc = await gcmEncrypt(vaultKey, wrapping, new Uint8Array(0));
  const legacy: LegacyVaultSeal = {
    version,
    passcodeWrappedKey: bytesToHex(wrapEnc.iv) + bytesToHex(wrapEnc.ct),
    hasDeviceSecret: ds !== undefined,
    encryptedSeed: bytesToHex(seedEnc.ct),
    iv: bytesToHex(seedEnc.iv),
    aad: bytesToHex(aad),
    passcodeSalt: bytesToHex(salt),
    argon2TimeCost: params.argon2TimeCost,
    argon2MemoryCost: params.argon2MemoryCost,
    argon2Parallelism: params.argon2Parallelism,
  };
  if (version === 2) {
    const mnEnc = await gcmEncrypt(new TextEncoder().encode(mnemonic), vaultKey, aad);
    legacy.encryptedMnemonic = bytesToHex(mnEnc.ct);
    legacy.mnemonicIv = bytesToHex(mnEnc.iv);
  }
  return legacy;
}

/** Re-create a v3 seal exactly as the previous format did: recomputed AAD, old HKDF form. */
async function makeLegacyV3Seal(
  mnemonic: string,
  passcode: string,
  ds?: Uint8Array,
): Promise<LegacyVaultSeal> {
  const params = { ...FAST };
  const seed = seedOf(mnemonic);
  const vaultKey = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pk = await argon2id({
    password: passcode.normalize('NFKD'),
    salt,
    parallelism: params.argon2Parallelism,
    iterations: params.argon2TimeCost,
    memorySize: params.argon2MemoryCost,
    hashLength: 32,
    outputType: 'binary',
  });
  // The v3 combination (unconventional): salt = deviceSecret, info = fixed label.
  const wrapping = ds ? hkdf(sha256, pk, ds, 'onezerowallet-vault-combined', 32) : pk;
  const seedEnc = await gcmEncrypt(seed, vaultKey, buildAad('seed', 3, ds !== undefined, params));
  const mnEnc = await gcmEncrypt(
    new TextEncoder().encode(mnemonic),
    vaultKey,
    buildAad('mnemonic', 3, ds !== undefined, params),
  );
  const wrapEnc = await gcmEncrypt(
    vaultKey,
    wrapping,
    buildAad('vault-key', 3, ds !== undefined, params),
  );
  return {
    version: 3,
    passcodeWrappedKey: bytesToHex(wrapEnc.iv) + bytesToHex(wrapEnc.ct),
    hasDeviceSecret: ds !== undefined,
    encryptedSeed: bytesToHex(seedEnc.ct),
    iv: bytesToHex(seedEnc.iv),
    passcodeSalt: bytesToHex(salt),
    argon2TimeCost: params.argon2TimeCost,
    argon2MemoryCost: params.argon2MemoryCost,
    argon2Parallelism: params.argon2Parallelism,
    encryptedMnemonic: bytesToHex(mnEnc.ct),
    mnemonicIv: bytesToHex(mnEnc.iv),
  };
}

/** Re-create a v4 seal: conventional HKDF, no account type, AAD without the at= field. */
async function makeLegacyV4Seal(
  mnemonic: string,
  passcode: string,
  ds?: Uint8Array,
): Promise<LegacyVaultSeal> {
  const params = { ...FAST };
  const seed = seedOf(mnemonic);
  const vaultKey = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pk = await argon2id({
    password: passcode.normalize('NFKD'),
    salt,
    parallelism: params.argon2Parallelism,
    iterations: params.argon2TimeCost,
    memorySize: params.argon2MemoryCost,
    hashLength: 32,
    outputType: 'binary',
  });
  const wrapping = ds ? combineWithDeviceSecret(pk, ds) : pk;
  const aadFor = (role: 'seed' | 'mnemonic' | 'vault-key') =>
    buildAad(role, 4, ds !== undefined, params);
  const seedEnc = await gcmEncrypt(seed, vaultKey, aadFor('seed'));
  const mnEnc = await gcmEncrypt(new TextEncoder().encode(mnemonic), vaultKey, aadFor('mnemonic'));
  const wrapEnc = await gcmEncrypt(vaultKey, wrapping, aadFor('vault-key'));
  return {
    version: 4,
    passcodeWrappedKey: bytesToHex(wrapEnc.iv) + bytesToHex(wrapEnc.ct),
    hasDeviceSecret: ds !== undefined,
    encryptedSeed: bytesToHex(seedEnc.ct),
    iv: bytesToHex(seedEnc.iv),
    passcodeSalt: bytesToHex(salt),
    argon2TimeCost: params.argon2TimeCost,
    argon2MemoryCost: params.argon2MemoryCost,
    argon2Parallelism: params.argon2Parallelism,
    encryptedMnemonic: bytesToHex(mnEnc.ct),
    mnemonicIv: bytesToHex(mnEnc.iv),
  };
}

describe('B2: migration of v4 seals (account type added)', () => {
  it('v4 migrates to v5 as bip39-multichain and opens', async () => {
    const legacy = await makeLegacyV4Seal(MNEMONIC_12_HARDHAT, PASS);
    const m = await migrateLegacySeal(legacy, PASS);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.seal.version).toBe(VAULT_FORMAT_VERSION);
    expect(m.seal.accountType).toBe('bip39-multichain');
    const r = await unsealVault(m.seal, PASS);
    expect(r.success && r.mnemonic).toBe(MNEMONIC_12_HARDHAT);
  });

  it('v4 with a device secret migrates only with the device secret', async () => {
    const legacy = await makeLegacyV4Seal(MNEMONIC_12_ABANDON, PASS, DEVICE_SECRET);
    expect(await migrateLegacySeal(legacy, PASS)).toEqual({
      ok: false,
      error: 'device_secret_missing',
    });
    const m = await migrateLegacySeal(legacy, PASS, DEVICE_SECRET);
    expect(m.ok).toBe(true);
    if (m.ok) expect((await unsealVault(m.seal, PASS, DEVICE_SECRET)).success).toBe(true);
  });
});

describe('A10: migration of v3 seals (HKDF scheme change)', () => {
  it('v3 seal migrates to v4 and opens with the same passcode', async () => {
    const legacy = await makeLegacyV3Seal(MNEMONIC_12_HARDHAT, PASS);
    const m = await migrateLegacySeal(legacy, PASS);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.seal.version).toBe(VAULT_FORMAT_VERSION);
    const r = await unsealVault(m.seal, PASS);
    expect(r.success && r.mnemonic).toBe(MNEMONIC_12_HARDHAT);
  });

  it('v3 seal with a device secret migrates only with the device secret', async () => {
    const legacy = await makeLegacyV3Seal(MNEMONIC_12_ABANDON, PASS, DEVICE_SECRET);
    expect(await migrateLegacySeal(legacy, PASS)).toEqual({
      ok: false,
      error: 'device_secret_missing',
    });
    const m = await migrateLegacySeal(legacy, PASS, DEVICE_SECRET);
    expect(m.ok).toBe(true);
    if (m.ok) expect((await unsealVault(m.seal, PASS, DEVICE_SECRET)).success).toBe(true);
  });

  it('a v4 seal presented to migration is rejected as unsupported_version', async () => {
    const current = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
    expect(await migrateLegacySeal(current as unknown as LegacyVaultSeal, PASS)).toEqual({
      ok: false,
      error: 'unsupported_version',
    });
  });
});

describe('A4: migration of v1/v2 seals', () => {
  it('current-format seals are rejected by unsealVault as unsupported_version when presented as legacy', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await unsealVault(legacy as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'unsupported_version',
    });
  });

  it('v2 seal migrates to v3 and opens with the same passcode and mnemonic', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_HARDHAT, PASS);
    const m = await migrateLegacySeal(legacy, PASS);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.seal.version).toBe(VAULT_FORMAT_VERSION);
    expect(Object.keys(m.seal)).not.toContain('aad');
    const r = await unsealVault(m.seal, PASS);
    expect(r.success && r.mnemonic).toBe(MNEMONIC_12_HARDHAT);
  });

  it('v1 seal needs the recovery phrase: absent -> mnemonic_required', async () => {
    const legacy = await makeLegacySeal(1, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal(legacy, PASS)).toEqual({
      ok: false,
      error: 'mnemonic_required',
    });
  });

  it('v1 seal + correct phrase migrates; wrong phrase -> seed_mnemonic_mismatch', async () => {
    const legacy = await makeLegacySeal(1, MNEMONIC_12_ABANDON, PASS);
    const bad = await migrateLegacySeal(legacy, PASS, undefined, MNEMONIC_12_HARDHAT);
    expect(bad).toEqual({ ok: false, error: 'seed_mnemonic_mismatch' });
    const good = await migrateLegacySeal(legacy, PASS, undefined, MNEMONIC_12_ABANDON);
    expect(good.ok).toBe(true);
    if (good.ok) expect((await unsealVault(good.seal, PASS)).success).toBe(true);
  });

  it('v1 seal with device secret migrates only with the device secret', async () => {
    const legacy = await makeLegacySeal(1, MNEMONIC_12_ABANDON, PASS, DEVICE_SECRET);
    expect(await migrateLegacySeal(legacy, PASS, undefined, MNEMONIC_12_ABANDON)).toEqual({
      ok: false,
      error: 'device_secret_missing',
    });
    const m = await migrateLegacySeal(legacy, PASS, DEVICE_SECRET, MNEMONIC_12_ABANDON);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.seal.hasDeviceSecret).toBe(true);
      expect((await unsealVault(m.seal, PASS, DEVICE_SECRET)).success).toBe(true);
    }
  });

  it('wrong passcode -> wrong_passcode', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal(legacy, 'wrong')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
  });

  it('v2 seal with mnemonic fields removed -> malformed_seal (no silent downgrade)', async () => {
    const legacy: Record<string, unknown> = {
      ...(await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS)),
    };
    delete legacy['encryptedMnemonic'];
    delete legacy['mnemonicIv'];
    expect(await migrateLegacySeal(legacy as unknown as LegacyVaultSeal, PASS)).toEqual({
      ok: false,
      error: 'malformed_seal',
    });
  });

  it('tampered legacy stored aad -> tampered_data', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal({ ...legacy, aad: flipBit(legacy.aad ?? '', 2) }, PASS)).toEqual(
      {
        ok: false,
        error: 'tampered_data',
      },
    );
  });

  it('legacy seal with out-of-range params -> invalid_params without running Argon2', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    vi.mocked(argon2id).mockClear();
    expect(await migrateLegacySeal({ ...legacy, argon2TimeCost: 1 }, PASS)).toEqual({
      ok: false,
      error: 'invalid_params',
    });
    expect(argon2id).not.toHaveBeenCalled();
  });

  it('unknown version -> unsupported_version', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal({ ...legacy, version: 5 }, PASS)).toEqual({
      ok: false,
      error: 'unsupported_version',
    });
  });
});
```

## packages/crypto-vault/src/session.test.ts

```typescript
/**
 * A2: session API. Keys never leave the module; signing, re-auth and lock behave as specified.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
import { recoverPublicKey, type Hex } from 'viem';
import { createSeal, type VaultSeal } from './vault';
import { mnemonicToSeed } from './mnemonic';
import { deriveTonKey, deriveTronKey, deriveEvmKey } from './derivation';
import { isValidEvmAddress, isValidTronAddress, validateTonAddress } from './address';
import { unlockSession, lockSession, getSession, type VaultSession } from './session';
import { InMemoryStorage } from './storage';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'session passphrase 123';
const DIGEST = sha256(new TextEncoder().encode('test payload'));

let seal: VaultSeal;
beforeAll(async () => {
  seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
});
afterEach(() => {
  lockSession();
  vi.useRealTimers();
});

async function open(opts?: { reauthWindowMs?: number }): Promise<VaultSession> {
  const r = await unlockSession(seal, PASS, new InMemoryStorage(), opts);
  if (!r.success) throw new Error(`unlock failed: ${r.error}`);
  return r.session;
}

/** Collect every property name and every Uint8Array / string value reachable from `root`. */
function walk(root: unknown): { keys: string[]; leaves: unknown[] } {
  const keys: string[] = [];
  const leaves: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown): void => {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) {
      leaves.push(v);
      return;
    }
    if (seen.has(v)) return;
    seen.add(v);
    // Functions are opaque closures: do not descend (Function.prototype has throwing accessors).
    if (typeof v === 'function') return;
    if (v instanceof Uint8Array) {
      leaves.push(v);
      return;
    }
    for (const k of Reflect.ownKeys(v)) {
      keys.push(String(k));
      visit((v as Record<string | symbol, unknown>)[k]);
    }
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto && proto !== Object.prototype && proto !== Function.prototype) visit(proto);
  };
  visit(root);
  return { keys, leaves };
}

describe('A2: the session object does not expose secrets', () => {
  it('has no privateKey / seed / mnemonic / secret property at any depth', async () => {
    const s = await open();
    const info = s.getPublicInfo(0);
    const { keys } = walk({ session: s, info });
    // `revealMnemonic` is the one documented FUNCTION (gated by re-auth); no other name may
    // look like secret data. Function-ness of every member is asserted in the next test.
    for (const k of keys.filter((name) => name !== 'revealMnemonic')) {
      expect(k.toLowerCase()).not.toMatch(/private|seed|mnemonic|secret|vaultkey/);
    }
  });

  it('exposes exactly the documented functions and nothing else', async () => {
    const s = await open();
    expect(Object.keys(s).sort()).toEqual(
      ['getPublicInfo', 'lock', 'reauthenticate', 'revealMnemonic', 'signDigest'].sort(),
    );
    for (const v of Object.values(s)) expect(typeof v).toBe('function');
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('JSON.stringify of session and public info contains no key bytes or mnemonic', async () => {
    const s = await open();
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const secrets = [
      bytesToHex(seed),
      bytesToHex(deriveTonKey(seed).privateKey),
      bytesToHex(deriveTronKey(seed).privateKey),
      bytesToHex(deriveEvmKey(seed).privateKey),
    ];
    const json = JSON.stringify({ s, info: s.getPublicInfo(0), seal: undefined }).toLowerCase();
    for (const secret of secrets) expect(json).not.toContain(secret);
    expect(json).not.toContain('junk');
  });

  it('no reachable Uint8Array value equals a private key or the seed', async () => {
    const s = await open();
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const secretHex = new Set([
      bytesToHex(seed),
      bytesToHex(deriveTonKey(seed).privateKey),
      bytesToHex(deriveTronKey(seed).privateKey),
      bytesToHex(deriveEvmKey(seed).privateKey),
    ]);
    const { leaves } = walk({ s, info: s.getPublicInfo(0), got: getSession() });
    for (const leaf of leaves) {
      if (leaf instanceof Uint8Array) expect(secretHex.has(bytesToHex(leaf))).toBe(false);
      if (typeof leaf === 'string') {
        for (const secret of secretHex) expect(leaf.toLowerCase()).not.toContain(secret);
      }
    }
  });

  it('getPublicInfo returns a copy: mutating it does not affect later calls', async () => {
    const s = await open();
    const a = s.getPublicInfo(0);
    if (!a?.evm) throw new Error('expected info');
    a.evm.rawAddress = 'tampered';
    expect(s.getPublicInfo(0)?.evm?.rawAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('getPublicInfo matches independently derived public material', async () => {
    const s = await open();
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const info = s.getPublicInfo(0);
    expect(info?.evm?.rawAddress).toBe(deriveEvmKey(seed).rawAddress);
    expect(info?.ton.publicKeyHex).toBe(deriveTonKey(seed).publicKeyHex);
    expect(info?.tron?.hexAddress).toBe(deriveTronKey(seed).hexAddress);
  });

  it('B1: getPublicInfo exposes checksummed EVM, base58 TRON and V5R1 TON addresses', async () => {
    const s = await open();
    const info = s.getPublicInfo(0);
    if (!info?.evm || !info.tron) throw new Error('expected info');
    // Hardhat mnemonic first account: published EIP-55 address.
    expect(info.evm.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(isValidEvmAddress(info.evm.address)).toBe(true);
    expect(info.tron.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(isValidTronAddress(info.tron.address)).toBe(true);
    expect(info.ton.addressRaw).toMatch(/^0:[0-9a-f]{64}$/);
    expect(info.ton.addressBounceable.startsWith('EQ')).toBe(true);
    expect(info.ton.addressNonBounceable.startsWith('UQ')).toBe(true);
    expect(info.ton.addressTestnetNonBounceable.startsWith('0Q')).toBe(true);
    expect(validateTonAddress(info.ton.addressNonBounceable).valid).toBe(true);
    // Mutating the returned copy must not change later calls.
    info.evm.address = 'tampered';
    expect(s.getPublicInfo(0)?.evm?.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('getPublicInfo rejects invalid account indexes', async () => {
    const s = await open();
    for (const bad of [-1, 1.5, 2 ** 31, Number.NaN]) expect(s.getPublicInfo(bad)).toBeNull();
  });
});

describe('A2: signatures verify against the public key (noble)', () => {
  it('TON: Ed25519 signature verifies', async () => {
    const s = await open();
    const r = s.signDigest('ton', 0, DIGEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signature).toHaveLength(64);
    const pub = hexToBytes(s.getPublicInfo(0)?.ton.publicKeyHex ?? '');
    expect(ed25519.verify(r.signature, DIGEST, pub)).toBe(true);
    const other = sha256(new TextEncoder().encode('other'));
    expect(ed25519.verify(r.signature, other, pub)).toBe(false);
  });

  it.each(['tron', 'evm'] as const)(
    '%s: recoverable secp256k1 signature verifies and recovers',
    async (chain) => {
      const s = await open();
      const r = s.signDigest(chain, 0, DIGEST);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.signature).toHaveLength(65);
      const pubHex = s.getPublicInfo(0)?.[chain]?.publicKeyHex ?? '';
      const compact = r.signature.slice(0, 64);
      expect(secp256k1.verify(compact, DIGEST, hexToBytes(pubHex), { lowS: true })).toBe(true);
      // Independent recovery with viem (not the signer's own library).
      const recovered = await recoverPublicKey({
        hash: ('0x' + bytesToHex(DIGEST)) as Hex,
        signature: ('0x' + bytesToHex(r.signature)) as Hex,
      });
      const compressed = secp256k1.Point.fromHex(recovered.slice(2)).toHex(true);
      expect(compressed).toBe(pubHex);
    },
  );

  it('account 1 signs with a different key than account 0', async () => {
    const s = await open();
    const r = s.signDigest('ton', 1, DIGEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pub0 = hexToBytes(s.getPublicInfo(0)?.ton.publicKeyHex ?? '');
    const pub1 = hexToBytes(s.getPublicInfo(1)?.ton.publicKeyHex ?? '');
    expect(ed25519.verify(r.signature, DIGEST, pub1)).toBe(true);
    expect(ed25519.verify(r.signature, DIGEST, pub0)).toBe(false);
  });

  it('validates chain, digest length/type and account index', async () => {
    const s = await open();
    expect(s.signDigest('btc' as never, 0, DIGEST)).toEqual({ ok: false, error: 'invalid_chain' });
    expect(s.signDigest('evm', 0, new Uint8Array(31))).toEqual({
      ok: false,
      error: 'invalid_digest',
    });
    expect(s.signDigest('evm', 0, new Uint8Array(33))).toEqual({
      ok: false,
      error: 'invalid_digest',
    });
    expect(s.signDigest('evm', 0, 'x' as never)).toEqual({ ok: false, error: 'invalid_digest' });
    expect(s.signDigest('evm', -1, DIGEST)).toEqual({ ok: false, error: 'invalid_account' });
    expect(s.signDigest('evm', 0.5, DIGEST)).toEqual({ ok: false, error: 'invalid_account' });
  });
});

describe('A2: lock', () => {
  it('signing after lock fails with locked, and getPublicInfo returns null', async () => {
    const s = await open();
    expect(s.signDigest('evm', 0, DIGEST).ok).toBe(true);
    s.lock();
    expect(s.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    expect(s.signDigest('ton', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    expect(s.getPublicInfo(0)).toBeNull();
    expect(getSession()).toBeNull();
  });

  it('lockSession() locks the same session object', async () => {
    const s = await open();
    expect(getSession()).toBe(s);
    lockSession();
    expect(s.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
  });

  it('a new unlock locks the previous session', async () => {
    const first = await open();
    const second = await open();
    expect(first.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    expect(second.signDigest('evm', 0, DIGEST).ok).toBe(true);
  });

  it('inactivity timeout locks the session', async () => {
    vi.useFakeTimers();
    const { setInactivityTimeout } = await import('./session');
    setInactivityTimeout(1000);
    const s = await open();
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    setInactivityTimeout(300000);
  });

  it('reauthenticate and revealMnemonic fail after lock', async () => {
    const s = await open();
    s.lock();
    expect(await s.reauthenticate(PASS)).toEqual({ ok: false, error: 'locked' });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'locked' });
  });

  it('locking while a reauthenticate is in flight does not open a reveal window', async () => {
    const s = await open();
    const pending = s.reauthenticate(PASS);
    s.lock();
    expect(await pending).toEqual({ ok: false, error: 'locked' });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'locked' });
  });
});

describe('A2: revealMnemonic requires fresh re-authentication', () => {
  let storage: InMemoryStorage;
  let s: VaultSession;
  beforeEach(async () => {
    storage = new InMemoryStorage();
    const r = await unlockSession(seal, PASS, storage);
    if (!r.success) throw new Error('unlock failed');
    s = r.session;
  });

  it('fails without re-auth', () => {
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('wrong passcode does not open the window', async () => {
    expect(await s.reauthenticate('wrong passphrase')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('succeeds once after re-auth, then fails on the second call', async () => {
    expect(await s.reauthenticate(PASS)).toEqual({ ok: true });
    expect(s.revealMnemonic()).toEqual({ ok: true, mnemonic: MNEMONIC_12_HARDHAT });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('a second reveal needs a second re-auth', async () => {
    await s.reauthenticate(PASS);
    s.revealMnemonic();
    expect(s.revealMnemonic().ok).toBe(false);
    await s.reauthenticate(PASS);
    expect(s.revealMnemonic().ok).toBe(true);
  });

  it('the window expires after reauthWindowMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const r = await unlockSession(seal, PASS, new InMemoryStorage(), { reauthWindowMs: 60_000 });
    if (!r.success) throw new Error('unlock failed');
    expect(await r.session.reauthenticate(PASS)).toEqual({ ok: true });
    vi.advanceTimersByTime(60_001);
    expect(r.session.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('a failed re-auth after a successful one closes the open window', async () => {
    await s.reauthenticate(PASS);
    await s.reauthenticate('wrong passphrase');
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('re-auth runs a real passcode check (fresh Argon2id), not a cached comparison', async () => {
    // The session holds no passcode: a different valid-looking passcode cannot succeed.
    expect(await s.reauthenticate(PASS + ' ')).toEqual({ ok: false, error: 'wrong_passcode' });
  });
});
```

## packages/crypto-vault/src/vault-manager.test.ts

```typescript
/**
 * A9: VaultManager end-to-end against in-memory adapters.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { VaultManager } from './vault-manager';
import { InMemoryStorage, STORAGE_KEYS } from './storage';
import { mnemonicToSeed } from './mnemonic';
import { deriveEvmKey } from './derivation';
import { loadSeal } from './seal-store';
import { lockSession } from './session';
import { MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'my passphrase 1';
const PASS2 = 'my passphrase 2';

function makeManager(withSecure: boolean): {
  manager: VaultManager;
  bulk: InMemoryStorage;
  secure: InMemoryStorage;
} {
  const bulk = new InMemoryStorage();
  const secure = new InMemoryStorage();
  const manager = new VaultManager({
    sealStorage: bulk,
    secureStorage: withSecure ? secure : undefined,
    config: FAST,
  });
  return { manager, bulk, secure };
}

afterEach(() => {
  lockSession();
});

describe('A9: VaultManager create/import/unlock', () => {
  it('creates a wallet with a generated 24-word phrase shown once', async () => {
    const { manager } = makeManager(false);
    expect(await manager.hasVault()).toBe(false);
    const created = await manager.createWallet(PASS);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.mnemonic?.split(' ')).toHaveLength(24);
    expect(await manager.hasVault()).toBe(true);
  });

  it('imports a known phrase and unlocks to the matching public material', async () => {
    const { manager } = makeManager(false);
    const imported = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(imported.ok).toBe(true);

    const unlocked = await manager.unlock(PASS);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    const info = unlocked.session.getPublicInfo(0);
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    expect(info?.evm?.rawAddress).toBe(deriveEvmKey(seed).rawAddress);
  });

  it('rejects a second wallet while one exists', async () => {
    const { manager } = makeManager(false);
    await manager.createWallet(PASS);
    expect(await manager.createWallet(PASS)).toEqual({ ok: false, error: 'vault_exists' });
  });

  it('rejects an invalid imported phrase', async () => {
    const { manager } = makeManager(false);
    const r = await manager.importWallet('one two three', PASS);
    expect(r).toEqual({ ok: false, error: 'invalid_mnemonic' });
  });

  it('rejects a weak passcode', async () => {
    const { manager } = makeManager(false); // needs 12+ chars
    const r = await manager.importWallet(MNEMONIC_12_HARDHAT, 'short');
    expect(r).toMatchObject({ ok: false, error: 'weak_passcode' });
  });

  it('wrong passcode fails and creates no session', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(await manager.unlock('wrong passphrase')).toMatchObject({
      success: false,
      error: 'wrong_passcode',
    });
    expect(manager.getSession()).toBeNull();
  });
});

describe('A9: device secret placement and loss', () => {
  it('stores the device secret only in the secure adapter', async () => {
    const { manager, bulk, secure } = makeManager(true);
    const created = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(created.ok).toBe(true);
    expect(await secure.get(STORAGE_KEYS.DEVICE_SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(await bulk.get(STORAGE_KEYS.DEVICE_SECRET)).toBeNull();
    const sealed = await loadSeal(bulk);
    expect(sealed.ok && sealed.seal.hasDeviceSecret).toBe(true);
  });

  it('cannot open the seal if the device secret is lost; only re-import recovers', async () => {
    const { manager, secure } = makeManager(true);
    await manager.importWallet(MNEMONIC_24_ABANDON, PASS);

    await secure.clear(); // OS/Telegram cleared SecureStorage

    expect(await manager.unlock(PASS)).toEqual({
      success: false,
      error: 'device_secret_missing',
    });

    // Recovery: wipe the orphaned seal and import the phrase again.
    await manager.wipe();
    expect(await manager.hasVault()).toBe(false);
    const reimported = await manager.importWallet(MNEMONIC_24_ABANDON, PASS);
    expect(reimported.ok).toBe(true);
    expect((await manager.unlock(PASS)).success).toBe(true);
  });
});

describe('A9: changePasscode', () => {
  it('rejects a weak new passcode', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(await manager.changePasscode(PASS, 'short')).toMatchObject({
      ok: false,
      error: 'weak_passcode',
    });
  });

  it('re-seals: new passcode works, old one does not', async () => {
    const { manager, bulk } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const changed = await manager.changePasscode(PASS, PASS2);
    expect(changed.ok).toBe(true);
    expect(await manager.unlock(PASS)).toMatchObject({ success: false, error: 'wrong_passcode' });
    // The failed old-passcode attempt opened a backoff window; let it elapse for this test.
    await bulk.set(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT, '0');
    expect((await manager.unlock(PASS2)).success).toBe(true);
  });

  it('recreates the biometric wrap and returns a fresh token', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const enabled = await manager.enableBiometric(PASS);
    expect(enabled.ok).toBe(true);

    const changed = await manager.changePasscode(PASS, PASS2);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.biometricToken).toMatch(/^[0-9a-f]{64}$/);

    // The old token is invalid; the new one opens the seal with the new passcode's vault key.
    expect((await manager.unlockWithBiometric(changed.biometricToken ?? '')).success).toBe(true);
  });
});

describe('A9: biometrics through the manager', () => {
  it('enable -> unlockWithBiometric -> disable requires the passcode', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);

    const enabled = await manager.enableBiometric(PASS);
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    expect((await manager.unlockWithBiometric(enabled.token)).success).toBe(true);
    manager.lock();

    expect(await manager.disableBiometric('wrong passphrase')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
    expect(await manager.disableBiometric(PASS)).toEqual({ ok: true });
    expect(await manager.unlockWithBiometric(enabled.token)).toMatchObject({
      success: false,
      error: 'biometric_not_enabled',
    });
  });
});

describe('A9: wipe', () => {
  it('removes the seal and device secret', async () => {
    const { manager, bulk, secure } = makeManager(true);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    await manager.wipe();
    expect(await manager.hasVault()).toBe(false);
    expect(await bulk.get(STORAGE_KEYS.SEAL)).toBeNull();
    expect(await secure.get(STORAGE_KEYS.DEVICE_SECRET)).toBeNull();
  });
});
```

## packages/crypto-vault/src/index.test.ts

```typescript
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
```

## apps/miniapp/src/test/helpers/secret-scan.ts

```typescript
/**
 * Secret scanner for build output.
 *
 * Fails closed: a missing directory, a non-directory, or a directory with no
 * scannable files is an error (never a vacuous pass).
 *
 * The rules look for secret VALUES, not identifier names. Libraries such as
 * @scure/bip32 legitimately contain property names like `xpriv`, so a bare
 * substring match on names would be a false positive.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * SHA-256 of long hex literals that are known NOT to be secrets, keyed by the exact literal.
 * Hashing the match (rather than allowlisting a prefix) means any change to the literal fails
 * the scan and forces a review.
 *
 * - 4692…886a: the Wallet V5R1 contract code cell (BOC hex) embedded by @ton/ton (MIT). It is
 *   public contract code, not key material. Source: @ton/ton WalletContractV5R1 constructor.
 */
export const ALLOWED_HEX_LITERALS_SHA256 = new Set([
  '469237e482c1835b5eaf4e0c9dbaae1cc825f6f5e90f547d85b93ec94a12886a',
]);

export interface ScanRule {
  pattern: RegExp;
  reason: string;
}

export const SECRET_RULES: ScanRule[] = [
  // 11 x "abandon" + "about" = the 12-word BIP-39 test mnemonic. (The previous pattern needed
  // 12 x "abandon" and so could never match it; caught by secret-scan.test.ts.)
  { pattern: /abandon (?:abandon ){10}about/, reason: 'BIP-39 test mnemonic (12 words)' },
  {
    pattern: /test test test test test test test test test test test junk/,
    reason: 'Hardhat default test mnemonic',
  },
  { pattern: /[0-9a-f]{128,}/i, reason: '512+ bit hex string (possible seed or private key)' },
  {
    pattern: /\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,}/,
    reason: 'BIP-32 extended private key value',
  },
  {
    pattern: /-----BEGIN (?:EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    reason: 'PEM-encoded private key',
  },
  { pattern: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}/, reason: 'Stripe secret key' },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,}/,
    reason: 'GitHub token',
  },
  { pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, reason: 'Telegram bot token' },
];

export const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.html', '.css', '.map', '.json'];

/** Recursively collect files with one of the extensions. Throws if `dir` is not a directory. */
export function collectFiles(dir: string, exts: string[] = DEFAULT_EXTENSIONS): string[] {
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new Error(`Scan directory does not exist: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Scan target is not a directory: ${dir}`);
  }
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scan every file under `dir`. Returns issue strings (file + reason; never the
 * matched text). Throws if the directory is missing or contains no scannable files.
 */
export function scanDirectory(dir: string, exts: string[] = DEFAULT_EXTENSIONS): string[] {
  const files = collectFiles(dir, exts);
  if (files.length === 0) {
    throw new Error(`Scan directory has no scannable files (${exts.join(', ')}): ${dir}`);
  }
  const issues: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    for (const rule of SECRET_RULES) {
      if (rule.reason.includes('hex string')) {
        // Long hex: allow only exact reviewed literals (hashed), so the rule still catches any
        // other 512+ bit hex value. Compare case-insensitively because hex constants vary.
        const re = new RegExp(rule.pattern.source, 'gi');
        for (const match of content.matchAll(re)) {
          const hash = createHash('sha256').update(match[0].toLowerCase()).digest('hex');
          if (!ALLOWED_HEX_LITERALS_SHA256.has(hash)) {
            issues.push(`${file}: ${rule.reason}`);
            break;
          }
        }
        continue;
      }
      if (rule.pattern.test(content)) {
        issues.push(`${file}: ${rule.reason}`);
      }
    }
  }
  return issues;
}
```

## apps/miniapp/src/test/helpers/secret-scan.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirectory, collectFiles } from './secret-scan';

describe('secret scanner (negative tests: it must catch injected secrets)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scan-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when the directory does not exist (no vacuous pass)', () => {
    expect(() => scanDirectory(join(dir, 'missing'))).toThrow(/does not exist/);
  });

  it('throws when the directory has no scannable files (no vacuous pass)', () => {
    writeFileSync(join(dir, 'notes.txt'), 'nothing to scan');
    expect(() => scanDirectory(dir)).toThrow(/no scannable files/);
  });

  it('passes on clean content', () => {
    writeFileSync(join(dir, 'a.js'), 'console.log("hello");');
    expect(scanDirectory(dir)).toEqual([]);
  });

  it('does NOT flag library identifier names such as xpriv (false-positive regression)', () => {
    writeFileSync(join(dir, 'a.js'), 'return HDKey.fromExtendedKey(json.xpriv);');
    expect(scanDirectory(dir)).toEqual([]);
  });

  it('catches an injected 12-word test mnemonic', () => {
    writeFileSync(join(dir, 'a.js'), `x="${'abandon '.repeat(11)}about"`);
    expect(scanDirectory(dir).join('\n')).toContain('BIP-39 test mnemonic');
  });

  it('catches an injected long hex string', () => {
    writeFileSync(join(dir, 'nested.js'), `x="${'ab'.repeat(64)}"`);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.js'), `x="${'cd'.repeat(64)}"`);
    const issues = scanDirectory(dir);
    expect(issues.some((i) => i.includes('nested.js') && i.includes('hex'))).toBe(true);
    expect(issues.some((i) => i.includes('b.js') && i.includes('hex'))).toBe(true);
  });

  it('catches an injected GitHub token and PEM key', () => {
    writeFileSync(join(dir, 'a.js'), `t="ghp_${'A'.repeat(36)}"`);
    writeFileSync(join(dir, 'b.html'), '-----BEGIN EC PRIVATE KEY-----');
    const issues = scanDirectory(dir).join('\n');
    expect(issues).toContain('GitHub token');
    expect(issues).toContain('PEM-encoded private key');
  });

  it('issue strings never contain the matched secret text', () => {
    const hex = 'ab'.repeat(64);
    writeFileSync(join(dir, 'a.js'), `x="${hex}"`);
    expect(scanDirectory(dir).join('\n')).not.toContain(hex);
  });

  it('collectFiles throws when the target is a file, not a directory', () => {
    const f = join(dir, 'a.js');
    writeFileSync(f, '1');
    expect(() => collectFiles(f)).toThrow(/not a directory/);
  });
});
```

## apps/miniapp/src/test/sdk-smoke.test.ts

```typescript
/**
 * B3: smoke test of @telegram-apps/sdk in a mocked environment under the valibot override.
 *
 * This proves the SDK loads, initializes, mocks launch params and cleans up without throwing.
 * It does NOT prove behaviour inside a real Telegram client (manual checks remain).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  init,
  isTMA,
  mockTelegramEnv,
  retrieveLaunchParams,
  retrieveRawLaunchParams,
} from '@telegram-apps/sdk';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('B3: @telegram-apps/sdk smoke test', () => {
  it('imports the expected functions', () => {
    expect(typeof init).toBe('function');
    expect(typeof retrieveLaunchParams).toBe('function');
    expect(typeof mockTelegramEnv).toBe('function');
  });

  it('isTMA returns a boolean without throwing', () => {
    expect(typeof isTMA()).toBe('boolean');
  });

  it('initializes against a mocked environment and reads launch params', () => {
    mockTelegramEnv({
      launchParams: {
        tgWebAppVersion: '10.0',
        tgWebAppPlatform: 'tdesktop',
        tgWebAppThemeParams: {},
      },
      resetPostMessage: true,
    });
    cleanups.push(init({ acceptCustomStyles: false }));

    const params = retrieveLaunchParams();
    expect(params.tgWebAppVersion).toBe('10.0');
    expect(params.tgWebAppPlatform).toBe('tdesktop');
    expect(retrieveRawLaunchParams()).toContain('tgWebAppVersion=10.0');
    expect(isTMA()).toBe(true);
  });
});
```

## apps/miniapp/playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  // 'never' so a failing local run does not block waiting on a report server.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // e2e-prepare builds dist/ and .e2e/vault-bundle.js, so a fresh clone needs no manual step.
    command: 'node scripts/e2e-prepare.mjs && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Never reuse: a stale server could serve an old build and hide failures.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
```

