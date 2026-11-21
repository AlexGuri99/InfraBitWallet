/**
 * Telegram lifecycle hooks (A8).
 *
 * Telegram emits `activated` / `deactivated` events on WebApp when the Mini App is brought to
 * the foreground or backgrounded (https://core.telegram.org/bots/webapps, events section). The
 * vault session already locks on `visibilitychange`; these hooks let the app also lock when
 * Telegram itself deactivates the Mini App (e.g. Desktop window minimised), where the DOM
 * visibility event does not always fire.
 *
 * The listener lives in the app adapter, not the pure crypto package.
 */
export interface TelegramLifecycleApi {
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
}

export interface LifecycleHooksOptions {
  onActivated?: () => void;
  onDeactivated?: () => void;
}

/**
 * Subscribe to Telegram's activated/deactivated events. Returns an unsubscribe function.
 * Missing object/methods are a no-op (feature detection; never assume a Bot API version).
 */
export function installTelegramLifecycleHooks(
  webApp: TelegramLifecycleApi | undefined,
  options: LifecycleHooksOptions,
): () => void {
  if (!webApp || typeof webApp.onEvent !== 'function') return () => {};

  const onActivated = (): void => options.onActivated?.();
  const onDeactivated = (): void => options.onDeactivated?.();

  webApp.onEvent('activated', onActivated);
  webApp.onEvent('deactivated', onDeactivated);

  return () => {
    webApp.offEvent?.('activated', onActivated);
    webApp.offEvent?.('deactivated', onDeactivated);
  };
}
