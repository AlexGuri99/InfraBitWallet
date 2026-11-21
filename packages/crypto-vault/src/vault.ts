/**
 * Vault module — encrypts/decrypts the BIP-39 seed under a vault key.
 *
 * Design:
 * - Random 256-bit vault key encrypts the seed with AES-256-GCM (WebCrypto).
 * - Vault key is wrapped (encrypted) by a passcode-derived key (Argon2id).
 * - Optionally the passcode-derived key is COMBINED with a device-specific
 *   secret (via HKDF-SHA256) so that BOTH factors are required. Neither the
 *   passcode nor the device secret alone can unwrap the vault key.
 * - Optionally also wrapped by a biometric secret (Telegram BiometricManager).
 * - The seal binds its version and KDF parameters as AAD so tampering with
 *   stored parameters causes decryption to fail.
 * - Version 2 also stores an encrypted mnemonic phrase for re-display of the
 *   recovery phrase after unlock ("test your backup").
 *
 * Sources:
 * - AES-256-GCM: NIST SP 800-38D
 * - Web Crypto API: https://www.w3.org/TR/WebCryptoAPI/
 * - Argon2id: RFC 9106
 * - HKDF: RFC 5869
 * - hash-wasm: https://github.com/Daninet/hash-wasm (MIT, fetched 2026-11-20)
 */
import { argon2id } from 'hash-wasm';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { mnemonicToSeed, normalizeMnemonic, validateMnemonicPhrase } from './mnemonic';

// ---------------------------------------------------------------------------
// Types
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

/**
 * VaultSeal — the persisted data envelope.
 *
 * Security properties:
 * - `passcodeWrappedKey`: when `hasDeviceSecret` is false, this is the vault
 *   key encrypted with the passcode-derived key alone (iv || ciphertext, hex).
 *   When `hasDeviceSecret` is true, this is the vault key encrypted with the
 *   HKDF-combined key (passcodeKey + deviceSecret). There is NO copy that
 *   unlocks with the passcode alone.
 * - `deviceWrappedKey` is NOT stored. The device secret is stored in
 *   SecureStorage and combined at runtime. The seal only records that it
 *   is needed via `hasDeviceSecret`.
 * - Version 2 adds `encryptedMnemonic` and `mnemonicIv` for re-display of
 *   the recovery phrase after unlock.
 */
export interface VaultSeal {
  /** Vault key wrapped by passcode-derived key (or combined key if hasDeviceSecret) (hex: iv || ciphertext) */
  passcodeWrappedKey: string;
  /** True if the device secret is required for unwrapping. If true, passcode alone cannot unwrap. */
  hasDeviceSecret: boolean;
  /** Biometric-wrapped vault key (hex, optional) */
  biometricWrappedKey?: string;
  /** AES-GCM encrypted seed (hex) */
  encryptedSeed: string;
  /** AES-GCM IV used for seed encryption (hex) */
  iv: string;
  /** AES-GCM AAD (additional authenticated data) — version + params as JSON (hex) */
  aad: string;
  /** Vault format version for parameter migration */
  version: number;
  /** Argon2id salt for passcode derivation (hex) */
  passcodeSalt: string;
  /** Argon2id parameters used */
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
  /** AES-GCM encrypted mnemonic phrase (UTF-8 bytes, hex) — v2+ */
  encryptedMnemonic?: string;
  /** AES-GCM IV used for mnemonic encryption (hex) — v2+ */
  mnemonicIv?: string;
}

export type VaultUnlockResult =
  | { success: true; seed: Uint8Array; mnemonic?: string }
  | {
      success: false;
      error: 'wrong_passcode' | 'device_secret_missing' | 'tampered_data' | 'kdf_unavailable';
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex2bytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toUint8Array(buf: ArrayBuffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf, 0, buf.byteLength);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// AES-256-GCM with AAD support
// ---------------------------------------------------------------------------

async function aes256GcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad?: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encryptParams: AesGcmParams & { additionalData?: BufferSource } = {
    name: 'AES-GCM',
    iv,
  };
  if (aad) encryptParams.additionalData = aad as BufferSource;
  const encrypted = await globalThis.crypto.subtle.encrypt(
    encryptParams,
    cryptoKey,
    plaintext as BufferSource,
  );
  return { ciphertext: toUint8Array(encrypted), iv };
}

async function aes256GcmDecrypt(
  ciphertext: BufferSource,
  key: BufferSource,
  iv: BufferSource,
  aad?: BufferSource,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decryptParams: AesGcmParams & { additionalData?: BufferSource } = {
    name: 'AES-GCM',
    iv,
  };
  if (aad) decryptParams.additionalData = aad;
  const decrypted = await globalThis.crypto.subtle.decrypt(decryptParams, cryptoKey, ciphertext);
  return toUint8Array(decrypted);
}

// ---------------------------------------------------------------------------
// Passcode key derivation (Argon2id)
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit key from a passcode using Argon2id.
 *
 * Returns null if Argon2id is unavailable (WASM not loaded).
 * The caller MUST fail closed when null is returned.
 */
async function derivePasscodeKey(
  passcode: string,
  salt: Uint8Array,
  config: Required<VaultConfig>,
): Promise<Uint8Array | null> {
  try {
    const normalized = passcode.normalize('NFKD');
    const result = await argon2id({
      password: normalized,
      salt,
      parallelism: config.argon2Parallelism,
      iterations: config.argon2TimeCost,
      memorySize: config.argon2MemoryCost,
      hashLength: 32,
      outputType: 'binary',
    });
    return result;
  } catch {
    return null;
  }
}

/**
 * Combine a passcode-derived key with a device secret via HKDF-SHA256.
 * Produces a 32-byte output key that requires both inputs.
 */
function combineWithDeviceSecret(passcodeKey: Uint8Array, deviceSecret: Uint8Array): Uint8Array {
  return hkdf(sha256, passcodeKey, deviceSecret, 'onezerowallet-vault-combined', 32);
}

/**
 * Encode the AAD payload: a JSON string of parameters that, if tampered with
 * in storage, should make the GCM decryption fail.
 */
function encodeAad(version: number, config: Required<VaultConfig>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      v: version,
      t: config.argon2TimeCost,
      m: config.argon2MemoryCost,
      p: config.argon2Parallelism,
    }),
  );
}

// ---------------------------------------------------------------------------
// Vault operations
// ---------------------------------------------------------------------------

/**
 * Seal the vault.
 *
 * @param seed - 64-byte BIP-39 seed
 * @param passcode - User's passcode
 * @param deviceSecret - Optional 32-byte device secret (stored in SecureStorage by caller)
 * @param config - Optional Argon2id parameters
 * @param mnemonic - Optional mnemonic phrase (v2+). If provided, it is encrypted and
 *   stored for re-display after unlock.
 * @returns The vault seal
 */
export async function sealVault(
  seed: Uint8Array,
  passcode: string,
  deviceSecret?: Uint8Array,
  config?: VaultConfig,
  mnemonic?: string,
): Promise<VaultSeal> {
  const cfg = { ...DEFAULT_VAULT_CONFIG, ...config };
  const vaultKey = globalThis.crypto.getRandomValues(new Uint8Array(32));

  // Determine version: v2 if mnemonic is provided, otherwise v1
  const version = mnemonic !== undefined ? 2 : 1;

  // Encode AAD: version + params so stored parameters cannot be tampered with
  const aad = encodeAad(version, cfg);

  // Encrypt seed with vault key (AAD-bound)
  const { ciphertext: encryptedSeed, iv } = await aes256GcmEncrypt(seed, vaultKey, aad);

  // Encrypt mnemonic if provided (v2+)
  const seal: VaultSeal = {
    version,
    encryptedSeed: bytesToHex(encryptedSeed),
    iv: bytesToHex(iv),
    aad: bytesToHex(aad),
    passcodeWrappedKey: '',
    hasDeviceSecret: false,
    passcodeSalt: '',
    argon2TimeCost: cfg.argon2TimeCost,
    argon2MemoryCost: cfg.argon2MemoryCost,
    argon2Parallelism: cfg.argon2Parallelism,
  };
  if (mnemonic !== undefined) {
    const mnemonicBytes = new TextEncoder().encode(mnemonic);
    const { ciphertext: mnemonicCt, iv: mnemonicIvRaw } = await aes256GcmEncrypt(
      mnemonicBytes,
      vaultKey,
      aad,
    );
    seal.encryptedMnemonic = bytesToHex(mnemonicCt);
    seal.mnemonicIv = bytesToHex(mnemonicIvRaw);
  }

  // Derive passcode key
  const passcodeSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const passcodeKey = await derivePasscodeKey(passcode, passcodeSalt, cfg);
  if (!passcodeKey) {
    vaultKey.fill(0);
    throw new Error('KDF_UNAVAILABLE');
  }

  // Choose the wrapping key: combined with device secret or passcode alone
  let wrappingKey: Uint8Array;
  if (deviceSecret !== undefined) {
    const combined = combineWithDeviceSecret(passcodeKey, deviceSecret);
    wrappingKey = combined;
  } else {
    wrappingKey = passcodeKey;
  }
  const hasDeviceSecret = deviceSecret !== undefined;

  // Wrap vault key with wrapping key
  const { ciphertext: wrappedCt, iv: wrapIv } = await aes256GcmEncrypt(vaultKey, wrappingKey);

  const combined = new Uint8Array(wrapIv.length + wrappedCt.length);
  combined.set(wrapIv, 0);
  combined.set(wrappedCt, wrapIv.length);

  // Zero intermediate keys
  wrappingKey.fill(0);
  passcodeKey.fill(0);
  vaultKey.fill(0);

  seal.passcodeWrappedKey = bytesToHex(combined);
  seal.hasDeviceSecret = hasDeviceSecret;
  seal.passcodeSalt = bytesToHex(passcodeSalt);
  return seal;
}

/**
 * Unseal the vault.
 *
 * @param seal - The vault seal
 * @param passcode - User's passcode
 * @param deviceSecret - The device secret from SecureStorage (required if seal.hasDeviceSecret)
 * @returns Decrypted seed (and mnemonic if version >= 2) or error
 */
export async function unsealVault(
  seal: VaultSeal,
  passcode: string,
  deviceSecret?: Uint8Array,
): Promise<VaultUnlockResult> {
  try {
    // Derive passcode key
    const passcodeSalt = hex2bytes(seal.passcodeSalt);
    const passcodeKey = await derivePasscodeKey(passcode, passcodeSalt, {
      argon2TimeCost: seal.argon2TimeCost,
      argon2MemoryCost: seal.argon2MemoryCost,
      argon2Parallelism: seal.argon2Parallelism,
    });

    if (!passcodeKey) {
      return { success: false, error: 'kdf_unavailable' };
    }

    // If device secret is required, check it
    if (seal.hasDeviceSecret) {
      if (!deviceSecret || deviceSecret.length === 0) {
        passcodeKey.fill(0);
        return { success: false, error: 'device_secret_missing' };
      }
    }

    // Re-derive the wrapping key (same as during seal)
    let wrappingKey: Uint8Array;
    if (seal.hasDeviceSecret && deviceSecret) {
      wrappingKey = combineWithDeviceSecret(passcodeKey, deviceSecret);
      passcodeKey.fill(0);
    } else {
      wrappingKey = passcodeKey;
    }

    // Unwrap vault key
    const wrappedKeyBuf = hex2bytes(seal.passcodeWrappedKey);
    const wrapIv = wrappedKeyBuf.slice(0, 12);
    const wrappedKeyCt = wrappedKeyBuf.slice(12);

    let vaultKey: Uint8Array<ArrayBuffer>;
    try {
      const unwrapped = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: wrapIv as BufferSource },
        await globalThis.crypto.subtle.importKey(
          'raw',
          wrappingKey as BufferSource,
          { name: 'AES-GCM' },
          false,
          ['decrypt'],
        ),
        wrappedKeyCt,
      );
      vaultKey = toUint8Array(unwrapped);
    } catch {
      wrappingKey.fill(0);
      return { success: false, error: 'wrong_passcode' };
    }

    wrappingKey.fill(0);

    // Decrypt seed (verify AAD)
    let seed: Uint8Array;
    try {
      const aad = hex2bytes(seal.aad);
      seed = await aes256GcmDecrypt(
        hex2bytes(seal.encryptedSeed),
        vaultKey,
        hex2bytes(seal.iv),
        aad,
      );
    } catch {
      vaultKey.fill(0);
      return { success: false, error: 'tampered_data' };
    }

    // Decrypt mnemonic if available (v2+)
    let mnemonic: string | undefined;
    if (
      seal.version >= 2 &&
      seal.encryptedMnemonic !== undefined &&
      seal.mnemonicIv !== undefined
    ) {
      try {
        const aad = hex2bytes(seal.aad);
        const mnemonicBytes = await aes256GcmDecrypt(
          hex2bytes(seal.encryptedMnemonic),
          vaultKey,
          hex2bytes(seal.mnemonicIv),
          aad,
        );
        mnemonic = new TextDecoder().decode(mnemonicBytes);
      } catch {
        vaultKey.fill(0);
        return { success: false, error: 'tampered_data' };
      }
    }

    vaultKey.fill(0);

    if (mnemonic !== undefined) {
      return { success: true, seed, mnemonic };
    }
    return { success: true, seed };
  } catch {
    return { success: false, error: 'tampered_data' };
  }
}

export async function changePasscode(
  seal: VaultSeal,
  oldPasscode: string,
  newPasscode: string,
  deviceSecret?: Uint8Array,
  config?: VaultConfig,
): Promise<VaultSeal | VaultUnlockResult> {
  const unsealResult = await unsealVault(seal, oldPasscode, deviceSecret);
  if (!unsealResult.success) {
    return unsealResult;
  }
  // Pass the mnemonic through so v2 seals remain v2 after passcode change
  const newSeal = await sealVault(
    unsealResult.seed,
    newPasscode,
    deviceSecret,
    config,
    unsealResult.mnemonic,
  );
  unsealResult.seed.fill(0);
  return newSeal;
}

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

export async function addBiometricWrap(
  vaultKey: Uint8Array,
  biometricSecret: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const { ciphertext } = await aes256GcmEncrypt(vaultKey, biometricSecret);
  return bytesToHex(ciphertext);
}

export async function removeBiometricWrap(
  biometricWrappedKey: string,
  biometricSecret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const encrypted = hex2bytes(biometricWrappedKey);
  const iv = encrypted.slice(0, 12);
  const ct = encrypted.slice(12);
  return aes256GcmDecrypt(ct, biometricSecret, iv);
}

/**
 * Public entry point for creating a seal from a mnemonic phrase. The seed is derived inside
 * this module and never returned. Always produces a v2 seal (mnemonic stored for backup checks).
 * Throws if the phrase is invalid.
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
    return await sealVault(seed, passcode, deviceSecret, config, normalized);
  } finally {
    seed.fill(0);
  }
}
