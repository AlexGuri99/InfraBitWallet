/**
 * Unlock, home and settings screens.
 *
 * All passcodes and phrases are read from uncontrolled inputs at submit time; the phrase only
 * exists in the module holder and is written into the DOM on demand. Settings actions that
 * touch secrets require a fresh passcode re-authentication.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
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

function shortAddress(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function CopyButton({ value, label }: { value: string; label: string }) {
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
    <Button
      variant="secondary"
      onClick={() => void copy()}
      aria-label={label}
      className="w-auto px-3 min-h-9 text-sm"
    >
      {copied ? t('home.copied') : t('home.copy')}
    </Button>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.6H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {hidden ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 5.2A10 10 0 0 1 12 5c5 0 9 7 9 7a17 17 0 0 1-2.2 3.1M6.1 6.1A17 17 0 0 0 3 12s4 7 9 7a9.9 9.9 0 0 0 3.9-.8" />
        </>
      ) : (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function ActionIcon({ kind }: { kind: 'receive' | 'send' | 'swap' | 'stake' }) {
  const paths = {
    receive: (
      <>
        <path d="M12 4v12" />
        <path d="M6 10l6 6 6-6" />
        <path d="M4 20h16" />
      </>
    ),
    send: (
      <>
        <path d="M12 20V8" />
        <path d="M6 14l6-6 6 6" />
        <path d="M4 4h16" />
      </>
    ),
    swap: (
      <>
        <path d="M4 8h13l-3-3" />
        <path d="M20 16H7l3 3" />
      </>
    ),
    stake: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8M9.5 10.5h5M9.5 13.5h5" />
      </>
    ),
  } as const;
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

function TokenIcon({ symbol }: { symbol: string }) {
  return (
    <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="19" className="fill-current opacity-15" />
      <text x="20" y="24" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">
        {symbol}
      </text>
    </svg>
  );
}

type Chain = 'ton' | 'tron' | 'evm';
type SheetState =
  { kind: 'receive'; focus: Chain } | { kind: 'notice'; title: string; body: string } | null;

function Sheet({
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
        style={{
          backgroundColor: 'var(--tg-theme-bg-color, #fff)',
          color: 'var(--tg-theme-text-color, #000)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('home.close')}
            className="min-h-9 min-w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
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
  const [tab, setTab] = useState<'wallet' | 'activity'>('wallet');
  const [masked, setMasked] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [copiedPill, setCopiedPill] = useState(false);

  const hasTron = info?.tron !== undefined;
  const hasEvm = info?.evm !== undefined;

  const assets = [
    {
      id: 'TON',
      name: 'Toncoin',
      badge: 'TON',
      symbol: 'TON',
      chain: 'ton' as Chain,
      visible: true,
    },
    {
      id: 'USDT',
      name: 'Tether USD',
      badge: 'TON · Jetton',
      symbol: 'USDT',
      chain: 'ton' as Chain,
      visible: true,
    },
    {
      id: 'TRX',
      name: 'TRON',
      badge: 'TRC-20',
      symbol: 'TRX',
      chain: 'tron' as Chain,
      visible: hasTron,
    },
    {
      id: 'ETH',
      name: 'Ethereum',
      badge: 'ERC-20',
      symbol: 'ETH',
      chain: 'evm' as Chain,
      visible: hasEvm,
    },
  ].filter((asset) => asset.visible);

  const copyTon = async (): Promise<void> => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.ton.addressNonBounceable);
      setCopiedPill(true);
      window.setTimeout(() => {
        setCopiedPill(false);
      }, 1500);
    } catch {
      setCopiedPill(false);
    }
  };

  const openReceive = (focus: Chain): void => {
    setSheet({ kind: 'receive', focus });
  };

  const receiveEntries = [
    {
      chain: 'ton' as Chain,
      label: t('receive.ton'),
      value: info?.ton.addressNonBounceable ?? '',
      hint: t('receive.tonHint'),
    },
    ...(info?.tron
      ? [
          {
            chain: 'tron' as Chain,
            label: t('receive.tron'),
            value: info.tron.address,
            hint: undefined,
          },
        ]
      : []),
    ...(info?.evm
      ? [
          {
            chain: 'evm' as Chain,
            label: t('receive.evm'),
            value: info.evm.address,
            hint: undefined,
          },
        ]
      : []),
  ];

  return (
    <ScreenShell title={t('home.title')}>
      {info ? (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                openReceive('ton');
              }}
              aria-label={t('home.walletInfo')}
              className="h-9 w-9 shrink-0 rounded-full bg-indigo-500/15 ring-2 ring-indigo-500/40 text-indigo-600 dark:text-indigo-300 text-xs font-bold flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              OZ
            </button>
            <div
              role="tablist"
              aria-label={t('home.title')}
              className="flex-1 rounded-full bg-black/5 dark:bg-white/10 p-1"
            >
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'wallet'}
                  onClick={() => {
                    setTab('wallet');
                  }}
                  className={`min-h-8 rounded-full text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    tab === 'wallet'
                      ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow'
                      : 'opacity-70'
                  }`}
                >
                  {t('home.walletTab')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'activity'}
                  onClick={() => {
                    setTab('activity');
                  }}
                  className={`min-h-8 rounded-full text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                    tab === 'activity'
                      ? 'bg-[var(--tg-theme-section-bg-color,#fff)] shadow'
                      : 'opacity-70'
                  }`}
                >
                  {t('home.activityTab')}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onLock}
              aria-label={t('home.lock')}
              className="h-9 w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <LockIcon />
            </button>
            <button
              type="button"
              onClick={onSettings}
              aria-label={t('home.settings')}
              className="h-9 w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <GearIcon />
            </button>
            <span className="rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide">
              {t('home.testnet')}
            </span>
          </div>

          <section
            className="rounded-2xl p-4 text-white border border-white/15 shadow-lg bg-gradient-to-br from-[#0b1b3a] via-[#1e2a78] to-[#0aa7c2]"
            aria-label={t('home.mainWallet')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white/80">{t('home.mainWallet')}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyTon()}
                  aria-label={t('home.copyTon')}
                  data-testid="ton-address-pill"
                  className="rounded-full bg-white/15 px-3 py-1 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {copiedPill ? t('home.copied') : shortAddress(info.ton.addressNonBounceable)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMasked((v) => !v);
                  }}
                  aria-label={masked ? t('home.showBalance') : t('home.hideBalance')}
                  className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <EyeIcon hidden={masked} />
                </button>
              </div>
            </div>
            <p data-testid="hero-balance" className="mt-4 text-4xl font-bold tracking-tight">
              {masked ? '••••' : '$0.00'}
            </p>
            <span className="mt-2 inline-block rounded-full bg-white/15 px-3 py-1 text-xs text-white/80">
              $0.00 · 0.00% 24h
            </span>
          </section>

          <div className="grid grid-cols-4 gap-3">
            {(
              [
                ['receive', 'home.receive', 'bg-blue-500/15 text-blue-600 dark:text-blue-300'],
                ['send', 'home.send', 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'],
                ['swap', 'home.swap', 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'],
                ['stake', 'home.stake', 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'],
              ] as const
            ).map(([kind, key, colors]) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  if (kind === 'receive') openReceive('ton');
                  else if (kind === 'send')
                    setSheet({ kind: 'notice', title: t('home.send'), body: t('home.sendNotice') });
                  else if (kind === 'swap')
                    setSheet({ kind: 'notice', title: t('home.swap'), body: t('home.swapNotice') });
                  else
                    setSheet({
                      kind: 'notice',
                      title: t('home.stake'),
                      body: t('home.stakeNotice'),
                    });
                }}
                aria-label={t(key)}
                className="flex flex-col items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-xl py-1"
              >
                <span
                  className={`h-12 w-12 rounded-2xl flex items-center justify-center ${colors}`}
                >
                  <ActionIcon kind={kind} />
                </span>
                <span className="text-xs">{t(key)}</span>
              </button>
            ))}
          </div>

          {tab === 'wallet' ? (
            <section aria-label={t('home.walletTab')} className="flex flex-col gap-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  data-testid={`asset-${asset.id}`}
                  aria-label={`${asset.name} ${asset.badge}`}
                  onClick={() => {
                    openReceive(asset.chain);
                  }}
                  className="w-full flex items-center gap-3 rounded-xl bg-black/5 dark:bg-white/10 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <TokenIcon symbol={asset.symbol} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{asset.name}</span>
                    <span className="inline-block mt-0.5 rounded-full bg-black/10 dark:bg-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
                      {asset.badge}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold">0 {asset.symbol}</span>
                    <span className="block text-xs opacity-70">$0.00</span>
                  </span>
                </button>
              ))}
            </section>
          ) : (
            <section
              aria-label={t('home.activityTab')}
              className="rounded-xl bg-black/5 dark:bg-white/10 p-6 text-center text-sm opacity-70"
            >
              {t('home.activityEmpty')}
            </section>
          )}

          <Notice>{t('home.notice')}</Notice>
        </>
      ) : (
        <ErrorText>{t('settings.error')}</ErrorText>
      )}

      {sheet ? (
        <Sheet
          title={sheet.kind === 'receive' ? t('receive.title') : sheet.title}
          onClose={() => {
            setSheet(null);
          }}
        >
          {sheet.kind === 'receive' ? (
            <>
              {receiveEntries
                .sort((a, b) => (a.chain === sheet.focus ? -1 : b.chain === sheet.focus ? 1 : 0))
                .map((entry) => (
                  <div
                    key={entry.chain}
                    className="rounded-lg bg-black/5 dark:bg-white/10 p-3 flex flex-col gap-1"
                  >
                    <span className="text-xs opacity-70">{entry.label}</span>
                    <code
                      className="text-xs break-all"
                      data-testid={`address-${entry.chain.toUpperCase()}`}
                    >
                      {entry.value}
                    </code>
                    {entry.hint ? <span className="text-xs opacity-70">{entry.hint}</span> : null}
                    <CopyButton value={entry.value} label={`${t('home.copy')} ${entry.label}`} />
                  </div>
                ))}
            </>
          ) : (
            <p className="text-sm">{sheet.body}</p>
          )}
        </Sheet>
      ) : null}
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
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
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
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
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
