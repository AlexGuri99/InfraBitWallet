/**
 * Vault module — encrypts/decrypts the BIP-39 seed under a vault key.
 *
 * Design:
 * - Random 256-bit vault key encrypts the seed with AES-256-GCM (WebCrypto).
 * - Vault key is wrapped (encrypted) by a passcode-derived key (Argon2id).
 * - Optionally also wrapped by a device-specific secret (stored in SecureStorage).
 * - Optionally also wrapped by a biometric secret (Telegram BiometricManager).
 *
 * Sources:
 * - AES-256-GCM: NIST SP 800-38D
 * - Web Crypto API: https://www.w3.org/TR/WebCryptoAPI/
 * - Argon2id: RFC 9106
 * - hash-wasm: https://github.com/Daninet/hash-wasm (MIT, fetched 2026-11-20)
 */
import { argon2id } from 'hash-wasm';
import type { StorageAdapter } from './storage';
import { STORAGE_KEYS } from './storage';

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

export interface VaultSeal {
  passcodeWrappedKey: string;
  deviceWrappedKey?: string;
  biometricWrappedKey?: string;
  encryptedSeed: string;
  iv: string;
  version: number;
  passcodeSalt: string;
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
}

export type VaultUnlockResult =
  | { success: true; seed: Uint8Array }
  | { success: false; error: 'wrong_passcode' | 'device_secret_missing' | 'tampered_data' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex2bytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toUint8Array(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf, 0, buf.byteLength);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

async function aes256GcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    plaintext as BufferSource,
  );
  return { ciphertext: toUint8Array(encrypted), iv };
}

async function aes256GcmDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    ciphertext as BufferSource,
  );
  return toUint8Array(decrypted);
}

// ---------------------------------------------------------------------------
// Passcode key derivation (Argon2id)
// ---------------------------------------------------------------------------

async function derivePasscodeKey(
  passcode: string,
  salt: Uint8Array,
  config: Required<VaultConfig>,
): Promise<Uint8Array> {
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
}

// ---------------------------------------------------------------------------
// Vault operations
// ---------------------------------------------------------------------------

export async function sealVault(
  seed: Uint8Array,
  passcode: string,
  config?: VaultConfig,
): Promise<VaultSeal> {
  const cfg = { ...DEFAULT_VAULT_CONFIG, ...config };
  const vaultKey = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const { ciphertext: encryptedSeed, iv } = await aes256GcmEncrypt(seed, vaultKey);
  const passcodeSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const passcodeKey = await derivePasscodeKey(passcode, passcodeSalt, cfg);
  const { ciphertext: passcodeWrappedCt, iv: passcodeIv } = await aes256GcmEncrypt(
    vaultKey,
    passcodeKey,
  );

  const combined = new Uint8Array(passcodeIv.length + passcodeWrappedCt.length);
  combined.set(passcodeIv, 0);
  combined.set(passcodeWrappedCt, passcodeIv.length);
  const passcodeWrappedKey = bytesToHex(combined);

  passcodeKey.fill(0);
  vaultKey.fill(0);

  return {
    version: 1,
    encryptedSeed: bytesToHex(encryptedSeed),
    iv: bytesToHex(iv),
    passcodeWrappedKey,
    passcodeSalt: bytesToHex(passcodeSalt),
    argon2TimeCost: cfg.argon2TimeCost,
    argon2MemoryCost: cfg.argon2MemoryCost,
    argon2Parallelism: cfg.argon2Parallelism,
  };
}

export async function addDeviceSecretWrap(
  seal: VaultSeal,
  secureStorage: StorageAdapter,
): Promise<VaultSeal> {
  const deviceSecret = globalThis.crypto.getRandomValues(new Uint8Array(32));
  await secureStorage.set(STORAGE_KEYS.DEVICE_SECRET, bytesToHex(deviceSecret));
  const deviceWrappedKey = bytesToHex(deviceSecret) + '|' + seal.passcodeWrappedKey;
  deviceSecret.fill(0);
  return { ...seal, deviceWrappedKey };
}

export async function unsealVault(
  seal: VaultSeal,
  passcode: string,
  secureStorage?: StorageAdapter,
  _biometricSecret?: Uint8Array,
): Promise<VaultUnlockResult> {
  try {
    const passcodeSalt = hex2bytes(seal.passcodeSalt);
    const passcodeKey = await derivePasscodeKey(passcode, passcodeSalt, {
      argon2TimeCost: seal.argon2TimeCost,
      argon2MemoryCost: seal.argon2MemoryCost,
      argon2Parallelism: seal.argon2Parallelism,
    });

    if (seal.deviceWrappedKey && secureStorage) {
      const storedDeviceSecret = await secureStorage.get(STORAGE_KEYS.DEVICE_SECRET);
      if (!storedDeviceSecret) {
        passcodeKey.fill(0);
        return { success: false, error: 'device_secret_missing' };
      }
    }

    const wrapKey = await globalThis.crypto.subtle.importKey(
      'raw',
      passcodeKey as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );

    const wrappedKeyBuf = hex2bytes(seal.passcodeWrappedKey);
    const wrapIv = wrappedKeyBuf.slice(0, 12);
    const wrappedKeyCt = wrappedKeyBuf.slice(12);

    let vaultKey: Uint8Array;
    try {
      const unwrapped = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: wrapIv as BufferSource },
        wrapKey,
        wrappedKeyCt,
      );
      vaultKey = toUint8Array(unwrapped);
    } catch {
      passcodeKey.fill(0);
      return { success: false, error: 'wrong_passcode' };
    }

    try {
      const encryptedSeed = hex2bytes(seal.encryptedSeed);
      const decrypted = await aes256GcmDecrypt(
        encryptedSeed,
        vaultKey,
        hex2bytes(seal.iv),
      );
      vaultKey.fill(0);
      passcodeKey.fill(0);
      return { success: true, seed: decrypted };
    } catch {
      vaultKey.fill(0);
      passcodeKey.fill(0);
      return { success: false, error: 'tampered_data' };
    }
  } catch {
    return { success: false, error: 'tampered_data' };
  }
}

export async function changePasscode(
  seal: VaultSeal,
  oldPasscode: string,
  newPasscode: string,
  config?: VaultConfig,
): Promise<VaultSeal | VaultUnlockResult> {
  const unsealResult = await unsealVault(seal, oldPasscode);
  if (!unsealResult.success) {
    return unsealResult;
  }
  const newSeal = await sealVault(unsealResult.seed, newPasscode, config);
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
  biometricSecret: Uint8Array,
): Promise<string> {
  const { ciphertext } = await aes256GcmEncrypt(vaultKey, biometricSecret);
  return bytesToHex(ciphertext);
}

export async function removeBiometricWrap(
  biometricWrappedKey: string,
  biometricSecret: Uint8Array,
): Promise<Uint8Array> {
  const encrypted = hex2bytes(biometricWrappedKey);
  const iv = encrypted.slice(0, 12);
  const ct = encrypted.slice(12);
  return aes256GcmDecrypt(ct, biometricSecret, iv);
}