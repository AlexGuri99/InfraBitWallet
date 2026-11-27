/**
 * Shared UI primitives (DESIGN.md §2–§4).
 *
 * Semantic tokens only — no screen hardcodes a colour. Mobile-first inside a 430px frame with
 * Telegram safe areas. Nothing here ever receives a secret as a prop or keeps one in state.
 */
import { useEffect } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';
import { t } from '../i18n';
import { ChevronLeftIcon, CloseIcon } from './icons';
import { CoinIcon } from './coin-icons';

export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <span
      className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-2"
      aria-label={`Step ${String(current)} of ${String(total)}`}
    >
      Step {current} of {total}
    </span>
  );
}

/** Centred mobile viewport frame with Telegram safe-area insets. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] w-full justify-center bg-canvas text-ink">
      <div
        data-testid="phone-frame"
        className="flex min-h-[100dvh] w-full max-w-[430px] flex-col"
        style={{
          // Device/status-bar inset + Telegram's floating-controls band (fullscreen only).
          paddingTop:
            'calc(var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0px)) + var(--tg-content-safe-area-inset-top, 0px))',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('settings.back')}
      className="pressable flex h-9 items-center gap-0.5 rounded-full bg-surface-secondary pl-1.5 pr-3 text-[13px] font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
    >
      <ChevronLeftIcon size={18} />
      {t('settings.back')}
    </button>
  );
}

/**
 * Standard sub-screen header: `< Back` pill on the left, centred title, optional right slot.
 * The title is the screen's only h1.
 */
export function ScreenHeader({
  title,
  onBack,
  right,
  step,
  floating = false,
}: {
  title: string;
  onBack?: (() => void) | undefined;
  right?: ReactNode;
  step?: { current: number; total: number } | undefined;
  floating?: boolean;
}) {
  return (
    <header
      className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3 ${
        floating ? '' : 'sticky z-20 bg-glass backdrop-blur-[18px]'
      }`}
      style={
        floating
          ? undefined
          : {
              // Stick below the same safe-area band the shell reserves, so a scrolled header never
              // slides under the notch or Telegram's floating fullscreen controls.
              top: 'calc(var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0px)) + var(--tg-content-safe-area-inset-top, 0px))',
            }
      }
    >
      <div className="flex justify-start">{onBack ? <BackButton onClick={onBack} /> : null}</div>
      <h1 className="text-center text-[17px] font-bold tracking-[-0.01em] text-ink">{title}</h1>
      <div className="flex items-center justify-end gap-2">
        {step ? <StepIndicator current={step.current} total={step.total} /> : null}
        {right}
      </div>
    </header>
  );
}

/**
 * Onboarding / flow shell: framed viewport with the standard header and a scrolling main column.
 * Renders exactly one h1 (the screen title) and one main landmark.
 */
export function ScreenShell({
  title,
  children,
  onBack,
  step,
  right,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  onBack?: (() => void) | undefined;
  step?: { current: number; total: number } | undefined;
  right?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <PhoneFrame>
      <ScreenHeader title={title} onBack={onBack} step={step} right={right} />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-10 pt-1">
        {subtitle}
        {children}
      </main>
    </PhoneFrame>
  );
}

/** Full-bleed scrolling content with clearance for the floating nav (DESIGN.md §4). */
export function ScreenBody({ children }: { children: ReactNode }) {
  return <main className="flex-1 px-4 pb-[96px] pt-1">{children}</main>;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const base =
    'pressable flex w-full min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-bold tracking-[-0.01em] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-canvas)] disabled:opacity-40 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-accent-primary text-accent-ink',
    secondary: 'bg-surface-secondary text-ink',
    danger: 'bg-negative text-white',
  } as const;
  return <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

/** Compact round icon button used in the top utility cluster. */
export function IconButton({
  label,
  children,
  className = '',
  tone = 'surface',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  tone?: 'surface' | 'glass' | 'hero';
}) {
  const tones = {
    surface: 'bg-surface-secondary text-ink',
    glass: 'bg-glass text-ink backdrop-blur-[18px]',
    hero: 'bg-hero-pill text-hero-ink',
  } as const;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  id,
  ref,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string | undefined;
  id: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-[12.5px] font-semibold text-ink-2">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className={`min-h-12 rounded-2xl border border-hairline bg-surface px-4 py-2 text-[15px] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${className}`}
        {...props}
      />
      {hint ? <p className="px-1 text-[12px] text-ink-muted">{hint}</p> : null}
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
  hint?: string | undefined;
  id: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-[12.5px] font-semibold text-ink-2">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={4}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="rounded-2xl border border-hairline bg-surface px-4 py-3 font-mono text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
        {...props}
      />
      {hint ? <p className="px-1 text-[12px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" aria-live="polite" className="px-1 text-[13px] font-medium text-negative">
      {children}
    </p>
  );
}

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning' | 'positive';
}) {
  const tones = {
    info: 'bg-surface-secondary text-ink-2',
    warning: 'bg-[color:var(--status-positive-bg)] text-ink',
    positive: 'bg-positive-bg text-positive',
  } as const;
  return (
    <p className={`rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${tones[tone]}`}>{children}</p>
  );
}

/** Rounded grouped list container (DESIGN.md §4). */
export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section';
}) {
  return <Tag className={`overflow-hidden rounded-[24px] bg-surface ${className}`}>{children}</Tag>;
}

export function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-[14px] font-bold tracking-[0.01em] text-ink">{children}</h2>
      {right}
    </div>
  );
}

export function Divider({ inset = true }: { inset?: boolean }) {
  return <div className={`${inset ? 'ml-16' : ''} h-px bg-hairline`} aria-hidden="true" />;
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[88dvh] w-full max-w-[430px] flex-col gap-3 overflow-y-auto rounded-t-[28px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] text-ink sm:rounded-[28px]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('home.close')}
            className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Segmented pill control (Send | Sell, timeframe pills, category chips). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  size?: 'md' | 'sm';
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`grid gap-1 rounded-full bg-surface-secondary p-1 ${
        size === 'sm' ? 'text-[12px]' : 'text-[14px]'
      }`}
      style={{ gridTemplateColumns: `repeat(${String(options.length)}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(option.value);
            }}
            className={`pressable min-h-9 rounded-full px-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${
              active ? 'bg-surface text-ink shadow-card' : 'text-ink-2'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Round token avatar with a symbol fallback glyph. */
/** Circular coin avatar: branded SVG for known coins, deterministic monogram for jettons. */
export function TokenAvatar({
  symbol,
  size = 40,
  className = '',
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  return <CoinIcon symbol={symbol} size={size} className={className} />;
}
