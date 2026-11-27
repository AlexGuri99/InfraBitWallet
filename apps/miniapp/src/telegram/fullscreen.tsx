/**
 * Fullscreen + safe-area control.
 *
 * Telegram Mini Apps Bot API 8.0+ exposes `requestFullscreen` / `exitFullscreen`, a
 * `fullscreenChanged` event and device/TG safe-area insets. Outside Telegram we fall back to the
 * standard browser Fullscreen API. If neither exists the control reports `isSupported: false` so
 * the UI can hide it rather than render a dead button.
 *
 * Safe areas are written to CSS custom properties on <html>; `PhoneFrame` consumes
 * `--app-safe-top`. Values come from Telegram only — never from remote/attacker-controlled data.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '../i18n';
import { useToast } from '../ui/toast';
import { useTelegram } from './TelegramProvider';

export interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The subset of the Telegram WebApp we feature-detect. */
export interface FullscreenCapable {
  requestFullscreen?: (() => unknown) | undefined;
  exitFullscreen?: (() => unknown) | undefined;
  isFullscreen?: boolean | undefined;
  isVersionAtLeast?: ((version: string) => boolean) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent?: ((event: string, callback: (...args: any[]) => void) => void) | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  offEvent?: ((event: string, callback: (...args: any[]) => void) => void) | undefined;
  safeAreaInset?: Partial<SafeAreaInset> | undefined;
  contentSafeAreaInset?: Partial<SafeAreaInset> | undefined;
}

export interface FullscreenControl {
  isSupported: boolean;
  isFullscreen: boolean;
  toggle: () => void;
}

const FullscreenContext = createContext<FullscreenControl | null>(null);

/**
 * Object existence is the authoritative signal: Telegram only defines `requestFullscreen` /
 * `exitFullscreen` on clients that implement Bot API 8.0+. The version string is treated as
 * advisory (it can lag behind the injected object, especially on mobile clients); requiring it
 * used to hide an otherwise working control.
 */
export function telegramFullscreenSupported(tg: FullscreenCapable | null | undefined): boolean {
  if (!tg) return false;
  return typeof tg.requestFullscreen === 'function' && typeof tg.exitFullscreen === 'function';
}

/**
 * The raw Telegram WebView bridge. Inside the mobile clients this object exists synchronously,
 * before (or even without) the injected `window.Telegram.WebApp` exposing the high-level methods.
 * It is a function-only surface: `postEvent('web_app_<method>', data)`.
 */
export interface TelegramWebviewProxy {
  postEvent?: (eventType: string, eventData?: string) => void;
}

export const FULLSCREEN_BRIDGE_EVENTS = {
  enter: 'web_app_request_fullscreen',
  exit: 'web_app_exit_fullscreen',
} as const;

export function telegramWebviewProxy(): TelegramWebviewProxy | null {
  if (typeof window === 'undefined') return null;
  const proxy = (window as { TelegramWebviewProxy?: TelegramWebviewProxy }).TelegramWebviewProxy;
  return typeof proxy?.postEvent === 'function' ? proxy : null;
}

/**
 * Bridge fallback support: a WebView proxy exists AND the client advertises Bot API 8.0+ (older
 * clients ignore the request, so we keep the control hidden there). The version string is only
 * used here because the bridge has no capability object of its own.
 */
export function telegramBridgeFullscreenSupported(
  tg: FullscreenCapable | null | undefined,
): boolean {
  if (telegramWebviewProxy() === null) return false;
  if (typeof tg?.isVersionAtLeast === 'function') {
    try {
      return tg.isVersionAtLeast('8.0');
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Post a fullscreen request through the bridge. Event names and the empty payload match the
 * official telegram-web-app.js bridge (it calls `TelegramWebviewProxy.postEvent(eventType,
 * JSON.stringify(params))` with no params for these methods). Returns false when unreachable.
 */
export function requestBridgeFullscreen(enter: boolean): boolean {
  const proxy = telegramWebviewProxy();
  if (!proxy?.postEvent) return false;
  try {
    proxy.postEvent(enter ? FULLSCREEN_BRIDGE_EVENTS.enter : FULLSCREEN_BRIDGE_EVENTS.exit);
    return true;
  } catch {
    return false;
  }
}

/** Browser fallback: standard Fullscreen API on the document element. */
export function browserFullscreenSupported(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function'
  );
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Reads and normalizes Telegram's two inset objects. */
export function readSafeInsets(tg: FullscreenCapable | null | undefined): {
  safe: SafeAreaInset;
  content: SafeAreaInset;
} {
  const read = (value: Partial<SafeAreaInset> | undefined): SafeAreaInset => ({
    top: numberOrZero(value?.top),
    bottom: numberOrZero(value?.bottom),
    left: numberOrZero(value?.left),
    right: numberOrZero(value?.right),
  });
  return { safe: read(tg?.safeAreaInset), content: read(tg?.contentSafeAreaInset) };
}

/**
 * Writes the combined insets to <html>. `--app-safe-top` is `max(device notch, safe + content)`
 * so entering fullscreen shifts the app below the notch and Telegram's floating controls.
 */
export function applySafeAreaVars(safe: SafeAreaInset, content: SafeAreaInset): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const top = safe.top + content.top;
  const bottom = safe.bottom + content.bottom;
  root.style.setProperty('--tg-safe-area-inset-top', `${String(safe.top)}px`);
  root.style.setProperty('--tg-safe-area-inset-bottom', `${String(safe.bottom)}px`);
  root.style.setProperty('--tg-content-safe-area-inset-top', `${String(content.top)}px`);
  root.style.setProperty('--tg-content-safe-area-inset-bottom', `${String(content.bottom)}px`);
  root.style.setProperty(
    '--app-safe-top',
    top > 0 ? `max(env(safe-area-inset-top), ${String(top)}px)` : 'env(safe-area-inset-top)',
  );
  root.style.setProperty(
    '--app-safe-bottom',
    bottom > 0
      ? `max(env(safe-area-inset-bottom), ${String(bottom)}px)`
      : 'env(safe-area-inset-bottom)',
  );
}

/** Clears TG-derived values so they cannot leak into a different session/screen. */
export function resetSafeAreaVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of [
    '--tg-safe-area-inset-top',
    '--tg-safe-area-inset-bottom',
    '--tg-content-safe-area-inset-top',
    '--tg-content-safe-area-inset-bottom',
  ]) {
    root.style.removeProperty(name);
  }
  root.style.setProperty('--app-safe-top', 'env(safe-area-inset-top)');
  root.style.setProperty('--app-safe-bottom', 'env(safe-area-inset-bottom)');
}

function boolFromPayload(payload: unknown): boolean {
  if (typeof payload === 'boolean') return payload;
  if (payload !== null && typeof payload === 'object' && 'isFullscreen' in payload) {
    return Boolean((payload as { isFullscreen?: unknown }).isFullscreen);
  }
  return Boolean(payload);
}

function catchAsync(result: unknown, onError: () => void): void {
  if (result !== null && typeof result === 'object' && 'catch' in result) {
    const promise = result as Promise<unknown>;
    promise.catch(() => {
      onError();
    });
  }
}

export function FullscreenProvider({ children }: { children: ReactNode }) {
  const { webApp } = useTelegram();
  const toast = useToast();
  const tg = webApp as unknown as FullscreenCapable | null;
  // TelegramProvider resolves the WebApp (possibly after first paint), and some clients attach
  // the fullscreen methods after the object exists. Re-check for a short window instead of
  // freezing "unsupported" on the first render.
  const [tgSupported, setTgSupported] = useState(() => telegramFullscreenSupported(tg));
  const [bridgeSupported, setBridgeSupported] = useState(() =>
    telegramBridgeFullscreenSupported(tg),
  );
  const browserSupported = browserFullscreenSupported();
  const [isFullscreen, setIsFullscreen] = useState(
    () => tg?.isFullscreen === true || (browserSupported && document.fullscreenElement !== null),
  );
  // Bridge requests are optimistic: if no fullscreenChanged event arrives, we revert and explain.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearConfirmTimer = useCallback(() => {
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  }, []);
  useEffect(() => clearConfirmTimer, [clearConfirmTimer]);

  const isSupported = tgSupported || bridgeSupported || browserSupported;

  // Adopt Telegram's current state once the WebApp object becomes available.
  useEffect(() => {
    if (tgSupported) setIsFullscreen(tg?.isFullscreen === true);
  }, [tg, tgSupported]);

  // Follow the live object: false → true when Telegram (or a late script) attaches the methods.
  // The bridge is re-checked under the same window because some mobile clients create the proxy
  // (and the WebApp object) slightly after the first React render.
  useEffect(() => {
    const supported = telegramFullscreenSupported(tg);
    setTgSupported(supported);
    const bridge = telegramBridgeFullscreenSupported(tg);
    setBridgeSupported(bridge);
    if ((supported && bridge) || !tg) return undefined;
    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      if (telegramFullscreenSupported(tg)) setTgSupported(true);
      if (telegramBridgeFullscreenSupported(tg)) setBridgeSupported(true);
      if (
        (telegramFullscreenSupported(tg) && telegramBridgeFullscreenSupported(tg)) ||
        attempts >= 25
      ) {
        window.clearInterval(id);
      }
    }, 200);
    return () => {
      window.clearInterval(id);
    };
  }, [tg]);

  const notifyUnavailable = useCallback(() => {
    toast.show(t('home.fullscreenUnavailable'));
  }, [toast]);

  const syncInsets = useCallback(() => {
    if (tgSupported) {
      const { safe, content } = readSafeInsets(tg);
      applySafeAreaVars(safe, content);
    }
  }, [tg, tgSupported]);

  // Telegram events: fullscreen state, failures and safe-area changes. The bridge path needs the
  // fullscreenChanged event even when the high-level methods are missing.
  useEffect(() => {
    if (!tg || (!tgSupported && !bridgeSupported)) return;
    const onFullscreenChanged = (payload: unknown): void => {
      clearConfirmTimer();
      setIsFullscreen(boolFromPayload(payload));
      syncInsets();
    };
    const onFailed = (): void => {
      notifyUnavailable();
    };
    const onSafeArea = (): void => {
      syncInsets();
    };
    tg.onEvent?.('fullscreenChanged', onFullscreenChanged);
    tg.onEvent?.('fullscreenFailed', onFailed);
    tg.onEvent?.('safeAreaChanged', onSafeArea);
    tg.onEvent?.('contentSafeAreaChanged', onSafeArea);
    syncInsets();

    return () => {
      tg.offEvent?.('fullscreenChanged', onFullscreenChanged);
      tg.offEvent?.('fullscreenFailed', onFailed);
      tg.offEvent?.('safeAreaChanged', onSafeArea);
      tg.offEvent?.('contentSafeAreaChanged', onSafeArea);
      resetSafeAreaVars();
    };
  }, [tg, tgSupported, bridgeSupported, syncInsets, notifyUnavailable, clearConfirmTimer]);

  // Browser fallback: mirror the standard event.
  useEffect(() => {
    if (!browserSupported) return;
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [browserSupported]);

  const toggle = useCallback(() => {
    if (tgSupported) {
      try {
        const result = isFullscreen ? tg?.exitFullscreen?.() : tg?.requestFullscreen?.();
        catchAsync(result, notifyUnavailable);
      } catch {
        notifyUnavailable();
      }
      return;
    }
    if (bridgeSupported) {
      // Mobile clients can expose the WebView bridge without the high-level methods. Post the
      // documented event and trust `fullscreenChanged`; if it never arrives, revert and say so.
      const next = !isFullscreen;
      if (!requestBridgeFullscreen(next)) {
        notifyUnavailable();
        return;
      }
      setIsFullscreen(next);
      clearConfirmTimer();
      confirmTimer.current = setTimeout(() => {
        confirmTimer.current = null;
        setIsFullscreen((current) => (current === next ? !next : current));
        notifyUnavailable();
      }, 1500);
      return;
    }
    if (!browserSupported) return;
    try {
      const result = isFullscreen
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      catchAsync(result, notifyUnavailable);
    } catch {
      notifyUnavailable();
    }
  }, [
    tgSupported,
    bridgeSupported,
    browserSupported,
    isFullscreen,
    tg,
    notifyUnavailable,
    clearConfirmTimer,
  ]);

  const value = useMemo<FullscreenControl>(
    () => ({ isSupported, isFullscreen, toggle }),
    [isSupported, isFullscreen, toggle],
  );

  return <FullscreenContext.Provider value={value}>{children}</FullscreenContext.Provider>;
}

export function useFullscreenControl(): FullscreenControl {
  const ctx = useContext(FullscreenContext);
  if (!ctx) throw new Error('useFullscreenControl must be used inside FullscreenProvider');
  return ctx;
}
