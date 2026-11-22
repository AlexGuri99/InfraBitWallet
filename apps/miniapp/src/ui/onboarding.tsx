/**
 * Welcome, create-phrase, reveal-phrase and backup-verification screens.
 *
 * Secrets rule is unchanged: the phrase lives only in the module-scoped holder. It is written
 * into the DOM imperatively after an explicit tap (two numbered columns of pills) and removed
 * when hidden or unmounted. No word or passcode is ever React state.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';

type Step = { current: number; total: number };

function createWordItem(index: number, word: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const badge = document.createElement('span');
  badge.textContent = String(index + 1);
  badge.className =
    'h-6 w-6 shrink-0 rounded-full bg-black/10 dark:bg-white/20 text-xs flex items-center justify-center';
  const pill = document.createElement('span');
  pill.textContent = word;
  pill.dataset['role'] = 'word';
  pill.dataset['wordIndex'] = String(index);
  pill.className = 'flex-1 rounded-full bg-black/5 dark:bg-white/10 px-3 py-1 font-mono text-sm';
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
      className="grid grid-cols-2 gap-2 min-h-6"
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

export function WelcomeScreen({
  onCreate,
  onImport,
}: {
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <ScreenShell title={t('app.name')}>
      <h2 className="text-xl font-semibold">{t('welcome.title')}</h2>
      <p className="text-sm opacity-80">{t('app.tagline')}</p>
      <p className="text-sm">{t('welcome.body')}</p>
      <p className="text-sm">{t('welcome.telegram.body')}</p>
      <Notice tone="warning">{t('welcome.never.ask')}</Notice>
      <p className="text-xs opacity-70">{t('welcome.support')}</p>
      <Button onClick={onCreate}>{t('welcome.create')}</Button>
      <Button variant="secondary" onClick={onImport}>
        {t('welcome.import')}
      </Button>
    </ScreenShell>
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
  const [checked, setChecked] = useState(false);
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
    const onVisibility = (): void => {
      if (document.hidden && revealed) setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const left = leftRef.current;
    const right = rightRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (left) left.replaceChildren();
      if (right) right.replaceChildren();
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack} step={step}>
      <Notice tone="warning">{t('phrase.warning')}</Notice>
      <PhraseGrid leftRef={leftRef} rightRef={rightRef} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      {revealed ? (
        <Button
          variant="secondary"
          onClick={() => {
            setRevealed(false);
          }}
        >
          {t('phrase.hide')}
        </Button>
      ) : (
        <Button
          onClick={() => {
            setRevealed(true);
          }}
        >
          {hasPhrase ? t('phrase.reveal') : t('phrase.revealAgain')}
        </Button>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={!revealed}
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
          className="mt-1"
        />
        <span>{t('phrase.checkbox')}</span>
      </label>
      <Button onClick={onDone} disabled={!revealed || !checked || !hasPhrase}>
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
    const onVisibility = (): void => {
      if (document.hidden && revealed) setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const left = leftRef.current;
    const right = rightRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (left) left.replaceChildren();
      if (right) right.replaceChildren();
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack} step={step}>
      <Notice tone="warning">{t('phrase.settings.warning')}</Notice>
      <PhraseGrid leftRef={leftRef} rightRef={rightRef} />
      {empty ? <ErrorText>{t('settings.error')}</ErrorText> : null}
      {revealed ? (
        <Button
          variant="secondary"
          onClick={() => {
            setRevealed(false);
          }}
        >
          {t('phrase.hide')}
        </Button>
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
    </ScreenShell>
  );
}

export function VerifyScreen({
  onVerified,
  onCancel,
  step,
}: {
  onVerified: () => void;
  onCancel: () => void;
  step?: Step;
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
    secretHolder.clear();
    setDone(true);
    onVerified();
  };

  if (done) return null;

  return (
    <ScreenShell title={t('verify.title')} onBack={onCancel} step={step}>
      <p className="text-sm">{t('verify.body')}</p>
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
