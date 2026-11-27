/**
 * Telegram native event bridge — installed at the very start of `main.tsx`, before React mounts.
 *
 * Telegram clients deliver method responses on several different surfaces depending on platform:
 *
 * - iOS / macOS (WKWebView): `window.TelegramGameProxy.receiveEvent(eventType, eventData)` —
 *   the primary receiver. The name is created by the native side, but we initialize it when the
 *   client has not yet done so.
 * - Legacy fallback: `window.TelegramGameProxy_receiveEvent(eventType, eventData)`.
 * - Android / Desktop: `window.Telegram.WebView.receiveEvent(eventType, eventData)`.
 * - Telegram Web (iframe): `window.postMessage({ eventType, eventData })` from the parent.
 *
 * Every surface is wrapped WITHOUT breaking a handler that is already installed there, without
 * double-wrapping the same function, and with read-only globals tolerated. Events that arrive
 * before `FullscreenProvider` subscribes are buffered and flushed on subscribe.
 *
 * Payloads are untrusted: `eventData` may be an object or a JSON string, values are coerced, and
 * only the four documented event names are accepted.
 */

export interface NativeInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type NativeTelegramEvent =
  | { type: 'fullscreen_changed'; isFullscreen: boolean }
  | { type: 'fullscreen_failed'; error: string }
  | { type: 'safe_area_changed'; inset: NativeInset }
  | { type: 'content_safe_area_changed'; inset: NativeInset };

type NativeEventData = string | Record<string, unknown> | undefined;
type ReceiveEventFn = (eventType: string, eventData?: NativeEventData) => void;
type Subscriber = (event: NativeTelegramEvent) => void;

const WRAPPED = Symbol.for('infrabit.telegram.nativeEvents');
type WrappedFn = ReceiveEventFn & { [WRAPPED]?: boolean };

const MAX_QUEUE = 32;
const subscribers = new Set<Subscriber>();
const queue: NativeTelegramEvent[] = [];

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function readPayload(eventData: unknown): Record<string, unknown> {
  let data: unknown = eventData;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = undefined;
    }
  }
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

/** Strict parser: only the four documented shapes are accepted; anything else returns null. */
export function parseNativeTelegramEvent(
  eventType: unknown,
  eventData: unknown,
): NativeTelegramEvent | null {
  if (typeof eventType !== 'string') return null;
  const data = readPayload(eventData);
  if (eventType === 'fullscreen_changed') {
    const value = data['is_fullscreen'];
    return { type: 'fullscreen_changed', isFullscreen: value === true || value === 'true' };
  }
  if (eventType === 'fullscreen_failed') {
    return {
      type: 'fullscreen_failed',
      error: typeof data['error'] === 'string' ? data['error'] : '',
    };
  }
  if (eventType === 'safe_area_changed' || eventType === 'content_safe_area_changed') {
    return {
      type: eventType,
      inset: {
        top: numberOrZero(data['top']),
        bottom: numberOrZero(data['bottom']),
        left: numberOrZero(data['left']),
        right: numberOrZero(data['right']),
      },
    };
  }
  return null;
}

function deliver(event: NativeTelegramEvent): void {
  if (subscribers.size === 0) {
    if (queue.length < MAX_QUEUE) queue.push(event);
    return;
  }
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // A subscriber must never break Telegram's dispatch loop.
    }
  }
}

/** Subscribe to parsed native events. Queued pre-mount events are delivered immediately after. */
export function subscribeTelegramNativeEvents(handler: Subscriber): () => void {
  subscribers.add(handler);
  if (queue.length > 0) {
    const pending = queue.splice(0, queue.length);
    queueMicrotask(() => {
      // Deliver to whoever is subscribed now: React StrictMode mounts, unmounts and remounts
      // effects, so the subscribing handler identity can change before the microtask runs.
      if (subscribers.size === 0) {
        queue.unshift(...pending);
        return;
      }
      for (const event of pending) {
        for (const subscriber of subscribers) {
          try {
            subscriber(event);
          } catch {
            // Ignore a subscriber failure; the event is already consumed.
          }
        }
      }
    });
  }
  return () => {
    subscribers.delete(handler);
  };
}

/** Test/reset helper: drops buffered events and subscribers. */
export function resetTelegramNativeEvents(): void {
  queue.length = 0;
  subscribers.clear();
}

function makeReceiver(previous: ReceiveEventFn | undefined): ReceiveEventFn {
  const receiver: WrappedFn = (eventType, eventData) => {
    if (previous) {
      try {
        previous(eventType, eventData);
      } catch {
        // A broken pre-existing handler must not suppress our dispatch.
      }
    }
    const parsed = parseNativeTelegramEvent(eventType, eventData);
    if (parsed) deliver(parsed);
  };
  receiver[WRAPPED] = true;
  return receiver;
}

/**
 * Installs `receiveEvent` on `holder`, preserving the current handler. Skips surfaces that
 * already carry our wrapper (a shared function is dispatched once per surface call anyway).
 * Returns false when the property cannot be written (frozen/read-only global).
 */
function wrapReceiveEvent(holder: Record<string, unknown>, key: string): boolean {
  try {
    const current = holder[key];
    if (typeof current === 'function' && (current as WrappedFn)[WRAPPED] === true) return true;
    const previous = typeof current === 'function' ? (current as ReceiveEventFn) : undefined;
    holder[key] = makeReceiver(previous);
    return true;
  } catch {
    return false;
  }
}

interface NativeWindow {
  TelegramGameProxy?: Record<string, unknown>;
  TelegramGameProxy_receiveEvent?: unknown;
  Telegram?: { WebView?: Record<string, unknown> };
}

let installed = false;

/**
 * Installs the shared dispatcher across every Telegram receive surface. Idempotent: safe to call
 * again when a surface appears late (e.g. `window.Telegram` injected after page scripts).
 */
export function installTelegramNativeEventBridge(): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as NativeWindow;

  // 1. Primary iOS/macOS receiver.
  try {
    if (!win.TelegramGameProxy) win.TelegramGameProxy = {};
    wrapReceiveEvent(win.TelegramGameProxy, 'receiveEvent');
  } catch {
    // Read-only global: the other surfaces may still be writable.
  }

  // 2. Legacy global fallback.
  wrapReceiveEvent(win as unknown as Record<string, unknown>, 'TelegramGameProxy_receiveEvent');

  // 3. Android / Desktop WebView receiver (never create window.Telegram ourselves).
  try {
    if (win.Telegram) {
      if (!win.Telegram.WebView) win.Telegram.WebView = {};
      wrapReceiveEvent(win.Telegram.WebView, 'receiveEvent');
    }
  } catch {
    // Frozen Telegram object; nothing else to do here.
  }

  // 4. Telegram Web iframe messages: { eventType, eventData }.
  if (!installed) {
    installed = true;
    window.addEventListener('message', (message: MessageEvent) => {
      const raw: unknown = message.data;
      let data: unknown = raw;
      if (typeof raw === 'string') {
        try {
          data = JSON.parse(raw);
        } catch {
          return;
        }
      }
      if (data === null || typeof data !== 'object') return;
      const record = data as Record<string, unknown>;
      const parsed = parseNativeTelegramEvent(record['eventType'], record['eventData']);
      if (parsed) deliver(parsed);
    });
  }
}
