/**
 * Device secret (A9).
 *
 * A 32-byte random value stored ONLY in the secure adapter (Telegram SecureStorage, Bot API
 * 9.0+: Keychain on iOS, Keystore on Android — https://core.telegram.org/bots/webapps). It is
 * mixed into the key that wraps the vault key, so a copied seal cannot be opened offline with
 * the passcode alone.
 *
 * The value is persisted as exactly 64 lowercase hex characters and is validated strictly on
 * read. It is never logged or returned from the public package API except to the caller that
 * just created it (and that caller must pass it straight to createSeal).
 *
 * Consequence, documented in VAULT_DESIGN.md: if the OS/Telegram clears SecureStorage, the
 * seal cannot be opened with the passcode. Restoring from the recovery phrase is the only path.
 */
import type { StorageAdapter } from './storage';
import { STORAGE_KEYS } from './storage';

export const DEVICE_SECRET_BYTES = 32;
const DEVICE_SECRET_HEX = /^[0-9a-f]{64}$/;

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

/** True only for a string of exactly 64 lowercase hex characters. */
export function isValidDeviceSecretHex(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_SECRET_HEX.test(value);
}

/**
 * Generate a device secret, store it in the secure adapter, and return it for sealing.
 * Throws if storage is unavailable (fail closed).
 */
export async function createDeviceSecret(storage: StorageAdapter | undefined): Promise<Uint8Array> {
  if (!storage) throw new Error('STORAGE_REQUIRED');
  const secret = globalThis.crypto.getRandomValues(new Uint8Array(DEVICE_SECRET_BYTES));
  await storage.set(STORAGE_KEYS.DEVICE_SECRET, bytesToHex(secret));
  return secret;
}

/** Read the device secret, or null when absent/malformed. Malformed is treated as absent. */
export async function readDeviceSecret(
  storage: StorageAdapter | undefined,
): Promise<Uint8Array | null> {
  if (!storage) return null;
  const hex = await storage.get(STORAGE_KEYS.DEVICE_SECRET);
  if (!isValidDeviceSecretHex(hex)) return null;
  const out = new Uint8Array(DEVICE_SECRET_BYTES);
  for (let i = 0; i < DEVICE_SECRET_BYTES; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Remove the device secret (used by wipe and by disabling the device factor). */
export async function deleteDeviceSecret(storage: StorageAdapter | undefined): Promise<void> {
  if (!storage) return;
  await storage.delete(STORAGE_KEYS.DEVICE_SECRET);
}
