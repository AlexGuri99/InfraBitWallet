/**
 * Session handling — lifecycle of decrypted key material.
 *
 * Design (A2):
 * - Private keys and the seed live ONLY in the closure created by createSession(). The public
 *   session object has functions only: getPublicInfo, signDigest, reauthenticate,
 *   revealMnemonic, lock. No key bytes, seed or mnemonic are properties of anything returned.
 * - Only the 64-byte seed is retained while unlocked. A private key is derived for the single
 *   signing call and zero-filled immediately after.
 * - The mnemonic is NOT retained while unlocked. reauthenticate(passcode) re-opens the seal
 *   (fresh Argon2id check); the phrase is then held for the re-auth window (default 60 s) and
 *   handed out by exactly one revealMnemonic() call, which clears it.
 * - lock() zero-fills the seed and clears the window.
 *
 * What JavaScript cannot guarantee: zero-fill is best effort. The engine may have copied
 * buffers (JIT, GC moves), the mnemonic is an immutable string that cannot be wiped, and a
 * compromised page or extension can read the closure's values. See docs/VAULT_DESIGN.md.
 *
 * signDigest signs whatever 32 bytes it is given. Callers (chain adapters) MUST build the
 * payload themselves and show a human-readable preview of it before calling.
 */
import { StorageAdapter, STORAGE_KEYS } from './storage';
import { deriveTonKey, deriveTronKey, deriveEvmKey } from './derivation';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { unsealVault } from './vault';
import type { VaultSeal, VaultUnsealError } from './vault';

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

const MAX_BACKOFF_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 1000;

/**
 * Compute exponential backoff delay for a given attempt count.
 * Formula: base * 2^attempt + random(0, base)
 */
export function computeBackoffDelay(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  const clamped = Math.min(attemptCount, MAX_BACKOFF_ATTEMPTS);
  return BACKOFF_BASE_MS * Math.pow(2, clamped) + Math.floor(Math.random() * BACKOFF_BASE_MS);
}

/**
 * Check if we are currently in a backoff window.
 */
export async function isBackoffActive(storage: StorageAdapter): Promise<number> {
  const countStr = await storage.get(STORAGE_KEYS.BACKOFF_COUNT);
  const windowStartStr = await storage.get(STORAGE_KEYS.BACKOFF_WINDOW_START);
  if (!countStr || !windowStartStr) return 0;

  const count = parseInt(countStr, 10);
  const windowStart = parseInt(windowStartStr, 10);
  const delay = computeBackoffDelay(count);
  const elapsed = Date.now() - windowStart;

  if (elapsed >= delay) return 0; // backoff expired
  return delay - elapsed; // remaining wait time in ms
}

/**
 * Record a failed backoff attempt.
 */
export async function recordFailedAttempt(storage: StorageAdapter): Promise<void> {
  const countStr = await storage.get(STORAGE_KEYS.BACKOFF_COUNT);
  const count = countStr ? parseInt(countStr, 10) + 1 : 1;
  await storage.set(STORAGE_KEYS.BACKOFF_COUNT, count.toString());
  await storage.set(STORAGE_KEYS.BACKOFF_WINDOW_START, Date.now().toString());
}

/**
 * Reset backoff on successful unlock.
 */
export async function resetBackoff(storage: StorageAdapter): Promise<void> {
  await storage.delete(STORAGE_KEYS.BACKOFF_COUNT);
  await storage.delete(STORAGE_KEYS.BACKOFF_WINDOW_START);
}

/**
 * Check if the wipe threshold has been reached.
 */
export async function isWipeThresholdReached(
  storage: StorageAdapter,
  maxFailures: number,
): Promise<boolean> {
  const countStr = await storage.get(STORAGE_KEYS.BACKOFF_COUNT);
  if (!countStr) return false;
  return parseInt(countStr, 10) >= maxFailures;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type Chain = 'ton' | 'tron' | 'evm';

/** Public material for one account on every chain. Nothing here is secret. */
export interface PublicAccountInfo {
  accountIndex: number;
  ton: { path: string; publicKeyHex: string };
  tron: { path: string; publicKeyHex: string; hexAddress: string };
  evm: { path: string; publicKeyHex: string; rawAddress: string };
}

export type SignError = 'locked' | 'invalid_chain' | 'invalid_digest' | 'invalid_account';
export type SignResult = { ok: true; signature: Uint8Array } | { ok: false; error: SignError };

export type ReauthResult =
  { ok: true } | { ok: false; error: 'locked' | 'rate_limited' | VaultUnsealError };

export type RevealResult =
  { ok: true; mnemonic: string } | { ok: false; error: 'locked' | 'reauth_required' };

/**
 * TODO(P2 chain adapters): adapters build a SigningRequest from the ACTUAL payload to be signed
 * (never from UI state) and the UI must show `summary` before signDigest is called. Today the
 * session accepts a bare digest, which is blind signing; this interface is the contract that
 * will replace it. Fields are intentionally minimal until the adapters exist.
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
  reauthWindowMs?: number;
}

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
  return readDeviceSecretHex(await storage.get(STORAGE_KEYS.DEVICE_SECRET));
}

function publicInfoFor(seed: Uint8Array, accountIndex: number): PublicAccountInfo {
  const ton = deriveTonKey(seed, accountIndex);
  const tron = deriveTronKey(seed, accountIndex);
  const evm = deriveEvmKey(seed, accountIndex);
  const info: PublicAccountInfo = {
    accountIndex,
    ton: { path: ton.path, publicKeyHex: ton.publicKeyHex },
    tron: { path: tron.path, publicKeyHex: tron.publicKeyHex, hexAddress: tron.hexAddress },
    evm: { path: evm.path, publicKeyHex: evm.publicKeyHex, rawAddress: evm.rawAddress },
  };
  ton.privateKey.fill(0);
  tron.privateKey.fill(0);
  evm.privateKey.fill(0);
  return info;
}

function createSession(
  seed: Uint8Array,
  seal: VaultSeal,
  storage: StorageAdapter,
  reauthWindowMs: number,
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

  const session: VaultSession = {
    getPublicInfo(accountIndex = 0) {
      if (isLocked() || !validAccount(accountIndex)) return null;
      let info = publicCache.get(accountIndex);
      if (!info) {
        info = publicInfoFor(seed, accountIndex);
        publicCache.set(accountIndex, info);
      }
      return structuredClone(info);
    },

    signDigest(chain, accountIndex, digest) {
      if (isLocked()) return { ok: false, error: 'locked' };
      if (!(CHAINS as readonly string[]).includes(chain)) {
        return { ok: false, error: 'invalid_chain' };
      }
      if (!validAccount(accountIndex)) return { ok: false, error: 'invalid_account' };
      if (!(digest instanceof Uint8Array) || digest.length !== 32) {
        return { ok: false, error: 'invalid_digest' };
      }
      touchSession();
      const key =
        chain === 'ton'
          ? deriveTonKey(seed, accountIndex)
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
      if ((await isBackoffActive(storage)) > 0) return { ok: false, error: 'rate_limited' };
      const deviceSecret = await loadDeviceSecret(seal, storage);
      const result = await unsealVault(seal, passcode, deviceSecret);
      if (isLocked()) {
        if (result.success) result.seed.fill(0);
        return { ok: false, error: 'locked' };
      }
      if (!result.success) {
        if (result.error === 'wrong_passcode') await recordFailedAttempt(storage);
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

/**
 * Unlock the vault and create a session. Only one session is active: unlocking replaces
 * (and locks) a previous one. Biometric unlock arrives with A6; rate-limit rework with A8.
 */
export async function unlockSession(
  seal: VaultSeal,
  passcode: string,
  storage: StorageAdapter,
  options: UnlockOptions = {},
): Promise<
  | { success: true; session: VaultSession }
  | { success: false; error: VaultUnsealError | 'rate_limited' }
> {
  const remaining = await isBackoffActive(storage);
  if (remaining > 0) return { success: false, error: 'rate_limited' };

  const deviceSecret = await loadDeviceSecret(seal, storage);
  const result = await unsealVault(seal, passcode, deviceSecret);
  if (!result.success) {
    await recordFailedAttempt(storage);
    return { success: false, error: result.error };
  }
  await resetBackoff(storage);

  lockSession();
  const session = createSession(
    result.seed,
    seal,
    storage,
    options.reauthWindowMs ?? DEFAULT_REAUTH_WINDOW_MS,
  );
  activeSession = session;
  resetInactivityTimer();
  addVisibilityListener();
  return { success: true, session };
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

/** Internal for testing — get current backoff count */
export async function getBackoffCount(storage: StorageAdapter): Promise<number> {
  const countStr = await storage.get(STORAGE_KEYS.BACKOFF_COUNT);
  return countStr ? parseInt(countStr, 10) : 0;
}
