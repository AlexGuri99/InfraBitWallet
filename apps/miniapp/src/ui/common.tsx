/**
 * Small shared UI primitives. Mobile-first, Telegram theme variables, WCAG-friendly focus styles.
 * No secret ever passes through these components as props or state.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';
import { useTelegram } from '../telegram';

export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <span className="text-xs opacity-70" aria-label={`Step ${String(current)} of ${String(total)}`}>
      Step {current} of {total}
    </span>
  );
}

/**
 * Mobile: full-bleed with Telegram safe areas. Desktop: a centred elevated card.
 * The card surface uses the Telegram section colour so the app still looks native.
 */
export function ScreenShell({
  title,
  children,
  onBack,
  step,
}: {
  title: string;
  children: ReactNode;
  onBack?: (() => void) | undefined;
  step?: { current: number; total: number } | undefined;
}) {
  const { theme } = useTelegram();
  return (
    <div
      className="min-h-screen w-full flex justify-center"
      style={{
        backgroundColor: theme?.backgroundColor ?? 'var(--tg-theme-bg-color, #fff)',
        color: theme?.textColor ?? 'var(--tg-theme-text-color, #000)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div
        className="w-full max-w-md flex flex-col min-h-screen sm:min-h-0 sm:my-8 sm:rounded-2xl sm:shadow-xl sm:border sm:border-black/10 overflow-hidden"
        style={{
          backgroundColor: theme?.sectionBgColor ?? 'var(--tg-theme-section-bg-color, #fff)',
        }}
      >
        <header
          className="px-4 py-3 flex items-center gap-3"
          style={{
            backgroundColor: theme?.headerBgColor ?? 'var(--tg-theme-header-bg-color, #f0f0f0)',
          }}
        >
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-sm underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              aria-label="Back"
            >
              ←
            </button>
          ) : null}
          <h1 className="text-lg font-semibold flex-1">{title}</h1>
          {step ? <StepIndicator current={step.current} total={step.total} /> : null}
        </header>
        <main className="flex-1 px-4 py-6 flex flex-col gap-4 w-full">{children}</main>
      </div>
    </div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const base =
    'w-full min-h-11 rounded-lg px-4 py-2 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary:
      'text-[var(--tg-theme-button-text-color,#fff)] bg-[var(--tg-theme-button-color,#2481cc)]',
    secondary: 'border border-current bg-transparent',
    danger: 'text-white bg-[var(--tg-theme-destructive-text-color,#ff3b30)]',
  } as const;
  return <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  id,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  id: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className="min-h-11 rounded-lg border border-gray-400/60 bg-transparent px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        {...props}
      />
      {hint ? <p className="text-xs opacity-70">{hint}</p> : null}
    </div>
  );
}

export function PhraseInput({
  label,
  hint,
  id,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  id: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={4}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="rounded-lg border border-gray-400/60 bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        {...props}
      />
      {hint ? <p className="text-xs opacity-70">{hint}</p> : null}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className="text-sm text-[var(--tg-theme-destructive-text-color,#ff3b30)]"
    >
      {children}
    </p>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
}) {
  return (
    <p
      className={`rounded-lg p-3 text-sm ${
        tone === 'warning'
          ? 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100'
          : 'bg-black/5 dark:bg-white/10'
      }`}
    >
      {children}
    </p>
  );
}
