/**
 * @onezerowallet/crypto-vault public API.
 *
 * RULE: nothing exported here may return the seed, a private key or the vault key.
 * index.test.ts enforces an explicit allowlist of export names, so adding an export fails CI
 * until someone consciously updates the list. Secret-handling functions (mnemonicToSeed,
 * derive*, sealVault, unsealVault) are module-internal and imported directly by tests only.
 */

export { generateMnemonicPhrase, validateMnemonicPhrase, normalizeMnemonic } from './mnemonic';
export type { MnemonicLength, MnemonicValidation } from './mnemonic';

export {
  createSeal,
  changePasscode,
  evaluatePasscodeStrength,
  DEFAULT_VAULT_CONFIG,
} from './vault';
export type { VaultConfig, VaultSeal } from './vault';

export {
  unlockSession,
  lockSession,
  touchSession,
  getSession,
  setInactivityTimeout,
  computeBackoffDelay,
  isBackoffActive,
  recordFailedAttempt,
  resetBackoff,
  isWipeThresholdReached,
  getBackoffCount,
} from './session';
export type { VaultSession } from './session';

export { InMemoryStorage } from './storage';
export type { StorageAdapter } from './storage';
