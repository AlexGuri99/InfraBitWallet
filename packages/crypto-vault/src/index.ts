/**
 * @onezerowallet/crypto-vault public API.
 *
 * RULE: nothing exported here may return the seed, a private key or the vault key. Functions
 * that necessarily handle key material (`unsealVault`, `sealVault`, `derive*`, `mnemonicToSeed`)
 * stay module-internal. index.test.ts enforces an explicit allowlist of export names, so adding
 * an export fails CI until someone consciously updates the list.
 */

export {
  generateMnemonicPhrase,
  validateMnemonicPhrase,
  normalizeMnemonic,
  isBip39Word,
  generateTonNativeMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
export type { MnemonicLength, MnemonicValidation } from './mnemonic';
export type { AccountType } from './account-type';

export {
  createSeal,
  changePasscode,
  evaluatePasscodeStrength,
  measureKdf,
  enableBiometric,
  disableBiometric,
  DEFAULT_VAULT_CONFIG,
  KDF_BOUNDS,
  VAULT_FORMAT_VERSION,
} from './vault';
export type {
  VaultConfig,
  VaultSeal,
  PasscodePolicy,
  KdfMeasurement,
  ChangePasscodeResult,
  EnableBiometricResult,
} from './vault';

export {
  unlockSession,
  unlockSessionWithBiometric,
  lockSession,
  touchSession,
  getSession,
  setInactivityTimeout,
  wipeStoredVault,
} from './session';
export type {
  VaultSession,
  UnlockResult,
  UnlockOptions,
  ReauthResult,
  RevealResult,
  PublicAccountInfo,
  SigningRequest,
} from './session';

export {
  computeBackoffDelay,
  isBackoffActive,
  recordFailedAttempt,
  resetBackoff,
  isWipeThresholdReached,
  getBackoffCount,
} from './backoff';

export {
  toEip55Address,
  isValidEvmAddress,
  toBase58TronAddress,
  isValidTronAddress,
  tonAddressesFromPublicKey,
  validateTonAddress,
  TON_MAINNET_GLOBAL_ID,
  TON_TESTNET_GLOBAL_ID,
  TON_V5R1_DEFAULT_WALLET_ID,
} from './address';
export type { TonAddressForms, TonAddressValidation } from './address';

export { InMemoryStorage, CompositeStorage, STORAGE_KEYS } from './storage';
export type { StorageAdapter } from './storage';

export { IndexedDBAdapter } from './indexeddb';
export type { IndexedDbAdapterOptions } from './indexeddb';

export { saveSeal, loadSeal, migrateStoredSeal } from './seal-store';
export type { SaveSealResult, LoadSealResult, MigrateStoredResult } from './seal-store';

export { isValidDeviceSecretHex } from './device-secret';

export { VaultManager } from './vault-manager';
export type { VaultManagerOptions, CreateWalletResult } from './vault-manager';
