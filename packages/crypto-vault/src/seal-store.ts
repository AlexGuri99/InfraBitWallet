/**
 * Seal persistence (A9): schema-validated save/load plus migration wiring.
 *
 * Everything read from storage is untrusted: it is parsed as JSON and validated with zod before
 * it reaches the crypto code. A malformed or unknown-version envelope is rejected, never
 * guessed at. Legacy envelopes (v1–v3) are returned to the caller so they can be migrated with
 * the passcode, and are never written back unchanged.
 */
import { z } from 'zod';
import type { StorageAdapter } from './storage';

// Strict CSP forbids `unsafe-eval`; zod's JIT compiles validators with `new Function`, which the
// browser reports as a script-src eval violation. Disable it before any schema runs. Only seal
// parsing uses zod, so the cost is negligible. Source: zod v4 global config (`jitless`).
z.config({ jitless: true });
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
export const VaultSealSchema = z
  .object({
    version: z.literal(VAULT_FORMAT_VERSION),
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
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
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
