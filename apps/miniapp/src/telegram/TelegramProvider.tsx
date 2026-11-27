import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { lockVerticalSwipes } from './bridge';

export interface TelegramTheme {
  backgroundColor: string;
  textColor: string;
  hintColor: string;
  linkColor: string;
  buttonColor: string;
  buttonTextColor: string;
  headerBgColor: string;
  accentTextColor: string;
  sectionBgColor: string;
  sectionSeparatorColor: string;
  subtitleTextColor: string;
  destructiveTextColor: string;
}

export interface TelegramContextValue {
  /** Raw Telegram WebApp object, or null outside Telegram */
  webApp: TelegramWebApp | null;
  /** Parsed theme */
  theme: TelegramTheme | null;
  /** Platform string from Telegram */
  platform: string | null;
  /** Whether we are inside a real Telegram client */
  isTelegram: boolean;
  /** Whether SecureStorage is available */
  hasSecureStorage: boolean;
  /** Whether BiometricManager is available */
  hasBiometrics: boolean;
  /** Whether the environment is ready */
  ready: boolean;
}

const TelegramContext = createContext<TelegramContextValue | null>(null);

/**
 * Parses Telegram theme parameters into a typed object.
 * Returns null when themeParams is not available (outside Telegram).
 */
function parseThemeParams(src: Record<string, string> | undefined): TelegramTheme | null {
  if (!src) return null;
  return {
    backgroundColor: src['bg_color'] ?? '#ffffff',
    textColor: src['text_color'] ?? '#000000',
    hintColor: src['hint_color'] ?? '#999999',
    linkColor: src['link_color'] ?? '#2481cc',
    buttonColor: src['button_color'] ?? '#2481cc',
    buttonTextColor: src['button_text_color'] ?? '#ffffff',
    headerBgColor: src['header_bg_color'] ?? src['bg_color'] ?? '#ffffff',
    accentTextColor: src['accent_text_color'] ?? src['button_color'] ?? '#2481cc',
    sectionBgColor: src['section_bg_color'] ?? src['bg_color'] ?? '#ffffff',
    sectionSeparatorColor: src['section_separator_color'] ?? '#e0e0e0',
    subtitleTextColor: src['subtitle_text_color'] ?? src['hint_color'] ?? '#999999',
    destructiveTextColor: src['destructive_text_color'] ?? '#ff3b30',
  };
}

type WebApp = NonNullable<Window['Telegram']>['WebApp'];

/**
 * Feature-detects SecureStorage availability.
 * Uses isVersionAtLeast for Bot API 9.0+ and falls back to object existence check.
 */
function detectSecureStorage(webApp: WebApp): boolean {
  try {
    if (typeof webApp.isVersionAtLeast === 'function' && webApp.isVersionAtLeast('9.0')) {
      return true;
    }
    // Fallback: check object existence
    return 'SecureStorage' in webApp;
  } catch {
    return false;
  }
}

/**
 * Feature-detects BiometricManager availability.
 * Uses isVersionAtLeast for Bot API 7.2+ and falls back to object existence check.
 */
function detectBiometrics(webApp: WebApp): boolean {
  try {
    if (typeof webApp.isVersionAtLeast === 'function' && webApp.isVersionAtLeast('7.2')) {
      return true;
    }
    return 'BiometricManager' in webApp;
  } catch {
    return false;
  }
}

export type TelegramWebApp = WebApp;

declare global {
  interface Window {
    Telegram?: {
      /**
       * Native WebView bridge used by iOS to deliver responses with snake_case event names
       * (`fullscreen_changed`, `safe_area_changed`, ...). Optional: feature-detect, never assume.
       */
      WebView?: {
        receiveEvent?: (eventType: string, eventData?: string | Record<string, unknown>) => void;
      };
      WebApp: {
        initData: string;
        initDataUnsafe: Record<string, unknown>;
        version: string;
        platform: string;
        colorScheme: 'light' | 'dark';
        themeParams: Record<string, string>;
        isExpanded: boolean;
        viewportHeight: number;
        viewportStableHeight: number;
        isVersionAtLeast: (version: string) => boolean;
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        enableClosingConfirmation: () => void;
        disableClosingConfirmation: () => void;
        // Bot API 8.0+ fullscreen (feature-detect before use).
        requestFullscreen?: () => unknown;
        /** Bot API 7.7+; feature-detect before use. */
        disableVerticalSwipes?: () => unknown;
        exitFullscreen?: () => unknown;
        isFullscreen?: boolean;
        safeAreaInset?: { top: number; bottom: number; left: number; right: number };
        contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEvent: (event: string, callback: (...args: any[]) => void) => void;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        offEvent: (event: string, callback: (...args: any[]) => void) => void;
        sendData: (data: string) => void;
        switchInlineQuery: (query: string, chooseChatTypes?: string[]) => void;
        openLink: (url: string) => void;
        openTelegramLink: (url: string) => void;
        openInvoice: (url: string) => boolean;
        showPopup: (params: { title?: string; message: string; buttons?: unknown[] }) => void;
        showAlert: (message: string) => void;
        showConfirm: (message: string) => void;
        SecureStorage?: {
          getItem: (key: string) => Promise<string | null>;
          setItem: (key: string, value: string) => Promise<void>;
          removeItem: (key: string) => Promise<void>;
          clear: () => Promise<void>;
        };
        BiometricManager?: {
          init: () => void;
          isInited: boolean;
          isBiometricAvailable: boolean;
          biometricType: 'finger' | 'face' | undefined;
          isAccessRequested: boolean;
          isAccessGranted: boolean;
          isBiometricTokenSaved: boolean;
          requestAccess: (params: { reason?: string }) => void;
          authenticate: (
            params: { reason?: string },
            callback?: (isSuccess: boolean) => void,
          ) => void;
          updateBiometricToken: (token: string) => void;
          openSettings: () => void;
        };
      };
    };
  }
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<TelegramContextValue>({
    webApp: null,
    theme: null,
    platform: null,
    isTelegram: false,
    hasSecureStorage: false,
    hasBiometrics: false,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let installed = false;

    // Some Telegram clients (notably mobile) inject `window.Telegram.WebApp` a few frames after
    // the document scripts run. Sample for a short window instead of freezing "no Telegram" on
    // the first render, which used to hide Bot API 8.0+ controls (e.g. fullscreen) entirely.
    const MAX_ATTEMPTS = 50;
    const RETRY_MS = 100;

    const install = (webApp: WebApp): void => {
      if (cancelled || installed) return;
      installed = true;
      try {
        webApp.ready();
        webApp.enableClosingConfirmation();
      } catch {
        // Older clients may not implement these; the wallet still works.
      }
      // A downward swipe must never collapse or close the wallet (web + native bridge).
      lockVerticalSwipes(webApp);
      setValue({
        webApp,
        theme: parseThemeParams(webApp.themeParams),
        platform: webApp.platform,
        isTelegram: true,
        hasSecureStorage: detectSecureStorage(webApp),
        hasBiometrics: detectBiometrics(webApp),
        ready: true,
      });
    };

    const attempt = (): void => {
      if (cancelled) return;
      const webApp = window.Telegram?.WebApp ?? null;
      if (webApp) {
        install(webApp);
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) timer = setTimeout(attempt, RETRY_MS);
    };

    attempt();
    // A backgrounded Mini App can be resumed after the client injected the object.
    const onVisible = (): void => {
      if (!document.hidden) attempt();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return <TelegramContext.Provider value={value}>{children}</TelegramContext.Provider>;
}

export function useTelegram(): TelegramContextValue {
  const ctx = useContext(TelegramContext);
  if (!ctx) {
    throw new Error('useTelegram must be used within TelegramProvider');
  }
  return ctx;
}
