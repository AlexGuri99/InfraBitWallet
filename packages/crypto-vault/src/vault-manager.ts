/**
 * VaultManager (A9) — ties the wallet set, the seal envelopes, the device secret and the session
 * together.
 *
 * Layout:
 * - The wallet set (`vault_wallets`) holds public metadata (label, account type, creation time)
 *   and ONE sealed envelope per wallet. Envelopes are ciphertext only; there is never a plaintext
 *   key, seed or phrase in storage.
 * - The device secret lives in `secureStorage` (Telegram SecureStorage), routed by a
 *   CompositeStorage so session code can read it without knowing the split.
 * - A legacy single-wallet `vault_seal` is migrated into slot 1 (no re-encryption) the first time
 *   the set is read, so existing wallets keep working.
 *
 * The manager never returns the seed, a private key or the vault key. The mnemonic is only
 * generated here (createWallet / addWallet) or accepted for import; it is not retained.
 *
 * Every wallet is sealed under the SAME passcode, so an unlock opens every wallet at once (one
 * Argon2id run per wallet) and switching wallets needs no additional passcode. Adding or removing
 * a wallet drops biometric wraps: a new envelope cannot be wrapped without the biometric token,
 * which this module deliberately never stores.
 *
 * Device secret loss: if `secureStorage` is cleared by the OS/Telegram while the seals require a
 * device secret, unlocking fails with `device_secret_missing` and the passcode alone cannot open
 * them. The only recovery is importing the recovery phrase again after a wipe. This is deliberate
 * and tested.
 */
import type { StorageAdapter } from './storage';
import { CompositeStorage, STORAGE_KEYS } from './storage';
import {
  changePasscode as resealWithPasscode,
  createSeal,
  disableBiometric as removeBiometricWrap,
  enableBiometric as addBiometricWrap,
  enableBiometricWithToken,
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
  mnemonicToSeed,
  normalizeMnemonic,
  tonNativeMnemonicToSeed,
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
} from './mnemonic';
import { DEFAULT_ACCOUNT_TYPE, type AccountType } from './account-type';
import { createDeviceSecret, deleteDeviceSecret, readDeviceSecret } from './device-secret';
import { migrateStoredSeal, type MigrateStoredResult } from './seal-store';
import {
  createWalletId,
  defaultWalletLabel,
  loadWalletSet,
  MAX_WALLETS,
  saveWalletSet,
  withActiveWallet,
  withWalletLabel,
  type StoredWallet,
  type WalletSet,
} from './wallets';
import {
  getSession as getActiveSession,
  lockSession,
  unlockWalletSet,
  unlockWalletSetWithBiometric,
  wipeStoredVault,
  type UnlockOptions,
  type UnlockResult,
  type VaultSession,
  type WalletSessionEntry,
  type WalletSummary,
} from './session';

export interface VaultManagerOptions {
  /** IndexedDB (or equivalent) for the sealed envelopes and backoff state. */
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

export interface AddWalletOptions {
  /** Passcode of the existing vault (required to seal the new envelope). */
  passcode: string;
  /** Phrase for an imported wallet; omit to generate a new one. */
  mnemonic?: string | undefined;
  accountType?: AccountType | undefined;
  label?: string | undefined;
  /** Make the new wallet active (default true). */
  activate?: boolean | undefined;
}

export type AddWalletResult =
  | {
      ok: true;
      wallet: { id: string; label: string; accountType: AccountType };
      /** Present only when the phrase was generated here — show it once for backup. */
      mnemonic?: string | undefined;
      /** True when biometric wraps were removed because the wallet set changed. */
      biometricDropped: boolean;
    }
  | {
      ok: false;
      error:
        | 'locked'
        | 'vault_missing'
        | 'wrong_passcode'
        | 'weak_passcode'
        | 'invalid_mnemonic'
        | 'wallet_limit'
        | 'duplicate_wallet'
        | 'storage_error';
      message?: string | undefined;
    };

export type RemoveWalletResult =
  | { ok: true; activeId: string | null }
  | {
      ok: false;
      error:
        | 'locked'
        | 'vault_missing'
        | 'unknown_wallet'
        | 'phrase_mismatch'
        | 'last_wallet'
        | 'storage_error';
    };

function toEntries(set: WalletSet): WalletSessionEntry[] {
  return set.wallets.map((wallet) => ({
    id: wallet.id,
    label: wallet.label,
    accountType: wallet.accountType,
    seal: wallet.seal,
  }));
}

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

  private async loadSet(): Promise<ReturnType<typeof loadWalletSet>> {
    return loadWalletSet(this.sealStorage);
  }

  /** True when a wallet set (or a legacy single seal) is stored. */
  async hasVault(): Promise<boolean> {
    const loaded = await this.loadSet();
    if (loaded.ok) return loaded.set.wallets.length > 0;
    if (loaded.error === 'unsupported_version') {
      return (await this.sealStorage.get(STORAGE_KEYS.SEAL)) !== null;
    }
    return false;
  }

  /** True when a device factor will be used (secure storage configured). */
  get usesDeviceSecret(): boolean {
    return this.secureStorage !== undefined;
  }

  /** True when the active wallet's stored seal has a biometric wrap. */
  async hasBiometric(): Promise<boolean> {
    const loaded = await this.loadSet();
    if (!loaded.ok) return false;
    const active =
      loaded.set.wallets.find((wallet) => wallet.id === loaded.set.activeId) ??
      loaded.set.wallets[0];
    return active?.seal.biometricWrappedKey !== undefined;
  }

  /** Account type of the active wallet, or null when there is no readable store. */
  async getAccountType(): Promise<AccountType | null> {
    const loaded = await this.loadSet();
    if (!loaded.ok) return null;
    const active =
      loaded.set.wallets.find((wallet) => wallet.id === loaded.set.activeId) ??
      loaded.set.wallets[0];
    return active?.accountType ?? null;
  }

  /** Public wallet metadata (no seal, no key material). */
  async listWallets(): Promise<
    Array<{ id: string; label: string; accountType: AccountType; active: boolean }>
  > {
    const loaded = await this.loadSet();
    if (!loaded.ok) return [];
    return loaded.set.wallets.map((wallet) => ({
      id: wallet.id,
      label: wallet.label,
      accountType: wallet.accountType,
      active: wallet.id === loaded.set.activeId,
    }));
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

  /**
   * True when `passcode` opens the active wallet. Every wallet in a set is sealed under the same
   * passcode, so this is enough to verify the caller before a set change.
   */
  private async verifyPasscode(set: WalletSet, passcode: string): Promise<boolean> {
    const wallet = set.wallets.find((entry) => entry.id === set.activeId) ?? set.wallets[0];
    if (!wallet) return false;
    const deviceSecret = await readDeviceSecret(this.composite);
    const result = await unsealVault(wallet.seal, passcode, deviceSecret ?? undefined);
    deviceSecret?.fill(0);
    if (!result.success) return false;
    result.seed.fill(0);
    return true;
  }

  private phraseFor(accountType: AccountType, mnemonic?: string): Promise<string | null> {
    return (async () => {
      if (mnemonic === undefined) {
        return accountType === 'ton-native-only'
          ? await generateTonNativeMnemonicPhrase()
          : generateMnemonicPhrase(24);
      }
      return normalizeMnemonic(mnemonic);
    })();
  }

  private async phraseIsValid(accountType: AccountType, phrase: string): Promise<boolean> {
    return accountType === 'ton-native-only'
      ? await validateTonMnemonicPhrase(phrase)
      : validateMnemonicPhrase(phrase).valid;
  }

  private async seedFor(accountType: AccountType, phrase: string): Promise<Uint8Array> {
    return accountType === 'ton-native-only'
      ? await tonNativeMnemonicToSeed(phrase)
      : mnemonicToSeed(phrase);
  }

  /**
   * Seal one wallet under the shared passcode and return its record. Reads the existing device
   * secret (never overwrites it, which would make every other wallet unopenable).
   */
  private async sealWallet(
    phrase: string,
    passcode: string,
    accountType: AccountType,
    label: string,
  ): Promise<{ ok: true; wallet: StoredWallet; seed: Uint8Array } | { ok: false; error: string }> {
    let deviceSecret: Uint8Array | undefined;
    try {
      if (this.secureStorage) {
        deviceSecret = (await readDeviceSecret(this.composite)) ?? undefined;
        if (!deviceSecret) deviceSecret = await createDeviceSecret(this.secureStorage);
      }
      const seal = await createSeal(
        phrase,
        passcode,
        deviceSecret,
        this.options.config,
        accountType,
      );
      const unsealed = await unsealVault(seal, passcode, deviceSecret);
      if (!unsealed.success) return { ok: false, error: unsealed.error };
      return {
        ok: true,
        wallet: {
          id: createWalletId(),
          label,
          accountType,
          createdAt: Date.now(),
          seal,
        },
        seed: unsealed.seed,
      };
    } finally {
      deviceSecret?.fill(0);
    }
  }

  private async saveSet(set: WalletSet): Promise<boolean> {
    const saved = await saveWalletSet(this.sealStorage, set);
    return saved.ok;
  }

  /** Create the first wallet. The generated phrase (if any) is returned ONCE for backup. */
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
    const phrase = await this.phraseFor(accountType, mnemonic);
    if (phrase === null) return { ok: false, error: 'invalid_mnemonic' };
    if (!(await this.phraseIsValid(accountType, phrase))) {
      return { ok: false, error: 'invalid_mnemonic' };
    }

    try {
      const sealed = await this.sealWallet(phrase, passcode, accountType, defaultWalletLabel(0));
      if (!sealed.ok) return { ok: false, error: 'storage_error' };
      sealed.seed.fill(0);
      const set: WalletSet = {
        version: 1,
        activeId: sealed.wallet.id,
        wallets: [sealed.wallet],
      };
      if (!(await this.saveSet(set))) return { ok: false, error: 'storage_error' };
      return mnemonic === undefined
        ? { ok: true, seal: sealed.wallet.seal, mnemonic: phrase }
        : { ok: true, seal: sealed.wallet.seal };
    } catch {
      return { ok: false, error: 'storage_error' };
    }
  }

  /** Import an existing wallet as the first wallet. */
  async importWallet(
    mnemonic: string,
    passcode: string,
    options: { accountType?: AccountType | undefined } = {},
  ): Promise<CreateWalletResult> {
    return this.createWallet(passcode, mnemonic, options);
  }

  /**
   * Add another wallet to an unlocked vault. The passcode is required twice over: it opens every
   * existing wallet (verification) and seals the new envelope.
   */
  async addWallet(options: AddWalletOptions): Promise<AddWalletResult> {
    const loaded = await this.loadSet();
    if (!loaded.ok) {
      return {
        ok: false,
        error: loaded.error === 'unsupported_version' ? 'vault_missing' : 'vault_missing',
      };
    }
    const set = loaded.set;
    if (set.wallets.length >= MAX_WALLETS) return { ok: false, error: 'wallet_limit' };

    const policy = this.evaluatePasscode(options.passcode);
    if (!policy.ok) return { ok: false, error: 'weak_passcode', message: policy.error };
    if (!(await this.verifyPasscode(set, options.passcode))) {
      return { ok: false, error: 'wrong_passcode' };
    }

    const accountType = options.accountType ?? DEFAULT_ACCOUNT_TYPE;
    const phrase = await this.phraseFor(accountType, options.mnemonic);
    if (phrase === null) return { ok: false, error: 'invalid_mnemonic' };
    if (!(await this.phraseIsValid(accountType, phrase))) {
      return { ok: false, error: 'invalid_mnemonic' };
    }

    let sealed: Awaited<ReturnType<VaultManager['sealWallet']>>;
    try {
      sealed = await this.sealWallet(
        phrase,
        options.passcode,
        accountType,
        options.label ?? defaultWalletLabel(set.wallets.length),
      );
    } catch {
      return { ok: false, error: 'storage_error' };
    }
    if (!sealed.ok) return { ok: false, error: 'storage_error' };

    const session = this.getSession();
    // Reject adding a phrase the wallet set already knows (same seed = same wallet).
    if (session) {
      for (const existing of set.wallets) {
        if (await session.walletMatchesPhrase(existing.id, phrase)) {
          sealed.seed.fill(0);
          return { ok: false, error: 'duplicate_wallet' };
        }
      }
    }

    const biometricDropped = set.wallets.some(
      (wallet) => wallet.seal.biometricWrappedKey !== undefined,
    );
    const nextSet: WalletSet = {
      ...set,
      activeId: options.activate === false ? set.activeId : sealed.wallet.id,
      wallets: [
        ...set.wallets.map((wallet) =>
          biometricDropped ? { ...wallet, seal: removeBiometricWrap(wallet.seal) } : wallet,
        ),
        sealed.wallet,
      ],
    };
    if (!(await this.saveSet(nextSet))) {
      sealed.seed.fill(0);
      return { ok: false, error: 'storage_error' };
    }

    session?.addWallet(
      {
        id: sealed.wallet.id,
        label: sealed.wallet.label,
        accountType: sealed.wallet.accountType,
        seal: sealed.wallet.seal,
      },
      sealed.seed,
    );
    if (options.activate !== false) session?.switchWallet(sealed.wallet.id);

    return {
      ok: true,
      wallet: {
        id: sealed.wallet.id,
        label: sealed.wallet.label,
        accountType: sealed.wallet.accountType,
      },
      ...(options.mnemonic === undefined ? { mnemonic: phrase } : {}),
      biometricDropped,
    };
  }

  /** Rename a wallet. Labels are non-secret metadata. */
  async renameWallet(
    id: string,
    label: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = await this.loadSet();
    if (!loaded.ok) return { ok: false, error: 'vault_missing' };
    if (!loaded.set.wallets.some((wallet) => wallet.id === id)) {
      return { ok: false, error: 'unknown_wallet' };
    }
    const next = withWalletLabel(loaded.set, id, label);
    if (next === loaded.set) return { ok: false, error: 'invalid_label' };
    if (!(await this.saveSet(next))) return { ok: false, error: 'storage_error' };
    this.getSession()?.renameWallet(id, label);
    return { ok: true };
  }

  /** Switch the active wallet (all wallets are already open in the session). */
  async switchWallet(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = this.getSession();
    const loaded = await this.loadSet();
    if (!loaded.ok) return { ok: false, error: 'vault_missing' };
    if (!loaded.set.wallets.some((wallet) => wallet.id === id)) {
      return { ok: false, error: 'unknown_wallet' };
    }
    if (!session || !session.switchWallet(id)) return { ok: false, error: 'locked' };
    const next = withActiveWallet(loaded.set, id);
    if (!(await this.saveSet(next))) return { ok: false, error: 'storage_error' };
    return { ok: true };
  }

  /**
   * Remove one wallet after the user retypes ITS recovery phrase. The other wallets (and the
   * passcode) are untouched. Removing the last wallet is refused; use wipe for that.
   */
  async removeWallet(id: string, phrase: string): Promise<RemoveWalletResult> {
    const loaded = await this.loadSet();
    if (!loaded.ok) return { ok: false, error: 'vault_missing' };
    const set = loaded.set;
    if (!set.wallets.some((wallet) => wallet.id === id)) {
      return { ok: false, error: 'unknown_wallet' };
    }
    if (set.wallets.length <= 1) return { ok: false, error: 'last_wallet' };
    const session = this.getSession();
    if (!session) return { ok: false, error: 'locked' };
    if (!(await session.walletMatchesPhrase(id, phrase))) {
      return { ok: false, error: 'phrase_mismatch' };
    }
    const remaining = set.wallets.filter((wallet) => wallet.id !== id);
    const fallbackActive = set.activeId === id ? (remaining[0]?.id ?? set.activeId) : set.activeId;
    const nextSet: WalletSet = { ...set, activeId: fallbackActive, wallets: remaining };
    if (!(await this.saveSet(nextSet))) return { ok: false, error: 'storage_error' };
    const activeId = session.removeWallet(id);
    return { ok: true, activeId };
  }

  /** Unlock with a passcode. Legacy seals report unsupported_version until migrated. */
  async unlock(passcode: string): Promise<UnlockResult> {
    const loaded = await this.loadSet();
    if (!loaded.ok) {
      if (loaded.error === 'unsupported_version') {
        return { success: false, error: 'unsupported_version' };
      }
      return { success: false, error: 'malformed_seal' };
    }
    return unlockWalletSet(
      toEntries(loaded.set),
      loaded.set.activeId,
      passcode,
      this.composite,
      this.unlockOptions(),
    );
  }

  /** Unlock with the token returned by enableBiometric(). */
  async unlockWithBiometric(token: string): Promise<UnlockResult> {
    const loaded = await this.loadSet();
    if (!loaded.ok) {
      if (loaded.error === 'unsupported_version') {
        return { success: false, error: 'unsupported_version' };
      }
      return { success: false, error: 'malformed_seal' };
    }
    return unlockWalletSetWithBiometric(
      toEntries(loaded.set),
      loaded.set.activeId,
      token,
      this.composite,
      this.unlockOptions(),
    );
  }

  /** Current session (null when locked). */
  getSession(): VaultSession | null {
    return getActiveSession();
  }

  lock(): void {
    lockSession();
  }

  /** Public wallet list for the current session, or metadata when locked. */
  getSessionWallets(): WalletSummary[] {
    return this.getSession()?.listWallets() ?? [];
  }

  /**
   * Re-seal every wallet under a new passcode. Biometric wraps are dropped by the rotation and
   * re-created with ONE fresh token (returned so the caller can store it), or removed if the
   * rotation cannot add them.
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

    const loaded = await this.loadSet();
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const hadBiometric = loaded.set.wallets.some(
      (wallet) => wallet.seal.biometricWrappedKey !== undefined,
    );

    const resealed: StoredWallet[] = [];
    try {
      for (const wallet of loaded.set.wallets) {
        const result: ChangePasscodeResult = await resealWithPasscode(
          wallet.seal,
          oldPasscode,
          newPasscode,
          deviceSecret ?? undefined,
          this.options.config,
        );
        if (!result.ok) return { ok: false, error: result.error };
        resealed.push({ ...wallet, seal: result.seal });
      }

      let biometricToken: string | undefined;
      if (hadBiometric) {
        const first = resealed[0];
        if (!first) return { ok: false, error: 'vault_missing' };
        const enabled = await addBiometricWrap(first.seal, newPasscode, deviceSecret ?? undefined);
        if (!enabled.ok) return { ok: false, error: enabled.error };
        biometricToken = enabled.token;
        resealed[0] = { ...first, seal: enabled.seal };
        for (let index = 1; index < resealed.length; index++) {
          const wallet = resealed[index];
          if (!wallet) return { ok: false, error: 'vault_missing' };
          const wrapped = await enableBiometricWithToken(
            wallet.seal,
            newPasscode,
            enabled.token,
            deviceSecret ?? undefined,
          );
          if (!wrapped.ok) return { ok: false, error: wrapped.error };
          resealed[index] = { ...wallet, seal: wrapped.seal };
        }
      }

      const nextSet: WalletSet = { ...loaded.set, wallets: resealed };
      if (!(await this.saveSet(nextSet))) return { ok: false, error: 'storage_error' };
      const firstSeal = resealed[0]?.seal;
      if (!firstSeal) return { ok: false, error: 'vault_missing' };
      return {
        ok: true,
        seal: firstSeal,
        ...(biometricToken ? { biometricToken } : {}),
      };
    } finally {
      deviceSecret?.fill(0);
    }
  }

  /**
   * Enable biometrics for EVERY wallet with one token. Returns the token the caller MUST store via
   * BiometricManager.updateBiometricToken. The passcode is required.
   */
  async enableBiometric(
    passcode: string,
  ): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
    const loaded = await this.loadSet();
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    const wallets: StoredWallet[] = [];
    let token: string | undefined;
    try {
      for (const wallet of loaded.set.wallets) {
        if (token === undefined) {
          const enabled = await addBiometricWrap(wallet.seal, passcode, deviceSecret ?? undefined);
          if (!enabled.ok) return { ok: false, error: enabled.error };
          token = enabled.token;
          wallets.push({ ...wallet, seal: enabled.seal });
        } else {
          const wrapped = await enableBiometricWithToken(
            wallet.seal,
            passcode,
            token,
            deviceSecret ?? undefined,
          );
          if (!wrapped.ok) return { ok: false, error: wrapped.error };
          wallets.push({ ...wallet, seal: wrapped.seal });
        }
      }
      const nextSet: WalletSet = { ...loaded.set, wallets };
      if (!(await this.saveSet(nextSet))) return { ok: false, error: 'storage_error' };
      if (token === undefined) return { ok: false, error: 'vault_missing' };
      return { ok: true, token };
    } finally {
      deviceSecret?.fill(0);
    }
  }

  /** Disable biometrics on every wallet. Requires the passcode (a convenience gate). */
  async disableBiometric(passcode: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = await this.loadSet();
    if (!loaded.ok) return { ok: false, error: loaded.error };

    const deviceSecret = await readDeviceSecret(this.composite);
    try {
      const active =
        loaded.set.wallets.find((wallet) => wallet.id === loaded.set.activeId) ??
        loaded.set.wallets[0];
      if (!active) return { ok: false, error: 'vault_missing' };
      const check = await unsealVault(active.seal, passcode, deviceSecret ?? undefined);
      if (!check.success) return { ok: false, error: check.error };
      check.seed.fill(0);
    } finally {
      deviceSecret?.fill(0);
    }

    const nextSet: WalletSet = {
      ...loaded.set,
      wallets: loaded.set.wallets.map((wallet) => ({
        ...wallet,
        seal: removeBiometricWrap(wallet.seal),
      })),
    };
    if (!(await this.saveSet(nextSet))) return { ok: false, error: 'storage_error' };
    return { ok: true };
  }

  /** Upgrade a stored legacy (v1–v4) seal to the current format. */
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

  /** Delete every wallet, the device secret and the backoff state, then lock. */
  async wipe(): Promise<void> {
    lockSession();
    await wipeStoredVault(this.composite);
    await deleteDeviceSecret(this.secureStorage ?? this.sealStorage);
  }
}
