/**
 * Welcome, create-phrase, reveal-phrase and backup-verification screens (DESIGN.md §5.7).
 *
 * Security precedence is unchanged: the phrase lives only in the module-scoped holder. It is
 * written into the DOM imperatively after an explicit tap (two numbered columns of pills) and
 * removed when hidden or unmounted. No word or passcode is ever React state. An explicit
 * "Copy phrase" action (next to "Hide phrase") copies the words TAB-separated and arms a
 * 60-second clipboard clear; the phrase is never auto-copied.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, PhoneFrame, ScreenShell, Sheet } from './common';
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, CopyIcon, ShieldIcon } from './icons';
import { InfraBitLogo } from './logo';
import { copyPhraseToClipboard } from './clipboard';
import { useToast } from './toast';
import { LegalLinks } from './legal';

type Step = { current: number; total: number };

function createWordItem(index: number, word: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const badge = document.createElement('span');
  badge.textContent = String(index + 1);
  badge.className =
    'h-6 w-6 shrink-0 rounded-full bg-surface-elevated text-[11px] font-semibold text-ink-2 flex items-center justify-center tabular';
  const pill = document.createElement('span');
  pill.textContent = word;
  pill.dataset['role'] = 'word';
  pill.dataset['wordIndex'] = String(index);
  pill.className =
    'flex-1 rounded-full bg-surface-secondary px-3 py-1.5 font-mono text-[13px] text-ink';
  row.append(badge, pill);
  return row;
}

function renderPhrase(left: HTMLDivElement | null, right: HTMLDivElement | null): void {
  const words = secretHolder.words();
  if (left) left.replaceChildren();
  if (right) right.replaceChildren();
  if (words.length === 0) return;
  const half = Math.ceil(words.length / 2);
  words.forEach((word, index) => {
    const item = createWordItem(index, word);
    const target = index < half ? left : right;
    target?.append(item);
  });
}

export function PhraseGrid({
  leftRef,
  rightRef,
}: {
  leftRef: RefObject<HTMLDivElement | null>;
  rightRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      data-testid="phrase-words"
      aria-label="Recovery phrase words"
      className="grid min-h-6 grid-cols-2 gap-x-3 gap-y-2"
    >
      <div ref={leftRef} className="flex flex-col gap-2" />
      <div ref={rightRef} className="flex flex-col gap-2" />
    </div>
  );
}

function pickPositions(count: number, take: number): number[] {
  const positions = Array.from({ length: count }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const random = crypto.getRandomValues(new Uint32Array(1));
    const j = (random[0] ?? 0) % (i + 1);
    const a = positions[i];
    const b = positions[j];
    if (a !== undefined && b !== undefined) {
      positions[i] = b;
      positions[j] = a;
    }
  }
  return positions.slice(0, Math.min(take, count)).sort((a, b) => a - b);
}

/** Brand mark: the InfraBit logo replaces the rounded monogram emblem. */
function Emblem({ size = 88 }: { size?: number }) {
  return <InfraBitLogo size={size} className="shadow-card" />;
}

/** Recovery-phrase copy control (tab-separated words, one-minute clipboard auto-clear). */
function CopyPhraseButton() {
  const toast = useToast();
  const copy = async (): Promise<void> => {
    const words = secretHolder.words();
    if (words.length === 0) return;
    const copied = await copyPhraseToClipboard(words);
    toast.show(copied ? t('phrase.copied') : t('phrase.copyFailed'));
  };
  return (
    <Button variant="secondary" onClick={() => void copy()} data-testid="copy-phrase">
      <CopyIcon size={15} />
      {t('phrase.copy')}
    </Button>
  );
}

function PhraseCopyReminder() {
  return (
    <p className="px-1 text-[11.5px] leading-relaxed text-ink-muted">{t('phrase.copyHint')}</p>
  );
}

function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title={`More about ${t('app.name')}`} onClose={onClose}>
      <div className="flex items-start gap-3 rounded-2xl bg-surface-secondary p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-positive-bg text-positive">
          <ShieldIcon size={19} />
        </span>
        <p className="text-[13px] leading-relaxed text-ink-2">{t('welcome.body')}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-2">{t('welcome.telegram.body')}</p>
      <Notice tone="warning">{t('welcome.never.ask')}</Notice>
      <p className="text-[12px] leading-relaxed text-ink-muted">{t('welcome.support')}</p>
      <Button onClick={onClose}>{t('common.done')}</Button>
    </Sheet>
  );
}

export function WelcomeScreen({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  const [sheet, setSheet] = useState<'import' | 'about' | null>(null);
  return (
    <PhoneFrame>
      <main className="flex flex-1 flex-col justify-between px-5 pb-10 pt-10">
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <Emblem />
          <div className="flex flex-col items-center gap-1.5">
            <h1 className="text-[27px] font-extrabold tracking-[-0.03em] text-ink">
              {t('app.name')}
            </h1>
            <button
              type="button"
              onClick={() => {
                setSheet('about');
              }}
              className="pressable inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[13px] font-semibold text-accent-link focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
            >
              More about {t('app.name')}
              <ChevronRightIcon size={15} />
            </button>
          </div>
          <div className="flex max-w-[300px] flex-col gap-2">
            <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">
              {t('welcome.title')}
            </h2>
            <p className="text-[13px] leading-relaxed text-ink-2">{t('app.tagline')}</p>
          </div>
          <div className="w-full max-w-[330px] rounded-[22px] bg-surface px-4 py-3.5 text-left text-[12.5px] leading-relaxed text-ink-2 shadow-card">
            {t('welcome.telegram.body')}
          </div>
          <p className="max-w-[320px] text-[12px] font-semibold text-ink-2">
            {t('welcome.never.ask')}
          </p>
          <LegalLinks />
        </div>

        <div className="flex w-full flex-col gap-2.5 pt-8">
          <Button onClick={onCreate}>{t('welcome.create')}</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setSheet('import');
            }}
          >
            {t('welcome.import')}
          </Button>
        </div>
      </main>

      {sheet === 'about' ? (
        <AboutSheet
          onClose={() => {
            setSheet(null);
          }}
        />
      ) : null}

      {sheet === 'import' ? (
        <Sheet
          title={t('welcome.import')}
          onClose={() => {
            setSheet(null);
          }}
        >
          <button
            type="button"
            onClick={() => {
              setSheet(null);
              onImport();
            }}
            className="pressable flex items-center gap-3 rounded-[20px] bg-surface-secondary p-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-positive-bg font-mono text-[12px] font-bold text-positive">
              Aa
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold text-ink">Secret Words</span>
              <span className="block text-[12px] text-ink-2">
                12 or 24 words from an existing wallet
              </span>
            </span>
            <ChevronRightIcon size={18} className="text-ink-muted" />
          </button>
          <div
            aria-disabled="true"
            className="flex items-center gap-3 rounded-[20px] bg-surface-secondary p-3.5 opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-elevated text-ink-2">
              <CloseIcon size={17} />
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold text-ink">View Any Address</span>
              <span className="block text-[12px] text-ink-2">Read-only watch mode</span>
            </span>
            <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
              Coming soon
            </span>
          </div>
          <Notice>{t('welcome.never.ask')}</Notice>
        </Sheet>
      ) : null}
    </PhoneFrame>
  );
}

/** Create, step 1: show the generated phrase and require a backup acknowledgement. */
export function CreatePhraseScreen({
  onBack,
  onDone,
  step,
}: {
  onBack: () => void;
  onDone: () => void;
  step: Step;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPhrase = secretHolder.has();

  useEffect(() => {
    if (revealed) {
      if (!secretHolder.has()) {
        setError(t('settings.error'));
        return;
      }
      renderPhrase(leftRef.current, rightRef.current);
    } else {
      renderPhrase(null, null);
    }
  }, [revealed]);

  useEffect(() => {
    const hide = (): void => {
      if (revealed) setRevealed(false);
    };
    const onVisibility = (): void => {
      if (document.hidden) hide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', hide);
    const left = leftRef.current;
    const right = rightRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', hide);
      if (left) left.replaceChildren();
      if (right) right.replaceChildren();
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack} step={step}>
      <Notice tone="warning">{t('phrase.warning')}</Notice>
      <div className={`rounded-[24px] bg-surface p-3.5 shadow-card ${revealed ? '' : 'relative'}`}>
        <PhraseGrid leftRef={leftRef} rightRef={rightRef} />
        {revealed ? null : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[24px] bg-surface px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary text-ink-2">
              <ShieldIcon size={22} />
            </span>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Tap to reveal. Make sure nobody can see your screen.
            </p>
          </div>
        )}
      </div>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {revealed ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRevealed(false);
              }}
            >
              {t('phrase.hide')}
            </Button>
            <CopyPhraseButton />
          </div>
          <PhraseCopyReminder />
        </>
      ) : (
        <Button
          onClick={() => {
            setRevealed(true);
          }}
        >
          {hasPhrase ? t('phrase.reveal') : t('phrase.revealAgain')}
        </Button>
      )}
      <Notice>
        You will be asked to confirm three words from this phrase before the wallet is sealed.
      </Notice>
      <Button onClick={onDone} disabled={!revealed || !hasPhrase}>
        {t('phrase.next')}
      </Button>
    </ScreenShell>
  );
}

/** Settings-mode reveal (re-authenticated) with the same two-column layout. */
export function PhraseScreen({
  onBack,
  onDone,
  step,
}: {
  onBack: () => void;
  onDone: () => void;
  step?: Step;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    if (revealed) {
      if (!secretHolder.has()) {
        setEmpty(true);
        return;
      }
      renderPhrase(leftRef.current, rightRef.current);
    } else {
      renderPhrase(null, null);
    }
  }, [revealed]);

  useEffect(() => {
    const hide = (): void => {
      if (revealed) setRevealed(false);
    };
    const onVisibility = (): void => {
      if (document.hidden) hide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', hide);
    const left = leftRef.current;
    const right = rightRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', hide);
      if (left) left.replaceChildren();
      if (right) right.replaceChildren();
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack} step={step}>
      <Notice tone="warning">{t('phrase.settings.warning')}</Notice>
      <div className="rounded-[24px] bg-surface p-3.5 shadow-card">
        <PhraseGrid leftRef={leftRef} rightRef={rightRef} />
      </div>
      {empty ? <ErrorText>{t('settings.error')}</ErrorText> : null}
      {revealed ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRevealed(false);
              }}
            >
              {t('phrase.hide')}
            </Button>
            <CopyPhraseButton />
          </div>
          <PhraseCopyReminder />
        </>
      ) : (
        <Button
          onClick={() => {
            setRevealed(true);
          }}
        >
          {t('phrase.reveal')}
        </Button>
      )}
      <Button onClick={onDone}>{t('common.done')}</Button>
      <p className="px-1 text-[12px] text-ink-muted">{t('welcome.never.ask')}</p>
    </ScreenShell>
  );
}

export function VerifyScreen({
  onVerified,
  onCancel,
  step,
  keepPhrase = false,
}: {
  onVerified: () => void;
  onCancel: () => void;
  step?: Step;
  /** Creation flow: keep the phrase in the holder so the passcode step can seal it. */
  keepPhrase?: boolean;
}) {
  const words = secretHolder.words();
  const positions = useMemo(() => pickPositions(words.length, 3), [words.length]);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (): void => {
    const wrong: number[] = [];
    positions.forEach((position, index) => {
      const answer = (inputs.current[index]?.value ?? '').trim().toLowerCase();
      if (answer !== (words[position] ?? '').toLowerCase()) wrong.push(position + 1);
    });
    if (wrong.length > 0) {
      setError(`${t('verify.retry')} (${wrong.join(', ')})`);
      return;
    }
    setError(null);
    // Backup-test mode clears the temporary phrase immediately; creation keeps it for sealing.
    if (!keepPhrase) secretHolder.clear();
    setDone(true);
    onVerified();
  };

  if (done) return null;

  return (
    <ScreenShell title={t('verify.title')} onBack={onCancel} step={step}>
      <p className="px-1 text-[13px] leading-relaxed text-ink-2">{t('verify.body')}</p>
      {positions.map((position, index) => (
        <Field
          key={position}
          id={`word-${String(position)}`}
          label={`${t('verify.wordAt')} ${String(position + 1)}`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          ref={(element) => {
            inputs.current[index] = element;
          }}
        />
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={submit}>{t('verify.submit')}</Button>
    </ScreenShell>
  );
}

export function MoreButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable flex items-center gap-0.5 text-[13px] font-semibold text-accent-link"
    >
      {children}
      <ChevronDownIcon size={14} />
    </button>
  );
}
