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
