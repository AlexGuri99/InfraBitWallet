/**
 * Non-secret UI preferences: colour theme and privacy masking.
 *
 * These are device-local display preferences only — never key material. The theme is applied
 * through `data-theme` on <html> so every semantic token flips at once, and mirrored into the
 * Telegram chrome (background/header colours) when the app runs inside Telegram.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'ozw.theme';
const PRIVACY_KEY = 'ozw.privacy';
const MASK = '••••';

export const THEME_CHROME: Record<ThemeMode, { background: string; header: string }> = {
  light: { background: '#DFF2E6', header: '#DFF2E6' },
  // In dark mode the header follows Telegram's own background so iOS keeps its clean buttons.
  dark: { background: '#0A0F0D', header: 'bg_color' },
};

interface PreferencesValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  /** True while balances should render as ••••. */
  masked: boolean;
  setMasked: (masked: boolean) => void;
  toggleMasked: () => void;
  /** Masks a value when privacy mode is on. */
  guard: (value: string) => string;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Display preferences only — a storage failure must never break the app.
  }
}

function initialTheme(): ThemeMode {
  return readStored(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

function syncTelegramChrome(theme: ThemeMode): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  const chrome = THEME_CHROME[theme];
  try {
    if (typeof webApp.setBackgroundColor === 'function') {
      webApp.setBackgroundColor(chrome.background);
    }
    if (typeof webApp.setHeaderColor === 'function') {
      webApp.setHeaderColor(chrome.header);
    }
  } catch {
    // Older clients may reject colours; the in-app theme still applies.
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme);
  const [masked, setMaskedState] = useState<boolean>(() => readStored(PRIVACY_KEY) === '1');

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    writeStored(THEME_KEY, theme);
    syncTelegramChrome(theme);
  }, [theme]);

  useEffect(() => {
    writeStored(PRIVACY_KEY, masked ? '1' : '0');
  }, [masked]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);
  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'light' ? 'dark' : 'light'));
  }, []);
  const setMasked = useCallback((next: boolean) => {
    setMaskedState(next);
  }, []);
  const toggleMasked = useCallback(() => {
    setMaskedState((current) => !current);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      masked,
      setMasked,
      toggleMasked,
      guard: (text: string) => (masked ? MASK : text),
    }),
    [theme, setTheme, toggleTheme, masked, setMasked, toggleMasked],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside PreferencesProvider');
  return ctx;
}

/** Short helper for callers that only need masking. */
export function useMask(): (value: string) => string {
  return usePreferences().guard;
}
