/**
 * Dedicated 6-digit PIN screen shared by Create (step 2) and Import (step 2).
 *
 * The PIN is read from uncontrolled inputs only; React state holds metadata about the policy
 * (length, ok, error), never the value. Visibility toggling changes input types without
 * re-rendering from a value prop.
 */
import { useRef, useState } from 'react';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';
import { EyeIcon, ShieldIcon } from './icons';

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
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-positive-bg text-positive">
          <ShieldIcon size={26} />
        </span>
        <p className="max-w-[300px] text-[12.5px] leading-relaxed text-ink-2">
          {manager.usesDeviceSecret
            ? t('passcode.requirements.device')
            : t('passcode.requirements.noDevice')}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-[24px] bg-surface p-4 shadow-card">
        <Field
          id="passcode"
          ref={passRef}
          label={t('passcode.label')}
          type={type}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="new-password"
          autoFocus
          className="text-center font-mono text-[22px] tracking-[0.5em]"
          onChange={(event) => {
            update(event.target.value);
          }}
        />
        <Field
          id="passcode-confirm"
          ref={confirmRef}
          label={t('passcode.confirm')}
          type={type}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="new-password"
          className="text-center font-mono text-[22px] tracking-[0.5em]"
        />
        <button
          type="button"
          onClick={() => {
            setVisible((v) => !v);
          }}
          aria-pressed={visible}
          aria-label={visible ? t('passcode.hide') : t('passcode.show')}
          className="pressable flex items-center justify-center gap-1.5 self-center rounded-full bg-surface-secondary px-3 py-1.5 text-[12.5px] font-semibold text-ink-2"
        >
          <EyeIcon hidden={visible} size={15} />
          {visible ? t('passcode.hide') : t('passcode.show')}
        </button>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`px-1 text-[12.5px] ${meta.ok ? 'text-positive' : 'text-ink-2'}`}
      >
        {meta.length === 0
          ? ''
          : `${String(meta.length)} ${t('passcode.lengthLabel')} — ${
              meta.ok ? t('passcode.met') : (meta.error ?? t('passcode.notMet'))
            }`}
      </p>

      {manager.usesDeviceSecret ? null : (
        <Notice tone="warning">{t('passcode.requirements.offline')}</Notice>
      )}
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
