/**
 * Floating pill toast (DESIGN.md §6): auto-dismisses after 2.2s.
 *
 * Copy confirmations and "coming soon" taps route through here so no screen needs its own
 * transient banner. The message is always app-owned copy, never remote data.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

interface ToastValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);
const TOAST_MS = 2200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback((next: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setMessage(next);
    timer.current = window.setTimeout(() => {
      setMessage(null);
      timer.current = null;
    }, TOAST_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const value = useMemo<ToastValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 92px)' }}
      >
        {message ? (
          <span
            role="status"
            className="toast-enter pointer-events-auto rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-[color:var(--bg-surface)] shadow-card"
          >
            {message}
          </span>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
