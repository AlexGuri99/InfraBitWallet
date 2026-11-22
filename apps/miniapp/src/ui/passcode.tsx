/**
 * Dedicated passcode screen shared by Create (step 3) and Import (step 2).
 *
 * The passcode is read from uncontrolled inputs only; React state holds metadata about the
 * policy (length, ok, error), never the value. Visibility toggling changes input types without
 * re-rendering from a value prop.
 */
import { useRef, useState } from 'react';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';

interface PasscodeMeta {
  length: number;
  ok: boolean;
  error: string | null;
}

export function PasscodeScreen({
  manager,
  title,
  onBack,
  onSubmit,
  submitLabel,
  step,
}: {
  manager: VaultManager;
  title: string;
  onBack: () => void;
  /** Returns an error message, or null on success. */
  onSubmit: (passcode: string) => Promise<string | null>;
  submitLabel: string;
  step?: { current: number; total: number };
}) {
  const passRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [meta, setMeta] = useState<PasscodeMeta>({ length: 0, ok: false, error: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (value: string): void => {
    if (value === '') {
      setMeta({ length: 0, ok: false, error: null });
      return;
    }
    const policy = manager.evaluatePasscode(value);
    setMeta({ length: value.length, ok: policy.ok, error: policy.error ?? null });
  };

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
      const failure = await onSubmit(passcode);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
      if (passRef.current) passRef.current.value = '';
      if (confirmRef.current) confirmRef.current.value = '';
      setMeta({ length: 0, ok: false, error: null });
    }
  };

  const type = visible ? 'text' : 'password';

  return (
    <ScreenShell title={title} onBack={onBack} step={step}>
      <Notice tone={manager.usesDeviceSecret ? 'info' : 'warning'}>
        {manager.usesDeviceSecret
          ? t('passcode.requirements.device')
          : t('passcode.requirements.noDevice')}
      </Notice>
      {manager.usesDeviceSecret ? null : (
        <p className="text-xs opacity-70">{t('passcode.requirements.offline')}</p>
      )}

      <Field
        id="passcode"
        ref={passRef}
        label={t('passcode.label')}
        type={type}
        autoComplete="new-password"
        autoFocus
        onChange={(event) => {
          update(event.target.value);
        }}
      />
      <Field
        id="passcode-confirm"
        ref={confirmRef}
        label={t('passcode.confirm')}
        type={type}
        autoComplete="new-password"
      />
      <Button
        variant="secondary"
        onClick={() => {
          setVisible((v) => !v);
        }}
        aria-pressed={visible}
        className="w-auto self-start px-3 min-h-9 text-sm"
      >
        {visible ? t('passcode.hide') : t('passcode.show')}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${meta.ok ? 'text-green-600 dark:text-green-400' : 'opacity-70'}`}
      >
        {meta.length === 0
          ? ''
          : `${String(meta.length)} ${t('passcode.lengthLabel')} — ${
              meta.ok ? t('passcode.met') : (meta.error ?? t('passcode.notMet'))
            }`}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        onClick={() => {
          void submit();
        }}
        disabled={busy}
      >
        {busy ? t('common.working') : submitLabel}
      </Button>
    </ScreenShell>
  );
}
