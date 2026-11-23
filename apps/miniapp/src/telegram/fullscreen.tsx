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

function versionAllowsFullscreen(tg: FullscreenCapable): boolean {
  if (typeof tg.isVersionAtLeast !== 'function') return true;
  try {
    return tg.isVersionAtLeast('8.0');
  } catch {
    return true;
  }
}

/** True only when both Telegram fullscreen methods exist and Bot API 8.0+ is reported. */
export function telegramFullscreenSupported(tg: FullscreenCapable | null | undefined): boolean {
  if (!tg) return false;
  return (
    typeof tg.requestFullscreen === 'function' &&
    typeof tg.exitFullscreen === 'function' &&
    versionAllowsFullscreen(tg)
  );
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
  // TelegramProvider resolves the WebApp in an effect, so support must follow the live value
  // rather than being frozen at first render.
  const tgSupported = telegramFullscreenSupported(tg);
  const browserSupported = browserFullscreenSupported();
  const [isFullscreen, setIsFullscreen] = useState(
    () => tg?.isFullscreen === true || (browserSupported && document.fullscreenElement !== null),
  );

  const isSupported = tgSupported || browserSupported;

  // Adopt Telegram's current state once the WebApp object becomes available.
  useEffect(() => {
    if (tgSupported) setIsFullscreen(tg?.isFullscreen === true);
  }, [tg, tgSupported]);

  const notifyUnavailable = useCallback(() => {
    toast.show(t('home.fullscreenUnavailable'));
  }, [toast]);

  const syncInsets = useCallback(() => {
    if (tgSupported) {
      const { safe, content } = readSafeInsets(tg);
      applySafeAreaVars(safe, content);
    }
  }, [tg, tgSupported]);

  // Telegram events: fullscreen state, failures and safe-area changes.
  useEffect(() => {
    if (!tgSupported || !tg) return;
    const onFullscreenChanged = (payload: unknown): void => {
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
  }, [tg, tgSupported, syncInsets, notifyUnavailable]);

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
    if (!browserSupported) return;
    try {
      const result = isFullscreen
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      catchAsync(result, notifyUnavailable);
    } catch {
      notifyUnavailable();
    }
  }, [tgSupported, browserSupported, isFullscreen, tg, notifyUnavailable]);

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
