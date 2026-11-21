/**
 * Onboarding screens: welcome/risk, passcode, reveal phrase, verify backup, import.
 *
 * Secrets rule: passcodes and phrases are read from uncontrolled inputs / the module holder at
 * submit time only. The phrase is written into the DOM imperatively after an explicit tap and
 * cleared when hidden, navigated away, or the flow ends. No secret enters React state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AccountType, VaultManager } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, PhraseInput, ScreenShell } from './common';

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

export function PasscodeSetupScreen({
  manager,
  title,
  onBack,
  onSubmit,
  submitLabel,
}: {
  manager: VaultManager;
  title: string;
  onBack: () => void;
  onSubmit: (passcode: string, accountType: AccountType) => Promise<string | null>;
  submitLabel: string;
}) {
  const passRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [accountType, setAccountType] = useState<AccountType>('bip39-multichain');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const passcode = passRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';
    if (passcode !== confirm) {
      setError(t('passcode.mismatch'));
      return;
    }
    const policy = manager.evaluatePasscode(passcode);
    if (!policy.ok) {
      setError(policy.error ?? t('passcode.weak'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const failure = await onSubmit(passcode, accountType);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
      if (passRef.current) passRef.current.value = '';
      if (confirmRef.current) confirmRef.current.value = '';
    }
  };

  return (
    <ScreenShell title={title} onBack={onBack}>
      <Notice tone={manager.usesDeviceSecret ? 'info' : 'warning'}>
        {manager.usesDeviceSecret ? t('passcode.deviceSecret') : t('passcode.noDeviceSecret')}
      </Notice>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">{t('accountType.label')}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="accountType"
            value="bip39-multichain"
            checked={accountType === 'bip39-multichain'}
            onChange={() => {
              setAccountType('bip39-multichain');
            }}
            className="mt-1"
          />
          <span>{t('accountType.bip39')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="accountType"
            value="ton-native-only"
            checked={accountType === 'ton-native-only'}
            onChange={() => {
              setAccountType('ton-native-only');
            }}
            className="mt-1"
          />
          <span>
            {t('accountType.tonNative')}
            <span className="block text-xs opacity-70">{t('accountType.tonNative.help')}</span>
          </span>
        </label>
      </fieldset>

      <Field
        id="passcode"
        ref={passRef}
        label={t('passcode.label')}
        type="password"
        autoComplete="new-password"
        autoFocus
        inputMode="text"
      />
      <Field
        id="passcode-confirm"
        ref={confirmRef}
        label={t('passcode.confirm')}
        type="password"
        autoComplete="new-password"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? t('common.working') : submitLabel}
      </Button>
    </ScreenShell>
  );
}

export function ImportScreen({
  manager,
  onBack,
  onImported,
}: {
  manager: VaultManager;
  onBack: () => void;
  onImported: () => void;
}) {
  const phraseRef = useRef<HTMLTextAreaElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [accountType, setAccountType] = useState<AccountType>('bip39-multichain');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const phrase = phraseRef.current?.value ?? '';
    const passcode = passRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';
    if (passcode !== confirm) {
      setError(t('passcode.mismatch'));
      return;
    }
    const policy = manager.evaluatePasscode(passcode);
    if (!policy.ok) {
      setError(policy.error ?? t('passcode.weak'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const imported = await manager.importWallet(phrase, passcode, { accountType });
      if (phraseRef.current) phraseRef.current.value = '';
      if (!imported.ok) {
        setError(imported.error === 'invalid_mnemonic' ? t('import.invalid') : t('settings.error'));
        return;
      }
      const unlocked = await manager.unlock(passcode);
      if (!unlocked.success) {
        setError(t('settings.error'));
        return;
      }
      onImported();
    } finally {
      setBusy(false);
      if (passRef.current) passRef.current.value = '';
      if (confirmRef.current) confirmRef.current.value = '';
    }
  };

  return (
    <ScreenShell title={t('import.title')} onBack={onBack}>
      <PhraseInput
        id="import-phrase"
        ref={phraseRef}
        label={t('import.phrase')}
        hint={t('import.phraseHelp')}
        autoFocus
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">{t('accountType.label')}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="importAccountType"
            value="bip39-multichain"
            checked={accountType === 'bip39-multichain'}
            onChange={() => {
              setAccountType('bip39-multichain');
            }}
            className="mt-1"
          />
          <span>{t('accountType.bip39')}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="importAccountType"
            value="ton-native-only"
            checked={accountType === 'ton-native-only'}
            onChange={() => {
              setAccountType('ton-native-only');
            }}
            className="mt-1"
          />
          <span>{t('accountType.tonNative')}</span>
        </label>
      </fieldset>
      <Field
        id="import-passcode"
        ref={passRef}
        label={t('passcode.label')}
        type="password"
        autoComplete="new-password"
      />
      <Field
        id="import-passcode-confirm"
        ref={confirmRef}
        label={t('passcode.confirm')}
        type="password"
        autoComplete="new-password"
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? t('common.working') : t('import.submit')}
      </Button>
    </ScreenShell>
  );
}

export function PhraseScreen({
  onDone,
  onBack,
  settingsMode = false,
}: {
  onDone: () => void;
  onBack: () => void;
  settingsMode?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const wordsRef = useRef<HTMLDivElement>(null);
  const wordCount = secretHolder.words().length;

  useEffect(() => {
    const node = wordsRef.current;
    if (!node) return;
    if (!revealed) {
      node.textContent = '';
      return;
    }
    const words = secretHolder.words();
    if (words.length === 0) {
      setEmpty(true);
      return;
    }
    node.replaceChildren(
      ...words.map((word, index) => {
        const item = document.createElement('span');
        item.textContent = `${String(index + 1)}. ${word}`;
        item.className =
          'rounded bg-black/5 dark:bg-white/10 px-2 py-1 font-mono text-sm inline-block';
        item.dataset['wordIndex'] = String(index);
        return item;
      }),
    );
  }, [revealed]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden && revealed) setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const node = wordsRef.current;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (node) node.textContent = '';
    };
  }, [revealed]);

  return (
    <ScreenShell title={t('phrase.title')} onBack={onBack}>
      <Notice tone="warning">
        {settingsMode ? t('phrase.settings.warning') : t('phrase.warning')}
      </Notice>
      <p className="text-sm" aria-live="polite">
        {revealed ? '' : t('phrase.reveal')}
      </p>
      <div
        ref={wordsRef}
        data-testid="phrase-words"
        aria-label="Recovery phrase words"
        className="flex flex-wrap gap-2 min-h-6"
      />
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
          {wordCount > 0 ? t('phrase.reveal') : t('phrase.revealAgain')}
        </Button>
      )}
      <Button onClick={onDone} disabled={wordCount === 0}>
        {settingsMode ? t('verify.submit') : t('phrase.done')}
      </Button>
    </ScreenShell>
  );
}

export function VerifyScreen({
  onVerified,
  onCancel,
}: {
  onVerified: () => void;
  onCancel: () => void;
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
    <ScreenShell title={t('verify.title')} onBack={onCancel}>
      <p className="text-sm">{t('verify.body')}</p>
      {positions.map((position, index) => (
        <Field
          key={position}
          id={`word-${String(position)}`}
          label={`${t('verify.wordAt')} ${String(position + 1)}`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          ref={(el) => {
            inputs.current[index] = el;
          }}
        />
      ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={submit}>{t('verify.submit')}</Button>
    </ScreenShell>
  );
}
