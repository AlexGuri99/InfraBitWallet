/**
 * Thin wrappers over Telegram's JS bridge and the WebApp object for app-wide chrome behaviour.
 *
 * Telegram applies some settings natively (vertical swipe, header/background colours). The
 * high-level `WebApp` methods exist on most clients, but iOS in particular only reacts to the
 * bridge events, so both paths are used: calling an already-applied method is harmless.
 *
 * Event payloads are JSON-encoded exactly like telegram-web-app.js does
 * (`postEvent(eventType, JSON.stringify(params))`).
 */
import { telegramWebviewProxy } from './native-events';

/** Minimal WebApp surface used here (feature-detected; never assumed). */
export interface ChromeCapableWebApp {
  disableVerticalSwipes?: (() => unknown) | undefined;
  setHeaderColor?: ((color: string) => unknown) | undefined;
  setBackgroundColor?: ((color: string) => unknown) | undefined;
}

/** Active app background per DESIGN.md tokens (Mint Light / Forest Dark canvas). */
export const TELEGRAM_CHROME_COLORS = {
  light: '#DFF2E6',
  dark: '#0A0F0D',
} as const;

/** Native bar colour for a theme. The floating `X Close` / `v` bar sits over the canvas. */
export function telegramChromeColor(theme: 'light' | 'dark'): string {
  return TELEGRAM_CHROME_COLORS[theme];
}

/**
 * Post one bridge event. Returns false when the bridge is unavailable (e.g. Telegram Web), in
 * which case the WebApp method path is the only one.
 */
export function postTelegramEvent(eventType: string, eventData?: Record<string, unknown>): boolean {
  const proxy = telegramWebviewProxy();
  if (!proxy?.postEvent) return false;
  try {
    proxy.postEvent(eventType, eventData === undefined ? undefined : JSON.stringify(eventData));
    return true;
  } catch {
    return false;
  }
}

/**
 * Lock vertical swipe-to-close: the WebApp method where it exists, plus the bridge event iOS
 * needs (`web_app_setup_swipe_behavior` with `allow_vertical_swipe: false`). Called on app
 * ready and re-asserted on every fullscreen transition.
 */
export function lockVerticalSwipes(webApp?: ChromeCapableWebApp | null): void {
  try {
    webApp?.disableVerticalSwipes?.();
  } catch {
    // Older clients reject the method; the bridge event below still applies where supported.
  }
  postTelegramEvent('web_app_setup_swipe_behavior', { allow_vertical_swipe: false });
}

/**
 * Sync Telegram's native header/background colours with the app theme. Dark uses the Forest
 * canvas hex (not Telegram's `bg_color` alias) so the fullscreen bar matches our own tokens.
 */
export function syncTelegramChromeColors(
  theme: 'light' | 'dark',
  webApp?: ChromeCapableWebApp | null,
): void {
  const color = telegramChromeColor(theme);
  try {
    webApp?.setBackgroundColor?.(color);
  } catch {
    // Ignored: the bridge event below is the fallback.
  }
  try {
    webApp?.setHeaderColor?.(color);
  } catch {
    // Ignored.
  }
  postTelegramEvent('web_app_set_header_color', { color });
  postTelegramEvent('web_app_set_background_color', { color });
}
