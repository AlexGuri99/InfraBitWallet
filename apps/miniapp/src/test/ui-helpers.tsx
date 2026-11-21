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
