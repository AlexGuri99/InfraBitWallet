# Stage C review packet

Full source of the Stage C UI, adapters and tests. No secret is included: fixtures are public test phrases and the code only handles secrets through the vault API.

## apps/miniapp/src/App.tsx

```typescript
/**
 * App state machine: onboarding, unlock, home and settings.
 *
 * The UI only calls the vault API. It never reads keys, keeps no secret in React state, and
 * clears the module-level phrase holder whenever a flow ends, the wallet locks, or the app is
 * backgrounded.
 */
import { useCallback, useEffect, useState } from 'react';
import { setInactivityTimeout } from '@onezerowallet/crypto-vault';
import type { AccountType } from '@onezerowallet/crypto-vault';
import { useTelegram } from './telegram';
import { installTelegramLifecycleHooks } from './adapters/telegram-lifecycle';
import { useVault } from './vault/context';
import { secretHolder } from './vault/secret-holder';
import { t } from './i18n';
import {
  ImportScreen,
  PasscodeSetupScreen,
  PhraseScreen,
  VerifyScreen,
  WelcomeScreen,
} from './ui/onboarding';
import { HomeScreen, SettingsScreen, UnlockScreen } from './ui/wallet';
import { Notice, ScreenShell } from './ui/common';

type Screen =
  | 'loading'
  | 'welcome'
  | 'passcode-create'
  | 'import'
  | 'phrase'
  | 'verify'
  | 'unlock'
  | 'home'
  | 'settings'
  | 'settings-phrase'
  | 'settings-verify';

const AUTO_LOCK_KEY = 'ozw.autoLockMs';

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

  // Telegram backgrounding locks immediately (visibility is handled inside the vault session).
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

  const createWallet = async (
    passcode: string,
    accountType: AccountType,
  ): Promise<string | null> => {
    const created = await manager.createWallet(passcode, undefined, { accountType });
    if (!created.ok) {
      return created.error === 'weak_passcode'
        ? (created.message ?? t('passcode.weak'))
        : t('settings.error');
    }
    if (!created.mnemonic) return t('settings.error');
    secretHolder.set(created.mnemonic);
    setScreen('phrase');
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
          onCreate={() => {
            setScreen('passcode-create');
          }}
          onImport={() => {
            setScreen('import');
          }}
        />
      );
    case 'passcode-create':
      return (
        <PasscodeSetupScreen
          manager={manager}
          title={t('passcode.title')}
          onBack={() => {
            setScreen('welcome');
          }}
          onSubmit={createWallet}
          submitLabel={t('passcode.submit')}
        />
      );
    case 'import':
      return (
        <ImportScreen
          manager={manager}
          onBack={() => {
            setScreen('welcome');
          }}
          onImported={() => {
            setScreen('home');
          }}
        />
      );
    case 'phrase':
      return (
        <PhraseScreen
          onBack={() => {
            secretHolder.clear();
            setScreen('welcome');
          }}
          onDone={() => {
            setScreen('verify');
          }}
        />
      );
    case 'verify':
      return (
        <VerifyScreen
          onCancel={() => {
            setScreen('phrase');
          }}
          onVerified={() => {
            setScreen('unlock');
          }}
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
          settingsMode
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

## apps/miniapp/src/main.tsx

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TelegramProvider } from './telegram/TelegramProvider';
import { VaultProvider } from './vault/context';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <TelegramProvider>
      <VaultProvider>
        <App />
      </VaultProvider>
    </TelegramProvider>
  </StrictMode>,
);
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
  'passcode.title': 'Set a passcode',
  'passcode.label': 'Passcode',
  'passcode.confirm': 'Confirm passcode',
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
  'import.phrase': 'Recovery phrase',
  'import.phraseHelp': 'Words separated by spaces. Never type it anywhere else.',
  'import.submit': 'Import',
  'import.invalid': 'That phrase is not valid for the selected wallet type.',
  'unlock.title': 'Welcome back',
  'unlock.passcode': 'Passcode',
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
  'home.lock': 'Lock',
  'home.settings': 'Settings',
  'home.copy': 'Copy',
  'home.copied': 'Copied',
  'home.receive': 'Receive',
  'home.tonPrefer': 'Use this non-bounceable address for first-time senders.',
  'home.notice': 'We will never ask for your recovery phrase.',
  'settings.title': 'Settings',
  'settings.back': 'Back',
  'settings.reveal': 'Reveal recovery phrase',
  'settings.testBackup': 'Test your backup',
  'settings.changePasscode': 'Change passcode',
  'settings.oldPasscode': 'Current passcode',
  'settings.newPasscode': 'New passcode',
  'settings.confirmPasscode': 'Confirm new passcode',
  'settings.save': 'Save',
  'settings.changed': 'Passcode changed.',
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

export function ScreenShell({
  title,
  children,
  onBack,
}: {
  title: string;
  children: ReactNode;
  onBack?: () => void;
}) {
  const { theme } = useTelegram();
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: theme?.backgroundColor ?? 'var(--tg-theme-bg-color, #fff)',
        color: theme?.textColor ?? 'var(--tg-theme-text-color, #000)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
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
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>
      <main className="flex-1 px-4 py-6 flex flex-col gap-4 max-w-md w-full mx-auto">
        {children}
      </main>
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
 * Onboarding screens: welcome/risk, passcode, reveal phrase, verify backup, import.
 *
 * Secrets rule: passcodes and phrases are read from uncontrolled inputs / the module holder at
 * submit time only. The phrase is written into the DOM imperatively after an explicit tap and
 * cleared when hidden, navigated away, or the flow ends. No secret enters React state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountType, VaultManager } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, PhraseInput, ScreenShell } from './common';

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

export function PasscodeSetupScreen({
  manager,
  title,
  onBack,
  onSubmit,
  submitLabel,
}: {
  manager: VaultManager;
  title: string;
  onBack: () => void;
  onSubmit: (passcode: string, accountType: AccountType) => Promise<string | null>;
  submitLabel: string;
}) {
  const passRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [accountType, setAccountType] = useState<AccountType>('bip39-multichain');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const failure = await onSubmit(passcode, accountType);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
      if (passRef.current) passRef.current.value = '';
      if (confirmRef.current) confirmRef.current.value = '';
    }
  };

  return (
    <ScreenShell title={title} onBack={onBack}>
      <Notice tone={manager.usesDeviceSecret ? 'info' : 'warning'}>
        {manager.usesDeviceSecret ? t('passcode.deviceSecret') : t('passcode.noDeviceSecret')}
      </Notice>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">{t('accountType.label')}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="accountType"
            value="bip39-multichain"
            checked={accountType === 'bip39-multichain'}
            onChange={() => {
              setAccountType('bip39-multichain');
            }}
            className="mt-1"
          />
          <span>{t('accountType.bip39')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="accountType"
            value="ton-native-only"
            checked={accountType === 'ton-native-only'}
            onChange={() => {
              setAccountType('ton-native-only');
            }}
            className="mt-1"
          />
          <span>
            {t('accountType.tonNative')}
            <span className="block text-xs opacity-70">{t('accountType.tonNative.help')}</span>
          </span>
        </label>
      </fieldset>

      <Field
        id="passcode"
        ref={passRef}
        label={t('passcode.label')}
        type="password"
        autoComplete="new-password"
        autoFocus
        inputMode="text"
      />
      <Field
        id="passcode-confirm"
        ref={confirmRef}
        label={t('passcode.confirm')}
        type="password"
        autoComplete="new-password"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? t('common.working') : submitLabel}
      </Button>
    </ScreenShell>
  );
}

export function ImportScreen({
  manager,
  onBack,
  onImported,
}: {
  manager: VaultManager;
  onBack: () => void;
  onImported: () => void;
}) {
  const phraseRef = useRef<HTMLTextAreaElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [accountType, setAccountType] = useState<AccountType>('bip39-multichain');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const phrase = phraseRef.current?.value ?? '';
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
    setBusy(true);
    setError(null);
    try {
      const imported = await manager.importWallet(phrase, passcode, { accountType });
      if (phraseRef.current) phraseRef.current.value = '';
      if (!imported.ok) {
        setError(imported.error === 'invalid_mnemonic' ? t('import.invalid') : t('settings.error'));
        return;
      }
      const unlocked = await manager.unlock(passcode);
      if (!unlocked.success) {
        setError(t('settings.error'));
        return;
      }
      onImported();
    } finally {
      setBusy(false);
      if (passRef.current) passRef.current.value = '';
      if (confirmRef.current) confirmRef.current.value = '';
    }
  };

  return (
    <ScreenShell title={t('import.title')} onBack={onBack}>
      <PhraseInput
        id="import-phrase"
        ref={phraseRef}
        label={t('import.phrase')}
        hint={t('import.phraseHelp')}
        autoFocus
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">{t('accountType.label')}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="importAccountType"
            value="bip39-multichain"
            checked={accountType === 'bip39-multichain'}
            onChange={() => {
              setAccountType('bip39-multichain');
            }}
            className="mt-1"
          />
          <span>{t('accountType.bip39')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="importAccountType"
            value="ton-native-only"
            checked={accountType === 'ton-native-only'}
            onChange={() => {
              setAccountType('ton-native-only');
            }}
            className="mt-1"
          />
          <span>{t('accountType.tonNative')}</span>
        </label>
      </fieldset>
      <Field
        id="import-passcode"
        ref={passRef}
        label={t('passcode.label')}
        type="password"
        autoComplete="new-password"
      />
      <Field
        id="import-passcode-confirm"
        ref={confirmRef}
        label={t('passcode.confirm')}
        type="password"
        autoComplete="new-password"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? t('common.working') : t('import.submit')}
      </Button>
    </ScreenShell>
  );
}

export function PhraseScreen({
  onDone,
  onBack,
  settingsMode = false,
}: {
  onDone: () => void;
  onBack: () => void;
  settingsMode?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const wordsRef = useRef<HTMLDivElement>(null);
  const wordCount = secretHolder.words().length;

  useEffect(() => {
    const node = wordsRef.current;
    if (!node) return;
    if (!revealed) {
      node.textContent = '';
      return;
    }
    const words = secretHolder.words();
    if (words.length === 0) {
      setEmpty(true);
      return;
    }
    node.replaceChildren(
      ...words.map((word, index) => {
        const item = document.createElement('span');
        item.textContent = `${String(index + 1)}. ${word}`;
        item.className =
          'rounded bg-black/5 dark:bg-white/10 px-2 py-1 font-mono text-sm inline-block';
        item.dataset['wordIndex'] = String(index);
        return item;
      }),
    );
  }, [revealed]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && revealed) setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const node = wordsRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (node) node.textContent = '';
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack}>
      <Notice tone="warning">
        {settingsMode ? t('phrase.settings.warning') : t('phrase.warning')}
      </Notice>
      <p className="text-sm" aria-live="polite">
        {revealed ? '' : t('phrase.reveal')}
      </p>
      <div
        ref={wordsRef}
        data-testid="phrase-words"
        aria-label="Recovery phrase words"
        className="flex flex-wrap gap-2 min-h-6"
      />
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
          {wordCount > 0 ? t('phrase.reveal') : t('phrase.revealAgain')}
        </Button>
      )}
      <Button onClick={onDone} disabled={wordCount === 0}>
        {settingsMode ? t('verify.submit') : t('phrase.done')}
      </Button>
    </ScreenShell>
  );
}

export function VerifyScreen({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
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
    <ScreenShell title={t('verify.title')} onBack={onCancel}>
      <p className="text-sm">{t('verify.body')}</p>
      {positions.map((position, index) => (
        <Field
          key={position}
          id={`word-${String(position)}`}
          label={`${t('verify.wordAt')} ${String(position + 1)}`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          ref={(el) => {
            inputs.current[index] = el;
          }}
        />
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={submit}>{t('verify.submit')}</Button>
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
import { useEffect, useMemo, useRef, useState } from 'react';
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

function AddressRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
    <div className="rounded-lg bg-black/5 dark:bg-white/10 p-3 flex flex-col gap-1">
      <span className="text-xs opacity-70">{label}</span>
      <code className="text-xs break-all" data-testid={`address-${label}`}>
        {value}
      </code>
      {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
      <Button
        variant="secondary"
        onClick={() => void copy()}
        aria-label={`${t('home.copy')} ${label}`}
      >
        {copied ? t('home.copied') : t('home.copy')}
      </Button>
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

  return (
    <ScreenShell title={t('home.title')}>
      {info ? (
        <>
          <AddressRow
            label={t('home.receive') + ' TON'}
            value={info.ton.addressNonBounceable}
            hint={t('home.tonPrefer')}
          />
          <AddressRow label="EVM" value={info.evm?.address ?? ''} />
          <AddressRow label="TRON" value={info.tron?.address ?? ''} />
        </>
      ) : (
        <ErrorText>{t('settings.error')}</ErrorText>
      )}
      <Notice>{t('home.notice')}</Notice>
      <Button onClick={onSettings}>{t('home.settings')}</Button>
      <Button variant="secondary" onClick={onLock}>
        {t('home.lock')}
      </Button>
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
          autoComplete="current-password"
        />
        <Field
          id="new-passcode"
          ref={newRef}
          label={t('settings.newPasscode')}
          type="password"
          autoComplete="new-password"
        />
        <Field
          id="confirm-passcode"
          ref={confirmRef}
          label={t('settings.confirmPasscode')}
          type="password"
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
 * Stage C component tests: welcome, create, reveal phrase, backup verification, import.
 *
 * The most important assertion is negative: after leaving the phrase screen, none of the words
 * appear in the DOM or in localStorage/sessionStorage.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

const PASS = 'test passphrase one';
const MNEMONIC_12_HARDHAT = 'test test test test test test test test test test test junk';

async function createWalletFlow(): Promise<{ words: string[] }> {
  const user = userEvent.setup();
  const vault = makeVault();
  renderApp(vault);

  await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
  await user.type(screen.getByLabelText('Passcode'), PASS);
  await user.type(screen.getByLabelText('Confirm passcode'), PASS);
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  // Phrase screen: hidden until an explicit tap, never auto-shown.
  await screen.findByRole('heading', { name: 'Your recovery phrase' });
  const phraseNode = screen.getByTestId('phrase-words');
  expect(phraseNode.textContent).toBe('');

  await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
  await waitFor(() => {
    expect(phraseNode.textContent).not.toBe('');
  });
  const words = Array.from(phraseNode.querySelectorAll('span')).map((el) =>
    el.textContent.replace(/^\d+\.\s*/, ''),
  );
  expect(words).toHaveLength(24);

  await user.click(screen.getByRole('button', { name: 'I wrote it down' }));
  await screen.findByRole('heading', { name: 'Check your backup' });
  return { words };
}

describe('Stage C: onboarding', () => {
  it('shows the risk disclosure and anti-phishing notice', async () => {
    renderApp(makeVault());
    expect(await screen.findByText('Your keys, your coins')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OneZeroWallet');
    expect(screen.getByText(/self-custodial/)).toBeInTheDocument();
    expect(screen.getByText(/We will never ask for your recovery phrase/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram or your device may clear local data/)).toBeInTheDocument();
  });

  it('rejects a short passphrase when no device secret is available', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await user.type(screen.getByLabelText('Passcode'), 'short');
    await user.type(screen.getByLabelText('Confirm passcode'), 'short');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/);
  });

  it('creates a wallet, verifies the backup and clears the phrase', async () => {
    const user = userEvent.setup();
    const { words } = await createWalletFlow();

    const inputs = screen.getAllByRole('textbox');
    const positions = inputs.map((input) => {
      const label = input.closest('div')?.querySelector('label')?.textContent ?? '';
      const match = /(\d+)/.exec(label);
      return Number.parseInt(match?.[1] ?? '0', 10) - 1;
    });
    expect(positions).toHaveLength(3);

    // Wrong answers fail with positions only (never echo words).
    for (const input of inputs) await user.type(input, 'wrongword');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/);

    // Correct answers unlock the flow.
    for (const [index, position] of positions.entries()) {
      const input = inputs[index];
      if (input) {
        await user.clear(input);
        await user.type(input, words[position] ?? '');
      }
    }
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('heading', { name: 'Welcome back' });

    // Secret gone from the DOM and from web storage.
    expect(screen.queryByTestId('phrase-words')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(secretHolder.has()).toBe(false);
    const storageDump = `${JSON.stringify(localStorage)}\n${JSON.stringify(sessionStorage)}`;
    expect(storageDump).not.toContain(words[0] ?? 'never');
  });

  it('imports a wallet and shows addresses', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
    await user.type(screen.getByLabelText('Recovery phrase'), MNEMONIC_12_HARDHAT);
    await user.type(screen.getByLabelText('Passcode'), PASS);
    await user.type(screen.getByLabelText('Confirm passcode'), PASS);
    await user.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByRole('heading', { name: 'Your wallet' });
    const evm = screen.getByTestId('address-EVM');
    expect(evm).toHaveTextContent('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
    expect(screen.getByTestId('address-Receive TON')).toHaveTextContent(/^UQ/);
    // The typed phrase must not linger in storage or the DOM.
    expect(document.body.textContent).not.toContain('junk');
  });

  it('never renders the phrase before the explicit reveal tap', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await user.type(screen.getByLabelText('Passcode'), PASS);
    await user.type(screen.getByLabelText('Confirm passcode'), PASS);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });
    const words = secretHolder.words();
    const phraseNode = screen.getByTestId('phrase-words');
    for (const word of [words[0], words[5], words[23]]) {
      if (word) expect(phraseNode.textContent).not.toContain(word);
    }
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
  await user.type(screen.getByLabelText('Passcode'), PASS);
  await user.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByRole('heading', { name: 'Your wallet' });
}

describe('Stage C: unlock and settings', () => {
  it('shows wrong-passcode and then a rate-limit message', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await screen.findByRole('heading', { name: 'Welcome back' });

    await user.type(screen.getByLabelText('Passcode'), 'wrong passphrase');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');

    await user.type(screen.getByLabelText('Passcode'), 'wrong passphrase');
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

  it('a wrong passcode in settings does not open the phrase', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText('Enter your passcode to continue'), 'wrong passphrase');
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

## apps/miniapp/src/test/e2e/onboarding.spec.ts

```typescript
/**
 * Stage C E2E: create a wallet, verify the backup, lock/unlock, reject a wrong passcode and
 * reload into a persisted vault. Runs against the production build with no Telegram client, so
 * no device secret exists and the passphrase policy requires 12+ characters.
 *
 * Every test gets a fresh browser context, so IndexedDB starts empty.
 */
import { test, expect } from '@playwright/test';

const PASS = 'e2e passphrase one';

test.describe('onboarding and unlock', () => {
  test('create, verify backup, lock and unlock, survive reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();

    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeVisible();
    await expect(page.getByTestId('phrase-words')).toHaveText('');
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();

    const words = (await page.getByTestId('phrase-words').locator('span').allTextContents()).map(
      (text) => text.replace(/^\d+\.\s*/, ''),
    );
    expect(words).toHaveLength(24);
    await page.getByRole('button', { name: 'I wrote it down' }).click();

    await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
    const inputs = page.locator('input[id^="word-"]');
    const count = await inputs.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await inputs.nth(i).fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // The phrase must not survive in web storage or the visible DOM.
    const dump = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      text: document.body.innerText,
    }));
    expect(dump.local).not.toContain(words[0] ?? 'never');
    expect(dump.session).not.toContain(words[0] ?? 'never');
    expect(dump.text).not.toContain(words.join(' '));

    // Wrong passcode is rejected; then the right one opens the wallet.
    await page.getByLabel('Passcode', { exact: true }).fill('wrong passphrase');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Wrong passcode|Too many attempts/);

    // The wrong attempt opened a short backoff window; let it elapse before reloading.
    await page.waitForTimeout(3500);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('address-EVM')).toHaveText(/^0x/);
    await expect(page.getByTestId('address-TRON')).toHaveText(/^T/);
    await expect(page.getByTestId('address-Receive TON')).toHaveText(/^UQ/);
  });

  test('IndexedDB holds only the sealed envelope, never the phrase', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    const words = (await page.getByTestId('phrase-words').locator('span').allTextContents()).map(
      (text) => text.replace(/^\d+\.\s*/, ''),
    );

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
    for (const word of words) expect(dump.values.toLowerCase()).not.toContain(word.toLowerCase());
  });

  test('imports a wallet phrase', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await page
      .getByLabel('Recovery phrase')
      .fill('test test test test test test test test test test test junk');
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('address-EVM')).toHaveText(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });

  test('settings reveal requires re-auth and clears the phrase on leaving', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    const words = (await page.getByTestId('phrase-words').locator('span').allTextContents()).map(
      (text) => text.replace(/^\d+\.\s*/, ''),
    );
    await page.getByRole('button', { name: 'I wrote it down' }).click();
    const inputs = page.locator('input[id^="word-"]');
    for (let i = 0; i < 3; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await inputs.nth(i).fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.getByTestId('phrase-words')).not.toHaveText('');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
  });

  test('the phrase screen is empty until the explicit reveal tap', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('phrase-words')).toHaveText('');

    // Backgrounding hides an already revealed phrase.
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.getByTestId('phrase-words')).not.toHaveText('');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('phrase-words')).toHaveText('');
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
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await expect(page.getByLabel('Passcode', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm passcode')).toBeVisible();
    await page.getByLabel('Passcode', { exact: true }).fill('short');
    await page.getByLabel('Confirm passcode').fill('short');
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

