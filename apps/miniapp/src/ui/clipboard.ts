/**
 * Clipboard helpers for the recovery-phrase copy action.
 *
 * The phrase is copied as TAB-separated words (`words.join('\t')`) so it pastes back into wallets
 * that split on tabs or whitespace. The clipboard is cleared after 60 seconds where the browser
 * allows a programmatic write; when it does not, the reminder copy tells the user to clear it.
 *
 * The phrase is never kept in React state: callers pass the words straight from `secretHolder`.
 */

export const PHRASE_CLIPBOARD_CLEAR_MS = 60_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** Exact text written to the clipboard for a recovery phrase. */
export function phraseClipboardText(words: readonly string[]): string {
  return words.join('\t');
}

function clipboard(): Clipboard | null {
  if (typeof navigator === 'undefined') return null;
  const value = (navigator as { clipboard?: Clipboard }).clipboard;
  return value ?? null;
}

/** Best-effort clear. A browser may refuse a background write; that is not an error to surface. */
export function clearClipboard(): void {
  const api = clipboard();
  if (!api) return;
  void Promise.resolve(api.writeText('')).catch(() => {
    // Ignored: the reminder copy already tells the user to clear it manually.
  });
}

/** (Re)start the one-minute auto-clear window. */
export function scheduleClipboardClear(delayMs: number = PHRASE_CLIPBOARD_CLEAR_MS): void {
  if (typeof setTimeout !== 'function') return;
  if (clearTimer !== null) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    clearClipboard();
  }, delayMs);
}

/** Cancel a pending auto-clear (tests / teardown). */
export function cancelClipboardClear(): void {
  if (clearTimer !== null) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
}

/**
 * Legacy fallback for browsers/webviews without the async Clipboard API: select a temporary
 * textarea and run `execCommand('copy')` inside the same user gesture. The node is removed
 * immediately; the text is still the tab-separated phrase and is only in the DOM for this call.
 */
function copyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.append(area);
  try {
    area.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- fallback for webviews without navigator.clipboard
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * Copy the phrase and arm the auto-clear. Returns false when the clipboard is unavailable or the
 * write is rejected, so the UI can show a failure instead of a false "Copied".
 */
export async function copyPhraseToClipboard(words: readonly string[]): Promise<boolean> {
  const text = phraseClipboardText(words);
  const api = clipboard();
  if (api) {
    try {
      await api.writeText(text);
      scheduleClipboardClear();
      return true;
    } catch {
      // Fall through to the legacy path (permission denied / insecure context).
    }
  }
  if (!copyViaTextarea(text)) return false;
  scheduleClipboardClear();
  return true;
}
