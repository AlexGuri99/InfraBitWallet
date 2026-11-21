/**
 * Unlock, home and settings screens.
 *
 * All passcodes and phrases are read from uncontrolled inputs at submit time; the phrase only
 * exists in the module holder and is written into the DOM on demand. Settings actions that
 * touch secrets require a fresh passcode re-authentication.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { setInactivityTimeout } from '@onezerowallet/crypto-vault';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import type { BiometryApi } from '../adapters/biometry';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { Button, ErrorText, Field, Notice, ScreenShell } from './common';

const AUTO_LOCK_KEY = 'ozw.autoLockMs';

function rateLimitedText(ms: number): string {
  return `${t('unlock.rateLimited')} ${String(Math.ceil(ms / 1000))}s`;
}

export function UnlockScreen({
  manager,
  biometry,
  onUnlocked,
  onWiped,
}: {
  manager: VaultManager;
  biometry: BiometryApi;
  onUnlocked: () => void;
  onWiped: () => void;
}) {
  const passRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterMs, setRetryAfterMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [available, enabled] = await Promise.all([
        biometry.available(),
        manager.hasBiometric(),
      ]);
      if (!controller.signal.aborted) {
        setBioAvailable(available);
        setBioEnabled(enabled);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [biometry, manager]);

  useEffect(() => {
    if (retryAfterMs <= 0) return;
    const id = window.setInterval(() => {
      setRetryAfterMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [retryAfterMs]);

  const unlock = async (): Promise<void> => {
    if (busy || retryAfterMs > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await manager.unlock(passRef.current?.value ?? '');
      if (passRef.current) passRef.current.value = '';
      if (result.success) {
        onUnlocked();
        return;
      }
      if (result.error === 'rate_limited') {
        setRetryAfterMs(result.retryAfterMs ?? 0);
        return;
      }
      if (result.error === 'wiped') {
        setError(t('unlock.wiped'));
        onWiped();
        return;
      }
      if (result.error === 'device_secret_missing') {
        setError(t('unlock.deviceSecretMissing'));
        return;
      }
      if (result.error === 'storage_required') {
        setError(t('unlock.storage'));
        return;
      }
      if (result.error === 'kdf_unavailable') {
        setError(t('unlock.kdf'));
        return;
      }
      setError(t('unlock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  const unlockBiometric = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await biometry.authenticate('Unlock your wallet');
      if (!token) {
        setError(t('unlock.wrong'));
        return;
      }
      const result = await manager.unlockWithBiometric(token);
      if (result.success) {
        onUnlocked();
        return;
      }
      if (result.error === 'rate_limited') {
        setRetryAfterMs(result.retryAfterMs ?? 0);
        return;
      }
      setError(t('unlock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell title={t('unlock.title')}>
      <Field
        id="unlock-passcode"
        ref={passRef}
        label={t('unlock.passcode')}
        type="password"
        autoComplete="current-password"
        autoFocus
      />
      {retryAfterMs > 0 ? (
        <p role="status" aria-live="polite" className="text-sm">
          {rateLimitedText(retryAfterMs)}
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onClick={() => void unlock()} disabled={busy || retryAfterMs > 0}>
        {busy ? t('common.working') : t('unlock.submit')}
      </Button>
      {bioAvailable && bioEnabled ? (
        <Button variant="secondary" onClick={() => void unlockBiometric()} disabled={busy}>
          {t('unlock.biometric')}
        </Button>
      ) : null}
      <Notice>{t('home.notice')}</Notice>
    </ScreenShell>
  );
}

function AddressRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="rounded-lg bg-black/5 dark:bg-white/10 p-3 flex flex-col gap-1">
      <span className="text-xs opacity-70">{label}</span>
      <code className="text-xs break-all" data-testid={`address-${label}`}>
        {value}
      </code>
      {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
      <Button
        variant="secondary"
        onClick={() => void copy()}
        aria-label={`${t('home.copy')} ${label}`}
      >
        {copied ? t('home.copied') : t('home.copy')}
      </Button>
    </div>
  );
}

export function HomeScreen({
  manager,
  onLock,
  onSettings,
}: {
  manager: VaultManager;
  onLock: () => void;
  onSettings: () => void;
}) {
  const session = manager.getSession();
  const info = session?.getPublicInfo(0) ?? null;

  return (
    <ScreenShell title={t('home.title')}>
      {info ? (
        <>
          <AddressRow
            label={t('home.receive') + ' TON'}
            value={info.ton.addressNonBounceable}
            hint={t('home.tonPrefer')}
          />
          <AddressRow label="EVM" value={info.evm?.address ?? ''} />
          <AddressRow label="TRON" value={info.tron?.address ?? ''} />
        </>
      ) : (
        <ErrorText>{t('settings.error')}</ErrorText>
      )}
      <Notice>{t('home.notice')}</Notice>
      <Button onClick={onSettings}>{t('home.settings')}</Button>
      <Button variant="secondary" onClick={onLock}>
        {t('home.lock')}
      </Button>
    </ScreenShell>
  );
}

export function SettingsScreen({
  manager,
  biometry,
  onBack,
  onReveal,
  onTestBackup,
  onWiped,
}: {
  manager: VaultManager;
  biometry: BiometryApi;
  onBack: () => void;
  onReveal: () => void;
  onTestBackup: () => void;
  onWiped: () => void;
}) {
  const reauthRef = useRef<HTMLInputElement>(null);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const bioPassRef = useRef<HTMLInputElement>(null);
  const wipeRef = useRef<HTMLInputElement>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [autoLockMs, setAutoLockMs] = useState<number>(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTO_LOCK_KEY) : null;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
  });

  useEffect(() => {
    void (async () => {
      setBioAvailable(await biometry.available());
      setBioEnabled(await manager.hasBiometric());
    })();
  }, [biometry, manager]);

  const reauth = async (): Promise<boolean> => {
    const session = manager.getSession();
    if (!session) return false;
    const result = await session.reauthenticate(reauthRef.current?.value ?? '');
    if (reauthRef.current) reauthRef.current.value = '';
    if (!result.ok) {
      setError(
        result.error === 'rate_limited'
          ? rateLimitedText(result.retryAfterMs ?? 0)
          : t('unlock.wrong'),
      );
      return false;
    }
    setError(null);
    return true;
  };

  const reveal = async (): Promise<void> => {
    const session = manager.getSession();
    if (!session) return;
    if (!(await reauth())) return;
    const revealed = session.revealMnemonic();
    if (!revealed.ok) {
      setError(t('unlock.wrong'));
      return;
    }
    secretHolder.set(revealed.mnemonic);
    onReveal();
  };

  const testBackup = async (): Promise<void> => {
    const session = manager.getSession();
    if (!session) return;
    if (!(await reauth())) return;
    const revealed = session.revealMnemonic();
    if (!revealed.ok) return;
    secretHolder.set(revealed.mnemonic);
    onTestBackup();
  };

  const changePasscode = async (): Promise<void> => {
    const next = newRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';
    if (next !== confirm) {
      setError(t('passcode.mismatch'));
      return;
    }
    const policy = manager.evaluatePasscode(next);
    if (!policy.ok) {
      setError(policy.error ?? t('passcode.weak'));
      return;
    }
    setError(null);
    const result = await manager.changePasscode(oldRef.current?.value ?? '', next);
    if (oldRef.current) oldRef.current.value = '';
    if (newRef.current) newRef.current.value = '';
    if (confirmRef.current) confirmRef.current.value = '';
    if (!result.ok) {
      setError(
        result.error === 'weak_passcode'
          ? (result.message ?? t('passcode.weak'))
          : t('unlock.wrong'),
      );
      return;
    }
    if (result.biometricToken) {
      const stored = await biometry.updateToken(result.biometricToken);
      if (!stored) setError(t('settings.error'));
    }
    setMessage(t('settings.changed'));
  };

  const toggleBiometrics = async (enable: boolean): Promise<void> => {
    const passcode = bioPassRef.current?.value ?? '';
    if (bioPassRef.current) bioPassRef.current.value = '';
    setError(null);
    if (enable) {
      const grant = await biometry.requestAccess('Protect your wallet');
      if (!grant) {
        setError(t('settings.error'));
        return;
      }
      const enabled = await manager.enableBiometric(passcode);
      if (!enabled.ok) {
        setError(t('unlock.wrong'));
        return;
      }
      if (!(await biometry.updateToken(enabled.token))) {
        setError(t('settings.error'));
        return;
      }
      setBioEnabled(true);
    } else {
      const disabled = await manager.disableBiometric(passcode);
      if (!disabled.ok) {
        setError(t('unlock.wrong'));
        return;
      }
      await biometry.updateToken(null);
      setBioEnabled(false);
    }
  };

  const wipe = async (): Promise<void> => {
    if ((wipeRef.current?.value ?? '').trim().toUpperCase() !== 'WIPE') {
      setError(t('settings.wipeConfirm'));
      return;
    }
    await manager.wipe();
    secretHolder.clear();
    onWiped();
  };

  const autoLockOptions = useMemo(
    () => [
      { value: 60_000, label: t('settings.autoLock.min1') },
      { value: 300_000, label: t('settings.autoLock.min5') },
      { value: 900_000, label: t('settings.autoLock.min15') },
    ],
    [],
  );

  return (
    <ScreenShell title={t('settings.title')} onBack={onBack}>
      <section className="flex flex-col gap-2" aria-labelledby="settings-backup">
        <h2 id="settings-backup" className="font-semibold">
          {t('settings.reveal')}
        </h2>
        <Field
          id="settings-reauth"
          ref={reauthRef}
          label={t('settings.requiresPasscode')}
          type="password"
          autoComplete="current-password"
        />
        <Button onClick={() => void reveal()}>{t('settings.reveal')}</Button>
        <Button variant="secondary" onClick={() => void testBackup()}>
          {t('settings.testBackup')}
        </Button>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="settings-passcode">
        <h2 id="settings-passcode" className="font-semibold">
          {t('settings.changePasscode')}
        </h2>
        <Field
          id="old-passcode"
          ref={oldRef}
          label={t('settings.oldPasscode')}
          type="password"
          autoComplete="current-password"
        />
        <Field
          id="new-passcode"
          ref={newRef}
          label={t('settings.newPasscode')}
          type="password"
          autoComplete="new-password"
        />
        <Field
          id="confirm-passcode"
          ref={confirmRef}
          label={t('settings.confirmPasscode')}
          type="password"
          autoComplete="new-password"
        />
        <Button onClick={() => void changePasscode()}>{t('settings.save')}</Button>
      </section>

      {bioAvailable ? (
        <section className="flex flex-col gap-2" aria-labelledby="settings-biometrics">
          <h2 id="settings-biometrics" className="font-semibold">
            {t('settings.biometrics')}:{' '}
            {bioEnabled ? t('settings.biometrics.on') : t('settings.biometrics.off')}
          </h2>
          <p className="text-xs opacity-70">{t('settings.biometrics.explain')}</p>
          <Field
            id="bio-passcode"
            ref={bioPassRef}
            label={t('settings.requiresPasscode')}
            type="password"
            autoComplete="current-password"
          />
          {bioEnabled ? (
            <Button variant="secondary" onClick={() => void toggleBiometrics(false)}>
              {t('settings.biometrics.disable')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void toggleBiometrics(true)}>
              {t('settings.biometrics.enable')}
            </Button>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="settings-autolock">
        <h2 id="settings-autolock" className="font-semibold">
          {t('settings.autoLock')}
        </h2>
        <select
          aria-label={t('settings.autoLock')}
          className="min-h-11 rounded-lg border border-gray-400/60 bg-transparent px-3 py-2"
          value={autoLockMs}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            setAutoLockMs(next);
            setInactivityTimeout(next);
            try {
              localStorage.setItem(AUTO_LOCK_KEY, String(next));
            } catch {
              // Preferences are non-secret; ignore storage failures.
            }
          }}
        >
          {autoLockOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="settings-wipe">
        <h2 id="settings-wipe" className="font-semibold">
          {t('settings.wipe')}
        </h2>
        <p className="text-xs opacity-70">{t('settings.wipeConfirm')}</p>
        <Field
          id="wipe-confirm"
          ref={wipeRef}
          label={t('settings.wipeConfirm')}
          autoComplete="off"
        />
        <Button variant="danger" onClick={() => void wipe()}>
          {t('settings.wipeButton')}
        </Button>
      </section>

      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Notice>{t('home.notice')}</Notice>
    </ScreenShell>
  );
}
