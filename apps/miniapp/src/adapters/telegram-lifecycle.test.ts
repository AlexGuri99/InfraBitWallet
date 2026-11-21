/**
 * A8: Telegram activated/deactivated hooks.
 */
import { describe, it, expect, vi } from 'vitest';
import { installTelegramLifecycleHooks, type TelegramLifecycleApi } from './telegram-lifecycle';

function fakeWebApp(): {
  webApp: TelegramLifecycleApi;
  emit: (event: string) => void;
  activeHandlers: () => number;
} {
  const handlers = new Map<string, Set<() => void>>();
  return {
    webApp: {
      onEvent(event, handler) {
        const set = handlers.get(event) ?? new Set();
        set.add(handler);
        handlers.set(event, set);
      },
      offEvent(event, handler) {
        handlers.get(event)?.delete(handler);
      },
    },
    emit(event) {
      for (const handler of handlers.get(event) ?? []) handler();
    },
    activeHandlers() {
      let n = 0;
      for (const set of handlers.values()) n += set.size;
      return n;
    },
  };
}

describe('A8: Telegram lifecycle hooks', () => {
  it('calls onDeactivated when Telegram deactivates the app', () => {
    const { webApp, emit } = fakeWebApp();
    const onDeactivated = vi.fn();
    const onActivated = vi.fn();
    installTelegramLifecycleHooks(webApp, { onActivated, onDeactivated });
    emit('deactivated');
    expect(onDeactivated).toHaveBeenCalledOnce();
    emit('activated');
    expect(onActivated).toHaveBeenCalledOnce();
  });

  it('unsubscribe removes both handlers', () => {
    const { webApp, emit, activeHandlers } = fakeWebApp();
    const onDeactivated = vi.fn();
    const unsubscribe = installTelegramLifecycleHooks(webApp, { onDeactivated });
    expect(activeHandlers()).toBe(2);
    unsubscribe();
    expect(activeHandlers()).toBe(0);
    emit('deactivated');
    expect(onDeactivated).not.toHaveBeenCalled();
  });

  it('is a no-op when the environment lacks the event API', () => {
    expect(() => installTelegramLifecycleHooks(undefined, {})).not.toThrow();
    expect(() => installTelegramLifecycleHooks({}, {})).not.toThrow();
  });
});
