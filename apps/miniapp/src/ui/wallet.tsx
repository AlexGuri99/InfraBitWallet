/**
 * Unlock screen and Settings tab.
 *
 * All passcodes and phrases are read from uncontrolled inputs at submit time; the phrase only
 * exists in the module holder and is written into the DOM on demand. Settings actions that touch
 * secrets require a fresh passcode re-authentication.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setInactivityTimeout } from '@onezerowallet/crypto-vault';
import type { PublicAccountInfo, VaultManager } from '@onezerowallet/crypto-vault';
import { formatUsd } from '@onezerowallet/chain-ton';
import type { BiometryApi } from '../adapters/biometry';
import { t } from '../i18n';
import { secretHolder } from '../vault/secret-holder';
import { useFullscreenControl } from '../telegram/fullscreen';
import { Button, Card, ErrorText, Field, Notice, PhoneFrame, Sheet } from './common';
import { InfraBitLogo } from './logo';
import { AUTO_LOCK_KEY, readPreference, usePreferences } from './preferences';
import { useToast } from './toast';
import {
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  FingerprintIcon,
  FullscreenEnterIcon,
  GridIcon,
  KeyIcon,
  LayersIcon,
  LockIcon,
  MoonIcon,
  SunIcon,
  TrashIcon,
  BellIcon,
  GlobeIcon,
} from './icons';

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
    <PhoneFrame>
      <main className="flex flex-1 flex-col justify-center gap-5 px-6 pb-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <InfraBitLogo size={80} className="shadow-hero" />
          <div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">
              {t('unlock.title')}
            </h1>
            <p className="mt-1 text-[12.5px] text-ink-2">{t('app.name')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Field
            id="unlock-passcode"
            ref={passRef}
            label={t('unlock.passcode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="current-password"
            autoFocus
            className="text-center font-mono text-[26px] tracking-[0.5em]"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void unlock();
            }}
          />
          {retryAfterMs > 0 ? (
            <p role="status" aria-live="polite" className="px-1 text-[12.5px] text-ink-2">
              {rateLimitedText(retryAfterMs)}
            </p>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button onClick={() => void unlock()} disabled={busy || retryAfterMs > 0}>
            {busy ? t('common.working') : t('unlock.submit')}
          </Button>
          {bioAvailable && bioEnabled ? (
            <Button variant="secondary" onClick={() => void unlockBiometric()} disabled={busy}>
              <FingerprintIcon size={17} />
              {t('unlock.biometric')}
            </Button>
          ) : null}
        </div>

        <p className="text-center text-[11.5px] font-medium text-ink-muted">{t('home.notice')}</p>
      </main>
    </PhoneFrame>
  );
}

type SettingsSheet =
  'change-pin' | 'biometrics' | 'auto-lock' | 'reveal' | 'backup' | 'wipe' | 'appearance' | null;

export interface SettingsTabProps {
  manager: VaultManager;
  biometry: BiometryApi;
  info: PublicAccountInfo | null;
  tonAddress: string;
  balanceUsd: number | null;
  /** Label of the active wallet. */
  walletLabel: string;
  onManageWallets: () => void;
  onLock: () => void;
  onReveal: () => void;
  onTestBackup: () => void;
  onWiped: () => void;
}

export function SettingsTab({
  manager,
  biometry,
  info,
  tonAddress,
  balanceUsd,
  walletLabel,
  onManageWallets,
  onLock,
  onReveal,
  onTestBackup,
  onWiped,
}: SettingsTabProps) {
  const { theme, setTheme, guard } = usePreferences();
  const fullscreen = useFullscreenControl();
  const toast = useToast();
  const [sheet, setSheet] = useState<SettingsSheet>(null);
  const [copied, setCopied] = useState(false);

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
    const raw = typeof localStorage !== 'undefined' ? readPreference(AUTO_LOCK_KEY) : null;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
  });

  useEffect(() => {
    void (async () => {
      setBioAvailable(await biometry.available());
      setBioEnabled(await manager.hasBiometric());
    })();
  }, [biometry, manager]);

  const closeSheet = (): void => {
    setSheet(null);
    setError(null);
  };

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
    setSheet(null);
    onReveal();
  };

  const testBackup = async (): Promise<void> => {
    const session = manager.getSession();
    if (!session) return;
    if (!(await reauth())) return;
    const revealed = session.revealMnemonic();
    if (!revealed.ok) return;
    secretHolder.set(revealed.mnemonic);
    setSheet(null);
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
    closeSheet();
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
    closeSheet();
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

  const copyAddress = async (): Promise<void> => {
    if (!tonAddress) return;
    try {
      await navigator.clipboard.writeText(tonAddress);
      setCopied(true);
      toast.show(t('home.copied'));
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.show(t('home.copyFailed'));
    }
  };

  const autoLockOptions = useMemo(
    () => [
      { value: 60_000, label: t('settings.autoLock.min1') },
      { value: 300_000, label: t('settings.autoLock.min5') },
      { value: 900_000, label: t('settings.autoLock.min15') },
    ],
    [],
  );

  const comingSoon = (label: string): void => {
    toast.show(`${label} — coming soon`);
  };

  return (
    <PhoneFrame>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[96px] pt-4">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">Settings</h1>

        <section className="flex flex-col items-center gap-2 rounded-[24px] bg-surface px-5 py-5 text-center shadow-card">
          <InfraBitLogo size={64} className="shadow-hero" />
          <p className="text-[17px] font-bold tracking-[-0.01em] text-ink">{walletLabel}</p>
          <p className="tabular text-[13px] font-medium text-ink-2">
            {guard(balanceUsd === null ? '—' : formatUsd(balanceUsd))}
          </p>
          <button
            type="button"
            onClick={() => void copyAddress()}
            aria-label={t('home.copyTon')}
            className="pressable flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1.5 font-mono text-[11.5px] text-ink-2"
          >
            {info ? `${tonAddress.slice(0, 6)}…${tonAddress.slice(-4)}` : '—'}
            <CopyIcon size={12} />
            {copied ? t('home.copied') : null}
          </button>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onManageWallets}
            data-testid="manage-wallets"
            className="pressable flex items-center gap-2 rounded-[20px] bg-surface px-3.5 py-3 text-left shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-secondary text-ink">
              <LayersIcon size={16} />
            </span>
            <span className="text-[12.5px] font-semibold text-ink">{t('home.wallets')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              comingSoon('Portfolio');
            }}
            className="pressable flex items-center gap-2 rounded-[20px] bg-surface px-3.5 py-3 text-left shadow-card"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-secondary text-ink">
              <GridIcon size={16} />
            </span>
            <span className="text-[12.5px] font-semibold text-ink">Portfolio</span>
          </button>
        </div>

        <SettingsGroup title="Preferences">
          <SettingsRow
            icon={
              <span className="text-hero-ink">
                {theme === 'light' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
              </span>
            }
            iconTone="bg-hero"
            title="Appearance"
            value={theme === 'light' ? 'Light' : 'Dark'}
            onClick={() => {
              setSheet('appearance');
            }}
          />
          {fullscreen.isSupported ? (
            <SettingsRow
              icon={<FullscreenEnterIcon size={15} />}
              iconTone="bg-surface-elevated text-ink-2"
              title="Fullscreen"
              value={fullscreen.isFullscreen ? 'On' : 'Off'}
              onClick={fullscreen.toggle}
            />
          ) : null}
          <SettingsRow
            icon={<BellIcon size={15} />}
            iconTone="bg-swap-bg text-swap"
            title="Sounds"
            badge="Coming soon"
            disabled
          />
          <SettingsRow
            icon={<GlobeIcon size={15} />}
            iconTone="bg-positive-bg text-positive"
            title="Language"
            value="English"
            badge="Coming soon"
            disabled
          />
        </SettingsGroup>

        <SettingsGroup title="Security">
          <SettingsRow
            icon={<KeyIcon size={15} />}
            iconTone="bg-positive-bg text-positive"
            title="Change PIN"
            onClick={() => {
              setSheet('change-pin');
            }}
          />
          <SettingsRow
            icon={<FingerprintIcon size={15} />}
            iconTone="bg-swap-bg text-swap"
            title="Biometrics"
            value={bioAvailable ? (bioEnabled ? 'On' : 'Off') : 'Unavailable'}
            onClick={() => {
              setSheet('biometrics');
            }}
          />
          <SettingsRow
            icon={<ClockIcon size={15} />}
            iconTone="bg-surface-elevated text-ink-2"
            title="Auto-Lock"
            value={
              autoLockOptions.find((option) => option.value === autoLockMs)?.label ?? '5 minutes'
            }
            onClick={() => {
              setSheet('auto-lock');
            }}
          />
          <SettingsRow
            icon={<EyeIcon size={15} />}
            iconTone="bg-surface-elevated text-ink-2"
            title="Reveal Phrase"
            onClick={() => {
              setError(null);
              setSheet('reveal');
            }}
          />
          <SettingsRow
            icon={<LayersIcon size={15} />}
            iconTone="bg-surface-elevated text-ink-2"
            title="Test Backup"
            onClick={() => {
              setError(null);
              setSheet('backup');
            }}
          />
          <SettingsRow
            icon={<LockIcon size={15} />}
            iconTone="bg-surface-elevated text-ink-2"
            title="Lock Wallet"
            onClick={onLock}
          />
          <SettingsRow
            icon={<TrashIcon size={15} />}
            iconTone="bg-surface-secondary text-negative"
            title="Wipe Wallet"
            danger
            onClick={() => {
              setError(null);
              setSheet('wipe');
            }}
          />
        </SettingsGroup>

        <SettingsGroup title="More">
          <SettingsRow
            icon={<LayersIcon size={15} />}
            iconTone="bg-swap-bg text-swap"
            title="Assets & Activity"
            badge="Coming soon"
            disabled
          />
        </SettingsGroup>

        {message ? (
          <p role="status" className="px-1 text-[12.5px] font-medium text-positive">
            {message}
          </p>
        ) : null}
        <p className="px-2 pb-2 text-center text-[11.5px] text-ink-muted">{t('home.notice')}</p>
      </main>

      {sheet === 'appearance' ? (
        <Sheet title="Appearance" onClose={closeSheet}>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'light', label: 'Light', icon: <SunIcon size={18} /> },
                { id: 'dark', label: 'Dark', icon: <MoonIcon size={18} /> },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={theme === option.id}
                onClick={() => {
                  setTheme(option.id);
                }}
                className={`pressable flex flex-col items-center gap-2 rounded-[20px] px-4 py-5 text-[13px] font-semibold ${
                  theme === option.id
                    ? 'bg-accent-primary text-accent-ink'
                    : 'bg-surface-secondary text-ink'
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
          <p className="px-1 text-[12px] text-ink-muted">
            The theme is a device preference, stored locally and never synced.
          </p>
        </Sheet>
      ) : null}

      {sheet === 'change-pin' ? (
        <Sheet title="Change PIN" onClose={closeSheet}>
          <Field
            id="old-passcode"
            ref={oldRef}
            label={t('settings.oldPasscode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="current-password"
          />
          <Field
            id="new-passcode"
            ref={newRef}
            label={t('settings.newPasscode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="new-password"
          />
          <Field
            id="confirm-passcode"
            ref={confirmRef}
            label={t('settings.confirmPasscode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="new-password"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button onClick={() => void changePasscode()}>{t('settings.save')}</Button>
        </Sheet>
      ) : null}

      {sheet === 'biometrics' ? (
        <Sheet title="Biometrics" onClose={closeSheet}>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {t('settings.biometrics.explain')}
          </p>
          {bioAvailable ? (
            <>
              <Field
                id="bio-passcode"
                ref={bioPassRef}
                label={t('settings.requiresPasscode')}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="current-password"
              />
              {error ? <ErrorText>{error}</ErrorText> : null}
              {bioEnabled ? (
                <Button variant="secondary" onClick={() => void toggleBiometrics(false)}>
                  {t('settings.biometrics.disable')}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void toggleBiometrics(true)}>
                  {t('settings.biometrics.enable')}
                </Button>
              )}
            </>
          ) : (
            <Notice tone="warning">Biometric unlock is unavailable on this device.</Notice>
          )}
        </Sheet>
      ) : null}

      {sheet === 'auto-lock' ? (
        <Sheet title={t('settings.autoLock')} onClose={closeSheet}>
          {autoLockOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === autoLockMs}
              onClick={() => {
                setAutoLockMs(option.value);
                setInactivityTimeout(option.value);
                try {
                  localStorage.setItem(AUTO_LOCK_KEY, String(option.value));
                } catch {
                  // Preferences are non-secret; ignore storage failures.
                }
                toast.show(`Auto-lock: ${option.label}`);
                closeSheet();
              }}
              className={`pressable flex items-center justify-between rounded-2xl px-4 py-3 text-[14px] font-semibold ${
                option.value === autoLockMs
                  ? 'bg-accent-primary text-accent-ink'
                  : 'bg-surface-secondary text-ink'
              }`}
            >
              {option.label}
              {option.value === autoLockMs ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </Sheet>
      ) : null}

      {sheet === 'reveal' ? (
        <Sheet title={t('settings.reveal')} onClose={closeSheet}>
          <p className="text-[13px] leading-relaxed text-ink-2">{t('phrase.settings.warning')}</p>
          <Field
            id="settings-reauth"
            ref={reauthRef}
            label={t('settings.requiresPasscode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="current-password"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button onClick={() => void reveal()}>{t('settings.reveal')}</Button>
        </Sheet>
      ) : null}

      {sheet === 'backup' ? (
        <Sheet title={t('settings.testBackup')} onClose={closeSheet}>
          <p className="text-[13px] leading-relaxed text-ink-2">{t('verify.body')}</p>
          <Field
            id="settings-reauth"
            ref={reauthRef}
            label={t('settings.requiresPasscode')}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="current-password"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button onClick={() => void testBackup()}>{t('settings.testBackup')}</Button>
        </Sheet>
      ) : null}

      {sheet === 'wipe' ? (
        <Sheet title={t('settings.wipe')} onClose={closeSheet}>
          <Notice tone="warning">{t('settings.wipeConfirm')}</Notice>
          <Field
            id="wipe-confirm"
            ref={wipeRef}
            label={t('settings.wipeConfirm')}
            autoComplete="off"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button variant="danger" onClick={() => void wipe()}>
            {t('settings.wipeButton')}
          </Button>
        </Sheet>
      ) : null}
    </PhoneFrame>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-1 text-[14px] font-bold tracking-[0.01em] text-ink">{title}</h2>
      <Card>{children}</Card>
    </section>
  );
}

function SettingsRow({
  icon,
  iconTone,
  title,
  value,
  badge,
  disabled = false,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  iconTone: string;
  title: string;
  value?: string;
  badge?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="pressable flex w-full items-center gap-3 px-4 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-link)]"
    >
      <span
        className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] ${iconTone}`}
      >
        {icon}
      </span>
      <span
        className={`flex-1 text-[14.5px] font-semibold ${danger ? 'text-negative' : 'text-ink'}`}
      >
        {title}
      </span>
      {value ? <span className="text-[12.5px] text-ink-2">{value}</span> : null}
      {badge ? (
        <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
          {badge}
        </span>
      ) : null}
      {disabled ? null : <ChevronRightIcon size={15} className="text-ink-muted" />}
    </button>
  );
}
