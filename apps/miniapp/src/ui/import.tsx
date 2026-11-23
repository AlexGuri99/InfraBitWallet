/**
 * Import, step 1: the recovery phrase as 12/24 numbered, uncontrolled word boxes.
 *
 * Word values live in the DOM/refs only. React state holds the box count, invalid box indexes
 * and the advanced toggle — never a word. Smart paste fills the boxes from the clipboard event.
 */
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { isBip39Word } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { Button, ErrorText, Notice, ScreenShell, Segmented } from './common';

function splitWords(text: string): string[] {
  return text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export function ImportPhraseScreen({
  onBack,
  onNext,
  step,
}: {
  onBack: () => void;
  /** Receives the assembled words and the advanced flag; returns an error message or null. */
  onNext: (words: string[], forceTonNative: boolean) => Promise<string | null>;
  step?: { current: number; total: number };
}) {
  const [count, setCount] = useState<24 | 12>(24);
  const [invalid, setInvalid] = useState<Set<number>>(new Set());
  const [forceTonNative, setForceTonNative] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pending = useRef<string[] | null>(null);

  const focus = (index: number): void => {
    const target = inputs.current[Math.max(0, Math.min(index, count - 1))];
    target?.focus();
    target?.select();
  };

  const markWord = (index: number, value: string): void => {
    setInvalid((prev) => {
      const next = new Set(prev);
      if (value.trim() !== '' && !isBip39Word(value)) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const applyPending = (): void => {
    const words = pending.current;
    if (!words) return;
    pending.current = null;
    words.forEach((word, index) => {
      const input = inputs.current[index];
      if (input) input.value = word;
    });
    const next = new Set<number>();
    words.forEach((word, index) => {
      if (!isBip39Word(word)) next.add(index);
    });
    setInvalid(next);
    focus(Math.min(words.length, count - 1));
  };

  // A paste that changes the word count re-renders first; fill once the boxes exist.
  useEffect(() => {
    if (pending.current) {
      const words = pending.current;
      pending.current = null;
      words.forEach((word, index) => {
        const input = inputs.current[index];
        if (input) input.value = word;
      });
      const next = new Set<number>();
      words.forEach((word, index) => {
        if (!isBip39Word(word)) next.add(index);
      });
      setInvalid(next);
    }
  }, [count]);

  const collect = (): string[] =>
    Array.from({ length: count }, (_, index) => (inputs.current[index]?.value ?? '').trim());

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const words = splitWords(event.clipboardData.getData('text/plain'));
    if (words.length >= 2) {
      event.preventDefault();
      const nextCount: 12 | 24 = words.length === 12 ? 12 : words.length === 24 ? 24 : count;
      pending.current = words.slice(0, nextCount);
      if (nextCount !== count) setCount(nextCount);
      else applyPending();
    }
  };

  const submit = async (): Promise<void> => {
    if (busy) return;
    const words = collect();
    const empty = words.findIndex((w) => w === '');
    if (empty !== -1) {
      setError(`${t('import.step.phrase')}: ${String(empty + 1)}`);
      return;
    }
    const bad = new Set<number>();
    words.forEach((word, index) => {
      if (!isBip39Word(word)) bad.add(index);
    });
    if (bad.size > 0) {
      setInvalid(bad);
      setError(t('import.invalidWord'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const failure = await onNext(words, forceTonNative);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const columns: Array<[number, number]> = [
    [0, count / 2 - 1],
    [count / 2, count - 1],
  ];

  return (
    <ScreenShell title={t('import.title')} onBack={onBack} step={step}>
      <div className="flex flex-col gap-2">
        <Segmented
          label="Recovery phrase length"
          value={count === 12 ? '12' : '24'}
          options={[
            { value: '24', label: t('import.words24') },
            { value: '12', label: t('import.words12') },
          ]}
          onChange={(value) => {
            setCount(value === '12' ? 12 : 24);
            setInvalid(new Set());
            setError(null);
            pending.current = null;
          }}
        />
        <p className="px-1 text-[12px] text-ink-muted">{t('import.pasteHint')}</p>
      </div>

      <div className="rounded-[24px] bg-surface p-3 shadow-card">
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
          {columns.map(([start, end], columnIndex) => (
            <div key={columnIndex} className="flex flex-col gap-2">
              {Array.from({ length: end - start + 1 }, (_, offset) => {
                const index = start + offset;
                return (
                  <div key={index} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-[10.5px] font-semibold text-ink-2 tabular"
                    >
                      {index + 1}
                    </span>
                    <input
                      ref={(element) => {
                        inputs.current[index] = element;
                      }}
                      id={`import-word-${String(index)}`}
                      aria-label={`Word ${String(index + 1)}`}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className={`min-h-9 w-full rounded-xl border bg-surface-secondary px-2.5 py-1 font-mono text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${
                        invalid.has(index) ? 'border-negative' : 'border-transparent'
                      }`}
                      onBlur={(event) => {
                        markWord(index, event.target.value);
                      }}
                      onPaste={handlePaste}
                      onKeyDown={(event) => {
                        if (event.key === ' ' || event.key === 'Enter' || event.key === 'Tab') {
                          if (index === count - 1 && event.key === 'Enter') {
                            event.preventDefault();
                            void submit();
                            return;
                          }
                          event.preventDefault();
                          focus(index + 1);
                        } else if (
                          event.key === 'Backspace' &&
                          event.currentTarget.value === '' &&
                          index > 0
                        ) {
                          event.preventDefault();
                          focus(index - 1);
                        }
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <details className="rounded-2xl bg-surface px-4 py-3 text-[13px]">
        <summary className="cursor-pointer font-semibold text-ink-2">
          {t('import.advanced')}
        </summary>
        <label className="mt-2 flex items-start gap-2 text-ink">
          <input
            type="checkbox"
            checked={forceTonNative}
            onChange={(event) => {
              setForceTonNative(event.target.checked);
            }}
            className="mt-0.5 h-4 w-4 accent-[color:var(--accent-primary)]"
          />
          <span>{t('import.forceTon')}</span>
        </label>
      </details>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Notice tone="warning">{t('welcome.never.ask')}</Notice>
      <Button
        onClick={() => {
          void submit();
        }}
        disabled={busy}
      >
        {busy ? t('common.working') : t('import.continue')}
      </Button>
    </ScreenShell>
  );
}

export function DisambiguateScreen({
  onBack,
  onChoose,
  step,
}: {
  onBack: () => void;
  onChoose: (accountType: 'bip39-multichain' | 'ton-native-only') => void;
  step?: { current: number; total: number };
}) {
  return (
    <ScreenShell title={t('import.disambiguate.title')} onBack={onBack} step={step}>
      <p className="px-1 text-[13px] leading-relaxed text-ink-2">{t('import.disambiguate.body')}</p>
      <Button
        onClick={() => {
          onChoose('bip39-multichain');
        }}
      >
        {t('import.disambiguate.standard')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          onChoose('ton-native-only');
        }}
      >
        {t('import.disambiguate.ton')}
      </Button>
    </ScreenShell>
  );
}
