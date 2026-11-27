/**
 * Fullscreen toggle: Telegram Bot API 8.0+ behaviour, safe-area vars, failure toast, and the
 * unsupported-environment case (button hidden).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonPortfolio } from '@onezerowallet/chain-ton';
import { UI_TON_NETWORK } from '../ui/wallet-shell';
import type { TonReadApi, TonStakeApi, TonSwapApi, TonWriteApi } from '../ton/api';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderShell } from './ui-helpers';
import {
  installTelegramNativeEventBridge,
  resetTelegramNativeEvents,
} from '../telegram/native-events';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

type Handler = (...args: unknown[]) => void;

interface FullscreenHarness {
  request: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  emit: (event: string, payload?: unknown) => void;
  setInsets: (
    safe: { top: number; bottom: number },
    content: { top: number; bottom: number },
  ) => void;
  restore: () => void;
}

interface MutableWebApp {
  requestFullscreen?: unknown;
  exitFullscreen?: unknown;
  isFullscreen?: boolean;
  onEvent?: unknown;
  offEvent?: unknown;
  safeAreaInset?: unknown;
  contentSafeAreaInset?: unknown;
  isVersionAtLeast?: unknown;
}

function webAppRecord(): MutableWebApp {
  const tg = window.Telegram?.WebApp as unknown as MutableWebApp | undefined;
  if (!tg) throw new Error('Telegram mock is not installed');
  return tg;
}

function installFullscreenMock(): FullscreenHarness {
  const tg = webAppRecord();
  const keys = [
    'onEvent',
    'offEvent',
    'requestFullscreen',
    'exitFullscreen',
    'isFullscreen',
    'safeAreaInset',
    'contentSafeAreaInset',
    'isVersionAtLeast',
  ] as const;
  const original = Object.fromEntries(
    (keys as readonly string[]).map((key) => [key, (tg as Record<string, unknown>)[key]]),
  ) as Record<string, unknown>;
  const handlers = new Map<string, Set<Handler>>();

  const request = vi.fn();
  const exit = vi.fn();
  tg.requestFullscreen = request;
  tg.exitFullscreen = exit;
  tg.isFullscreen = false;
  tg.safeAreaInset = { top: 24, bottom: 16, left: 0, right: 0 };
  tg.contentSafeAreaInset = { top: 8, bottom: 4, left: 0, right: 0 };
  tg.onEvent = (event: string, callback: Handler): void => {
    const set = handlers.get(event) ?? new Set<Handler>();
    set.add(callback);
    handlers.set(event, set);
  };
  tg.offEvent = (event: string, callback: Handler): void => {
    handlers.get(event)?.delete(callback);
  };

  return {
    request,
    exit,
    emit: (event, payload) => {
      for (const callback of handlers.get(event) ?? []) callback(payload);
    },
    setInsets: (safe, content) => {
      tg.safeAreaInset = { ...safe, left: 0, right: 0 };
      tg.contentSafeAreaInset = { ...content, left: 0, right: 0 };
      for (const callback of handlers.get('safeAreaChanged') ?? []) callback();
      for (const callback of handlers.get('contentSafeAreaChanged') ?? []) callback();
    },
    restore: () => {
      for (const key of keys as readonly string[]) {
        const value = original[key];
        if (value === undefined) Reflect.deleteProperty(tg, key);
        else (tg as Record<string, unknown>)[key] = value;
      }
    },
  };
}

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

function apiWith(): TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi {
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

async function renderHome(): Promise<void> {
  const manager = await unlockedManager();
  renderShell({ ...makeVault(), manager }, apiWith());
  await screen.findByTestId('hero-balance');
}

/**
 * iOS delivers responses through window.TelegramGameProxy.receiveEvent (the primary native
 * receiver); Android/Desktop use Telegram.WebView.receiveEvent. Prefer the former here.
 */
function nativeReceiver(): (eventType: string, eventData?: unknown) => void {
  const gameProxy = (
    window as unknown as {
      TelegramGameProxy?: { receiveEvent?: (eventType: string, eventData?: unknown) => void };
      TelegramGameProxy_receiveEvent?: (eventType: string, eventData?: unknown) => void;
    }
  ).TelegramGameProxy?.receiveEvent;
  if (typeof gameProxy === 'function') return gameProxy;
  const legacy = (
    window as unknown as { TelegramGameProxy_receiveEvent?: (e: string, d?: unknown) => void }
  ).TelegramGameProxy_receiveEvent;
  if (typeof legacy === 'function') return legacy;
  const webView = (
    window.Telegram as unknown as {
      WebView?: { receiveEvent?: (eventType: string, eventData?: unknown) => void };
    }
  ).WebView?.receiveEvent;
  if (typeof webView === 'function') return webView;
  throw new Error('no Telegram native receiveEvent surface was installed');
}

function receiveNative(event: string, data?: unknown): void {
  nativeReceiver()(event, typeof data === 'string' ? data : JSON.stringify(data));
}

function iconPath(button: HTMLElement): string | null {
  return button.querySelector('svg path')?.getAttribute('d') ?? null;
}

/** Mobile fallback: the WebView bridge exists, the high-level SDK methods do not. */
function installBridgeMock(): { postEvent: ReturnType<typeof vi.fn>; restore: () => void } {
  const postEvent = vi.fn();
  (window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy = { postEvent };
  return {
    postEvent,
    restore: () => {
      Reflect.deleteProperty(window, 'TelegramWebviewProxy');
    },
  };
}

afterEach(() => {
  resetTelegramNativeEvents();
});

describe('fullscreen toggle', () => {
  it('calls requestFullscreen/exitFullscreen and follows fullscreenChanged', async () => {
    const harness = installFullscreenMock();
    try {
      const user = userEvent.setup();
      await renderHome();

      const enter = screen.getByRole('button', { name: 'Enter fullscreen' });
      expect(enter).toHaveAttribute('aria-pressed', 'false');
      await user.click(enter);
      expect(harness.request).toHaveBeenCalledTimes(1);

      act(() => {
        harness.emit('fullscreenChanged', { isFullscreen: true });
      });
      const exit = await screen.findByRole('button', { name: 'Exit fullscreen' });
      expect(exit).toHaveAttribute('aria-pressed', 'true');
      await user.click(exit);
      expect(harness.exit).toHaveBeenCalledTimes(1);

      act(() => {
        harness.emit('fullscreenChanged', false);
      });
      expect(await screen.findByRole('button', { name: 'Enter fullscreen' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    } finally {
      harness.restore();
    }
  });

  it('applies the content inset only in fullscreen and sums both insets on the shell', async () => {
    const harness = installFullscreenMock();
    try {
      await renderHome();
      const root = document.documentElement.style;
      // Normal sheet mode: status-bar inset only, no extra content band.
      expect(root.getPropertyValue('--tg-safe-area-inset-top')).toBe('24px');
      expect(root.getPropertyValue('--tg-content-safe-area-inset-top')).toBe('0px');
      expect(root.getPropertyValue('--app-safe-top')).toContain('+ 0px');

      const frame = screen.getByTestId('phone-frame');
      expect(frame.style.paddingTop).toBe(
        'calc(var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0px)) + var(--tg-content-safe-area-inset-top, 0px))',
      );

      act(() => {
        harness.emit('fullscreenChanged', { isFullscreen: true });
      });
      expect(root.getPropertyValue('--tg-content-safe-area-inset-top')).toBe('8px');
      expect(root.getPropertyValue('--app-safe-top')).toContain('+ 8px');

      act(() => {
        harness.setInsets({ top: 40, bottom: 0 }, { top: 12, bottom: 0 });
      });
      expect(root.getPropertyValue('--tg-safe-area-inset-top')).toBe('40px');
      expect(root.getPropertyValue('--tg-content-safe-area-inset-top')).toBe('12px');
    } finally {
      harness.restore();
    }
  });

  it('uses a 48px content clearance in fullscreen when Telegram reports none yet', async () => {
    const harness = installFullscreenMock();
    try {
      await renderHome();
      act(() => {
        harness.emit('fullscreenChanged', { isFullscreen: true });
      });
      act(() => {
        harness.setInsets({ top: 24, bottom: 0 }, { top: 0, bottom: 0 });
      });
      expect(
        document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-top'),
      ).toBe('48px');

      act(() => {
        harness.emit('fullscreenChanged', { isFullscreen: false });
      });
      expect(
        document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-top'),
      ).toBe('0px');
    } finally {
      harness.restore();
    }
  });

  it('shows a pill toast when fullscreenFailed fires', async () => {
    const harness = installFullscreenMock();
    try {
      await renderHome();
      act(() => {
        harness.emit('fullscreenFailed', { error: 'UNSUPPORTED' });
      });
      expect(await screen.findByRole('status')).toHaveTextContent(
        "Fullscreen isn't available on this device",
      );
    } finally {
      harness.restore();
    }
  });

  it('appears when Telegram injects WebApp after the first render', async () => {
    const saved = window.Telegram;
    const harness = installFullscreenMock();
    try {
      Reflect.deleteProperty(window, 'Telegram');
      await renderHome();
      // jsdom has no browser Fullscreen API, so nothing is shown before the injection.
      expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();

      act(() => {
        if (saved) window.Telegram = saved;
      });
      const enter = await screen.findByRole(
        'button',
        { name: 'Enter fullscreen' },
        { timeout: 3000 },
      );
      expect(enter).toBeInTheDocument();
    } finally {
      if (saved) window.Telegram = saved;
      harness.restore();
    }
  });

  it('appears when the fullscreen methods are attached after mount', async () => {
    const tg = webAppRecord();
    const harness = installFullscreenMock();
    try {
      Reflect.deleteProperty(tg, 'requestFullscreen');
      Reflect.deleteProperty(tg, 'exitFullscreen');
      await renderHome();
      expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();

      act(() => {
        tg.requestFullscreen = harness.request;
        tg.exitFullscreen = harness.exit;
      });
      expect(
        await screen.findByRole('button', { name: 'Enter fullscreen' }, { timeout: 3000 }),
      ).toBeInTheDocument();
    } finally {
      harness.restore();
    }
  });

  it('renders a Fullscreen row in Settings → Preferences', async () => {
    const harness = installFullscreenMock();
    try {
      const manager = await unlockedManager();
      renderShell({ ...makeVault(), manager }, apiWith(), { tab: 'settings' });
      const row = await screen.findByRole('button', { name: /^Fullscreen/ });
      expect(row).toHaveTextContent('Off');
      await userEvent.setup().click(row);
      expect(harness.request).toHaveBeenCalledTimes(1);
    } finally {
      harness.restore();
    }
  });

  it('falls back to the WebView bridge when Telegram methods are missing (mobile clients)', async () => {
    const harness = installFullscreenMock();
    const bridge = installBridgeMock();
    const tg = webAppRecord();
    try {
      Reflect.deleteProperty(tg, 'requestFullscreen');
      Reflect.deleteProperty(tg, 'exitFullscreen');
      const user = userEvent.setup();
      await renderHome();

      const enter = await screen.findByRole('button', { name: 'Enter fullscreen' });
      await user.click(enter);
      expect(bridge.postEvent).toHaveBeenCalledWith('web_app_request_fullscreen');
      // Optimistic until Telegram confirms.
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      act(() => {
        harness.emit('fullscreenChanged', { isFullscreen: true });
      });
      const exit = await screen.findByRole('button', { name: 'Exit fullscreen' });
      await user.click(exit);
      const posted = (bridge.postEvent.mock.calls as unknown[][]).map((call) => call[0]);
      expect(posted).toContain('web_app_exit_fullscreen');
    } finally {
      bridge.restore();
      harness.restore();
    }
  });

  it('reverts the optimistic bridge toggle when the client ignores the request', async () => {
    const harness = installFullscreenMock();
    const bridge = installBridgeMock();
    const tg = webAppRecord();
    try {
      Reflect.deleteProperty(tg, 'requestFullscreen');
      Reflect.deleteProperty(tg, 'exitFullscreen');
      const user = userEvent.setup();
      await renderHome();

      await user.click(await screen.findByRole('button', { name: 'Enter fullscreen' }));
      expect(bridge.postEvent).toHaveBeenCalledWith('web_app_request_fullscreen');
      expect(
        await screen.findByText("Fullscreen isn't available on this device", {}, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole('button', { name: 'Enter fullscreen' }, { timeout: 3000 }),
      ).toHaveAttribute('aria-pressed', 'false');
    } finally {
      bridge.restore();
      harness.restore();
    }
  });

  it('iOS native fullscreen_changed confirms the request, clears the timer and flips the icon', async () => {
    const harness = installFullscreenMock();
    const bridge = installBridgeMock();
    const tg = webAppRecord();
    try {
      Reflect.deleteProperty(tg, 'requestFullscreen');
      Reflect.deleteProperty(tg, 'exitFullscreen');
      const user = userEvent.setup();
      await renderHome();

      const enter = await screen.findByRole('button', { name: 'Enter fullscreen' });
      // Sheet mode → outward expand arrows.
      expect(iconPath(enter)).toBe('M9 4H4v5');
      await user.click(enter);
      expect(bridge.postEvent).toHaveBeenCalledWith('web_app_request_fullscreen');

      act(() => {
        receiveNative('fullscreen_changed', { is_fullscreen: true });
      });
      const exit = await screen.findByRole('button', { name: 'Exit fullscreen' });
      expect(exit).toHaveAttribute('aria-pressed', 'true');
      // Fullscreen → inward collapse arrows.
      expect(iconPath(exit)).toBe('M4 9h5V4');

      // The optimistic 1.5s timer must have been cleared: no false "unavailable" toast.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1700);
      });
      expect(
        screen.queryByText("Fullscreen isn't available on this device"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
    } finally {
      bridge.restore();
      harness.restore();
    }
  });

  it('accepts both object and JSON-string payloads from TelegramGameProxy.receiveEvent', async () => {
    const harness = installFullscreenMock();
    const bridge = installBridgeMock();
    const tg = webAppRecord();
    try {
      Reflect.deleteProperty(tg, 'requestFullscreen');
      Reflect.deleteProperty(tg, 'exitFullscreen');
      await renderHome();

      // Object payload (iOS passes a decoded object).
      act(() => {
        receiveNative('fullscreen_changed', { is_fullscreen: true });
      });
      expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();

      // JSON-encoded string payload (some clients stringify eventData).
      act(() => {
        receiveNative('fullscreen_changed', JSON.stringify({ is_fullscreen: false }));
      });
      expect(await screen.findByRole('button', { name: 'Enter fullscreen' })).toBeInTheDocument();
      expect(
        document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-top'),
      ).toBe('0px');
    } finally {
      bridge.restore();
      harness.restore();
    }
  });

  it('flushes native events that arrive before the provider mounts (early-boot buffer)', async () => {
    const harness = installFullscreenMock();
    try {
      // main.tsx installs the dispatcher before React; iOS can answer before the first render.
      installTelegramNativeEventBridge();
      act(() => {
        receiveNative('fullscreen_changed', JSON.stringify({ is_fullscreen: true }));
      });

      await renderHome();
      // The queued event was flushed on subscribe: collapse icon and content clearance applied.
      expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
      expect(
        document.documentElement.style.getPropertyValue('--tg-content-safe-area-inset-top'),
      ).toBe('8px');

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1700);
      });
      expect(
        screen.queryByText("Fullscreen isn't available on this device"),
      ).not.toBeInTheDocument();
    } finally {
      harness.restore();
    }
  });

  it('native safe-area events clear the floating Telegram controls in fullscreen and reset on exit', async () => {
    const harness = installFullscreenMock();
    const bridge = installBridgeMock();
    try {
      await renderHome();
      const root = document.documentElement.style;

      act(() => {
        receiveNative('fullscreen_changed', { is_fullscreen: true });
        receiveNative('safe_area_changed', { top: 59, bottom: 34, left: 0, right: 0 });
        receiveNative('content_safe_area_changed', {
          top: 52,
          bottom: 0,
          left: 0,
          right: 0,
        });
      });
      expect(root.getPropertyValue('--tg-safe-area-inset-top')).toBe('59px');
      expect(root.getPropertyValue('--tg-safe-area-inset-bottom')).toBe('34px');
      expect(root.getPropertyValue('--tg-content-safe-area-inset-top')).toBe('52px');
      expect(root.getPropertyValue('--app-safe-top')).toContain('+ 52px');

      act(() => {
        receiveNative('fullscreen_changed', { is_fullscreen: false });
      });
      // Back to normal sheet mode: no extra content clearance.
      expect(root.getPropertyValue('--tg-content-safe-area-inset-top')).toBe('0px');
      expect(root.getPropertyValue('--tg-content-safe-area-inset-bottom')).toBe('0px');
      expect(root.getPropertyValue('--app-safe-top')).toContain('+ 0px');
    } finally {
      bridge.restore();
      harness.restore();
    }
  });

  it('keeps the control hidden on a bridge client older than Bot API 8.0', async () => {
    const harness = installFullscreenMock();
    const bridge = installBridgeMock();
    const tg = webAppRecord();
    try {
      Reflect.deleteProperty(tg, 'requestFullscreen');
      Reflect.deleteProperty(tg, 'exitFullscreen');
      tg.isVersionAtLeast = (): boolean => false;
      await renderHome();
      expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    } finally {
      bridge.restore();
      harness.restore();
    }
  });

  it('hides the control when neither Telegram nor browser fullscreen is supported', async () => {
    const tg = webAppRecord();
    Reflect.deleteProperty(tg, 'requestFullscreen');
    Reflect.deleteProperty(tg, 'exitFullscreen');
    Reflect.deleteProperty(tg, 'isFullscreen');
    Reflect.deleteProperty(tg, 'safeAreaInset');
    Reflect.deleteProperty(tg, 'contentSafeAreaInset');

    await renderHome();
    expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
  });
});
