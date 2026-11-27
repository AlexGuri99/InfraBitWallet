/**
 * Multi-wallet storage (v1) — a set of independently sealed wallets under one passcode.
 *
 * Every wallet keeps its own v5 envelope: its own Argon2id salt, vault key, wrapped key and
 * ciphertexts. Nothing here holds a plaintext phrase or key: the wallet set stores LABELS and
 * ENVELOPES only. Labels, account types and creation times are non-secret metadata.
 *
 * Layout:
 * - `vault_wallets` (IndexedDB): JSON { version, activeId, wallets: [{ id, label, accountType,
 *   createdAt, seal }] }.
 * - A pre-existing single-wallet `vault_seal` is migrated into slot 1 by `loadWalletSet` the first
 *   time a wallet set is read; the legacy key is then deleted. No re-encryption happens, so the
 *   same passcode continues to open the migrated wallet.
 *
 * Everything read from storage is untrusted and validated with zod before it reaches crypto.
 */
import { z } from './zod-jitless';
import type { StorageAdapter } from './storage';
import { STORAGE_KEYS } from './storage';
import { loadSeal, VaultSealSchema } from './seal-store';
import type { VaultSeal } from './vault';
import type { AccountType } from './account-type';

export const WALLET_SET_VERSION = 1;
/** Upper bound so a hostile/tampered store cannot make unlock loop forever. */
export const MAX_WALLETS = 10;
export const WALLET_ID_BYTES = 8;

export interface StoredWallet {
  id: string;
  label: string;
  accountType: AccountType;
  createdAt: number;
  seal: VaultSeal;
}

export interface WalletSet {
  version: typeof WALLET_SET_VERSION;
  activeId: string;
  wallets: StoredWallet[];
}

const accountTypeSchema = z.enum(['bip39-multichain', 'ton-native-only']);

const StoredWalletSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f]{16}$/),
    label: z.string().min(1).max(40),
    accountType: accountTypeSchema,
    createdAt: z.number().int().nonnegative(),
    seal: VaultSealSchema,
  })
  .strict();

const WalletSetSchema = z
  .object({
    version: z.literal(WALLET_SET_VERSION),
    activeId: z.string().regex(/^[0-9a-f]{16}$/),
    wallets: z.array(StoredWalletSchema).min(1).max(MAX_WALLETS),
  })
  .strict()
  .refine(
    (set) => {
      const ids = set.wallets.map((wallet) => wallet.id);
      return new Set(ids).size === ids.length && ids.includes(set.activeId);
    },
    { message: 'wallet set ids must be unique and contain the active wallet' },
  );

export type LoadWalletSetResult =
  | { ok: true; set: WalletSet; migrated: boolean }
  | {
      ok: false;
      error: 'no_vault' | 'malformed_vault' | 'storage_required' | 'unsupported_version';
    };

/** 16 lowercase hex chars from Web Crypto. */
export function createWalletId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(WALLET_ID_BYTES));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Default label for the slot at `index` (1-based naming, as shown in the UI). */
export function defaultWalletLabel(index: number): string {
  return `Wallet ${String(index + 1)}`;
}

function singleWalletSet(seal: VaultSeal, label: string): WalletSet {
  const id = createWalletId();
  return {
    version: WALLET_SET_VERSION,
    activeId: id,
    wallets: [
      {
        id,
        label,
        accountType: seal.accountType,
        createdAt: Date.now(),
        seal,
      },
    ],
  };
}

/**
 * Load and validate the wallet set.
 *
 * When only a legacy single-wallet `vault_seal` exists, it is wrapped into slot 1 (no
 * re-encryption), persisted under `vault_wallets` and the legacy key is removed. A legacy
 * pre-v5 seal is NOT migrated here: it needs the passcode, so the caller keeps using
 * `migrateStoredSeal` and the set is built on the next load.
 */
export async function loadWalletSet(
  storage: StorageAdapter | undefined,
): Promise<LoadWalletSetResult> {
  if (!storage) return { ok: false, error: 'storage_required' };

  const raw = await storage.get(STORAGE_KEYS.WALLETS);
  if (raw !== null) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'malformed_vault' };
    }
    const parsed = WalletSetSchema.safeParse(json);
    if (!parsed.success) return { ok: false, error: 'malformed_vault' };
    return { ok: true, set: parsed.data as WalletSet, migrated: false };
  }

  const legacy = await loadSeal(storage);
  if (!legacy.ok) {
    if (legacy.error === 'unsupported_version') {
      return { ok: false, error: 'unsupported_version' };
    }
    return { ok: false, error: 'no_vault' };
  }
  const set = singleWalletSet(legacy.seal, defaultWalletLabel(0));
  const saved = await saveWalletSet(storage, set);
  if (!saved.ok) return { ok: false, error: 'malformed_vault' };
  await storage.delete(STORAGE_KEYS.SEAL);
  return { ok: true, set, migrated: true };
}

/** Validate and persist the whole wallet set atomically (one storage write). */
export async function saveWalletSet(
  storage: StorageAdapter | undefined,
  set: WalletSet,
): Promise<{ ok: true } | { ok: false; error: 'invalid_vault' | 'storage_required' }> {
  if (!storage) return { ok: false, error: 'storage_required' };
  const parsed = WalletSetSchema.safeParse(set);
  if (!parsed.success) return { ok: false, error: 'invalid_vault' };
  await storage.set(STORAGE_KEYS.WALLETS, JSON.stringify(parsed.data));
  return { ok: true };
}

/** Copy of the set with `activeId` replaced. The caller persists it. */
export function withActiveWallet(set: WalletSet, activeId: string): WalletSet {
  if (!set.wallets.some((wallet) => wallet.id === activeId)) return set;
  return { ...set, activeId };
}

/** Copy of the set with one wallet relabelled. The caller persists it. */
export function withWalletLabel(set: WalletSet, id: string, label: string): WalletSet {
  const trimmed = label.trim().slice(0, 40);
  if (trimmed === '') return set;
  return {
    ...set,
    wallets: set.wallets.map((wallet) =>
      wallet.id === id ? { ...wallet, label: trimmed } : wallet,
    ),
  };
}
