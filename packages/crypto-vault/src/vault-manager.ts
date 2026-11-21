/**
 * VaultManager (A9) — ties the seal store, the device secret and the session together.
 *
 * Layout:
 * - The sealed envelope (ciphertext) and backoff state live in `sealStorage` (IndexedDB).
 * - The device secret lives in `secureStorage` (Telegram SecureStorage), routed by a
 *   CompositeStorage so session code can read it without knowing the split.
 *
 * The manager never returns the seed, a private key or the vault key. The mnemonic is only
 * generated here (createWallet) or accepted for import; it is not retained.
 *
 * Device secret loss: if `secureStorage` is cleared by the OS/Telegram while the seal requires a
 * device secret, unlocking fails with `device_secret_missing` and the passcode alone cannot open
 * the seal. The only recovery is importing the recovery phrase again (importWallet) after a
 * wipe. This is deliberate and tested.
 */
import type { StorageAdapter } from './storage';
import { CompositeStorage, STORAGE_KEYS } from './storage';
import {
  changePasscode as resealWithPasscode,
  createSeal,
  disableBiometric as removeBiometricWrap,
  enableBiometric as addBiometricWrap,
  evaluatePasscodeStrength,
  unsealVault,
  type ChangePasscodeResult,
  type PasscodePolicy,
  type VaultConfig,
  type VaultSeal,
} from './vault';
import {
  generateMnemonicPhrase,
  generateTonNativeMnemonicPhrase,
  normalizeMnemonic,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { DEFAULT_ACCOUNT_TYPE, type AccountType } from './account-type';
import { createDeviceSecret, deleteDeviceSecret, readDeviceSecret } from './device-secret';
import { loadSeal, migrateStoredSeal, saveSeal, type MigrateStoredResult } from './seal-store';
import {
  getSession as getActiveSession,
  lockSession,
  unlockSession,
  unlockSessionWithBiometric,
  wipeStoredVault,
  type UnlockOptions,
  type UnlockResult,
  type VaultSession,
} from './session';

export interface VaultManagerOptions {
  /** IndexedDB (or equivalent) for the seal ciphertext and backoff state. */
  sealStorage: StorageAdapter | undefined;
  /** SecureStorage (or equivalent) for the device secret. Optional: without it no device factor. */
  secureStorage?: StorageAdapter | undefined;
  /** Argon2id config for new seals. Tests should pass a fast config. */
  config?: VaultConfig | undefined;
  /** Wipe after this many consecutive wrong passcodes. 0/undefined = disabled. */
  wipeAfterFailures?: number | undefined;
  /** Re-auth window for revealMnemonic, in ms. */
  reauthWindowMs?: number | undefined;
}

export type CreateWalletResult =
  | { ok: true; seal: VaultSeal; mnemonic?: string }
  | {
      ok: false;
      error: 'vault_exists' | 'weak_passcode' | 'invalid_mnemonic' | 'storage_error';
      message?: string | undefined;
    };

export class VaultManager {
  private readonly composite: CompositeStorage;
  private readonly sealStorage: StorageAdapter;
  private readonly secureStorage: StorageAdapter | undefined;
  private readonly options: VaultManagerOptions;

  constructor(options: VaultManagerOptions) {
    const sealStorage = options.sealStorage;
    if (!sealStorage) throw new Error('STORAGE_REQUIRED');
    this.options = options;
    this.sealStorage = sealStorage;
    this.secureStorage = options.secureStorage;
    // Only the device secret is routed to secure storage; everything else stays bulk.
    this.composite = new CompositeStorage(options.secureStorage ?? sealStorage, sealStorage, [
      STORAGE_KEYS.DEVICE_SECRET,
    ]);
  }

  /** True when a seal is stored (current or legacy). */
  async hasVault(): Promise<boolean> {
    return (await this.sealStorage.get(STORAGE_KEYS.SEAL)) !== null;
  }

  /** True when a device factor will be used (secure storage configured). */
  get usesDeviceSecret(): boolean {
    return this.secureStorage !== undefined;
  }

  /** Evaluate the policy for a passcode at the manager's current factor level. */
  evaluatePasscode(passcode: string): PasscodePolicy {
    return evaluatePasscodeStrength(passcode, this.usesDeviceSecret);
  }

  private unlockOptions(): UnlockOptions {
    return {
      reauthWindowMs: this.options.reauthWindowMs,
      wipeAfterFailures: this.options.wipeAfterFailures,
    };
  }

  /** Create a new wallet. The generated phrase (if any) is returned ONCE for backup. */
  async createWallet(
    passcode: string,
    mnemonic?: string,
    options: { accountType?: AccountType | undefined } = {},
  ): Promise<CreateWalletResult> {
    if (await this.hasVault()) return { ok: false, error: 'vault_exists' };

    const policy = this.evaluatePasscode(passcode);
    if (!policy.ok) {
      return { ok: false, error: 'weak_passcode', message: policy.error };
    }

    const accountType = options.accountType ?? DEFAULT_ACCOUNT_TYPE;
    let phrase: string;
    let generated = false;
    if (mnemonic === undefined) {
      phrase =
        accountType === 'ton-native-only'
          ? await generateTonNativeMnemonicPhrase()
          : generateMnemonicPhrase(24);
      generated = true;
    } else {
      phrase = normalizeMnemonic(mnemonic);
      const valid =
        accountType === 'ton-native-only'
          ? await validateTonMnemonicPhrase(phrase)
          : validateMnemonicPhrase(phrase).valid;
      if (!valid) return { ok: false, error: 'invalid_mnemonic' };
    }

    let deviceSecret: Uint8Array | undefined;
    if (this.secureStorage) {
      deviceSecret = await createDeviceSecret(this.secureStorage);
    }
    try {
      const seal = await createSeal(
        phrase,
        passcode,
        deviceSecret,
        this.options.config,
        accountType,
      );
      const saved = await saveSeal(this.sealStorage, seal);
      if (!saved.ok) return { ok: false, error: 'storage_error' };
      return generated ? { ok: true, seal, mnemonic: phrase } : { ok: true, seal };
    } finally {
      deviceSecret?.fill(0);
    }
  }

  /** Import an existing wallet. The phrase must be valid for the chosen account type. */
  async importWallet(
    mnemonic: string,
    passcode: string,
    options: { accountType?: AccountType | undefined } = {},
  ): Promise<CreateWalletResult> {
    return this.createWallet(passcode, mnemonic, options);
  }

  /** Unlock with a passcode. Legacy seals report unsupported_version until migrated. */
  async unlock(passcode: string): Promise<UnlockResult> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) {
      if (loaded.error === 'unsupported_version') {
        return { success: false, error: 'unsupported_version' };
      }
      return { success: false, error: 'malformed_seal' };
    }
    return unlockSession(loaded.seal, passcode, this.composite, this.unlockOptions());
  }

  /** Unlock with the token returned by enableBiometric(). */
  async unlockWithBiometric(token: string): Promise<UnlockResult> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) {
      if (loaded.error === 'unsupported_version') {
        return { success: false, error: 'unsupported_version' };
      }
      return { success: false, error: 'malformed_seal' };
    }
    return unlockSessionWithBiometric(loaded.seal, token, this.composite, this.unlockOptions());
  }

  /** Current session (null when locked). */
  getSession(): VaultSession | null {
    // Imported lazily to keep the manager thin.
    return getActiveSession();
  }

  lock(): void {
    lockSession();
  }

  /**
   * Re-seal under a new passcode. Any biometric wrap is dropped by the rotation; if biometrics
   * were enabled, a fresh wrap is created and the new token returned so the caller can store it.
   */
  async changePasscode(
    oldPasscode: string,
    newPasscode: string,
  ): Promise<
    | { ok: true; seal: VaultSeal; biometricToken?: string | undefined }
    | { ok: false; error: string; message?: string | undefined }
  > {
    const policy = this.evaluatePasscode(newPasscode);
    if (!policy.ok) return { ok: false, error: 'weak_passcode', message: policy.error };

    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const hadBiometric = loaded.seal.biometricWrappedKey !== undefined;

    const resealed: ChangePasscodeResult = await resealWithPasscode(
      loaded.seal,
      oldPasscode,
      newPasscode,
      deviceSecret ?? undefined,
      this.options.config,
    );
    deviceSecret?.fill(0);
    if (!resealed.ok) return { ok: false, error: resealed.error };

    let seal = resealed.seal;
    let biometricToken: string | undefined;
    if (hadBiometric) {
      const secret = await readDeviceSecret(this.composite);
      const enabled = await addBiometricWrap(seal, newPasscode, secret ?? undefined);
      secret?.fill(0);
      if (!enabled.ok) return { ok: false, error: enabled.error };
      seal = enabled.seal;
      biometricToken = enabled.token;
    }

    const saved = await saveSeal(this.sealStorage, seal);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, seal, ...(biometricToken ? { biometricToken } : {}) };
  }

  /**
   * Enable biometrics. Returns a token the caller MUST store via
   * BiometricManager.updateBiometricToken. The passcode is required.
   */
  async enableBiometric(
    passcode: string,
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const enabled = await addBiometricWrap(loaded.seal, passcode, deviceSecret ?? undefined);
    deviceSecret?.fill(0);
    if (!enabled.ok) return { ok: false, error: enabled.error };

    const saved = await saveSeal(this.sealStorage, enabled.seal);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, token: enabled.token };
  }

  /** Disable biometrics. Requires the passcode (documented: biometrics are a convenience). */
  async disableBiometric(passcode: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = await loadSeal(this.sealStorage);
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const check = await unsealVault(loaded.seal, passcode, deviceSecret ?? undefined);
    deviceSecret?.fill(0);
    if (!check.success) return { ok: false, error: check.error };
    check.seed.fill(0);

    const saved = await saveSeal(this.sealStorage, removeBiometricWrap(loaded.seal));
    return saved.ok ? { ok: true } : { ok: false, error: saved.error };
  }

  /** Upgrade a stored legacy (v1–v3) seal to the current format. */
  async migrate(passcode: string, mnemonic?: string): Promise<MigrateStoredResult> {
    const deviceSecret = await readDeviceSecret(this.composite);
    const result = await migrateStoredSeal(
      this.sealStorage,
      passcode,
      deviceSecret ?? undefined,
      mnemonic,
    );
    deviceSecret?.fill(0);
    return result;
  }

  /** Delete the seal and device secret, then lock. Cannot be undone without the phrase. */
  async wipe(): Promise<void> {
    lockSession();
    await wipeStoredVault(this.composite);
    await deleteDeviceSecret(this.secureStorage ?? this.sealStorage);
  }
}
