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
