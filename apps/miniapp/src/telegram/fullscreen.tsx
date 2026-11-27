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

/** Bridge methods that ask the client to re-send its current safe-area values. */
export const SAFE_AREA_BRIDGE_EVENTS = {
  safe: 'web_app_request_safe_area',
  content: 'web_app_request_content_safe_area',
} as const;

/**
 * Top clearance used while fullscreen is on and the client has not reported a content inset yet.
 * Telegram's floating `X InfraBitWallet` / `v` controls sit in that band, so the header must never
 * start at 0 there.
 */
export const FULLSCREEN_CONTENT_TOP_FALLBACK = 48;

/**
 * Native WebView bridge iOS uses to deliver responses: `Telegram.WebView.receiveEvent(name, data)`
 * with snake_case names. It is separate from the camelCase `WebApp.onEvent` surface.
 */
export interface TelegramWebViewBridge {
  receiveEvent?: (eventType: string, eventData?: string | Record<string, unknown>) => void;
}

export type NativeFullscreenEvent =
  | { type: 'fullscreen_changed'; isFullscreen: boolean }
  | { type: 'fullscreen_failed'; error: string }
  | { type: 'safe_area_changed'; inset: Partial<SafeAreaInset> }
  | { type: 'content_safe_area_changed'; inset: Partial<SafeAreaInset> };

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

/** Ask the client to send fresh safe-area values through `Telegram.WebView.receiveEvent`. */
export function requestBridgeSafeArea(which: 'safe' | 'content'): boolean {
  const proxy = telegramWebviewProxy();
  if (!proxy?.postEvent) return false;
  try {
    proxy.postEvent(
      which === 'safe' ? SAFE_AREA_BRIDGE_EVENTS.safe : SAFE_AREA_BRIDGE_EVENTS.content,
    );
    return true;
  } catch {
    return false;
  }
}

/** Parses the `eventData` an iOS client passes to `Telegram.WebView.receiveEvent`. */
export function parseWebviewEvent(
  eventType: string,
  eventData: unknown,
): NativeFullscreenEvent | null {
  let data: unknown = eventData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = undefined;
    }
  }
  const record = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  if (eventType === 'fullscreen_changed') {
    const value = record['is_fullscreen'];
    return { type: 'fullscreen_changed', isFullscreen: value === true || value === 'true' };
  }
  if (eventType === 'fullscreen_failed') {
    return {
      type: 'fullscreen_failed',
      error: typeof record['error'] === 'string' ? record['error'] : '',
    };
  }
  if (eventType === 'safe_area_changed' || eventType === 'content_safe_area_changed') {
    return {
      type: eventType,
      inset: {
        top: numberOrZero(record['top']),
        bottom: numberOrZero(record['bottom']),
        left: numberOrZero(record['left']),
        right: numberOrZero(record['right']),
      },
    };
  }
  return null;
}

interface TelegramGlobalWithWebView {
  WebApp?: unknown;
  WebView?: TelegramWebViewBridge;
}

function telegramGlobal(): TelegramGlobalWithWebView | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { Telegram?: TelegramGlobalWithWebView }).Telegram;
}

/**
 * Intercepts `window.Telegram.WebView.receiveEvent`, preserving any handler the injected SDK
 * installed. Only acts inside Telegram (a WebView bridge or proxy must exist); returns a cleanup
 * that restores the previous state exactly.
 */
export function installWebViewReceiveEvent(
  handler: (event: NativeFullscreenEvent) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const existingGlobal = telegramGlobal();
  const proxy = telegramWebviewProxy();
  if (!existingGlobal && !proxy) return () => {};

  const win = window as { Telegram?: TelegramGlobalWithWebView };
  const telegram = win.Telegram ?? {};
  const webView = telegram.WebView ?? {};
  const previous = webView.receiveEvent;

  const receiveEvent = (eventType: string, eventData?: string | Record<string, unknown>): void => {
    if (previous) {
      try {
        previous(eventType, eventData);
      } catch {
        // A broken third-party handler must not suppress our own state updates.
      }
    }
    const parsed = parseWebviewEvent(eventType, eventData);
    if (parsed) handler(parsed);
  };

  // Some clients expose `window.Telegram` as a read-only property; never assign over it.
  try {
    webView.receiveEvent = receiveEvent;
    telegram.WebView = webView;
    if (!win.Telegram) win.Telegram = telegram;
  } catch {
    return () => {};
  }

  return () => {
    try {
      if (webView.receiveEvent !== receiveEvent) return; // someone else replaced it later
      if (previous) webView.receiveEvent = previous;
      else delete webView.receiveEvent;
      if (!telegram.WebApp && Object.keys(webView).length === 0) delete telegram.WebView;
      if (!telegram.WebApp && Object.keys(telegram).length === 0 && !proxy) delete win.Telegram;
    } catch {
      // Restoration is best-effort; a frozen global is not worth crashing the app over.
    }
  };
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
 * Writes the insets to <html>.
 *
 * - `--tg-safe-area-inset-*` are the device/Telegram chrome insets (falling back to the CSS
 *   `env(safe-area-inset-*)` notch values when the client reports 0).
 * - `--tg-content-safe-area-inset-top` is the band Telegram's floating fullscreen controls occupy.
 *   It is applied only in fullscreen; while the client has not reported a value yet we use
 *   `FULLSCREEN_CONTENT_TOP_FALLBACK` so the header can never hide behind those controls. In
 *   normal sheet mode it is 0, so there is no extra blank gap.
 * - `--app-safe-top` is the sum of both (kept for older consumers).
 */
export function applySafeAreaVars(
  safe: SafeAreaInset,
  content: SafeAreaInset,
  isFullscreen: boolean = false,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const safeTop = safe.top > 0 ? `${String(safe.top)}px` : 'env(safe-area-inset-top, 0px)';
  const safeBottom =
    safe.bottom > 0 ? `${String(safe.bottom)}px` : 'env(safe-area-inset-bottom, 0px)';
  const contentTop = isFullscreen
    ? content.top > 0
      ? content.top
      : FULLSCREEN_CONTENT_TOP_FALLBACK
    : 0;
  const contentBottom = isFullscreen ? content.bottom : 0;

  root.style.setProperty('--tg-safe-area-inset-top', safeTop);
  root.style.setProperty('--tg-safe-area-inset-bottom', safeBottom);
  root.style.setProperty('--tg-safe-area-inset-left', `${String(safe.left)}px`);
  root.style.setProperty('--tg-safe-area-inset-right', `${String(safe.right)}px`);
  root.style.setProperty('--tg-content-safe-area-inset-top', `${String(contentTop)}px`);
  root.style.setProperty('--tg-content-safe-area-inset-bottom', `${String(contentBottom)}px`);
  root.style.setProperty(
    '--app-safe-top',
    `calc(var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0px)) + ${String(contentTop)}px)`,
  );
  root.style.setProperty(
    '--app-safe-bottom',
    `calc(var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + ${String(contentBottom)}px)`,
  );
}

/** Clears TG-derived values so they cannot leak into a different session/screen. */
export function resetSafeAreaVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of [
    '--tg-safe-area-inset-top',
    '--tg-safe-area-inset-bottom',
    '--tg-safe-area-inset-left',
    '--tg-safe-area-inset-right',
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
  // Bridge requests are optimistic: if no confirmation event arrives, we revert and explain.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearConfirmTimer = useCallback(() => {
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
  }, []);
  useEffect(() => clearConfirmTimer, [clearConfirmTimer]);

  // Latest Telegram insets and fullscreen state, kept in refs so event handlers and the
  // fullscreen change effect always apply consistent values.
  const insetsRef = useRef(readSafeInsets(tg));
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;

  const applyInsets = useCallback(() => {
    applySafeAreaVars(insetsRef.current.safe, insetsRef.current.content, isFullscreenRef.current);
  }, []);

  const setFullscreen = useCallback(
    (next: boolean) => {
      isFullscreenRef.current = next;
      setIsFullscreen(next);
      applyInsets();
    },
    [applyInsets],
  );

  const isSupported = tgSupported || bridgeSupported || browserSupported;

  // Adopt Telegram's current state once the WebApp object becomes available.
  useEffect(() => {
    if (tgSupported) setFullscreen(tg?.isFullscreen === true);
  }, [tg, tgSupported, setFullscreen]);

  // Recompute the clearance whenever fullscreen flips (enter: content band applies; exit: 0).
  useEffect(() => {
    isFullscreenRef.current = isFullscreen;
    applyInsets();
    if (!tgSupported && !bridgeSupported) return;
    // Ask the client for fresh values; iOS answers through Telegram.WebView.receiveEvent.
    requestBridgeSafeArea('safe');
    requestBridgeSafeArea('content');
  }, [isFullscreen, tgSupported, bridgeSupported, applyInsets]);

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
    if (tg) insetsRef.current = readSafeInsets(tg);
    applyInsets();
  }, [tg, applyInsets]);

  const applyBridgeInset = useCallback(
    (kind: 'safe' | 'content', inset: Partial<SafeAreaInset>) => {
      const normalized: SafeAreaInset = {
        top: numberOrZero(inset.top),
        bottom: numberOrZero(inset.bottom),
        left: numberOrZero(inset.left),
        right: numberOrZero(inset.right),
      };
      insetsRef.current = {
        ...insetsRef.current,
        [kind]: normalized,
      };
      applyInsets();
    },
    [applyInsets],
  );

  // iOS delivers responses through Telegram.WebView.receiveEvent (snake_case), not only through
  // WebApp.onEvent. Intercept it so a successful request clears the optimistic timer immediately.
  useEffect(() => {
    return installWebViewReceiveEvent((event) => {
      if (event.type === 'fullscreen_changed') {
        clearConfirmTimer();
        setFullscreen(event.isFullscreen);
        syncInsets();
        return;
      }
      if (event.type === 'fullscreen_failed') {
        clearConfirmTimer();
        notifyUnavailable();
        return;
      }
      applyBridgeInset(event.type === 'safe_area_changed' ? 'safe' : 'content', event.inset);
    });
  }, [applyBridgeInset, clearConfirmTimer, notifyUnavailable, setFullscreen, syncInsets]);

  // Telegram events: fullscreen state, failures and safe-area changes. The bridge path needs the
  // fullscreenChanged event even when the high-level methods are missing.
  useEffect(() => {
    if (!tg || (!tgSupported && !bridgeSupported)) return;
    const onFullscreenChanged = (payload: unknown): void => {
      clearConfirmTimer();
      setFullscreen(boolFromPayload(payload));
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
  }, [
    tg,
    tgSupported,
    bridgeSupported,
    syncInsets,
    notifyUnavailable,
    clearConfirmTimer,
    setFullscreen,
  ]);

  // Browser fallback: mirror the standard event.
  useEffect(() => {
    if (!browserSupported) return;
    const onChange = (): void => {
      setFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [browserSupported, setFullscreen]);

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
      setFullscreen(next);
      clearConfirmTimer();
      confirmTimer.current = setTimeout(() => {
        confirmTimer.current = null;
        // Only revert if Telegram never confirmed the transition.
        if (isFullscreenRef.current === next) setFullscreen(!next);
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
    setFullscreen,
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
