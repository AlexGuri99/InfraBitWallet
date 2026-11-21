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
