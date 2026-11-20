/**
 * Session handling — manages the lifecycle of decrypted key material.
 *
 * Design:
 * - Seed is decrypted and used only inside the vault module; never in React/Zustand state or DOM.
 * - The module exposes narrow signing functions, never the raw seed.
 * - Best-effort memory wiping via Uint8Array.fill(0) after use.
 * - Auto-lock on inactivity timeout + when the window is hidden (page visibility API).
 * - Exponential backoff on passcode attempts (persistent).
 */
import { StorageAdapter, STORAGE_KEYS } from './storage';
import { deriveAllKeys } from './derivation';
import type { DerivedKeys } from './derivation';
import { unsealVault, VaultSeal } from './vault';

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

export interface VaultSession {
  /** Derived keys for each chain (read-only after unlock) */
  readonly keys: DerivedKeys;
  /** Lock the session immediately */
  lock(): void;
  /** Time of last activity (ms since epoch) */
  lastActivity: number;
}

let activeSession: VaultSession | null = null;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let inactivityTimeoutMs: number = 300000; // 5 minutes default

/**
 * Set the auto-lock inactivity timeout.
 */
export function setInactivityTimeout(ms: number): void {
  inactivityTimeoutMs = ms;
}

function resetInactivityTimer(): void {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
  }
  if (activeSession && inactivityTimeoutMs > 0) {
    inactivityTimer = setTimeout(() => {
      lockSession();
    }, inactivityTimeoutMs);
  }
}

/**
 * Unlock the vault and create a session.
 * The seed is never exposed to the caller — only derived keys are available.
 *
 * @returns The derived keys for each chain
 */
export async function unlockSession(
  seal: VaultSeal,
  passcode: string,
  secureStorage?: StorageAdapter,
  biometricSecret?: Uint8Array,
): Promise<
  { success: true; session: VaultSession } | { success: false; error: 'wrong_passcode' | 'device_secret_missing' | 'tampered_data' }
> {
  // Check backoff
  if (secureStorage) {
    const remaining = await isBackoffActive(secureStorage);
    if (remaining > 0) {
      return { success: false, error: 'wrong_passcode' };
    }
  }

  const result = await unsealVault(seal, passcode, secureStorage, biometricSecret);
  if (!result.success) {
    if (secureStorage) {
      await recordFailedAttempt(secureStorage);
    }
    return { success: false, error: result.error };
  }

  // Check wipe threshold
  if (secureStorage) {
    await resetBackoff(secureStorage);
  }

  // Derive all keys
  const keys = deriveAllKeys(result.seed);
  result.seed.fill(0); // Clear seed from memory

  // Create session with auto-lock
  const session: VaultSession = {
    keys: Object.freeze(keys),
    lastActivity: Date.now(),
    lock: () => {
      lockSession();
    },
  };

  activeSession = session;

  // Wire up auto-lock
  resetInactivityTimer();

  // Listen for page visibility changes
  if (typeof document !== 'undefined') {
    const handler = () => {
      if (document.hidden) {
        lockSession();
      }
    };
    document.addEventListener('visibilitychange', handler);
  }

  return { success: true, session };
}

/**
 * Lock the active session. Zero-fills derived keys and clears references.
 */
export function lockSession(): void {
  if (!activeSession) return;

  for (const key of Object.values(activeSession.keys)) {
    (key as { privateKey: Uint8Array }).privateKey.fill(0);
  }

  activeSession = null;
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

/**
 * Touch the session (reset inactivity timer). Call on user interaction.
 */
export function touchSession(): void {
  if (activeSession) {
    activeSession.lastActivity = Date.now();
    resetInactivityTimer();
  }
}

/**
 * Get the current session, or null if locked.
 */
export function getSession(): VaultSession | null {
  return activeSession;
}

/** Internal for testing — get current backoff count */
export async function getBackoffCount(storage: StorageAdapter): Promise<number> {
  const countStr = await storage.get(STORAGE_KEYS.BACKOFF_COUNT);
  return countStr ? parseInt(countStr, 10) : 0;
}