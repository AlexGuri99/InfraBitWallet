/**
 * Vault module — encrypts/decrypts the BIP-39 seed and mnemonic under a random vault key.
 *
 * Seal format (version 3):
 * - A random 256-bit vault key encrypts the seed and the mnemonic (AES-256-GCM, WebCrypto),
 *   each with its own random 96-bit IV.
 * - The vault key is wrapped by a key derived from the passcode (Argon2id) and, when the
 *   seal has a device secret, an HKDF-SHA256 combination of the Argon2id output and the
 *   device secret. No stored copy of the vault key opens with the passcode alone in that case.
 * - EVERY ciphertext (seed, mnemonic, wrapped vault key) is authenticated with AAD that is
 *   RECOMPUTED at open time from: format version, Argon2id parameters, the device-secret
 *   flag and a role label ("vault-key" | "seed" | "mnemonic"). Nothing in the seal supplies
 *   the AAD. A ciphertext moved to another role, or opened under a different version or
 *   parameter set, fails GCM authentication.
 *   Note: for the Argon2id parameters the key derivation output also changes, so a parameter
 *   edit is first seen as a failed key unwrap ("wrong_passcode"); the AAD binding is the
 *   second line of defence and is tested directly in vault.test.ts.
 * - The mnemonic is required. After decryption the mnemonic must regenerate the stored seed
 *   (BIP-39, empty passphrase; passphrases are not supported).
 * - Parameters are bounds-checked BEFORE Argon2id runs (see KDF_BOUNDS).
 *
 * Sources:
 * - AES-GCM: NIST SP 800-38D; Web Crypto: https://www.w3.org/TR/WebCryptoAPI/
 * - Argon2id: RFC 9106; HKDF: RFC 5869
 * - hash-wasm: https://github.com/Daninet/hash-wasm (MIT)
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
export const VAULT_FORMAT_VERSION = 3;

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

const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEVICE_SECRET_BYTES = 32;
const SEED_BYTES = 64;
const GCM_TAG_BYTES = 16;
const WRAPPED_KEY_BYTES = IV_BYTES + 32 + GCM_TAG_BYTES;
const SEED_CT_BYTES = SEED_BYTES + GCM_TAG_BYTES;
const MNEMONIC_CT_MIN_BYTES = 1 + GCM_TAG_BYTES;
const MNEMONIC_CT_MAX_BYTES = 1024;

/**
 * VaultSeal v3 — the persisted envelope (all binary fields are hex strings).
 * There is deliberately no `aad` field: AAD is recomputed (see header).
 */
export interface VaultSeal {
  version: number;
  /** Vault key wrapped by the passcode (or passcode+device secret) key: iv(12) || ct(32) || tag(16). */
  passcodeWrappedKey: string;
  /** True if the device secret is required. */
  hasDeviceSecret: boolean;
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

/** Pre-v3 seal (versions 1 and 2): carries a stored `aad`, wrap has no AAD. Migration input only. */
export interface LegacyVaultSeal {
  version: number;
  passcodeWrappedKey: string;
  hasDeviceSecret: boolean;
  biometricWrappedKey?: string;
  encryptedSeed: string;
  iv: string;
  aad: string;
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
  | 'seed_mnemonic_mismatch';

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

export type AadRole = 'vault-key' | 'seed' | 'mnemonic';

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

/** HKDF-SHA256(ikm = passcodeKey, salt = deviceSecret, info = fixed label). Reworked in A10. */
function combineWithDeviceSecret(passcodeKey: Uint8Array, deviceSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, passcodeKey, deviceSecret, 'onezerowallet-vault-combined', 32);
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

// ---------------------------------------------------------------------------
// Seal parsing (strict; nothing is trusted from storage)
// ---------------------------------------------------------------------------

interface ParsedSeal {
  version: number;
  hasDeviceSecret: boolean;
  params: Required<VaultConfig>;
  salt: Uint8Array;
  wrappedKey: Uint8Array;
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

function parseSeal(input: unknown): { ok: true; seal: ParsedSeal } | ParseFailure {
  const malformed: ParseFailure = { ok: false, error: 'malformed_seal' };
  if (typeof input !== 'object' || input === null) return malformed;
  const s = input as Record<string, unknown>;

  const version = s['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) return malformed;
  if (version !== VAULT_FORMAT_VERSION) return { ok: false, error: 'unsupported_version' };

  const hasDeviceSecret = s['hasDeviceSecret'];
  if (typeof hasDeviceSecret !== 'boolean') return malformed;

  const params = readParams(s);
  if (params === null) return malformed;

  const salt = parseHex(s['passcodeSalt'], SALT_BYTES);
  const wrappedKey = parseHex(s['passcodeWrappedKey'], WRAPPED_KEY_BYTES);
  const seedIv = parseHex(s['iv'], IV_BYTES);
  const seedCt = parseHex(s['encryptedSeed'], SEED_CT_BYTES);
  const mnemonicIv = parseHex(s['mnemonicIv'], IV_BYTES);
  const mnemonicCt = parseHex(s['encryptedMnemonic']);
  if (!salt || !wrappedKey || !seedIv || !seedCt || !mnemonicIv || !mnemonicCt) return malformed;
  if (mnemonicCt.length < MNEMONIC_CT_MIN_BYTES || mnemonicCt.length > MNEMONIC_CT_MAX_BYTES) {
    return malformed;
  }

  // Bounds are checked before any KDF work.
  if (!paramsInBounds(params)) return { ok: false, error: 'invalid_params' };

  return {
    ok: true,
    seal: {
      version,
      hasDeviceSecret,
      params,
      salt,
      wrappedKey,
      seedIv,
      seedCt,
      mnemonicIv,
      mnemonicCt,
    },
  };
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
 * Open a v3 seal. INTERNAL: returns the seed, so it is not exported from index.ts.
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
  let seed: Uint8Array | null = null;
  let handedOver = false;
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
      return { success: false, error: 'tampered_data' };
    } finally {
      mnemonicBytes.fill(0);
    }

    const derived = mnemonicToSeed(normalizeMnemonic(mnemonic));
    const matches = constantTimeEqual(derived, seed);
    derived.fill(0);
    if (!matches) return { success: false, error: 'seed_mnemonic_mismatch' };

    handedOver = true;
    return { success: true, seed, mnemonic };
  } finally {
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
    if (!handedOver) seed?.fill(0);
  }
}

/**
 * Re-seal under a new passcode. The vault key is regenerated (new salt, new IVs).
 * (Return type is reworked to a discriminated result in A10.)
 */
export async function changePasscode(
  seal: VaultSeal,
  oldPasscode: string,
  newPasscode: string,
  deviceSecret?: Uint8Array,
  config?: VaultConfig,
): Promise<VaultSeal | VaultUnlockResult> {
  const unsealed = await unsealVault(seal, oldPasscode, deviceSecret);
  if (!unsealed.success) return unsealed;
  try {
    return await sealVault(unsealed.seed, unsealed.mnemonic, newPasscode, deviceSecret, config);
  } finally {
    unsealed.seed.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Legacy (v1/v2) migration
// ---------------------------------------------------------------------------

export type MigrateError = VaultUnsealError | 'mnemonic_required';
export type MigrateResult = { ok: true; seal: VaultSeal } | { ok: false; error: MigrateError };

/**
 * Migrate a v1 or v2 seal (stored `aad`, unauthenticated key wrap) to the current format.
 *
 * - v2 carries its own mnemonic.
 * - v1 never stored one, so the caller must supply the user's recovery phrase; it must
 *   regenerate the stored seed ('seed_mnemonic_mismatch' otherwise, 'mnemonic_required' if absent).
 * The legacy Argon2id parameters must satisfy KDF_BOUNDS (checked before any KDF work).
 * Legacy biometric wraps were non-functional and are dropped (re-enable via the new flow).
 */
export async function migrateLegacySeal(
  legacy: LegacyVaultSeal,
  passcode: string,
  deviceSecret?: Uint8Array,
  mnemonic?: string,
): Promise<MigrateResult> {
  const fail = (error: MigrateError): MigrateResult => ({ ok: false, error });
  const s = legacy as unknown as Record<string, unknown>;

  const version = s['version'];
  if (version !== 1 && version !== 2) return fail('unsupported_version');
  const hasDeviceSecret = s['hasDeviceSecret'];
  if (typeof hasDeviceSecret !== 'boolean') return fail('malformed_seal');
  const params = readParams(s);
  if (params === null) return fail('malformed_seal');

  const salt = parseHex(s['passcodeSalt'], SALT_BYTES);
  const wrappedKey = parseHex(s['passcodeWrappedKey'], WRAPPED_KEY_BYTES);
  const seedIv = parseHex(s['iv'], IV_BYTES);
  const seedCt = parseHex(s['encryptedSeed'], SEED_CT_BYTES);
  const aad = parseHex(s['aad']);
  if (!salt || !wrappedKey || !seedIv || !seedCt || !aad || aad.length > 256) {
    return fail('malformed_seal');
  }
  let storedMnemonicIv: Uint8Array | null = null;
  let storedMnemonicCt: Uint8Array | null = null;
  if (version === 2) {
    storedMnemonicIv = parseHex(s['mnemonicIv'], IV_BYTES);
    storedMnemonicCt = parseHex(s['encryptedMnemonic']);
    if (
      !storedMnemonicIv ||
      !storedMnemonicCt ||
      storedMnemonicCt.length < MNEMONIC_CT_MIN_BYTES ||
      storedMnemonicCt.length > MNEMONIC_CT_MAX_BYTES
    ) {
      return fail('malformed_seal'); // v2 without mnemonic fields: no silent downgrade
    }
  }
  if (!paramsInBounds(params)) return fail('invalid_params');
  if (
    hasDeviceSecret &&
    (deviceSecret === undefined || deviceSecret.length !== DEVICE_SECRET_BYTES)
  ) {
    return fail('device_secret_missing');
  }

  let wrappingKey: Uint8Array | null = null;
  let vaultKey: Uint8Array | null = null;
  let seed: Uint8Array | null = null;
  try {
    wrappingKey = await deriveWrappingKey(
      passcode,
      salt,
      params,
      hasDeviceSecret ? deviceSecret : undefined,
    );
    if (wrappingKey === null) return fail('kdf_unavailable');

    try {
      // Legacy wrap was encrypted without AAD.
      vaultKey = await aesDecrypt(
        wrappedKey.slice(IV_BYTES),
        wrappingKey,
        wrappedKey.slice(0, IV_BYTES),
        new Uint8Array(0),
      );
    } catch {
      return fail('wrong_passcode');
    }

    let recovered: string | undefined;
    try {
      seed = await aesDecrypt(seedCt, vaultKey, seedIv, aad);
      if (storedMnemonicCt && storedMnemonicIv) {
        const bytes = await aesDecrypt(storedMnemonicCt, vaultKey, storedMnemonicIv, aad);
        recovered = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        bytes.fill(0);
      }
    } catch {
      return fail('tampered_data');
    }

    const phrase = recovered ?? mnemonic;
    if (phrase === undefined) return fail('mnemonic_required');
    const normalized = normalizeMnemonic(phrase);
    const derived = mnemonicToSeed(normalized);
    const matches = constantTimeEqual(derived, seed);
    derived.fill(0);
    if (!matches) return fail('seed_mnemonic_mismatch');

    const newSeal = await sealVault(seed, normalized, passcode, deviceSecret, params);
    return { ok: true, seal: newSeal };
  } finally {
    wrappingKey?.fill(0);
    vaultKey?.fill(0);
    seed?.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Passcode policy (reworked in A7)
// ---------------------------------------------------------------------------

export function evaluatePasscodeStrength(passcode: string, hasDeviceSecretWrap: boolean): string {
  if (passcode.length < (hasDeviceSecretWrap ? 4 : 8)) {
    return hasDeviceSecretWrap
      ? 'Passcode must be at least 4 characters'
      : 'Without device-secret locking, passcode must be at least 8 characters';
  }
  if (!hasDeviceSecretWrap && !/\d/.test(passcode)) {
    return 'Without device-secret locking, passcode should include at least one digit';
  }
  return '';
}
