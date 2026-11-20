/**
 * @onezerowallet/crypto-vault — BIP-39 mnemonic management, multi-chain derivation,
 * AES-256-GCM vault encryption, passcode+device+biometric unlock, and session handling.
 *
 * This package NEVER exposes the raw seed or private keys outside its module boundary.
 * See docs/VAULT_DESIGN.md for the full threat model.
 */

export {
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  normalizeMnemonic,
  mnemonicToSeed,
  zeroFill,
  bytesToHex,
  seedToHex,
} from './mnemonic';

export type { MnemonicLength, MnemonicValidation } from './mnemonic';

export {
  deriveTonKey,
  deriveTronKey,
  deriveEvmKey,
  deriveAllKeys,
} from './derivation';

export type { DerivedKey, DerivedKeys } from './derivation';

export {
  sealVault,
  unsealVault,
  changePasscode,
  addDeviceSecretWrap,
  addBiometricWrap,
  removeBiometricWrap,
  evaluatePasscodeStrength,
  DEFAULT_VAULT_CONFIG,
} from './vault';

export type { VaultConfig, VaultSeal, VaultUnlockResult } from './vault';

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

export { InMemoryStorage, STORAGE_KEYS } from './storage';
export type { StorageAdapter } from './storage';

export type { DerivedKey as DerivedKeyInfo } from './derivation';