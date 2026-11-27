/**
 * Fetches the active network configuration from the same-origin `/api/ton/config` endpoint.
 *
 * Fail-closed: any error, timeout or malformed response returns the safe default (testnet, swaps
 * and staking disabled). The app never guesses "mainnet" when the server cannot be reached.
 */
import { DEFAULT_TON_CONFIG, type TonConfig } from '../ui/network';

const CONFIG_TIMEOUT_MS = 8000;

function isTonConfig(value: unknown): value is TonConfig {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record['network'] === 'mainnet' || record['network'] === 'testnet') &&
    typeof record['swapEnabled'] === 'boolean' &&
    typeof record['stakingEnabled'] === 'boolean' &&
    typeof record['swapFeeBps'] === 'number' &&
    Number.isInteger(record['swapFeeBps']) &&
    record['swapFeeBps'] >= 0 &&
    typeof record['referralConfigured'] === 'boolean'
  );
}

export async function fetchTonConfig(signal?: AbortSignal): Promise<TonConfig> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CONFIG_TIMEOUT_MS);
  const abort = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', abort);
  try {
    const response = await fetch('/api/ton/config', {
      method: 'GET',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return DEFAULT_TON_CONFIG;
    const body: unknown = await response.json();
    return isTonConfig(body) ? body : DEFAULT_TON_CONFIG;
  } catch {
    return DEFAULT_TON_CONFIG;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
