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
import { mnemonicToSeed, normalizeMnemonic, validateMnemonicPhrase } from './mnemonic';

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
export const VAULT_FORMAT_VERSION = 4;

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
): Uint8Array {
  return new TextEncoder().encode(
    [
      'onezerowallet/vault',
      `role=${role}`,
      `v=${String(version)}`,
      `t=${String(params.argon2TimeCost)}`,
      `m=${String(params.argon2MemoryCost)}`,
      `p=${String(params.argon2Parallelism)}`,
      `ds=${hasDeviceSecret ? '1' : '0'}`,
    ].join('|'),
  );
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

/** Parse the v3/v4 field set (identical apart from the optional biometric wrap). */
function parseSealBody(s: Record<string, unknown>, version: number): ParsedSeal | null {
  const hasDeviceSecret = s['hasDeviceSecret'];
  if (typeof hasDeviceSecret !== 'boolean') return null;

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
      buildAad('seed', version, hasDeviceSecret, params),
    );
    const mnemonicEnc = await aesEncrypt(
      new TextEncoder().encode(mnemonic),
      vaultKey,
      buildAad('mnemonic', version, hasDeviceSecret, params),
    );
    const wrapEnc = await aesEncrypt(
      vaultKey,
      wrappingKey,
      buildAad('vault-key', version, hasDeviceSecret, params),
    );

    return {
      version,
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
): Promise<VaultSeal> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonicPhrase(normalized).valid) {
    throw new Error('INVALID_MNEMONIC');
  }
  const seed = mnemonicToSeed(normalized);
  try {
    return await sealVault(seed, normalized, passcode, deviceSecret, config);
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
      buildAad('seed', p.version, p.hasDeviceSecret, p.params),
    );
    mnemonicBytes = await aesDecrypt(
      p.mnemonicCt,
      vaultKey,
      p.mnemonicIv,
      buildAad('mnemonic', p.version, p.hasDeviceSecret, p.params),
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

  const derived = mnemonicToSeed(normalizeMnemonic(mnemonic));
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
        buildAad('vault-key', p.version, p.hasDeviceSecret, p.params),
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
        buildAad('vault-key', p.version, p.hasDeviceSecret, p.params),
      );
    } catch {
      return { ok: false, error: 'wrong_passcode' };
    }

    const token = globalThis.crypto.getRandomValues(new Uint8Array(BIOMETRIC_TOKEN_BYTES));
    bioKey = biometricWrapKeyFromToken(token, p.hasDeviceSecret ? deviceSecret : undefined);
    const wrapEnc = await aesEncrypt(
      vaultKey,
      bioKey,
      buildAad('biometric-key', p.version, p.hasDeviceSecret, p.params),
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
        buildAad('biometric-key', p.version, p.hasDeviceSecret, p.params),
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
  if (version !== 1 && version !== 2 && version !== 3) {
    return legacyFailure('unsupported_version');
  }
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
  if (version === 2 || version === 3) {
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
    // Every legacy version was written with the old combination; v4 is the first to use
    // conventional HKDF.
    wrappingKey = await deriveLegacyV3WrappingKey(
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
        version === 3 ? buildAad('vault-key', version, hasDeviceSecret, params) : new Uint8Array(0),
      );
    } catch {
      return legacyFailure('wrong_passcode');
    }

    let recovered: string | undefined;
    try {
      const seedAad =
        version === 3
          ? buildAad('seed', version, hasDeviceSecret, params)
          : (storedAad as Uint8Array);
      seed = await aesDecrypt(seedCt, vaultKey, seedIv, seedAad);
      if (storedMnemonicCt && storedMnemonicIv) {
        const mnAad =
          version === 3
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

    const newSeal = await sealVault(seed, normalized, passcode, deviceSecret, params);
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
