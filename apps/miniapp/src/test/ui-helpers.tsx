/**
 * Shared helpers for UI tests: a real VaultManager over in-memory adapters, a fake biometry
 * adapter (unavailable by default) and the provider stack the app expects.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import { TelegramProvider } from '../telegram/TelegramProvider';
import { VaultProvider, type VaultUi } from '../vault/context';
import { PreferencesProvider } from '../ui/preferences';
import { ToastProvider } from '../ui/toast';
import { WalletShell } from '../ui/wallet-shell';
import type { WalletTab } from '../ui/nav';
import type { TonConfig } from '../ui/network';
import type { TonReadApi, TonStakeApi, TonSwapApi, TonWriteApi } from '../ton/api';
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

/** Wrap already-built UI in the providers the app expects. */
export function renderWithProviders(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <TelegramProvider>
      <PreferencesProvider>
        <ToastProvider>{ui}</ToastProvider>
      </PreferencesProvider>
    </TelegramProvider>,
  );
}

export function renderApp(vault: VaultUi): ReturnType<typeof render> {
  return render(
    <TelegramProvider>
      <VaultProvider value={vault}>
        <App />
      </VaultProvider>
    </TelegramProvider>,
  );
}

/** Render the wallet shell directly with an injectable TON read/write API. */
export function renderShell(
  vault: VaultUi,
  api: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi,
  options: {
    tab?: WalletTab;
    onLock?: () => void;
    onTabChange?: (tab: WalletTab) => void;
    tonConfig?: TonConfig;
  } = {},
): ReturnType<typeof render> {
  return renderWithProviders(
    <WalletShell
      manager={vault.manager}
      api={api}
      biometry={vault.biometry}
      tonConfig={options.tonConfig}
      tab={options.tab ?? 'wallet'}
      onTabChange={options.onTabChange ?? (() => {})}
      onLock={options.onLock ?? (() => {})}
      onRevealPhrase={() => {}}
      onTestBackup={() => {}}
      onWiped={() => {}}
    />,
  );
}
