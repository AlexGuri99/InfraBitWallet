/**
 * App state machine: onboarding, unlock, wallet shell and settings sub-flows.
 *
 * The UI only calls the vault API. It never reads keys, keeps no secret in React state, and
 * clears the module-level phrase holder whenever a flow ends, the wallet locks, or the app is
 * backgrounded.
 *
 * Create order: phrase -> passcode (the vault is sealed last, after an explicit backup
 * acknowledgement; the 3-word check lives in Settings -> Test Backup).
 * Import order: phrase (type auto-detected) -> passcode.
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
import { UnlockScreen } from './ui/wallet';
import { WalletShell } from './ui/wallet-shell';
import { PreferencesProvider } from './ui/preferences';
import { ToastProvider } from './ui/toast';
import { Notice, PhoneFrame, ScreenShell } from './ui/common';
import {
  createTonReadApi,
  type TonReadApi,
  type TonStakeApi,
  type TonSwapApi,
  type TonWriteApi,
} from './ton/api';
import type { WalletTab } from './ui/nav';

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

const defaultTonApi: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi = createTonReadApi();

function LoadingScreen() {
  return (
    <PhoneFrame>
      <main className="flex flex-1 items-center justify-center">
        <p aria-live="polite" className="text-[13px] font-medium text-ink-2">
          {t('common.working')}
        </p>
      </main>
    </PhoneFrame>
  );
}

export function App() {
  const { manager, biometry } = useVault();
  const { webApp } = useTelegram();
  const [screen, setScreen] = useState<Screen>('loading');
  const [tab, setTab] = useState<WalletTab>('wallet');
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
        setScreen('home');
        setTab('settings');
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
    const watch = ['home', 'settings-phrase', 'settings-verify'].includes(screen);
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
    setTab('wallet');
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
    setTab('wallet');
    setScreen('home');
    return null;
  };

  let content;
  if (storageError) {
    content = (
      <ScreenShell title={t('app.name')}>
        <Notice tone="warning">{t('error.storage')}</Notice>
      </ScreenShell>
    );
  } else {
    switch (screen) {
      case 'loading':
        content = <LoadingScreen />;
        break;
      case 'welcome':
        content = (
          <WelcomeScreen
            onCreate={startCreate}
            onImport={() => {
              secretHolder.clear();
              setScreen('import-phrase');
            }}
          />
        );
        break;
      case 'create-phrase':
        content = (
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
        break;
      case 'create-passcode':
        content = (
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
        break;
      case 'import-phrase':
        content = (
          <ImportPhraseScreen
            step={{ current: 1, total: 2 }}
            onBack={() => {
              secretHolder.clear();
              setScreen('welcome');
            }}
            onNext={importPhraseNext}
          />
        );
        break;
      case 'import-disambiguate':
        content = (
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
        break;
      case 'import-passcode':
        content = (
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
        break;
      case 'unlock':
        content = (
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
        break;
      case 'home':
        content = (
          <WalletShell
            manager={manager}
            api={defaultTonApi}
            biometry={biometry}
            tab={tab}
            onTabChange={setTab}
            onLock={lock}
            onRevealPhrase={() => {
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
        break;
      case 'settings-phrase':
        content = (
          <PhraseScreen
            onBack={() => {
              secretHolder.clear();
              setScreen('home');
              setTab('settings');
            }}
            onDone={() => {
              secretHolder.clear();
              setScreen('home');
              setTab('settings');
            }}
          />
        );
        break;
      case 'settings-verify':
        content = (
          <VerifyScreen
            onCancel={() => {
              secretHolder.clear();
              setScreen('home');
              setTab('settings');
            }}
            onVerified={() => {
              setScreen('home');
              setTab('settings');
            }}
          />
        );
        break;
      default:
        content = <LoadingScreen />;
        break;
    }
  }

  return (
    <PreferencesProvider>
      <ToastProvider>{content}</ToastProvider>
    </PreferencesProvider>
  );
}

export { defaultTonApi };
