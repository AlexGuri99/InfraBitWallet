# Stage C review packet

Full source of the Stage C UI, adapters and tests after the onboarding refactor, 4-digit PIN policy, Home redesign and the 2-step Create flow (2026-11-22). Test fixtures are public test phrases only.

## apps/miniapp/src/App.tsx

```typescript
/**
 * App state machine: onboarding, unlock, home and settings.
 *
 * The UI only calls the vault API. It never reads keys, keeps no secret in React state, and
 * clears the module-level phrase holder whenever a flow ends, the wallet locks, or the app is
 * backgrounded.
 *
 * Create order: phrase -> verify -> passcode (the vault is sealed last, after the user has
 * proven the backup). Import order: phrase (type auto-detected) -> passcode.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  generateMnemonicPhrase,
  setInactivityTimeout,
  type AccountType,
} from '@onezerowallet/crypto-vault';
import { useTelegram } from './telegram';
import { installTelegramLifecycleHooks } from './adapters/telegram-lifecycle';
import { useVault } from './vault/context';
import { secretHolder } from './vault/secret-holder';
import { detectAccountType } from './vault/detect';
import { t } from './i18n';
import { CreatePhraseScreen, PhraseScreen, VerifyScreen, WelcomeScreen } from './ui/onboarding';
import { DisambiguateScreen, ImportPhraseScreen } from './ui/import';
import { PasscodeScreen } from './ui/passcode';
import { HomeScreen, SettingsScreen, UnlockScreen } from './ui/wallet';
import { Notice, ScreenShell } from './ui/common';

type Screen =
  | 'loading'
  | 'welcome'
  | 'create-phrase'
  | 'create-passcode'
  | 'import-phrase'
  | 'import-disambiguate'
  | 'import-passcode'
  | 'unlock'
  | 'home'
  | 'settings'
  | 'settings-phrase'
  | 'settings-verify';

const AUTO_LOCK_KEY = 'ozw.autoLockMs';

const ONBOARDING_SECRET_SCREENS: Screen[] = [
  'create-phrase',
  'create-passcode',
  'import-phrase',
  'import-disambiguate',
  'import-passcode',
];

function LoadingScreen() {
  return (
    <ScreenShell title={t('app.name')}>
      <p aria-live="polite">{t('common.working')}</p>
    </ScreenShell>
  );
}

export function App() {
  const { manager, biometry } = useVault();
  const { webApp } = useTelegram();
  const [screen, setScreen] = useState<Screen>('loading');
  const [storageError, setStorageError] = useState(false);
  const [importAccountType, setImportAccountType] = useState<AccountType>('bip39-multichain');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTO_LOCK_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) setInactivityTimeout(parsed);
    } catch {
      // Preference only.
    }
    void (async () => {
      try {
        const has = await manager.hasVault();
        setScreen(has ? 'unlock' : 'welcome');
      } catch {
        setStorageError(true);
        setScreen('welcome');
      }
    })();
  }, [manager]);

  // Clear a temporary phrase when backgrounded on a secret screen.
  useEffect(() => {
    const wipe = (): void => {
      if (screen === 'settings-phrase' || screen === 'settings-verify') {
        secretHolder.clear();
        setScreen('settings');
        return;
      }
      if (ONBOARDING_SECRET_SCREENS.includes(screen)) {
        secretHolder.clear();
        setScreen('welcome');
      }
    };
    const onHidden = (): void => {
      if (document.hidden) wipe();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [screen]);

  // Telegram backgrounding locks immediately.
  useEffect(() => {
    return installTelegramLifecycleHooks(webApp ?? undefined, {
      onDeactivated: () => {
        manager.lock();
        secretHolder.clear();
        setScreen('unlock');
      },
    });
  }, [manager, webApp]);

  // Notice an inactivity lock (the session locks itself); the UI follows.
  useEffect(() => {
    const watch = ['home', 'settings', 'settings-phrase', 'settings-verify'].includes(screen);
    if (!watch) return;
    const id = window.setInterval(() => {
      if (manager.getSession() === null) {
        secretHolder.clear();
        setScreen('unlock');
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [manager, screen]);

  const lock = useCallback(() => {
    manager.lock();
    secretHolder.clear();
    setScreen('unlock');
  }, [manager]);

  const startCreate = useCallback(() => {
    if (!secretHolder.has()) secretHolder.set(generateMnemonicPhrase(24));
    setScreen('create-phrase');
  }, []);

  const sealCreatedWallet = async (passcode: string): Promise<string | null> => {
    const phrase = secretHolder.get();
    if (!phrase) return t('settings.error');
    const created = await manager.createWallet(passcode, phrase, {
      accountType: 'bip39-multichain',
    });
    if (!created.ok) {
      return created.error === 'weak_passcode'
        ? (created.message ?? t('passcode.weak'))
        : t('settings.error');
    }
    secretHolder.clear();
    const unlocked = await manager.unlock(passcode);
    if (!unlocked.success) {
      setScreen('unlock');
      return null;
    }
    setScreen('home');
    return null;
  };

  const importPhraseNext = async (
    words: string[],
    forceTonNative: boolean,
  ): Promise<string | null> => {
    const phrase = words.join(' ');
    const detected = await detectAccountType(phrase, { forceTonNative });
    if (detected.kind === 'invalid') return detected.message;
    secretHolder.set(phrase);
    if (detected.kind === 'ambiguous') {
      setScreen('import-disambiguate');
      return null;
    }
    setImportAccountType(detected.accountType);
    setScreen('import-passcode');
    return null;
  };

  const sealImportedWallet = async (passcode: string): Promise<string | null> => {
    const phrase = secretHolder.get();
    if (!phrase) return t('settings.error');
    const imported = await manager.importWallet(phrase, passcode, {
      accountType: importAccountType,
    });
    secretHolder.clear();
    if (!imported.ok) {
      return imported.error === 'invalid_mnemonic'
        ? t('import.sequenceError')
        : t('settings.error');
    }
    const unlocked = await manager.unlock(passcode);
    if (!unlocked.success) {
      setScreen('unlock');
      return null;
    }
    setScreen('home');
    return null;
  };

  if (storageError) {
    return (
      <ScreenShell title={t('app.name')}>
        <Notice tone="warning">{t('error.storage')}</Notice>
      </ScreenShell>
    );
  }

  switch (screen) {
    case 'loading':
      return <LoadingScreen />;
    case 'welcome':
      return (
        <WelcomeScreen
          onCreate={startCreate}
          onImport={() => {
            secretHolder.clear();
            setScreen('import-phrase');
          }}
        />
      );
    case 'create-phrase':
      return (
        <CreatePhraseScreen
          step={{ current: 1, total: 2 }}
          onBack={() => {
            secretHolder.clear();
            setScreen('welcome');
          }}
          onDone={() => {
            setScreen('create-passcode');
          }}
        />
      );
    case 'create-passcode':
      return (
        <PasscodeScreen
          manager={manager}
          title={t('passcode.title')}
          step={{ current: 2, total: 2 }}
          onBack={() => {
            setScreen('create-phrase');
          }}
          onSubmit={sealCreatedWallet}
          submitLabel={t('passcode.submit')}
        />
      );
    case 'import-phrase':
      return (
        <ImportPhraseScreen
          step={{ current: 1, total: 2 }}
          onBack={() => {
            secretHolder.clear();
            setScreen('welcome');
          }}
          onNext={importPhraseNext}
        />
      );
    case 'import-disambiguate':
      return (
        <DisambiguateScreen
          step={{ current: 1, total: 2 }}
          onBack={() => {
            secretHolder.clear();
            setScreen('import-phrase');
          }}
          onChoose={(accountType) => {
            setImportAccountType(accountType);
            setScreen('import-passcode');
          }}
        />
      );
    case 'import-passcode':
      return (
        <PasscodeScreen
          manager={manager}
          title={t('import.step.passcode')}
          step={{ current: 2, total: 2 }}
          onBack={() => {
            secretHolder.clear();
            setScreen('import-phrase');
          }}
          onSubmit={sealImportedWallet}
          submitLabel={t('import.submit')}
        />
      );
    case 'unlock':
      return (
        <UnlockScreen
          manager={manager}
          biometry={biometry}
          onUnlocked={() => {
            setScreen('home');
          }}
          onWiped={() => {
            secretHolder.clear();
            setScreen('welcome');
          }}
        />
      );
    case 'home':
      return (
        <HomeScreen
          manager={manager}
          onLock={lock}
          onSettings={() => {
            setScreen('settings');
          }}
        />
      );
    case 'settings':
      return (
        <SettingsScreen
          manager={manager}
          biometry={biometry}
          onBack={() => {
            setScreen('home');
          }}
          onReveal={() => {
            setScreen('settings-phrase');
          }}
          onTestBackup={() => {
            setScreen('settings-verify');
          }}
          onWiped={() => {
            secretHolder.clear();
            setScreen('welcome');
          }}
        />
      );
    case 'settings-phrase':
      return (
        <PhraseScreen
          onBack={() => {
            secretHolder.clear();
            setScreen('settings');
          }}
          onDone={() => {
            secretHolder.clear();
            setScreen('settings');
          }}
        />
      );
    case 'settings-verify':
      return (
        <VerifyScreen
          onCancel={() => {
            secretHolder.clear();
            setScreen('settings');
          }}
          onVerified={() => {
            setScreen('settings');
          }}
        />
      );
    default:
      return <LoadingScreen />;
  }
}
```

## apps/miniapp/src/i18n.ts

```typescript
/**
 * Minimal i18n scaffold (English only for now).
 *
 * Usage: `t('welcome.title')`. Adding a locale means adding a dictionary and a `lang` state;
 * no component should hardcode user-facing copy. Accessibility labels are included here too.
 */
const en = {
  'app.name': 'OneZeroWallet',
  'app.tagline': 'A self-custodial multi-chain wallet for Telegram',
  'welcome.title': 'Your keys, your coins',
  'welcome.body':
    'You control this wallet. No one — including us — can recover your recovery phrase or your funds if you lose it.',
  'welcome.telegram.body':
    'Telegram or your device may clear local data. Write your recovery phrase on paper and keep it offline.',
  'welcome.never.ask': 'We will never ask for your recovery phrase.',
  'welcome.support': 'Official support: only through the official bot listed on our website.',
  'welcome.create': 'Create a wallet',
  'welcome.import': 'Import a wallet',
  'onboarding.risk.title': 'Before you start',
  'onboarding.risk.points':
    'You are the only person who can access these funds. A lost recovery phrase cannot be restored. Local data can be cleared.',
  'onboarding.continue': 'I understand, continue',
  'step.of': 'Step {current} of {total}',
  'passcode.title': 'Set a passcode',
  'passcode.requirements.device': 'Enter a 4-digit PIN (avoid simple patterns like 0000 or 1234).',
  'passcode.requirements.noDevice':
    'Enter a 4-digit PIN (avoid simple patterns like 0000 or 1234).',
  'passcode.requirements.offline':
    'No device secret is available here, so the vault can be attacked offline if its data is copied.',
  'passcode.show': 'Show',
  'passcode.hide': 'Hide',
  'passcode.met': 'Requirements met',
  'passcode.notMet': 'Requirements not met',
  'passcode.lengthLabel': 'digits',
  'passcode.label': 'PIN',
  'passcode.confirm': 'Confirm PIN',
  'passcode.mismatch': 'The passcodes do not match',
  'passcode.deviceSecret':
    'This device protects the vault with a device secret stored by Telegram.',
  'passcode.noDeviceSecret':
    'No device secret is available here. Use a long passphrase; the vault can be attacked offline if copied.',
  'passcode.weak': 'Passcode is too weak',
  'passcode.submit': 'Continue',
  'accountType.label': 'Wallet type',
  'accountType.bip39': 'Standard wallet (24-word phrase for TON, TRON and EVM)',
  'accountType.tonNative': 'TON-native phrase (TON only)',
  'accountType.tonNative.help': 'Only choose this if your existing phrase came from a TON wallet.',
  'phrase.title': 'Your recovery phrase',
  'phrase.warning':
    'Write these words on paper, in order, and keep them offline. Anyone who sees them can steal your funds. Do not take screenshots.',
  'phrase.reveal': 'Show recovery phrase',
  'phrase.checkbox': "I've stored the seed phrase in a secure place.",
  'phrase.next': 'Next',
  'phrase.revealAgain': 'Show again',
  'phrase.hide': 'Hide phrase',
  'phrase.done': 'I wrote it down',
  'phrase.settings.warning':
    'This phrase is your only backup. Make sure no one can see your screen.',
  'verify.title': 'Check your backup',
  'verify.body': 'Enter the words at the positions below. This proves your backup is readable.',
  'verify.wordAt': 'Word',
  'verify.submit': 'Verify',
  'verify.retry': 'One or more words are incorrect. Check the positions and try again.',
  'verify.success': 'Backup verified.',
  'import.title': 'Import a wallet',
  'import.step.phrase': 'Enter recovery phrase',
  'import.step.passcode': 'Set a passcode',
  'import.words24': '24 words',
  'import.words12': '12 words',
  'import.continue': 'Continue',
  'import.pasteHint': 'Tip: paste the whole phrase into any box to fill all words.',
  'import.advanced': 'Advanced',
  'import.forceTon': 'Force TON-native format (TON-only wallets)',
  'import.invalidWord': 'Not a word from the BIP-39 list',
  'import.sequenceError': 'The phrase is not valid with the selected format.',
  'import.disambiguate.title': 'Which wallet is this phrase from?',
  'import.disambiguate.body':
    'This phrase is valid in both formats and they derive different keys. Choose where it was created.',
  'import.disambiguate.standard': 'Standard multichain wallet',
  'import.disambiguate.ton': 'TON-only wallet',
  'import.phrase': 'Recovery phrase',
  'import.phraseHelp': 'Words separated by spaces. Never type it anywhere else.',
  'import.submit': 'Import',
  'import.invalid': 'That phrase is not valid for the selected wallet type.',
  'unlock.title': 'Welcome back',
  'unlock.passcode': 'PIN',
  'unlock.submit': 'Unlock',
  'unlock.biometric': 'Unlock with biometrics',
  'unlock.wrong': 'Wrong passcode',
  'unlock.rateLimited': 'Too many attempts. Try again in',
  'unlock.deviceSecretMissing':
    'This device secret is gone, so this backup cannot be opened. Restore from your recovery phrase.',
  'unlock.wiped': 'The wallet was wiped after too many failed attempts.',
  'unlock.storage': 'Secure storage is unavailable in this environment.',
  'unlock.kdf': 'Key derivation is unavailable in this environment.',
  'home.title': 'Your wallet',
  'home.mainWallet': 'Main Wallet',
  'home.walletTab': 'Wallet',
  'home.activityTab': 'Activity',
  'home.activityEmpty': 'No transactions yet — live TON Testnet history arrives in P2',
  'home.testnet': 'Testnet',
  'home.receive': 'Receive',
  'home.send': 'Send',
  'home.swap': 'Swap',
  'home.stake': 'Stake',
  'home.showBalance': 'Show balance',
  'home.hideBalance': 'Hide balance',
  'home.walletInfo': 'Wallet info',
  'home.close': 'Close',
  'home.copyTon': 'Copy TON address',
  'receive.title': 'Receive',
  'receive.ton': 'TON (V5R1)',
  'receive.tron': 'TRON',
  'receive.evm': 'Ethereum (EVM)',
  'receive.tonHint': 'Non-bounceable address — use it for first-time senders.',
  'home.sendNotice': 'Sending activates in P2 (TON Testnet).',
  'home.swapNotice': 'Coming soon.',
  'home.stakeNotice': 'Coming soon.',
  'home.lock': 'Lock',
  'home.settings': 'Settings',
  'home.copy': 'Copy',
  'home.copied': 'Copied',
  'home.tonPrefer': 'Use this non-bounceable address for first-time senders.',
  'home.notice': 'We will never ask for your recovery phrase.',
  'settings.title': 'Settings',
  'settings.back': 'Back',
  'settings.reveal': 'Reveal recovery phrase',
  'settings.testBackup': 'Test your backup',
  'settings.changePasscode': 'Change PIN',
  'settings.oldPasscode': 'Current PIN',
  'settings.newPasscode': 'New PIN',
  'settings.confirmPasscode': 'Confirm new PIN',
  'settings.save': 'Save',
  'settings.changed': 'PIN changed.',
  'settings.biometrics': 'Biometric unlock',
  'settings.biometrics.on': 'Enabled',
  'settings.biometrics.off': 'Disabled',
  'settings.biometrics.enable': 'Enable',
  'settings.biometrics.disable': 'Disable',
  'settings.biometrics.explain':
    'A successful biometric check on this unlocked device can open the wallet without the passcode. The passcode is still required to reveal the phrase, change it, or turn biometrics off.',
  'settings.autoLock': 'Auto-lock after inactivity',
  'settings.autoLock.min1': '1 minute',
  'settings.autoLock.min5': '5 minutes',
  'settings.autoLock.min15': '15 minutes',
  'settings.wipe': 'Wipe this wallet',
  'settings.wipeConfirm':
    'Type WIPE to confirm. Without your recovery phrase this cannot be undone.',
  'settings.wipeButton': 'Wipe',
  'settings.requiresPasscode': 'Enter your passcode to continue',
  'settings.error': 'Something went wrong',
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.working': 'Working…',
  'error.storage': 'Secure storage is unavailable, so the wallet cannot start on this device.',
} as const;

export type MessageKey = keyof typeof en;

export function t(key: MessageKey): string {
  return en[key];
}

export const activeLanguage = 'en' as const;
```

## apps/miniapp/src/vault/context.tsx

```typescript
/**
 * Vault UI context: one VaultManager + biometry adapter for the app.
 *
 * The manager is injectable so component tests can use in-memory adapters and a fast KDF.
 * The default wires IndexedDB (seal + backoff) and, when the client supports Bot API 9.0+,
 * Telegram SecureStorage (device secret). Secrets never enter this context.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { IndexedDBAdapter, VaultManager } from '@onezerowallet/crypto-vault';
import { createSecureStorageAdapter, getSecureStorage } from '../adapters/secure-storage';
import { createSdkBiometryApi, type BiometryApi } from '../adapters/biometry';

export interface VaultUi {
  manager: VaultManager;
  biometry: BiometryApi;
  secureStorageAvailable: boolean;
}

const VaultContext = createContext<VaultUi | null>(null);

export function createDefaultVaultUi(): VaultUi {
  const webApp = window.Telegram?.WebApp as unknown as
    | { version?: string; isVersionAtLeast?: (v: string) => boolean; SecureStorage?: unknown }
    | undefined;
  const secureApi = getSecureStorage(webApp as Parameters<typeof getSecureStorage>[0]);
  const secureStorage = secureApi ? createSecureStorageAdapter(secureApi) : undefined;
  const sealStorage = new IndexedDBAdapter();
  const manager = new VaultManager({
    sealStorage,
    secureStorage,
  });
  return {
    manager,
    biometry: createSdkBiometryApi(),
    secureStorageAvailable: secureStorage !== undefined,
  };
}

export function VaultProvider({ children, value }: { children: ReactNode; value?: VaultUi }) {
  const vault = useMemo(() => value ?? createDefaultVaultUi(), [value]);
  return <VaultContext.Provider value={vault}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultUi {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used inside VaultProvider');
  return ctx;
}
```

## apps/miniapp/src/vault/secret-holder.ts

```typescript
/**
 * Short-lived holder for a recovery phrase during onboarding or settings re-auth.
 *
 * It is deliberately NOT React state, Zustand, localStorage, sessionStorage or a URL. A module
 * variable can be overwritten as soon as the flow ends, but a JavaScript string cannot be
 * zero-filled; docs/VAULT_DESIGN.md records that limitation. The UI must still clear it on
 * navigation, on background and after any verification.
 */
let phrase: string | null = null;

export const secretHolder = {
  set(next: string): void {
    phrase = next;
  },
  get(): string | null {
    return phrase;
  },
  words(): string[] {
    return phrase ? phrase.split(' ') : [];
  },
  clear(): void {
    phrase = null;
  },
  has(): boolean {
    return phrase !== null;
  },
};
```

## apps/miniapp/src/vault/detect.ts

```typescript
/**
 * Account-type detection for imports.
 *
 * 12-word phrases are always BIP-39. 24-word phrases are checked against both schemes: the same
 * words can be valid in both and then derive different keys (~1 in 256 BIP-39 phrases also pass
 * the TON seed check), so that case needs an explicit user choice.
 *
 * Validators are injectable so the ambiguous case can be tested deterministically.
 */
import {
  validateMnemonicPhrase,
  validateTonMnemonicPhrase,
  type AccountType,
} from '@onezerowallet/crypto-vault';

export type PhraseDetection =
  | { kind: 'resolved'; accountType: AccountType }
  | { kind: 'ambiguous' }
  | { kind: 'invalid'; message: string };

export interface DetectOptions {
  /** User explicitly forced the TON-native reading. */
  forceTonNative?: boolean;
  validateBip39?: (phrase: string) => boolean;
  validateTon?: (phrase: string) => Promise<boolean> | boolean;
}

export function phraseWordCount(phrase: string): number {
  return phrase.trim() === '' ? 0 : phrase.trim().split(/\s+/).length;
}

export async function detectAccountType(
  phrase: string,
  options: DetectOptions = {},
): Promise<PhraseDetection> {
  const validation = validateMnemonicPhrase(phrase);
  const bip39Valid = options.validateBip39 ? options.validateBip39(phrase) : validation.valid;
  const words = phraseWordCount(phrase);
  const tonValid =
    words === 24
      ? await (options.validateTon
          ? options.validateTon(phrase)
          : validateTonMnemonicPhrase(phrase))
      : false;

  if (options.forceTonNative) {
    return tonValid
      ? { kind: 'resolved', accountType: 'ton-native-only' }
      : { kind: 'invalid', message: 'The phrase is not a valid TON-native mnemonic.' };
  }

  if (words !== 12 && words !== 24) {
    return { kind: 'invalid', message: 'Enter 12 or 24 words.' };
  }
  if (bip39Valid && tonValid) return { kind: 'ambiguous' };
  if (bip39Valid) return { kind: 'resolved', accountType: 'bip39-multichain' };
  if (tonValid) return { kind: 'resolved', accountType: 'ton-native-only' };
  // Position-only errors; they never echo the words.
  return {
    kind: 'invalid',
    message: validation.errors[0] ?? 'The phrase is not a valid mnemonic.',
  };
}
```

## apps/miniapp/src/adapters/biometry.ts

```typescript
/**
 * Thin adapter over the Telegram SDK biometry component.
 *
 * Feature-detected at every call; outside Telegram every method resolves to unavailable/false
 * instead of throwing. Injectable for component tests.
 *
 * Source: @telegram-apps/sdk biometry component (Mini Apps ≥ 7.2) and
 * https://core.telegram.org/bots/webapps (BiometricManager): authenticate releases a token that
 * was previously saved with updateBiometricToken.
 */
import {
  authenticateBiometry,
  biometryState,
  isBiometryAvailable,
  isBiometryMounted,
  mountBiometry,
  openBiometrySettings,
  requestBiometryAccess,
  updateBiometryToken,
} from '@telegram-apps/sdk';

export interface BiometryApi {
  /** Whether biometrics is available on this device (mounts the component when needed). */
  available(): Promise<boolean>;
  /** Whether a biometric token is stored on the device. */
  tokenSaved(): boolean;
  requestAccess(reason: string): Promise<boolean>;
  /** Returns the stored token after a successful biometric check, or undefined. */
  authenticate(reason: string): Promise<string | undefined>;
  updateToken(token: string | null): Promise<boolean>;
  openSettings(): void;
}

async function ensureMounted(): Promise<boolean> {
  try {
    if (!isBiometryMounted() && mountBiometry.isAvailable()) await mountBiometry(undefined);
    return isBiometryAvailable();
  } catch {
    return false;
  }
}

export function createSdkBiometryApi(): BiometryApi {
  return {
    async available() {
      return ensureMounted();
    },
    tokenSaved() {
      try {
        return biometryState().tokenSaved;
      } catch {
        return false;
      }
    },
    async requestAccess(reason) {
      try {
        if (!(await ensureMounted())) return false;
        if (!requestBiometryAccess.isAvailable()) return false;
        return await requestBiometryAccess({ reason });
      } catch {
        return false;
      }
    },
    async authenticate(reason) {
      try {
        if (!(await ensureMounted())) return undefined;
        if (!authenticateBiometry.isAvailable()) return undefined;
        const { token } = await authenticateBiometry({ reason });
        return token;
      } catch {
        return undefined;
      }
    },
    async updateToken(token) {
      try {
        if (!(await ensureMounted())) return false;
        if (!updateBiometryToken.isAvailable()) return false;
        const status = await updateBiometryToken(token ? { token } : {});
        return status === 'updated';
      } catch {
        return false;
      }
    },
    openSettings() {
      try {
        if (openBiometrySettings.isAvailable()) openBiometrySettings();
      } catch {
        // Unavailable outside Telegram; nothing to do.
      }
    },
  };
}
```

## apps/miniapp/src/adapters/secure-storage.ts

```typescript
/**
 * Telegram SecureStorage adapter (A9).
 *
 * Thin, injectable wrapper around Telegram.WebApp.SecureStorage so the vault core never depends
 * on Telegram. Source: https://core.telegram.org/bots/webapps (fetched 2026-11-21)
 * - SecureStorage is available since Bot API 9.0.
 * - Values are encrypted at rest: Keychain on iOS, Keystore on Android.
 * - At most 10 items per bot per user.
 * - getItem, when the key is absent, returns null plus a flag telling whether it can be
 *   restored from the current device. restoreItem asks the user and returns the value.
 *
 * We keep exactly ONE item here (the device secret), well within the 10-item budget.
 */
import type { StorageAdapter } from '@onezerowallet/crypto-vault';

type Callback = (error: string | null, value?: unknown) => void;

/** Callback-style API as documented by Telegram. */
export interface TelegramSecureStorageApi {
  setItem(key: string, value: string, callback?: Callback): void;
  getItem(key: string, callback: Callback): void;
  removeItem(key: string, callback?: Callback): void;
  clear(callback?: Callback): void;
  restoreItem?(key: string, callback: Callback): void;
}

export interface TelegramWebAppLike {
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  SecureStorage?: TelegramSecureStorageApi;
}

export const SECURE_STORAGE_MIN_VERSION = '9.0';
/** Telegram's documented per-bot per-user limit. */
export const SECURE_STORAGE_ITEM_BUDGET = 10;
/** Item budget consumed by this wallet. */
export const SECURE_STORAGE_ITEMS_USED = ['device_secret'] as const;

function versionAtLeast(current: string, required: string): boolean {
  const a = current.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = required.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Feature-detect the object AND the Bot API version, never assuming either. */
export function isSecureStorageAvailable(webApp: TelegramWebAppLike | undefined): boolean {
  if (!webApp || !webApp.SecureStorage) return false;
  if (typeof webApp.isVersionAtLeast === 'function') {
    return webApp.isVersionAtLeast(SECURE_STORAGE_MIN_VERSION);
  }
  return (
    typeof webApp.version === 'string' && versionAtLeast(webApp.version, SECURE_STORAGE_MIN_VERSION)
  );
}

/** The SecureStorage API object, or null when unsupported. */
export function getSecureStorage(
  webApp: TelegramWebAppLike | undefined,
): TelegramSecureStorageApi | null {
  return isSecureStorageAvailable(webApp) ? (webApp?.SecureStorage ?? null) : null;
}

export interface SecureStorageAdapter extends StorageAdapter {
  /** Restore a key from another device (Telegram prompts the user). Null if unavailable/denied. */
  restore(key: string): Promise<string | null>;
  /** Whether restoreItem exists on this client. */
  readonly supportsRestore: boolean;
}

function settable(api: TelegramSecureStorageApi, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    api.setItem(key, value, (error) => {
      if (error) reject(new Error(`SECURE_STORAGE_SET_FAILED: ${error}`));
      else resolve();
    });
  });
}

function removable(api: TelegramSecureStorageApi, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    api.removeItem(key, (error) => {
      if (error) reject(new Error(`SECURE_STORAGE_REMOVE_FAILED: ${error}`));
      else resolve();
    });
  });
}

/**
 * Promisify the callback API. Async callbacks that throw are converted into rejections so a bad
 * client cannot hang the caller.
 */
export function createSecureStorageAdapter(api: TelegramSecureStorageApi): SecureStorageAdapter {
  const supportsRestore = typeof api.restoreItem === 'function';
  return {
    supportsRestore,
    get(key) {
      return new Promise<string | null>((resolve, reject) => {
        api.getItem(key, (error, value) => {
          if (error) reject(new Error(`SECURE_STORAGE_GET_FAILED: ${error}`));
          else resolve(typeof value === 'string' ? value : null);
        });
      });
    },
    set(key, value) {
      return settable(api, key, value);
    },
    delete(key) {
      return removable(api, key);
    },
    clear() {
      return new Promise((resolve, reject) => {
        api.clear((error) => {
          if (error) reject(new Error(`SECURE_STORAGE_CLEAR_FAILED: ${error}`));
          else resolve();
        });
      });
    },
    async restore(key) {
      if (!api.restoreItem) return null;
      return new Promise<string | null>((resolve) => {
        api.restoreItem?.(key, (error, value) => {
          // A denied restore surfaces as a non-null error; treat it as "not restored".
          if (error) resolve(null);
          else resolve(typeof value === 'string' ? value : null);
        });
      });
    },
  };
}
```

## apps/miniapp/src/adapters/telegram-lifecycle.ts

```typescript
/**
 * Telegram lifecycle hooks (A8).
 *
 * Telegram emits `activated` / `deactivated` events on WebApp when the Mini App is brought to
 * the foreground or backgrounded (https://core.telegram.org/bots/webapps, events section). The
 * vault session already locks on `visibilitychange`; these hooks let the app also lock when
 * Telegram itself deactivates the Mini App (e.g. Desktop window minimised), where the DOM
 * visibility event does not always fire.
 *
 * The listener lives in the app adapter, not the pure crypto package.
 */
export interface TelegramLifecycleApi {
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
}

export interface LifecycleHooksOptions {
  onActivated?: () => void;
  onDeactivated?: () => void;
}

/**
 * Subscribe to Telegram's activated/deactivated events. Returns an unsubscribe function.
 * Missing object/methods are a no-op (feature detection; never assume a Bot API version).
 */
export function installTelegramLifecycleHooks(
  webApp: TelegramLifecycleApi | undefined,
  options: LifecycleHooksOptions,
): () => void {
  if (!webApp || typeof webApp.onEvent !== 'function') return () => {};

  const onActivated = (): void => options.onActivated?.();
  const onDeactivated = (): void => options.onDeactivated?.();

  webApp.onEvent('activated', onActivated);
  webApp.onEvent('deactivated', onDeactivated);

  return () => {
    webApp.offEvent?.('activated', onActivated);
    webApp.offEvent?.('deactivated', onDeactivated);
  };
}
```

## apps/miniapp/src/ui/common.tsx

```typescript
/**
 * Small shared UI primitives. Mobile-first, Telegram theme variables, WCAG-friendly focus styles.
 * No secret ever passes through these components as props or state.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';
import { useTelegram } from '../telegram';

export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <span className="text-xs opacity-70" aria-label={`Step ${String(current)} of ${String(total)}`}>
      Step {current} of {total}
    </span>
  );
}

/**
 * Mobile: full-bleed with Telegram safe areas. Desktop: a centred elevated card.
 * The card surface uses the Telegram section colour so the app still looks native.
 */
export function ScreenShell({
  title,
  children,
  onBack,
  step,
}: {
  title: string;
  children: ReactNode;
  onBack?: (() => void) | undefined;
  step?: { current: number; total: number } | undefined;
}) {
  const { theme } = useTelegram();
  return (
    <div
      className="min-h-screen w-full flex justify-center"
      style={{
        backgroundColor: theme?.backgroundColor ?? 'var(--tg-theme-bg-color, #fff)',
        color: theme?.textColor ?? 'var(--tg-theme-text-color, #000)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div
        className="w-full max-w-md flex flex-col min-h-screen sm:min-h-0 sm:my-8 sm:rounded-2xl sm:shadow-xl sm:border sm:border-black/10 overflow-hidden"
        style={{
          backgroundColor: theme?.sectionBgColor ?? 'var(--tg-theme-section-bg-color, #fff)',
        }}
      >
        <header
          className="px-4 py-3 flex items-center gap-3"
          style={{
            backgroundColor: theme?.headerBgColor ?? 'var(--tg-theme-header-bg-color, #f0f0f0)',
          }}
        >
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-sm underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              aria-label="Back"
            >
              ←
            </button>
          ) : null}
          <h1 className="text-lg font-semibold flex-1">{title}</h1>
          {step ? <StepIndicator current={step.current} total={step.total} /> : null}
        </header>
        <main className="flex-1 px-4 py-6 flex flex-col gap-4 w-full">{children}</main>
      </div>
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const base =
    'w-full min-h-11 rounded-lg px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary:
      'text-[var(--tg-theme-button-text-color,#fff)] bg-[var(--tg-theme-button-color,#2481cc)]',
    secondary: 'border border-current bg-transparent',
    danger: 'text-white bg-[var(--tg-theme-destructive-text-color,#ff3b30)]',
  } as const;
  return <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  id,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  id: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className="min-h-11 rounded-lg border border-gray-400/60 bg-transparent px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        {...props}
      />
      {hint ? <p className="text-xs opacity-70">{hint}</p> : null}
    </div>
  );
}

export function PhraseInput({
  label,
  hint,
  id,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  id: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={4}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="rounded-lg border border-gray-400/60 bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        {...props}
      />
      {hint ? <p className="text-xs opacity-70">{hint}</p> : null}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className="text-sm text-[var(--tg-theme-destructive-text-color,#ff3b30)]"
    >
      {children}
    </p>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
}) {
  return (
    <p
      className={`rounded-lg p-3 text-sm ${
        tone === 'warning'
          ? 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100'
          : 'bg-black/5 dark:bg-white/10'
      }`}
    >
      {children}
    </p>
  );
}
```

## apps/miniapp/src/ui/onboarding.tsx

```typescript
/**
 * Welcome, create-phrase, reveal-phrase and backup-verification screens.
 *
 * Secrets rule is unchanged: the phrase lives only in the module-scoped holder. It is written
 * into the DOM imperatively after an explicit tap (two numbered columns of pills) and removed
 * when hidden or unmounted. No word or passcode is ever React state.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';

type Step = { current: number; total: number };

function createWordItem(index: number, word: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const badge = document.createElement('span');
  badge.textContent = String(index + 1);
  badge.className =
    'h-6 w-6 shrink-0 rounded-full bg-black/10 dark:bg-white/20 text-xs flex items-center justify-center';
  const pill = document.createElement('span');
  pill.textContent = word;
  pill.dataset['role'] = 'word';
  pill.dataset['wordIndex'] = String(index);
  pill.className = 'flex-1 rounded-full bg-black/5 dark:bg-white/10 px-3 py-1 font-mono text-sm';
  row.append(badge, pill);
  return row;
}

function renderPhrase(left: HTMLDivElement | null, right: HTMLDivElement | null): void {
  const words = secretHolder.words();
  if (left) left.replaceChildren();
  if (right) right.replaceChildren();
  if (words.length === 0) return;
  const half = Math.ceil(words.length / 2);
  words.forEach((word, index) => {
    const item = createWordItem(index, word);
    const target = index < half ? left : right;
    target?.append(item);
  });
}

export function PhraseGrid({
  leftRef,
  rightRef,
}: {
  leftRef: RefObject<HTMLDivElement | null>;
  rightRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      data-testid="phrase-words"
      aria-label="Recovery phrase words"
      className="grid grid-cols-2 gap-2 min-h-6"
    >
      <div ref={leftRef} className="flex flex-col gap-2" />
      <div ref={rightRef} className="flex flex-col gap-2" />
    </div>
  );
}

function pickPositions(count: number, take: number): number[] {
  const positions = Array.from({ length: count }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const random = crypto.getRandomValues(new Uint32Array(1));
    const j = (random[0] ?? 0) % (i + 1);
    const a = positions[i];
    const b = positions[j];
    if (a !== undefined && b !== undefined) {
      positions[i] = b;
      positions[j] = a;
    }
  }
  return positions.slice(0, Math.min(take, count)).sort((a, b) => a - b);
}

export function WelcomeScreen({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <ScreenShell title={t('app.name')}>
      <h2 className="text-xl font-semibold">{t('welcome.title')}</h2>
      <p className="text-sm opacity-80">{t('app.tagline')}</p>
      <p className="text-sm">{t('welcome.body')}</p>
      <p className="text-sm">{t('welcome.telegram.body')}</p>
      <Notice tone="warning">{t('welcome.never.ask')}</Notice>
      <p className="text-xs opacity-70">{t('welcome.support')}</p>
      <Button onClick={onCreate}>{t('welcome.create')}</Button>
      <Button variant="secondary" onClick={onImport}>
        {t('welcome.import')}
      </Button>
    </ScreenShell>
  );
}

/** Create, step 1: show the generated phrase and require a backup acknowledgement. */
export function CreatePhraseScreen({
  onBack,
  onDone,
  step,
}: {
  onBack: () => void;
  onDone: () => void;
  step: Step;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPhrase = secretHolder.has();

  useEffect(() => {
    if (revealed) {
      if (!secretHolder.has()) {
        setError(t('settings.error'));
        return;
      }
      renderPhrase(leftRef.current, rightRef.current);
    } else {
      renderPhrase(null, null);
    }
  }, [revealed]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && revealed) setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const left = leftRef.current;
    const right = rightRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (left) left.replaceChildren();
      if (right) right.replaceChildren();
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack} step={step}>
      <Notice tone="warning">{t('phrase.warning')}</Notice>
      <PhraseGrid leftRef={leftRef} rightRef={rightRef} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {revealed ? (
        <Button
          variant="secondary"
          onClick={() => {
            setRevealed(false);
          }}
        >
          {t('phrase.hide')}
        </Button>
      ) : (
        <Button
          onClick={() => {
            setRevealed(true);
          }}
        >
          {hasPhrase ? t('phrase.reveal') : t('phrase.revealAgain')}
        </Button>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={!revealed}
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
          className="mt-1"
        />
        <span>{t('phrase.checkbox')}</span>
      </label>
      <Button onClick={onDone} disabled={!revealed || !checked || !hasPhrase}>
        {t('phrase.next')}
      </Button>
    </ScreenShell>
  );
}

/** Settings-mode reveal (re-authenticated) with the same two-column layout. */
export function PhraseScreen({
  onBack,
  onDone,
  step,
}: {
  onBack: () => void;
  onDone: () => void;
  step?: Step;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (revealed) {
      if (!secretHolder.has()) {
        setEmpty(true);
        return;
      }
      renderPhrase(leftRef.current, rightRef.current);
    } else {
      renderPhrase(null, null);
    }
  }, [revealed]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && revealed) setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const left = leftRef.current;
    const right = rightRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (left) left.replaceChildren();
      if (right) right.replaceChildren();
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack} step={step}>
      <Notice tone="warning">{t('phrase.settings.warning')}</Notice>
      <PhraseGrid leftRef={leftRef} rightRef={rightRef} />
      {empty ? <ErrorText>{t('settings.error')}</ErrorText> : null}
      {revealed ? (
        <Button
          variant="secondary"
          onClick={() => {
            setRevealed(false);
          }}
        >
          {t('phrase.hide')}
        </Button>
      ) : (
        <Button
          onClick={() => {
            setRevealed(true);
          }}
        >
          {t('phrase.reveal')}
        </Button>
      )}
      <Button onClick={onDone}>{t('common.done')}</Button>
    </ScreenShell>
  );
}

export function VerifyScreen({
  onVerified,
  onCancel,
  step,
}: {
  onVerified: () => void;
  onCancel: () => void;
  step?: Step;
}) {
  const words = secretHolder.words();
  const positions = useMemo(() => pickPositions(words.length, 3), [words.length]);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (): void => {
    const wrong: number[] = [];
    positions.forEach((position, index) => {
      const answer = (inputs.current[index]?.value ?? '').trim().toLowerCase();
      if (answer !== (words[position] ?? '').toLowerCase()) wrong.push(position + 1);
    });
    if (wrong.length > 0) {
      setError(`${t('verify.retry')} (${wrong.join(', ')})`);
      return;
    }
    setError(null);
    secretHolder.clear();
    setDone(true);
    onVerified();
  };

  if (done) return null;

  return (
    <ScreenShell title={t('verify.title')} onBack={onCancel} step={step}>
      <p className="text-sm">{t('verify.body')}</p>
      {positions.map((position, index) => (
        <Field
          key={position}
          id={`word-${String(position)}`}
          label={`${t('verify.wordAt')} ${String(position + 1)}`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          ref={(element) => {
            inputs.current[index] = element;
          }}
        />
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={submit}>{t('verify.submit')}</Button>
    </ScreenShell>
  );
}
```

## apps/miniapp/src/ui/import.tsx

```typescript
/**
 * Import, step 1: the recovery phrase as 12/24 numbered, uncontrolled word boxes.
 *
 * Word values live in the DOM/refs only. React state holds the box count, invalid box indexes
 * and the advanced toggle — never a word. Smart paste fills the boxes from the clipboard event.
 */
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { isBip39Word } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { Button, ErrorText, Notice, ScreenShell } from './common';

function splitWords(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function ImportPhraseScreen({
  onBack,
  onNext,
  step,
}: {
  onBack: () => void;
  /** Receives the assembled words and the advanced flag; returns an error message or null. */
  onNext: (words: string[], forceTonNative: boolean) => Promise<string | null>;
  step?: { current: number; total: number };
}) {
  const [count, setCount] = useState<24 | 12>(24);
  const [invalid, setInvalid] = useState<Set<number>>(new Set());
  const [forceTonNative, setForceTonNative] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pending = useRef<string[] | null>(null);

  const focus = (index: number): void => {
    const target = inputs.current[Math.max(0, Math.min(index, count - 1))];
    target?.focus();
    target?.select();
  };

  const markWord = (index: number, value: string): void => {
    setInvalid((prev) => {
      const next = new Set(prev);
      if (value.trim() !== '' && !isBip39Word(value)) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const applyPending = (): void => {
    const words = pending.current;
    if (!words) return;
    pending.current = null;
    words.forEach((word, index) => {
      const input = inputs.current[index];
      if (input) input.value = word;
    });
    const next = new Set<number>();
    words.forEach((word, index) => {
      if (!isBip39Word(word)) next.add(index);
    });
    setInvalid(next);
    focus(Math.min(words.length, count - 1));
  };

  // A paste that changes the word count re-renders first; fill once the boxes exist.
  useEffect(() => {
    if (pending.current) {
      const words = pending.current;
      pending.current = null;
      words.forEach((word, index) => {
        const input = inputs.current[index];
        if (input) input.value = word;
      });
      const next = new Set<number>();
      words.forEach((word, index) => {
        if (!isBip39Word(word)) next.add(index);
      });
      setInvalid(next);
    }
  }, [count]);

  const collect = (): string[] =>
    Array.from({ length: count }, (_, index) => (inputs.current[index]?.value ?? '').trim());

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const words = splitWords(event.clipboardData.getData('text/plain'));
    if (words.length >= 2) {
      event.preventDefault();
      const nextCount: 12 | 24 = words.length === 12 ? 12 : words.length === 24 ? 24 : count;
      pending.current = words.slice(0, nextCount);
      if (nextCount !== count) setCount(nextCount);
      else applyPending();
    }
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const words = collect();
    const empty = words.findIndex((w) => w === '');
    if (empty !== -1) {
      setError(`${t('import.step.phrase')}: ${String(empty + 1)}`);
      return;
    }
    const bad = new Set<number>();
    words.forEach((word, index) => {
      if (!isBip39Word(word)) bad.add(index);
    });
    if (bad.size > 0) {
      setInvalid(bad);
      setError(t('import.invalidWord'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const failure = await onNext(words, forceTonNative);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<[number, number]> = [
    [0, count / 2 - 1],
    [count / 2, count - 1],
  ];

  return (
    <ScreenShell title={t('import.title')} onBack={onBack} step={step}>
      <div role="group" aria-label="Recovery phrase length" className="flex gap-2">
        {([24, 12] as const).map((option) => (
          <Button
            key={option}
            variant={count === option ? 'primary' : 'secondary'}
            aria-pressed={count === option}
            className="w-auto px-3 min-h-9 text-sm"
            onClick={() => {
              setCount(option);
              setInvalid(new Set());
              setError(null);
              pending.current = null;
            }}
          >
            {option === 24 ? t('import.words24') : t('import.words12')}
          </Button>
        ))}
      </div>
      <p className="text-xs opacity-70">{t('import.pasteHint')}</p>

      <div className="grid grid-cols-2 gap-2">
        {columns.map(([start, end], columnIndex) => (
          <div key={columnIndex} className="flex flex-col gap-2">
            {Array.from({ length: end - start + 1 }, (_, offset) => {
              const index = start + offset;
              return (
                <div key={index} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-6 w-6 shrink-0 rounded-full bg-black/10 dark:bg-white/20 text-xs flex items-center justify-center"
                  >
                    {index + 1}
                  </span>
                  <input
                    ref={(element) => {
                      inputs.current[index] = element;
                    }}
                    id={`import-word-${String(index)}`}
                    aria-label={`Word ${String(index + 1)}`}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className={`w-full min-h-9 rounded-lg border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      invalid.has(index) ? 'border-red-500' : 'border-gray-400/60'
                    } bg-transparent`}
                    onBlur={(event) => {
                      markWord(index, event.target.value);
                    }}
                    onPaste={handlePaste}
                    onKeyDown={(event) => {
                      if (event.key === ' ' || event.key === 'Enter' || event.key === 'Tab') {
                        if (index === count - 1 && event.key === 'Enter') {
                          event.preventDefault();
                          void submit();
                          return;
                        }
                        event.preventDefault();
                        focus(index + 1);
                      } else if (
                        event.key === 'Backspace' &&
                        event.currentTarget.value === '' &&
                        index > 0
                      ) {
                        event.preventDefault();
                        focus(index - 1);
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer opacity-70">{t('import.advanced')}</summary>
        <label className="mt-2 flex items-start gap-2">
          <input
            type="checkbox"
            checked={forceTonNative}
            onChange={(event) => {
              setForceTonNative(event.target.checked);
            }}
            className="mt-1"
          />
          <span>{t('import.forceTon')}</span>
        </label>
      </details>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Notice tone="warning">{t('welcome.never.ask')}</Notice>
      <Button
        onClick={() => {
          void submit();
        }}
        disabled={busy}
      >
        {busy ? t('common.working') : t('import.continue')}
      </Button>
    </ScreenShell>
  );
}

export function DisambiguateScreen({
  onBack,
  onChoose,
  step,
}: {
  onBack: () => void;
  onChoose: (accountType: 'bip39-multichain' | 'ton-native-only') => void;
  step?: { current: number; total: number };
}) {
  return (
    <ScreenShell title={t('import.disambiguate.title')} onBack={onBack} step={step}>
      <p className="text-sm">{t('import.disambiguate.body')}</p>
      <Button
        onClick={() => {
          onChoose('bip39-multichain');
        }}
      >
        {t('import.disambiguate.standard')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          onChoose('ton-native-only');
        }}
      >
        {t('import.disambiguate.ton')}
      </Button>
    </ScreenShell>
  );
}
```

## apps/miniapp/src/ui/passcode.tsx

```typescript
/**
 * Dedicated passcode screen shared by Create (step 3) and Import (step 2).
 *
 * The passcode is read from uncontrolled inputs only; React state holds metadata about the
 * policy (length, ok, error), never the value. Visibility toggling changes input types without
 * re-rendering from a value prop.
 */
import { useRef, useState } from 'react';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';

interface PasscodeMeta {
  length: number;
  ok: boolean;
  error: string | null;
}

export function PasscodeScreen({
  manager,
  title,
  onBack,
  onSubmit,
  submitLabel,
  step,
}: {
  manager: VaultManager;
  title: string;
  onBack: () => void;
  /** Returns an error message, or null on success. */
  onSubmit: (passcode: string) => Promise<string | null>;
  submitLabel: string;
  step?: { current: number; total: number };
}) {
  const passRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [meta, setMeta] = useState<PasscodeMeta>({ length: 0, ok: false, error: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (value: string): void => {
    if (value === '') {
      setMeta({ length: 0, ok: false, error: null });
      return;
    }
    const policy = manager.evaluatePasscode(value);
    setMeta({ length: value.length, ok: policy.ok, error: policy.error ?? null });
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const passcode = passRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';
    if (passcode !== confirm) {
      setError(t('passcode.mismatch'));
      return;
    }
    const policy = manager.evaluatePasscode(passcode);
    if (!policy.ok) {
      setError(policy.error ?? t('passcode.weak'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const failure = await onSubmit(passcode);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
      if (passRef.current) passRef.current.value = '';
      if (confirmRef.current) confirmRef.current.value = '';
      setMeta({ length: 0, ok: false, error: null });
    }
  };

  const type = visible ? 'text' : 'password';

  return (
    <ScreenShell title={title} onBack={onBack} step={step}>
      <Notice tone={manager.usesDeviceSecret ? 'info' : 'warning'}>
        {manager.usesDeviceSecret
          ? t('passcode.requirements.device')
          : t('passcode.requirements.noDevice')}
      </Notice>
      {manager.usesDeviceSecret ? null : (
        <p className="text-xs opacity-70">{t('passcode.requirements.offline')}</p>
      )}

      <Field
        id="passcode"
        ref={passRef}
        label={t('passcode.label')}
        type={type}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete="new-password"
        autoFocus
        onChange={(event) => {
          update(event.target.value);
        }}
      />
      <Field
        id="passcode-confirm"
        ref={confirmRef}
        label={t('passcode.confirm')}
        type={type}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete="new-password"
      />
      <Button
        variant="secondary"
        onClick={() => {
          setVisible((v) => !v);
        }}
        aria-pressed={visible}
        className="w-auto self-start px-3 min-h-9 text-sm"
      >
        {visible ? t('passcode.hide') : t('passcode.show')}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${meta.ok ? 'text-green-600 dark:text-green-400' : 'opacity-70'}`}
      >
        {meta.length === 0
          ? ''
          : `${String(meta.length)} ${t('passcode.lengthLabel')} — ${
              meta.ok ? t('passcode.met') : (meta.error ?? t('passcode.notMet'))
            }`}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        onClick={() => {
          void submit();
        }}
        disabled={busy}
      >
        {busy ? t('common.working') : submitLabel}
      </Button>
    </ScreenShell>
  );
}
```

## apps/miniapp/src/ui/wallet.tsx

```typescript
/**
 * Unlock, home and settings screens.
 *
 * All passcodes and phrases are read from uncontrolled inputs at submit time; the phrase only
 * exists in the module holder and is written into the DOM on demand. Settings actions that
 * touch secrets require a fresh passcode re-authentication.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setInactivityTimeout } from '@onezerowallet/crypto-vault';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import type { BiometryApi } from '../adapters/biometry';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';

const AUTO_LOCK_KEY = 'ozw.autoLockMs';

function rateLimitedText(ms: number): string {
  return `${t('unlock.rateLimited')} ${String(Math.ceil(ms / 1000))}s`;
}

export function UnlockScreen({
  manager,
  biometry,
  onUnlocked,
  onWiped,
}: {
  manager: VaultManager;
  biometry: BiometryApi;
  onUnlocked: () => void;
  onWiped: () => void;
}) {
  const passRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterMs, setRetryAfterMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [available, enabled] = await Promise.all([
        biometry.available(),
        manager.hasBiometric(),
      ]);
      if (!controller.signal.aborted) {
        setBioAvailable(available);
        setBioEnabled(enabled);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [biometry, manager]);

  useEffect(() => {
    if (retryAfterMs <= 0) return;
    const id = window.setInterval(() => {
      setRetryAfterMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [retryAfterMs]);

  const unlock = async (): Promise<void> => {
    if (busy || retryAfterMs > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await manager.unlock(passRef.current?.value ?? '');
      if (passRef.current) passRef.current.value = '';
      if (result.success) {
        onUnlocked();
        return;
      }
      if (result.error === 'rate_limited') {
        setRetryAfterMs(result.retryAfterMs ?? 0);
        return;
      }
      if (result.error === 'wiped') {
        setError(t('unlock.wiped'));
        onWiped();
        return;
      }
      if (result.error === 'device_secret_missing') {
        setError(t('unlock.deviceSecretMissing'));
        return;
      }
      if (result.error === 'storage_required') {
        setError(t('unlock.storage'));
        return;
      }
      if (result.error === 'kdf_unavailable') {
        setError(t('unlock.kdf'));
        return;
      }
      setError(t('unlock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  const unlockBiometric = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await biometry.authenticate('Unlock your wallet');
      if (!token) {
        setError(t('unlock.wrong'));
        return;
      }
      const result = await manager.unlockWithBiometric(token);
      if (result.success) {
        onUnlocked();
        return;
      }
      if (result.error === 'rate_limited') {
        setRetryAfterMs(result.retryAfterMs ?? 0);
        return;
      }
      setError(t('unlock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title={t('unlock.title')}>
      <Field
        id="unlock-passcode"
        ref={passRef}
        label={t('unlock.passcode')}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        autoComplete="current-password"
        autoFocus
      />
      {retryAfterMs > 0 ? (
        <p role="status" aria-live="polite" className="text-sm">
          {rateLimitedText(retryAfterMs)}
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void unlock()} disabled={busy || retryAfterMs > 0}>
        {busy ? t('common.working') : t('unlock.submit')}
      </Button>
      {bioAvailable && bioEnabled ? (
        <Button variant="secondary" onClick={() => void unlockBiometric()} disabled={busy}>
          {t('unlock.biometric')}
        </Button>
      ) : null}
      <Notice>{t('home.notice')}</Notice>
    </ScreenShell>
  );
}

function shortAddress(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button
      variant="secondary"
      onClick={() => void copy()}
      aria-label={label}
      className="w-auto px-3 min-h-9 text-sm"
    >
      {copied ? t('home.copied') : t('home.copy')}
    </Button>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {hidden ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.2A10 10 0 0 1 12 5c5 0 9 7 9 7a17 17 0 0 1-2.2 3.1M6.1 6.1A17 17 0 0 0 3 12s4 7 9 7a9.9 9.9 0 0 0 3.9-.8" />
        </>
      ) : (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function ActionIcon({ kind }: { kind: 'receive' | 'send' | 'swap' | 'stake' }) {
  const paths = {
    receive: (
      <>
        <path d="M12 4v12" />
        <path d="M6 10l6 6 6-6" />
        <path d="M4 20h16" />
      </>
    ),
    send: (
      <>
        <path d="M12 20V8" />
        <path d="M6 14l6-6 6 6" />
        <path d="M4 4h16" />
      </>
    ),
    swap: (
      <>
        <path d="M4 8h13l-3-3" />
        <path d="M20 16H7l3 3" />
      </>
    ),
    stake: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M9.5 10.5h5M9.5 13.5h5" />
      </>
    ),
  } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  return (
    <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="19" className="fill-current opacity-15" />
      <text x="20" y="24" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">
        {symbol}
      </text>
    </svg>
  );
}

type Chain = 'ton' | 'tron' | 'evm';
type SheetState =
  { kind: 'receive'; focus: Chain } | { kind: 'notice'; title: string; body: string } | null;

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--tg-theme-bg-color, #fff)',
          color: 'var(--tg-theme-text-color, #000)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('home.close')}
            className="min-h-9 min-w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function HomeScreen({
  manager,
  onLock,
  onSettings,
}: {
  manager: VaultManager;
  onLock: () => void;
  onSettings: () => void;
}) {
  const session = manager.getSession();
  const info = session?.getPublicInfo(0) ?? null;
  const [tab, setTab] = useState<'wallet' | 'activity'>('wallet');
  const [masked, setMasked] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [copiedPill, setCopiedPill] = useState(false);

  const hasTron = info?.tron !== undefined;
  const hasEvm = info?.evm !== undefined;

  const assets = [
    {
      id: 'TON',
      name: 'Toncoin',
      badge: 'TON',
      symbol: 'TON',
      chain: 'ton' as Chain,
      visible: true,
    },
    {
      id: 'USDT',
      name: 'Tether USD',
      badge: 'TON · Jetton',
      symbol: 'USDT',
      chain: 'ton' as Chain,
      visible: true,
    },
    {
      id: 'TRX',
      name: 'TRON',
      badge: 'TRC-20',
      symbol: 'TRX',
      chain: 'tron' as Chain,
      visible: hasTron,
    },
    {
      id: 'ETH',
      name: 'Ethereum',
      badge: 'ERC-20',
      symbol: 'ETH',
      chain: 'evm' as Chain,
      visible: hasEvm,
    },
  ].filter((asset) => asset.visible);

  const copyTon = async (): Promise<void> => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.ton.addressNonBounceable);
      setCopiedPill(true);
      window.setTimeout(() => {
        setCopiedPill(false);
      }, 1500);
    } catch {
      setCopiedPill(false);
    }
  };

  const openReceive = (focus: Chain): void => {
    setSheet({ kind: 'receive', focus });
  };

  const receiveEntries = [
    {
      chain: 'ton' as Chain,
      label: t('receive.ton'),
      value: info?.ton.addressNonBounceable ?? '',
      hint: t('receive.tonHint'),
    },
    ...(info?.tron
      ? [
          {
            chain: 'tron' as Chain,
            label: t('receive.tron'),
            value: info.tron.address,
            hint: undefined,
          },
        ]
      : []),
    ...(info?.evm
      ? [
          {
            chain: 'evm' as Chain,
            label: t('receive.evm'),
            value: info.evm.address,
            hint: undefined,
          },
        ]
      : []),
  ];

  return (
    <ScreenShell title={t('home.title')}>
      {info ? (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                openReceive('ton');
              }}
              aria-label={t('home.walletInfo')}
              className="h-9 w-9 shrink-0 rounded-full bg-indigo-500/15 ring-2 ring-indigo-500/40 text-indigo-600 dark:text-indigo-300 text-xs font-bold flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              OZ
            </button>
            <div
              role="tablist"
              aria-label={t('home.title')}
              className="flex-1 rounded-full bg-black/5 dark:bg-white/10 p-1"
            >
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'wallet'}
                  onClick={() => {
                    setTab('wallet');
                  }}
                  className={`min-h-8 rounded-full text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    tab === 'wallet'
                      ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow'
                      : 'opacity-70'
                  }`}
                >
                  {t('home.walletTab')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'activity'}
                  onClick={() => {
                    setTab('activity');
                  }}
                  className={`min-h-8 rounded-full text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    tab === 'activity'
                      ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow'
                      : 'opacity-70'
                  }`}
                >
                  {t('home.activityTab')}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onLock}
              aria-label={t('home.lock')}
              className="h-9 w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <LockIcon />
            </button>
            <button
              type="button"
              onClick={onSettings}
              aria-label={t('home.settings')}
              className="h-9 w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <GearIcon />
            </button>
            <span className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
              {t('home.testnet')}
            </span>
          </div>

          <section
            className="rounded-2xl p-4 text-white border border-white/15 shadow-lg bg-gradient-to-br from-[#0b1b3a] via-[#1e2a78] to-[#0aa7c2]"
            aria-label={t('home.mainWallet')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white/80">{t('home.mainWallet')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyTon()}
                  aria-label={t('home.copyTon')}
                  data-testid="ton-address-pill"
                  className="rounded-full bg-white/15 px-3 py-1 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {copiedPill ? t('home.copied') : shortAddress(info.ton.addressNonBounceable)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMasked((v) => !v);
                  }}
                  aria-label={masked ? t('home.showBalance') : t('home.hideBalance')}
                  className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <EyeIcon hidden={masked} />
                </button>
              </div>
            </div>
            <p data-testid="hero-balance" className="mt-4 text-4xl font-bold tracking-tight">
              {masked ? '••••' : '$0.00'}
            </p>
            <span className="mt-2 inline-block rounded-full bg-white/15 px-3 py-1 text-xs text-white/80">
              $0.00 · 0.00% 24h
            </span>
          </section>

          <div className="grid grid-cols-4 gap-3">
            {(
              [
                ['receive', 'home.receive', 'bg-blue-500/15 text-blue-600 dark:text-blue-300'],
                ['send', 'home.send', 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'],
                ['swap', 'home.swap', 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'],
                ['stake', 'home.stake', 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'],
              ] as const
            ).map(([kind, key, colors]) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  if (kind === 'receive') openReceive('ton');
                  else if (kind === 'send')
                    setSheet({ kind: 'notice', title: t('home.send'), body: t('home.sendNotice') });
                  else if (kind === 'swap')
                    setSheet({ kind: 'notice', title: t('home.swap'), body: t('home.swapNotice') });
                  else
                    setSheet({
                      kind: 'notice',
                      title: t('home.stake'),
                      body: t('home.stakeNotice'),
                    });
                }}
                aria-label={t(key)}
                className="flex flex-col items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl py-1"
              >
                <span
                  className={`h-12 w-12 rounded-2xl flex items-center justify-center ${colors}`}
                >
                  <ActionIcon kind={kind} />
                </span>
                <span className="text-xs">{t(key)}</span>
              </button>
            ))}
          </div>

          {tab === 'wallet' ? (
            <section aria-label={t('home.walletTab')} className="flex flex-col gap-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  data-testid={`asset-${asset.id}`}
                  aria-label={`${asset.name} ${asset.badge}`}
                  onClick={() => {
                    openReceive(asset.chain);
                  }}
                  className="w-full flex items-center gap-3 rounded-xl bg-black/5 dark:bg-white/10 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <TokenIcon symbol={asset.symbol} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{asset.name}</span>
                    <span className="inline-block mt-0.5 rounded-full bg-black/10 dark:bg-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
                      {asset.badge}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold">0 {asset.symbol}</span>
                    <span className="block text-xs opacity-70">$0.00</span>
                  </span>
                </button>
              ))}
            </section>
          ) : (
            <section
              aria-label={t('home.activityTab')}
              className="rounded-xl bg-black/5 dark:bg-white/10 p-6 text-center text-sm opacity-70"
            >
              {t('home.activityEmpty')}
            </section>
          )}

          <Notice>{t('home.notice')}</Notice>
        </>
      ) : (
        <ErrorText>{t('settings.error')}</ErrorText>
      )}

      {sheet ? (
        <Sheet
          title={sheet.kind === 'receive' ? t('receive.title') : sheet.title}
          onClose={() => {
            setSheet(null);
          }}
        >
          {sheet.kind === 'receive' ? (
            <>
              {receiveEntries
                .sort((a, b) => (a.chain === sheet.focus ? -1 : b.chain === sheet.focus ? 1 : 0))
                .map((entry) => (
                  <div
                    key={entry.chain}
                    className="rounded-lg bg-black/5 dark:bg-white/10 p-3 flex flex-col gap-1"
                  >
                    <span className="text-xs opacity-70">{entry.label}</span>
                    <code
                      className="text-xs break-all"
                      data-testid={`address-${entry.chain.toUpperCase()}`}
                    >
                      {entry.value}
                    </code>
                    {entry.hint ? <span className="text-xs opacity-70">{entry.hint}</span> : null}
                    <CopyButton value={entry.value} label={`${t('home.copy')} ${entry.label}`} />
                  </div>
                ))}
            </>
          ) : (
            <p className="text-sm">{sheet.body}</p>
          )}
        </Sheet>
      ) : null}
    </ScreenShell>
  );
}

export function SettingsScreen({
  manager,
  biometry,
  onBack,
  onReveal,
  onTestBackup,
  onWiped,
}: {
  manager: VaultManager;
  biometry: BiometryApi;
  onBack: () => void;
  onReveal: () => void;
  onTestBackup: () => void;
  onWiped: () => void;
}) {
  const reauthRef = useRef<HTMLInputElement>(null);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const bioPassRef = useRef<HTMLInputElement>(null);
  const wipeRef = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [autoLockMs, setAutoLockMs] = useState<number>(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTO_LOCK_KEY) : null;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
  });

  useEffect(() => {
    void (async () => {
      setBioAvailable(await biometry.available());
      setBioEnabled(await manager.hasBiometric());
    })();
  }, [biometry, manager]);

  const reauth = async (): Promise<boolean> => {
    const session = manager.getSession();
    if (!session) return false;
    const result = await session.reauthenticate(reauthRef.current?.value ?? '');
    if (reauthRef.current) reauthRef.current.value = '';
    if (!result.ok) {
      setError(
        result.error === 'rate_limited'
          ? rateLimitedText(result.retryAfterMs ?? 0)
          : t('unlock.wrong'),
      );
      return false;
    }
    setError(null);
    return true;
  };

  const reveal = async (): Promise<void> => {
    const session = manager.getSession();
    if (!session) return;
    if (!(await reauth())) return;
    const revealed = session.revealMnemonic();
    if (!revealed.ok) {
      setError(t('unlock.wrong'));
      return;
    }
    secretHolder.set(revealed.mnemonic);
    onReveal();
  };

  const testBackup = async (): Promise<void> => {
    const session = manager.getSession();
    if (!session) return;
    if (!(await reauth())) return;
    const revealed = session.revealMnemonic();
    if (!revealed.ok) return;
    secretHolder.set(revealed.mnemonic);
    onTestBackup();
  };

  const changePasscode = async (): Promise<void> => {
    const next = newRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';
    if (next !== confirm) {
      setError(t('passcode.mismatch'));
      return;
    }
    const policy = manager.evaluatePasscode(next);
    if (!policy.ok) {
      setError(policy.error ?? t('passcode.weak'));
      return;
    }
    setError(null);
    const result = await manager.changePasscode(oldRef.current?.value ?? '', next);
    if (oldRef.current) oldRef.current.value = '';
    if (newRef.current) newRef.current.value = '';
    if (confirmRef.current) confirmRef.current.value = '';
    if (!result.ok) {
      setError(
        result.error === 'weak_passcode'
          ? (result.message ?? t('passcode.weak'))
          : t('unlock.wrong'),
      );
      return;
    }
    if (result.biometricToken) {
      const stored = await biometry.updateToken(result.biometricToken);
      if (!stored) setError(t('settings.error'));
    }
    setMessage(t('settings.changed'));
  };

  const toggleBiometrics = async (enable: boolean): Promise<void> => {
    const passcode = bioPassRef.current?.value ?? '';
    if (bioPassRef.current) bioPassRef.current.value = '';
    setError(null);
    if (enable) {
      const grant = await biometry.requestAccess('Protect your wallet');
      if (!grant) {
        setError(t('settings.error'));
        return;
      }
      const enabled = await manager.enableBiometric(passcode);
      if (!enabled.ok) {
        setError(t('unlock.wrong'));
        return;
      }
      if (!(await biometry.updateToken(enabled.token))) {
        setError(t('settings.error'));
        return;
      }
      setBioEnabled(true);
    } else {
      const disabled = await manager.disableBiometric(passcode);
      if (!disabled.ok) {
        setError(t('unlock.wrong'));
        return;
      }
      await biometry.updateToken(null);
      setBioEnabled(false);
    }
  };

  const wipe = async (): Promise<void> => {
    if ((wipeRef.current?.value ?? '').trim().toUpperCase() !== 'WIPE') {
      setError(t('settings.wipeConfirm'));
      return;
    }
    await manager.wipe();
    secretHolder.clear();
    onWiped();
  };

  const autoLockOptions = useMemo(
    () => [
      { value: 60_000, label: t('settings.autoLock.min1') },
      { value: 300_000, label: t('settings.autoLock.min5') },
      { value: 900_000, label: t('settings.autoLock.min15') },
    ],
    [],
  );

  return (
    <ScreenShell title={t('settings.title')} onBack={onBack}>
      <section className="flex flex-col gap-2" aria-labelledby="settings-backup">
        <h2 id="settings-backup" className="font-semibold">
          {t('settings.reveal')}
        </h2>
        <Field
          id="settings-reauth"
          ref={reauthRef}
          label={t('settings.requiresPasscode')}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="current-password"
        />
        <Button onClick={() => void reveal()}>{t('settings.reveal')}</Button>
        <Button variant="secondary" onClick={() => void testBackup()}>
          {t('settings.testBackup')}
        </Button>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="settings-passcode">
        <h2 id="settings-passcode" className="font-semibold">
          {t('settings.changePasscode')}
        </h2>
        <Field
          id="old-passcode"
          ref={oldRef}
          label={t('settings.oldPasscode')}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="current-password"
        />
        <Field
          id="new-passcode"
          ref={newRef}
          label={t('settings.newPasscode')}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="new-password"
        />
        <Field
          id="confirm-passcode"
          ref={confirmRef}
          label={t('settings.confirmPasscode')}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete="new-password"
        />
        <Button onClick={() => void changePasscode()}>{t('settings.save')}</Button>
      </section>

      {bioAvailable ? (
        <section className="flex flex-col gap-2" aria-labelledby="settings-biometrics">
          <h2 id="settings-biometrics" className="font-semibold">
            {t('settings.biometrics')}:{' '}
            {bioEnabled ? t('settings.biometrics.on') : t('settings.biometrics.off')}
          </h2>
          <p className="text-xs opacity-70">{t('settings.biometrics.explain')}</p>
          <Field
            id="bio-passcode"
            ref={bioPassRef}
            label={t('settings.requiresPasscode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="current-password"
          />
          {bioEnabled ? (
            <Button variant="secondary" onClick={() => void toggleBiometrics(false)}>
              {t('settings.biometrics.disable')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void toggleBiometrics(true)}>
              {t('settings.biometrics.enable')}
            </Button>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="settings-autolock">
        <h2 id="settings-autolock" className="font-semibold">
          {t('settings.autoLock')}
        </h2>
        <select
          aria-label={t('settings.autoLock')}
          className="min-h-11 rounded-lg border border-gray-400/60 bg-transparent px-3 py-2"
          value={autoLockMs}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            setAutoLockMs(next);
            setInactivityTimeout(next);
            try {
              localStorage.setItem(AUTO_LOCK_KEY, String(next));
            } catch {
              // Preferences are non-secret; ignore storage failures.
            }
          }}
        >
          {autoLockOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="settings-wipe">
        <h2 id="settings-wipe" className="font-semibold">
          {t('settings.wipe')}
        </h2>
        <p className="text-xs opacity-70">{t('settings.wipeConfirm')}</p>
        <Field
          id="wipe-confirm"
          ref={wipeRef}
          label={t('settings.wipeConfirm')}
          autoComplete="off"
        />
        <Button variant="danger" onClick={() => void wipe()}>
          {t('settings.wipeButton')}
        </Button>
      </section>

      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Notice>{t('home.notice')}</Notice>
    </ScreenShell>
  );
}
```

## apps/miniapp/src/test/setup.ts

```typescript
// Test setup — mock Telegram environment and DOM matchers
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { mockTelegramEnvironment } from '../telegram/__mocks__/telegramMock';

mockTelegramEnvironment();

afterEach(() => {
  cleanup();
});
```

## apps/miniapp/src/test/ui-helpers.tsx

```typescript
/**
 * Shared helpers for UI tests: a real VaultManager over in-memory adapters, a fake biometry
 * adapter (unavailable by default) and the provider stack the app expects.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import { TelegramProvider } from '../telegram/TelegramProvider';
import { VaultProvider, type VaultUi } from '../vault/context';
import { App } from '../App';
import type { BiometryApi } from '../adapters/biometry';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

export function makeBiometry(overrides: Partial<BiometryApi> = {}): BiometryApi {
  return {
    available: () => Promise.resolve(false),
    tokenSaved: () => false,
    requestAccess: () => Promise.resolve(false),
    authenticate: () => Promise.resolve(undefined),
    updateToken: () => Promise.resolve(false),
    openSettings: () => {},
    ...overrides,
  };
}

export function makeVault(options: { secure?: boolean; biometry?: BiometryApi } = {}): VaultUi {
  const sealStorage = new InMemoryStorage();
  const secureStorage = options.secure ? new InMemoryStorage() : undefined;
  const manager = new VaultManager({ sealStorage, secureStorage, config: FAST });
  return {
    manager,
    biometry: options.biometry ?? makeBiometry(),
    secureStorageAvailable: secureStorage !== undefined,
  };
}

export function renderApp(vault: VaultUi): ReturnType<typeof render> {
  const ui: ReactElement = (
    <TelegramProvider>
      <VaultProvider value={vault}>
        <App />
      </VaultProvider>
    </TelegramProvider>
  );
  return render(ui);
}
```

## apps/miniapp/src/test/ui-onboarding.test.tsx

```typescript
/**
 * Onboarding component tests: Create (phrase -> verify -> passcode), Import (12/24 grid with
 * smart paste -> passcode) and the security invariant that no phrase survives the flow.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

const PASS = '2580';
const MNEMONIC_12 = 'test test test test test test test test test test test junk';

function phraseWords(): string[] {
  return Array.from(screen.getByTestId('phrase-words').querySelectorAll('[data-role="word"]')).map(
    (el) => el.textContent,
  );
}

async function createToPasscode(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
  await screen.findByRole('heading', { name: 'Your recovery phrase' });
  expect(screen.getByTestId('phrase-words').textContent).toBe('');

  await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
  await waitFor(() => {
    expect(phraseWords().length).toBeGreaterThan(0);
  });
  const words = phraseWords();
  expect(words).toHaveLength(24);

  const checkbox = screen.getByLabelText("I've stored the seed phrase in a secure place.");
  const next = screen.getByRole('button', { name: 'Next' });
  expect(next).toBeDisabled();
  await user.click(checkbox);
  expect(next).toBeEnabled();
  await user.click(next);

  await screen.findByRole('heading', { name: 'Set a passcode' });
  return words;
}

describe('Onboarding: create', () => {
  it('warns about local data, never asks for the phrase, and has no wallet-type selector', async () => {
    renderApp(makeVault());
    expect(await screen.findByText('Your keys, your coins')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OneZeroWallet');
    expect(screen.getByText(/self-custodial/)).toBeInTheDocument();
    expect(screen.getByText(/We will never ask for your recovery phrase/)).toBeInTheDocument();
    expect(screen.getByText(/may clear local data/)).toBeInTheDocument();
    expect(screen.queryByText('Wallet type')).not.toBeInTheDocument();
  });

  it('phrase is hidden until revealed and Next requires reveal + checkbox', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getByTestId('phrase-words').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(phraseWords()).toHaveLength(24);
    });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('creates the wallet after phrase + passcode and clears the phrase', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    const words = await createToPasscode(user);

    expect(screen.getByText(/Enter a 4-digit PIN/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN', { exact: true }), PASS);
    await user.type(screen.getByLabelText('Confirm PIN'), PASS);
    expect(screen.getByRole('status')).toHaveTextContent(/Requirements met/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Your wallet' });
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(/^0x/);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('phrase-words')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(secretHolder.has()).toBe(false);
    const dump = `${JSON.stringify(localStorage)}\n${JSON.stringify(sessionStorage)}`;
    expect(dump).not.toContain(words[0] ?? 'never');
  });

  it('shows the device-secret PIN requirements and accepts a 4-digit PIN', async () => {
    const user = userEvent.setup();
    renderApp(makeVault({ secure: true }));
    await createToPasscode(user);
    expect(screen.getByText(/Enter a 4-digit PIN/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN', { exact: true }), '2580');
    await user.type(screen.getByLabelText('Confirm PIN'), '2580');
    expect(screen.getByRole('status')).toHaveTextContent(/Requirements met/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your wallet' });
  });

  it('rejects a trivial PIN when a device secret exists', async () => {
    const user = userEvent.setup();
    renderApp(makeVault({ secure: true }));
    await createToPasscode(user);
    await user.type(screen.getByLabelText('PIN', { exact: true }), '1234');
    await user.type(screen.getByLabelText('Confirm PIN'), '1234');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too easy to guess/);
  });

  it('rejects a non-4-digit PIN and stays on the passcode step', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await createToPasscode(user);
    await user.type(screen.getByLabelText('PIN', { exact: true }), '123');
    await user.type(screen.getByLabelText('Confirm PIN'), '123');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/4-digit PIN/);
    expect(screen.getByRole('heading', { name: 'Set a passcode' })).toBeInTheDocument();
  });
});

describe('Onboarding: import', () => {
  it('shows 24 boxes by default, switches to 12, fills from a paste, and imports', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
    await screen.findByRole('heading', { name: 'Import a wallet' });
    expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(24);

    await user.click(screen.getByRole('button', { name: '12 words' }));
    expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(12);

    fireEvent.paste(screen.getByLabelText('Word 1'), {
      clipboardData: { getData: () => MNEMONIC_12 },
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Word 12').value).toBe('junk');
    });
    expect(screen.getByLabelText<HTMLInputElement>('Word 1').value).toBe('test');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Set a passcode' });
    await user.type(screen.getByLabelText('PIN', { exact: true }), PASS);
    await user.type(screen.getByLabelText('Confirm PIN'), PASS);
    await user.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByRole('heading', { name: 'Your wallet' });
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
    expect(secretHolder.has()).toBe(false);
  });

  it('auto-switches from 24 to 12 when a 12-word phrase is pasted', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
    fireEvent.paste(screen.getByLabelText('Word 1'), {
      clipboardData: { getData: () => MNEMONIC_12 },
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Word 12').value).toBe('junk');
    });
    expect(screen.getByRole('button', { name: '12 words' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(12);
  });

  it('rejects an invalid phrase without echoing words', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
    await user.click(screen.getByRole('button', { name: '12 words' }));
    fireEvent.paste(screen.getByLabelText('Word 1'), {
      clipboardData: {
        getData: () =>
          'zzsecretzz abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('zzsecretzz');
    expect(screen.getByLabelText('Word 1', { exact: true }).className).toContain('border-red-500');
    expect(screen.getByRole('heading', { name: 'Import a wallet' })).toBeInTheDocument();
  });
});
```

## apps/miniapp/src/test/ui-wallet.test.tsx

```typescript
/**
 * Stage C component tests: unlock errors, backoff notice, settings re-auth reveal, wipe.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

async function seededVault(): Promise<ReturnType<typeof makeVault>> {
  const vault = makeVault();
  const imported = await vault.manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
  expect(imported.ok).toBe(true);
  return vault;
}

async function unlockUi(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('heading', { name: 'Welcome back' });
  await user.type(screen.getByLabelText('PIN'), PASS);
  await user.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByRole('heading', { name: 'Your wallet' });
}

describe('Stage C: unlock and settings', () => {
  it('shows wrong-passcode and then a rate-limit message', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await screen.findByRole('heading', { name: 'Welcome back' });

    await user.type(screen.getByLabelText('PIN'), '1357');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');

    await user.type(screen.getByLabelText('PIN'), '1357');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Too many attempts/);
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('reveals the phrase only after re-authentication and clears it on leaving', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await unlockUi(user);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText('Enter your passcode to continue'), PASS);
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });

    const node = screen.getByTestId('phrase-words');
    expect(node.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(node.textContent).not.toBe('');
    });
    const words = Array.from(node.querySelectorAll('span')).map((el) =>
      el.textContent.replace(/^\d+\.\s*/, ''),
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(document.body.textContent.toLowerCase()).not.toContain('junk');
    expect(secretHolder.has()).toBe(false);
  });

  it('settings "Test your backup" re-runs verification without showing the phrase', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText('Enter your passcode to continue'), PASS);
    await user.click(screen.getByRole('button', { name: 'Test your backup' }));
    await screen.findByRole('heading', { name: 'Check your backup' });
    expect(screen.queryByText(MNEMONIC_12_HARDHAT)).not.toBeInTheDocument();

    const words = MNEMONIC_12_HARDHAT.split(' ');
    const inputs = screen.getAllByRole('textbox');
    for (const input of inputs) {
      const label = input.closest('div')?.querySelector('label')?.textContent ?? '';
      const position = Number.parseInt(/(\d+)/.exec(label)?.[1] ?? '0', 10) - 1;
      await user.type(input, words[position] ?? '');
    }
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(secretHolder.has()).toBe(false);
  });

  it('a wrong passcode in settings does not open the phrase', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText('Enter your passcode to continue'), '1357');
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');
    expect(screen.queryByRole('heading', { name: 'Your recovery phrase' })).not.toBeInTheDocument();
    expect(secretHolder.has()).toBe(false);
  });

  it('offers no biometric unlock when the adapter reports unavailable', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(
      screen.queryByRole('button', { name: 'Unlock with biometrics' }),
    ).not.toBeInTheDocument();
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('heading', { name: /Biometric unlock/ })).not.toBeInTheDocument();
  });

  it('wipes the wallet after typed confirmation', async () => {
    const user = userEvent.setup();
    const vault = await seededVault();
    renderApp(vault);
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText(/Type WIPE to confirm/), 'WIPE');
    await user.click(screen.getByRole('button', { name: 'Wipe' }));
    await screen.findByRole('heading', { name: 'Your keys, your coins' });
    expect(await vault.manager.hasVault()).toBe(false);
    expect(secretHolder.has()).toBe(false);
  });
});
```

## apps/miniapp/src/test/ui-home.test.tsx

```typescript
/**
 * Home redesign tests: hero card, tabs, action grid, asset list with inline badges, the Receive
 * sheet with real vault-derived addresses, and ton-native-only filtering.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import { TelegramProvider } from '../telegram/TelegramProvider';
import { HomeScreen } from '../ui/wallet';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

const TON_NATIVE_MNEMONIC = [
  'hospital',
  'stove',
  'relief',
  'fringe',
  'tongue',
  'always',
  'charge',
  'angry',
  'urge',
  'sentence',
  'again',
  'match',
  'nerve',
  'inquiry',
  'senior',
  'coconut',
  'label',
  'tumble',
  'carry',
  'category',
  'beauty',
  'bean',
  'road',
  'solution',
].join(' ');

async function unlockedManager(
  accountType: 'bip39-multichain' | 'ton-native-only' = 'bip39-multichain',
): Promise<VaultManager> {
  const manager = new VaultManager({ sealStorage: new InMemoryStorage(), config: FAST });
  const phrase = accountType === 'ton-native-only' ? TON_NATIVE_MNEMONIC : MNEMONIC_12_HARDHAT;
  const imported = await manager.importWallet(phrase, PASS, { accountType });
  expect(imported.ok).toBe(true);
  const unlocked = await manager.unlock(PASS);
  expect(unlocked.success).toBe(true);
  return manager;
}

function renderHome(
  manager: VaultManager,
  handlers: { onLock?: () => void; onSettings?: () => void } = {},
) {
  return render(
    <TelegramProvider>
      <HomeScreen
        manager={manager}
        onLock={handlers.onLock ?? (() => {})}
        onSettings={handlers.onSettings ?? (() => {})}
      />
    </TelegramProvider>,
  );
}

describe('Home: wallet dashboard', () => {
  it('shows the hero card, tabs, actions and assets with badges', async () => {
    renderHome(await unlockedManager());
    expect(screen.getByRole('heading', { name: 'Your wallet' })).toBeInTheDocument();
    expect(screen.getByText('Main Wallet')).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$0.00');
    expect(screen.getByRole('tab', { name: 'Wallet' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false');

    for (const action of ['Receive', 'Send', 'Swap', 'Stake']) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    }

    expect(screen.getByTestId('asset-TON')).toHaveTextContent('Toncoin');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('TON');
    expect(screen.getByTestId('asset-USDT')).toHaveTextContent('Tether USD');
    expect(screen.getByTestId('asset-USDT')).toHaveTextContent('TON · Jetton');
    expect(screen.getByTestId('asset-TRX')).toHaveTextContent('TRC-20');
    expect(screen.getByTestId('asset-ETH')).toHaveTextContent('ERC-20');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('0 TON');
    expect(screen.getByTestId('asset-ETH')).toHaveTextContent('0 ETH');
  });

  it('masks and unmasks the balance', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByRole('button', { name: 'Hide balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('••••');
    await user.click(screen.getByRole('button', { name: 'Show balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$0.00');
  });

  it('switches to Activity and shows the empty state', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText(/No transactions yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('asset-TON')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Wallet' }));
    expect(screen.getByTestId('asset-TON')).toBeInTheDocument();
  });

  it('Receive sheet shows the real derived TON, TRON and EVM addresses', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^UQ/);
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asset rows open the address sheet for their chain', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByTestId('asset-TRX'));
    const dialog = screen.getByRole('dialog', { name: 'Receive' });
    expect(dialog).toHaveTextContent('TRON');
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
  });

  it('action buttons open their notices and lock/settings callbacks fire', async () => {
    const user = userEvent.setup();
    const onLock = vi.fn();
    const onSettings = vi.fn();
    renderHome(await unlockedManager(), { onLock, onSettings });

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('dialog', { name: 'Send' })).toHaveTextContent(/P2/);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.getByRole('dialog', { name: 'Swap' })).toHaveTextContent(/Coming soon/);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Lock' }));
    expect(onLock).toHaveBeenCalledOnce();
  });

  it('ton-native-only hides TRON/EVM assets and addresses', async () => {
    renderHome(await unlockedManager('ton-native-only'));
    expect(screen.getByTestId('asset-TON')).toBeInTheDocument();
    expect(screen.getByTestId('asset-USDT')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-TRX')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asset-ETH')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^UQ/);
    expect(screen.queryByTestId('address-TRON')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
  });
});
```

## apps/miniapp/src/test/detect.test.ts

```typescript
/**
 * Account-type detection: 12 -> BIP-39, 24 -> one of the two, or explicit disambiguation when
 * both validators accept the phrase (the ~1/256 collision). Validators are injected so the
 * ambiguous path is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { detectAccountType } from '../vault/detect';

const WORDS_12 = 'a b c d e f g h i j k l';
const WORDS_24 = Array.from({ length: 24 }, (_, i) => `w${String(i)}`).join(' ');

describe('account-type detection', () => {
  it('12 words are always BIP-39', async () => {
    expect(
      await detectAccountType(WORDS_12, { validateBip39: () => true, validateTon: () => true }),
    ).toEqual({ kind: 'resolved', accountType: 'bip39-multichain' });
    expect(
      await detectAccountType(WORDS_12, { validateBip39: () => false, validateTon: () => true }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('24 words valid as both require disambiguation', async () => {
    expect(
      await detectAccountType(WORDS_24, { validateBip39: () => true, validateTon: () => true }),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('24 words valid only as BIP-39 resolve silently', async () => {
    expect(
      await detectAccountType(WORDS_24, { validateBip39: () => true, validateTon: () => false }),
    ).toEqual({ kind: 'resolved', accountType: 'bip39-multichain' });
  });

  it('24 words valid only as TON-native resolve silently', async () => {
    expect(
      await detectAccountType(WORDS_24, { validateBip39: () => false, validateTon: () => true }),
    ).toEqual({ kind: 'resolved', accountType: 'ton-native-only' });
  });

  it('forcing TON-native requires the TON check to pass', async () => {
    expect(
      await detectAccountType(WORDS_24, {
        forceTonNative: true,
        validateBip39: () => true,
        validateTon: () => true,
      }),
    ).toEqual({ kind: 'resolved', accountType: 'ton-native-only' });
    expect(
      await detectAccountType(WORDS_24, {
        forceTonNative: true,
        validateBip39: () => true,
        validateTon: () => false,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('neither valid -> invalid with a position-only message', async () => {
    const result = await detectAccountType(WORDS_24, {
      validateBip39: () => false,
      validateTon: () => false,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.message.length).toBeGreaterThan(0);
  });
});
```

## apps/miniapp/src/test/e2e/onboarding.spec.ts

```typescript
/**
 * E2E for the refactored onboarding flows.
 *
 * Create: phrase (reveal + checkbox) -> 3-word verification -> passcode -> Home.
 * Import: 12/24 numbered grid (smart paste) -> passcode -> Home.
 * Runs against the production build with no Telegram client, so no device secret exists and the
 * passphrase policy requires 12+ characters. Each test gets a fresh browser context (empty IDB).
 */
import { test, expect, type Page } from '@playwright/test';

const PASS = '2580';

function wordLocator(page: Page) {
  return page.locator('[data-role="word"]');
}

async function createToPasscode(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeVisible();
  await expect(page.getByTestId('phrase-words')).toHaveText('');
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  await expect(wordLocator(page)).toHaveCount(24);
  const words = await wordLocator(page).allTextContents();

  const next = page.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await page.getByLabel("I've stored the seed phrase in a secure place.").check();
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
  return words;
}

async function finishCreate(page: Page): Promise<void> {
  await page.getByLabel('PIN', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm PIN').fill(PASS);
  await expect(page.getByRole('status')).toHaveText(/Requirements met/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
}

async function pastePhrase(page: Page, phrase: string): Promise<void> {
  await page.getByLabel('Word 1', { exact: true }).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, phrase);
}

test.describe('onboarding and unlock', () => {
  test('create, verify, passcode, lock/unlock, survive reload', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);

    await page.getByRole('button', { name: 'Receive' }).click();
    await expect(page.getByTestId('address-EVM')).toHaveText(/^0x/);
    await expect(page.getByTestId('address-TRON')).toHaveText(/^T/);
    await expect(page.getByTestId('address-TON')).toHaveText(/^UQ/);
    await page.getByRole('button', { name: 'Close' }).click();

    const dump = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      text: document.body.innerText,
    }));
    expect(dump.local).not.toContain(words[0] ?? 'never');
    expect(dump.session).not.toContain(words[0] ?? 'never');
    expect(dump.text).not.toContain(words.join(' '));

    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill('1357');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Wrong passcode|Too many attempts/);

    await page.waitForTimeout(3500);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
  });

  test('IndexedDB holds only the sealed envelope after create', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);

    const dump = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('onezerowallet');
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(new Error(String(req.error)));
        };
      });
      const tx = db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(new Error(String(req.error)));
        };
      });
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(new Error(String(req.error)));
        };
      });
      db.close();
      return { keys: keys.map(String), values: JSON.stringify(values) };
    });

    expect(dump.keys.sort()).toEqual(['vault_seal']);
    expect(dump.values).not.toContain(words.join(' '));
    expect(dump.values).toContain('passcodeWrappedKey');
    expect(dump.values).toContain('accountType');
  });

  test('import: 12-word grid via smart paste, then passcode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await expect(page.getByLabel(/^Word \d+$/)).toHaveCount(24);
    await page.getByRole('button', { name: '12 words' }).click();
    await expect(page.getByLabel(/^Word \d+$/)).toHaveCount(12);

    await pastePhrase(page, 'test test test test test test test test test test test junk');
    await expect(page.getByLabel('Word 12', { exact: true })).toHaveValue('junk');
    await expect(page.getByLabel('Word 1', { exact: true })).toHaveValue('test');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm PIN').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await page.getByRole('button', { name: 'Receive' }).click();
    await expect(page.getByTestId('address-EVM')).toHaveText(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });

  test('home dashboard: hero, tabs, actions and asset list', async ({ page }) => {
    await createToPasscode(page);
    await finishCreate(page);

    await expect(page.getByText('Main Wallet')).toBeVisible();
    await expect(page.getByText('Testnet')).toBeVisible();
    await expect(page.getByTestId('hero-balance')).toHaveText('$0.00');
    await expect(page.getByTestId('asset-TON')).toContainText('Toncoin');
    await expect(page.getByTestId('asset-USDT')).toContainText('TON · Jetton');
    await expect(page.getByTestId('asset-TRX')).toContainText('TRC-20');
    await expect(page.getByTestId('asset-ETH')).toContainText('ERC-20');

    await page.getByRole('button', { name: 'Hide balance' }).click();
    await expect(page.getByTestId('hero-balance')).toHaveText('••••');
    await page.getByRole('button', { name: 'Show balance' }).click();

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText(/No transactions yet/)).toBeVisible();
    await page.getByRole('tab', { name: 'Wallet' }).click();

    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('dialog', { name: 'Send' })).toContainText('P2');
    await page.getByRole('button', { name: 'Close' }).click();
  });

  test('ton-native import shows only TON assets and address', async ({ page }) => {
    const tonPhrase = [
      'hospital',
      'stove',
      'relief',
      'fringe',
      'tongue',
      'always',
      'charge',
      'angry',
      'urge',
      'sentence',
      'again',
      'match',
      'nerve',
      'inquiry',
      'senior',
      'coconut',
      'label',
      'tumble',
      'carry',
      'category',
      'beauty',
      'bean',
      'road',
      'solution',
    ].join(' ');

    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await pastePhrase(page, tonPhrase);
    await expect(page.getByLabel('Word 24', { exact: true })).toHaveValue('solution');
    await page.getByRole('button', { name: 'Continue' }).click();

    // If the phrase happens to be valid BIP-39 too, choose the TON-only reading.
    if (
      await page
        .getByRole('heading', { name: 'Which wallet is this phrase from?' })
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByRole('button', { name: 'TON-only wallet' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm PIN').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('asset-TON')).toBeVisible();
    await expect(page.getByTestId('asset-USDT')).toBeVisible();
    await expect(page.getByTestId('asset-TRX')).toHaveCount(0);
    await expect(page.getByTestId('asset-ETH')).toHaveCount(0);

    await page.getByRole('button', { name: 'Receive' }).click();
    await expect(page.getByTestId('address-TON')).toHaveText(/^UQ/);
    await expect(page.getByTestId('address-TRON')).toHaveCount(0);
    await expect(page.getByTestId('address-EVM')).toHaveCount(0);
  });

  test('settings reveal requires re-auth and clears the phrase on leaving', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(wordLocator(page)).toHaveCount(24);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
  });

  test('settings Test your backup verifies the stored phrase', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Test your backup' }).click();

    await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
    const inputs = page.locator('input[id^="word-"]');
    for (let i = 0; i < 3; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await inputs.nth(i).fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('phrase hides when the app is backgrounded', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await expect(page.getByTestId('phrase-words')).toHaveText('');
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.getByTestId('phrase-words')).not.toHaveText('');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // The app wipes the temporary phrase and returns to the welcome screen.
    await expect(page.getByRole('heading', { name: 'Your keys, your coins' })).toBeVisible();
    await expect(page.getByTestId('phrase-words')).toHaveCount(0);
  });
});
```

## apps/miniapp/src/test/e2e/a11y.spec.ts

```typescript
/**
 * Stage C accessibility checks (no axe dependency: axe-core is MPL-2.0, which the dependency
 * policy asks us to review first). These checks assert the properties axe would flag most often:
 * accessible names for controls, a single h1, labelled inputs and a language on the document.
 */
import { test, expect } from '@playwright/test';

test.describe('accessibility', () => {
  test('document language and one main heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('every interactive control has an accessible name', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    const unnamed = await page.evaluate(() => {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]'),
      );
      const named = (el: HTMLElement): boolean => {
        if (el.getAttribute('aria-label')?.trim()) return true;
        if (el.getAttribute('aria-labelledby')) return true;
        if ((el as HTMLInputElement).id) {
          const label = document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`);
          if (label?.textContent?.trim()) return true;
        }
        if (el.closest('label')?.textContent?.trim()) return true;
        if ((el.textContent ?? '').trim()) return true;
        if (el.getAttribute('title')?.trim()) return true;
        return false;
      };
      return controls
        .filter((el) => !named(el) && el.offsetParent !== null)
        .map((el) => el.outerHTML.slice(0, 80));
    });
    expect(unnamed).toEqual([]);
  });

  test('form errors are announced and inputs are labelled', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await expect(page.getByLabel('Word 1', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/^Word \d+$/)).toHaveCount(24);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
```

## apps/miniapp/src/test/e2e/app.spec.ts

```typescript
import { test, expect } from '@playwright/test';

test.describe('OneZeroWallet', () => {
  test('should load the application', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'OneZeroWallet' })).toBeVisible();
  });

  test('should show the wallet description', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/self-custodial/)).toBeVisible();
  });
});
```

