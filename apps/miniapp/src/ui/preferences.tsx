/**
 * Non-secret UI preferences: colour theme and privacy masking.
 *
 * These are device-local display preferences only — never key material. The theme is applied
 * through `data-theme` on <html> so every semantic token flips at once, and mirrored into the
 * Telegram chrome (background/header colours) when the app runs inside Telegram.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { syncTelegramChromeColors } from '../telegram/bridge';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'infrabit.theme';
const PRIVACY_KEY = 'infrabit.privacy';
/** Auto-lock preference, shared with App and the Settings tab. */
export const AUTO_LOCK_KEY = 'infrabit.autoLockMs';
const MASK = '••••';

/**
 * Old device-local keys (`ozw.*` — the pre-rename brand). Testnet-only data: the first read
 * under the new key copies and removes the old one so the preferences carry over cleanly and
 * Mainnet starts with only `infrabit.*` keys.
 */
const LEGACY_KEYS: Readonly<Record<string, string>> = {
  'infrabit.theme': 'ozw.theme',
  'infrabit.privacy': 'ozw.privacy',
  'infrabit.autoLockMs': 'ozw.autoLockMs',
};

/** Read a preference, transparently migrating the legacy key on first access. */
export function readPreference(key: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = LEGACY_KEYS[key];
    if (legacy === undefined) return null;
    const previous = localStorage.getItem(legacy);
    if (previous === null) return null;
    localStorage.setItem(key, previous);
    localStorage.removeItem(legacy);
    return previous;
  } catch {
    return null;
  }
}

export const THEME_CHROME: Record<ThemeMode, { background: string; header: string }> = {
  // DESIGN.md canvas tokens, used verbatim so Telegram's native bar blends with our UI.
  light: { background: '#DFF2E6', header: '#DFF2E6' },
  dark: { background: '#0A0F0D', header: '#0A0F0D' },
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
  return readPreference(key);
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
  // Both the WebApp methods (Android/Desktop/Web) and the raw bridge events (iOS) are used;
  // missing surfaces are no-ops. Colours come from the DESIGN.md canvas tokens.
  syncTelegramChromeColors(theme, window.Telegram?.WebApp ?? null);
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
