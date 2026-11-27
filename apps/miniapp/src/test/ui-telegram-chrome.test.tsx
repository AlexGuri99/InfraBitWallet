/**
 * Telegram native chrome: vertical swipe lock and header/background colour sync.
 *
 * The bridge recorder stands in for `window.TelegramWebviewProxy`, and the WebApp methods are
 * spied so both code paths (method + bridge event) are asserted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonPortfolio } from '@onezerowallet/chain-ton';
import { UI_TON_NETWORK } from '../ui/wallet-shell';
import type { TonReadApi, TonStakeApi, TonSwapApi, TonWriteApi } from '../ton/api';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderShell } from './ui-helpers';
import { resetTelegramNativeEvents } from '../telegram/native-events';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

function portfolio(): TonPortfolio {
  return {
    address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
    network: UI_TON_NETWORK,
    status: 'active',
    balanceRaw: '1500000000',
    balance: '1.5',
    priceUsd: 1.5,
    change24h: 2,
    totalUsd: 2.25,
    assets: [
      {
        id: 'ton',
        symbol: 'TON',
        name: 'Toncoin',
        decimals: 9,
        standard: 'native',
        balanceRaw: '1500000000',
        balance: '1.5',
        usdValue: 2.25,
      },
    ],
    updatedAt: 1_700_000_000_000,
    source: 'toncenter',
  };
}

function apiStub(): TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi {
  return {
    getPortfolio: () => Promise.resolve(portfolio()),
    getActivity: () => Promise.resolve([]),
    getWalletState: () => Promise.reject(new Error('not used')),
    emulate: () => Promise.reject(new Error('not used')),
    broadcast: () => Promise.reject(new Error('not used')),
    getSwapAssets: () => Promise.reject(new Error('not used')),
    getSwapQuote: () => Promise.reject(new Error('not used')),
    getStakingInfo: () => Promise.reject(new Error('not used')),
  };
}

async function unlockedManager(): Promise<VaultManager> {
  const manager = new VaultManager({ sealStorage: new InMemoryStorage(), config: FAST });
  const imported = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
  expect(imported.ok).toBe(true);
  const unlocked = await manager.unlock(PASS);
  expect(unlocked.success).toBe(true);
  return manager;
}

interface BridgeRecorder {
  postEvent: ReturnType<typeof vi.fn>;
  events: () => string[];
  payloads: (eventType: string) => string[];
  restore: () => void;
}

function installBridge(): BridgeRecorder {
  const postEvent = vi.fn();
  (window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy = { postEvent };
  const calls = (): Array<[string, string | undefined]> =>
    postEvent.mock.calls as unknown as Array<[string, string | undefined]>;
  return {
    postEvent,
    events: () => calls().map((call) => call[0]),
    payloads: (eventType) =>
      calls()
        .filter((call) => call[0] === eventType)
        .map((call) => call[1] ?? ''),
    restore: () => {
      Reflect.deleteProperty(window, 'TelegramWebviewProxy');
    },
  };
}

function swipeLockPayloads(bridge: BridgeRecorder): string[] {
  return bridge.payloads('web_app_setup_swipe_behavior');
}

afterEach(() => {
  resetTelegramNativeEvents();
  vi.restoreAllMocks();
});

describe('telegram native chrome', () => {
  it('locks vertical swipes and syncs Mint Light colours on mount', async () => {
    const bridge = installBridge();
    const globalTg = window.Telegram;
    if (!globalTg) throw new Error('Telegram mock is not installed');
    const webApp = globalTg.WebApp;
    const setHeader = vi.spyOn(webApp, 'setHeaderColor');
    const setBackground = vi.spyOn(webApp, 'setBackgroundColor');
    try {
      const manager = await unlockedManager();
      renderShell({ ...makeVault(), manager }, apiStub(), { tab: 'settings' });
      await screen.findByTestId('infrabit-logo');

      expect(swipeLockPayloads(bridge)).toContain(JSON.stringify({ allow_vertical_swipe: false }));
      expect(setHeader).toHaveBeenCalledWith('#DFF2E6');
      expect(setBackground).toHaveBeenCalledWith('#DFF2E6');
      expect(bridge.payloads('web_app_set_header_color')).toContain(
        JSON.stringify({ color: '#DFF2E6' }),
      );
      expect(bridge.payloads('web_app_set_background_color')).toContain(
        JSON.stringify({ color: '#DFF2E6' }),
      );
    } finally {
      bridge.restore();
    }
  });

  it('posts Forest Dark colours when the theme toggles', async () => {
    const bridge = installBridge();
    const globalTg = window.Telegram;
    if (!globalTg) throw new Error('Telegram mock is not installed');
    const webApp = globalTg.WebApp;
    const setHeader = vi.spyOn(webApp, 'setHeaderColor');
    const setBackground = vi.spyOn(webApp, 'setBackgroundColor');
    try {
      const manager = await unlockedManager();
      renderShell({ ...makeVault(), manager }, apiStub());
      await screen.findByTestId('hero-balance');

      await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to dark theme' }));

      expect(setHeader).toHaveBeenLastCalledWith('#0A0F0D');
      expect(setBackground).toHaveBeenLastCalledWith('#0A0F0D');
      expect(bridge.payloads('web_app_set_header_color')).toContain(
        JSON.stringify({ color: '#0A0F0D' }),
      );
      expect(bridge.payloads('web_app_set_background_color')).toContain(
        JSON.stringify({ color: '#0A0F0D' }),
      );
    } finally {
      bridge.restore();
    }
  });

  it('re-asserts the swipe lock whenever fullscreen_changed fires', async () => {
    const bridge = installBridge();
    try {
      const manager = await unlockedManager();
      renderShell({ ...makeVault(), manager }, apiStub());
      await screen.findByTestId('hero-balance');

      const before = swipeLockPayloads(bridge).length;
      const receiver = (
        window as unknown as {
          TelegramGameProxy?: { receiveEvent?: (event: string, data?: unknown) => void };
        }
      ).TelegramGameProxy?.receiveEvent;
      expect(receiver).toBeTypeOf('function');
      act(() => {
        receiver?.('fullscreen_changed', JSON.stringify({ is_fullscreen: true }));
      });
      act(() => {
        receiver?.('fullscreen_changed', JSON.stringify({ is_fullscreen: false }));
      });
      expect(swipeLockPayloads(bridge).length).toBeGreaterThan(before);
    } finally {
      bridge.restore();
    }
  });
});
