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
import {
  mnemonicToSeed,
  normalizeMnemonic,
  tonNativeMnemonicToSeed,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { MAX_WALLETS } from './wallets';

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
    /** Wallet V5R1 testnet-only, bounceable (kQ…). */
    addressTestnetBounceable: string;
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

/** One wallet handed to an unlock call. Contains only the sealed envelope and public metadata. */
export interface WalletSessionEntry {
  id: string;
  label: string;
  accountType: AccountType;
  seal: VaultSeal;
}

/** Public wallet summary for the switcher. Never contains a phrase, seed or key. */
export interface WalletSummary {
  id: string;
  label: string;
  accountType: AccountType;
  active: boolean;
  /** Wallet V5R1 testnet non-bounceable address (what the UI displays). */
  tonAddress: string;
}

export interface VaultSession {
  getPublicInfo(accountIndex?: number): PublicAccountInfo | null;
  /** Ed25519 (TON, 64-byte signature) or recoverable secp256k1 (TRON/EVM, r||s||recovery = 65 bytes). */
  signDigest(chain: Chain, accountIndex: number, digest: Uint8Array): SignResult;
  /** Fresh passcode check. Opens the re-auth window for one revealMnemonic() call. */
  reauthenticate(passcode: string): Promise<ReauthResult>;
  /** Returns the phrase once per successful reauthenticate(), then clears the window. */
  revealMnemonic(): RevealResult;
  /** Public summaries of every loaded wallet, in storage order. */
  listWallets(): WalletSummary[];
  /** Id of the wallet whose keys sign and whose address the UI shows. */
  getActiveWalletId(): string;
  /** Switch the active wallet. False when locked or unknown (all loaded wallets are switchable). */
  switchWallet(id: string): boolean;
  /** Relabel a wallet in memory. Persisting the label is the manager's job. */
  renameWallet(id: string, label: string): void;
  /** Add an already-opened wallet to the session. False when locked, duplicate or over the cap. */
  addWallet(entry: WalletSessionEntry, seed: Uint8Array): boolean;
  /** Zero and drop a wallet. Returns the new active id, or null when none remain. */
  removeWallet(id: string): string | null;
  /** True when `phrase` regenerates this wallet's seed (used to confirm removal). */
  walletMatchesPhrase(id: string, phrase: string): Promise<boolean>;
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
  await storage.delete(STORAGE_KEYS.WALLETS);
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
      addressTestnetBounceable: tonAddresses.testnetBounceable,
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

interface LoadedWallet extends WalletSessionEntry {
  seed: Uint8Array;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function normalizeLabel(label: string): string {
  return label.trim().slice(0, 40);
}

function createSession(
  wallets: LoadedWallet[],
  activeId: string,
  storage: StorageAdapter,
  reauthWindowMs: number,
  wipeAfterFailures: number,
): VaultSession {
  const state = { locked: false };
  // A function call (not a property read) so the type checker does not narrow the flag across awaits.
  const isLocked = (): boolean => state.locked;
  let revealable: { mnemonic: string; expiresAt: number } | null = null;
  const publicCache = new Map<string, PublicAccountInfo>();
  let activeWalletId = activeId;

  const validAccount = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i <= MAX_ACCOUNT_INDEX;

  const findWallet = (id: string): LoadedWallet | undefined =>
    wallets.find((wallet) => wallet.id === id);
  const activeWallet = (): LoadedWallet | undefined => findWallet(activeWalletId);

  const infoFor = (wallet: LoadedWallet, accountIndex: number): PublicAccountInfo => {
    const key = `${wallet.id}:${String(accountIndex)}`;
    let info = publicCache.get(key);
    if (!info) {
      info = publicInfoFor(wallet.seed, accountIndex, wallet.accountType);
      publicCache.set(key, info);
    }
    return info;
  };

  const lock = (): void => {
    if (state.locked) return;
    state.locked = true;
    for (const wallet of wallets) wallet.seed.fill(0);
    wallets = [];
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
      const wallet = activeWallet();
      if (!wallet) return null;
      if (wallet.accountType === 'ton-native-only' && accountIndex !== 0) return null;
      return structuredClone(infoFor(wallet, accountIndex));
    },

    signDigest(chain, accountIndex, digest) {
      if (isLocked()) return { ok: false, error: 'locked' };
      const wallet = activeWallet();
      if (!wallet) return { ok: false, error: 'locked' };
      if (!(CHAINS as readonly string[]).includes(chain)) {
        return { ok: false, error: 'invalid_chain' };
      }
      if (wallet.accountType === 'ton-native-only' && chain !== 'ton') {
        return { ok: false, error: 'invalid_chain' };
      }
      if (!validAccount(accountIndex)) return { ok: false, error: 'invalid_account' };
      if (wallet.accountType === 'ton-native-only' && accountIndex !== 0) {
        return { ok: false, error: 'invalid_account' };
      }
      if (!(digest instanceof Uint8Array) || digest.length !== 32) {
        return { ok: false, error: 'invalid_digest' };
      }
      touchSession();
      const key =
        chain === 'ton'
          ? deriveTonKey(wallet.seed, accountIndex, wallet.accountType)
          : chain === 'tron'
            ? deriveTronKey(wallet.seed, accountIndex)
            : deriveEvmKey(wallet.seed, accountIndex);
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
      const wallet = activeWallet();
      if (!wallet) return { ok: false, error: 'locked' };
      revealable = null;
      const remaining = await isBackoffActive(storage);
      if (remaining > 0) return { ok: false, error: 'rate_limited', retryAfterMs: remaining };
      const deviceSecret = await loadDeviceSecret(wallet.seal, storage);
      const result = await unsealVault(wallet.seal, passcode, deviceSecret);
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

    listWallets() {
      if (isLocked()) return [];
      return wallets.map((wallet) => ({
        id: wallet.id,
        label: wallet.label,
        accountType: wallet.accountType,
        active: wallet.id === activeWalletId,
        tonAddress: infoFor(wallet, 0).ton.addressTestnetNonBounceable,
      }));
    },

    getActiveWalletId() {
      return isLocked() ? '' : activeWalletId;
    },

    switchWallet(id) {
      if (isLocked() || !findWallet(id)) return false;
      activeWalletId = id;
      touchSession();
      return true;
    },

    renameWallet(id, label) {
      if (isLocked()) return;
      const wallet = findWallet(id);
      const next = normalizeLabel(label);
      if (!wallet || next === '') return;
      wallet.label = next;
    },

    addWallet(entry, seed) {
      if (isLocked() || findWallet(entry.id) || wallets.length >= MAX_WALLETS) return false;
      if (!(seed instanceof Uint8Array) || seed.length !== 64) return false;
      wallets.push({ ...entry, label: normalizeLabel(entry.label), seed });
      return true;
    },

    removeWallet(id) {
      if (isLocked()) return null;
      const index = wallets.findIndex((wallet) => wallet.id === id);
      if (index === -1) return activeWalletId;
      const [removed] = wallets.splice(index, 1);
      removed?.seed.fill(0);
      revealable = null;
      publicCache.clear();
      if (activeWalletId === id) {
        activeWalletId = wallets[0]?.id ?? '';
      }
      return activeWalletId === '' ? null : activeWalletId;
    },

    async walletMatchesPhrase(id, phrase) {
      if (isLocked()) return false;
      const wallet = findWallet(id);
      if (!wallet) return false;
      const normalized = normalizeMnemonic(phrase);
      let derived: Uint8Array;
      if (wallet.accountType === 'ton-native-only') {
        if (!(await validateTonMnemonicPhrase(normalized))) return false;
        derived = await tonNativeMnemonicToSeed(normalized);
      } else {
        if (!validateMnemonicPhrase(normalized).valid) return false;
        derived = mnemonicToSeed(normalized);
      }
      try {
        return constantTimeEqual(derived, wallet.seed);
      } finally {
        derived.fill(0);
      }
    },

    lock,
  };

  activeLock = lock;
  return Object.freeze(session);
}

/** Guard the active session so re-auth cannot proceed across a lock. */
function openSession(
  wallets: LoadedWallet[],
  activeId: string,
  storage: StorageAdapter,
  options: UnlockOptions,
): UnlockResult {
  lockSession();
  const session = createSession(
    wallets,
    activeId,
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
  return unlockWalletSet(
    [{ id: 'default', label: 'Wallet 1', accountType: seal.accountType, seal }],
    'default',
    passcode,
    storage,
    options,
  );
}

/**
 * Unlock every wallet in a set with one passcode. Each envelope is opened independently (its own
 * Argon2id salt), so a wrong passcode costs N derivations once and counts as ONE failed attempt.
 * Any non-passcode failure (tampered data, missing device secret) fails the whole unlock closed.
 */
export async function unlockWalletSet(
  entries: readonly WalletSessionEntry[],
  activeId: string,
  passcode: string,
  storage: StorageAdapter | undefined,
  options: UnlockOptions = {},
): Promise<UnlockResult> {
  if (!storage) return { success: false, error: 'storage_required' }; // fail closed
  if (entries.length === 0) return { success: false, error: 'malformed_seal' };
  const remaining = await isBackoffActive(storage);
  if (remaining > 0) return { success: false, error: 'rate_limited', retryAfterMs: remaining };

  const opened: LoadedWallet[] = [];
  const fail = (error: VaultUnsealError): UnlockResult => {
    for (const wallet of opened) wallet.seed.fill(0);
    return { success: false, error };
  };

  for (const entry of entries) {
    const deviceSecret = await loadDeviceSecret(entry.seal, storage);
    const result = await unsealVault(entry.seal, passcode, deviceSecret);
    if (!result.success) {
      if (result.error === 'wrong_passcode') {
        const { count } = await recordFailedAttempt(storage);
        for (const wallet of opened) wallet.seed.fill(0);
        if ((options.wipeAfterFailures ?? 0) > 0 && count >= (options.wipeAfterFailures ?? 0)) {
          await wipeStoredVault(storage);
          return { success: false, error: 'wiped' };
        }
        return { success: false, error: 'wrong_passcode' };
      }
      return fail(result.error);
    }
    opened.push({
      id: entry.id,
      label: entry.label,
      accountType: entry.accountType,
      seal: entry.seal,
      seed: result.seed,
    });
  }

  await resetBackoff(storage);
  const active = opened.some((wallet) => wallet.id === activeId)
    ? activeId
    : (opened[0]?.id ?? activeId);
  return openSession(opened, active, storage, options);
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
  return openSession(
    [
      {
        id: 'default',
        label: 'Wallet 1',
        accountType: seal.accountType,
        seal,
        seed: result.seed,
      },
    ],
    'default',
    storage,
    options,
  );
}

/**
 * Biometric unlock for a wallet set. All-or-nothing: every envelope must carry a biometric wrap
 * made with the same token (the manager wraps all wallets with one token when biometrics are
 * enabled, and drops the wraps when the set changes).
 */
export async function unlockWalletSetWithBiometric(
  entries: readonly WalletSessionEntry[],
  activeId: string,
  token: string,
  storage: StorageAdapter | undefined,
  options: UnlockOptions = {},
): Promise<UnlockResult> {
  if (!storage) return { success: false, error: 'storage_required' };
  if (entries.length === 0) return { success: false, error: 'malformed_seal' };
  for (const entry of entries) {
    if (entry.seal.biometricWrappedKey === undefined) {
      return { success: false, error: 'biometric_not_enabled' };
    }
  }
  const remaining = await isBackoffActive(storage);
  if (remaining > 0) return { success: false, error: 'rate_limited', retryAfterMs: remaining };

  const opened: LoadedWallet[] = [];
  for (const entry of entries) {
    const deviceSecret = await loadDeviceSecret(entry.seal, storage);
    const result = await unlockWithBiometric(entry.seal, token, deviceSecret);
    if (!result.success) {
      for (const wallet of opened) wallet.seed.fill(0);
      return { success: false, error: result.error };
    }
    opened.push({
      id: entry.id,
      label: entry.label,
      accountType: entry.accountType,
      seal: entry.seal,
      seed: result.seed,
    });
  }
  await resetBackoff(storage);
  const active = opened.some((wallet) => wallet.id === activeId)
    ? activeId
    : (opened[0]?.id ?? activeId);
  return openSession(opened, active, storage, options);
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
