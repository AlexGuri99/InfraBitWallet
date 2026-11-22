/**
 * Home dashboard with live TON Testnet data.
 *
 * Data comes only from the same-origin `/api/ton/*` proxy (provider keys never reach the client).
 * On load there is a skeleton; on failure a visible offline banner with Retry — never a silent
 * $0.00. Amounts are decimal strings formatted with BigInt helpers from chain-ton.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { VaultManager } from '@onezerowallet/crypto-vault';
import {
  filterActivity,
  formatChange,
  formatUsd,
  truncateAddress,
  type TonActivityItem,
  type TonAssetBalance,
  type TonNetwork,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import { t } from '../i18n';
import { createTonReadApi, type TonReadApi } from '../ton/api';
import { Button, ErrorText, Notice, ScreenShell } from './common';
import { QrCode } from './qr';

export const UI_TON_NETWORK: TonNetwork = 'testnet';

// Stable default so refresh() does not change identity on every render.
const defaultTonApi: TonReadApi = createTonReadApi();

type Chain = 'ton' | 'tron' | 'evm';
type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error' };
type SheetState =
  | { kind: 'receive'; focus: Chain }
  | { kind: 'notice'; title: string; body: string }
  | { kind: 'activity'; item: TonActivityItem }
  | null;

function shortAddress(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function hashToHex(hash: string): string {
  try {
    return Array.from(atob(hash))
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return hash;
  }
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
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

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
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
      <text x="20" y="24" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        {symbol.slice(0, 4)}
      </text>
    </svg>
  );
}

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

interface AssetRow {
  key: string;
  testId: string;
  name: string;
  symbol: string;
  badge: string;
  balanceText: string;
  usdText: string;
  chain: Chain;
}

function chainBadge(asset: TonAssetBalance): string {
  return asset.standard === 'native' ? 'TON' : 'TON · Jetton';
}

function staticRows(hasTron: boolean, hasEvm: boolean): AssetRow[] {
  const rows: AssetRow[] = [
    {
      key: 'trx',
      testId: 'asset-TRX',
      name: 'TRON',
      symbol: 'TRX',
      badge: 'TRC-20',
      balanceText: '—',
      usdText: '—',
      chain: 'tron',
    },
    {
      key: 'eth',
      testId: 'asset-ETH',
      name: 'Ethereum',
      symbol: 'ETH',
      badge: 'ERC-20',
      balanceText: '—',
      usdText: '—',
      chain: 'evm',
    },
  ];
  return rows.filter((row) => (row.chain === 'tron' ? hasTron : hasEvm));
}

export function HomeScreen({
  manager,
  onLock,
  onSettings,
  api = defaultTonApi,
}: {
  manager: VaultManager;
  onLock: () => void;
  onSettings: () => void;
  api?: TonReadApi;
}) {
  const session = manager.getSession();
  const info = session?.getPublicInfo(0) ?? null;
  const [tab, setTab] = useState<'wallet' | 'activity'>('wallet');
  const [masked, setMasked] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [portfolio, setPortfolio] = useState<Load<TonPortfolio>>({ state: 'loading' });
  const [activity, setActivity] = useState<Load<TonActivityItem[]>>({ state: 'loading' });
  const [copiedPill, setCopiedPill] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const tonAddress = info?.ton.addressTestnetNonBounceable ?? '';
  const requestAddress = info?.ton.addressRaw ?? '';

  const refresh = useCallback(async (): Promise<void> => {
    if (!requestAddress) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPortfolio({ state: 'loading' });
    setActivity({ state: 'loading' });
    const [portfolioResult, activityResult] = await Promise.allSettled([
      api.getPortfolio(requestAddress, UI_TON_NETWORK, controller.signal),
      api.getActivity(requestAddress, UI_TON_NETWORK, 20, controller.signal),
    ]);
    if (controller.signal.aborted) return;
    setPortfolio(
      portfolioResult.status === 'fulfilled'
        ? { state: 'ready', value: portfolioResult.value }
        : { state: 'error' },
    );
    setActivity(
      activityResult.status === 'fulfilled'
        ? { state: 'ready', value: filterActivity(activityResult.value) }
        : { state: 'error' },
    );
  }, [api, requestAddress]);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  const portfolioReady = portfolio.state === 'ready' ? portfolio.value : null;
  const hasTron = info?.tron !== undefined;
  const hasEvm = info?.evm !== undefined;

  const assetRows: AssetRow[] = useMemo(() => {
    if (portfolioReady) {
      const rows: AssetRow[] = portfolioReady.assets.map((asset, index) => ({
        key: `${asset.id}-${String(index)}`,
        testId:
          asset.standard === 'native'
            ? 'asset-TON'
            : `asset-${asset.symbol.toUpperCase()}${asset.symbol.toUpperCase() === 'USDT' ? '' : `-${String(index)}`}`,
        name: asset.name,
        symbol: asset.symbol,
        badge: chainBadge(asset),
        balanceText: masked ? '••••' : `${asset.balance} ${asset.symbol}`,
        usdText: masked ? '••••' : asset.usdValue === null ? '—' : formatUsd(asset.usdValue),
        chain: 'ton',
      }));
      return [...rows, ...staticRows(hasTron, hasEvm)];
    }
    const placeholders: AssetRow[] = [
      {
        key: 'ton',
        testId: 'asset-TON',
        name: 'Toncoin',
        symbol: 'TON',
        badge: 'TON',
        balanceText: portfolio.state === 'error' ? '—' : '…',
        usdText: portfolio.state === 'error' ? '—' : '…',
        chain: 'ton',
      },
      {
        key: 'usdt',
        testId: 'asset-USDT',
        name: 'Tether USD',
        symbol: 'USDT',
        badge: 'TON · Jetton',
        balanceText: portfolio.state === 'error' ? '—' : '…',
        usdText: portfolio.state === 'error' ? '—' : '…',
        chain: 'ton',
      },
    ];
    return [...placeholders, ...staticRows(hasTron, hasEvm)];
  }, [portfolioReady, portfolio.state, masked, hasTron, hasEvm]);

  const copyTon = async (): Promise<void> => {
    if (!tonAddress) return;
    try {
      await navigator.clipboard.writeText(tonAddress);
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
      value: tonAddress,
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
  const focusedEntry =
    sheet?.kind === 'receive'
      ? (receiveEntries.find((entry) => entry.chain === sheet.focus) ?? receiveEntries[0])
      : undefined;

  const balanceDisplay =
    portfolio.state === 'loading'
      ? '…'
      : portfolio.state === 'error'
        ? '—'
        : masked
          ? '••••'
          : formatUsd(portfolio.value.totalUsd);
  const secondaryDisplay =
    portfolio.state === 'loading'
      ? 'Syncing…'
      : portfolio.state === 'error'
        ? 'Offline'
        : `${portfolio.value.balance} TON · ${formatChange(portfolio.value.change24h)}`;

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
              onClick={() => {
                void refresh();
              }}
              aria-label="Refresh"
              className="h-9 w-9 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <RefreshIcon />
            </button>
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

          {portfolio.state === 'error' ? (
            <div
              role="alert"
              className="rounded-lg bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-100 p-3 text-sm flex items-center justify-between gap-3"
            >
              <span>{t('home.offline')}</span>
              <Button
                variant="secondary"
                onClick={() => {
                  void refresh();
                }}
                className="w-auto px-3 min-h-9 text-sm"
              >
                {t('home.retry')}
              </Button>
            </div>
          ) : null}

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
                  {copiedPill ? t('home.copied') : shortAddress(tonAddress)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMasked((value) => !value);
                  }}
                  aria-label={masked ? t('home.showBalance') : t('home.hideBalance')}
                  className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <EyeIcon hidden={masked} />
                </button>
              </div>
            </div>
            <p data-testid="hero-balance" className="mt-4 text-4xl font-bold tracking-tight">
              {balanceDisplay}
            </p>
            <span className="mt-2 inline-block rounded-full bg-white/15 px-3 py-1 text-xs text-white/80">
              {secondaryDisplay}
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
              {assetRows.map((asset) => (
                <button
                  key={asset.key}
                  type="button"
                  data-testid={asset.testId}
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
                    <span className="block text-sm font-semibold">{asset.balanceText}</span>
                    <span className="block text-xs opacity-70">{asset.usdText}</span>
                  </span>
                </button>
              ))}
            </section>
          ) : (
            <section aria-label={t('home.activityTab')} className="flex flex-col gap-2">
              {activity.state === 'loading' ? (
                <p className="text-sm opacity-70" aria-live="polite">
                  {t('home.syncing')}
                </p>
              ) : activity.state === 'error' ? (
                <div
                  role="alert"
                  className="rounded-xl bg-black/5 dark:bg-white/10 p-4 text-sm flex items-center justify-between"
                >
                  <span>{t('home.offline')}</span>
                  <Button
                    variant="secondary"
                    onClick={() => void refresh()}
                    className="w-auto px-3 min-h-9 text-sm"
                  >
                    {t('home.retry')}
                  </Button>
                </div>
              ) : activity.value.length === 0 ? (
                <p className="rounded-xl bg-black/5 dark:bg-white/10 p-6 text-center text-sm opacity-70">
                  {t('home.activityEmpty')}
                </p>
              ) : (
                activity.value.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`activity-${item.id}`}
                    onClick={() => {
                      setSheet({ kind: 'activity', item });
                    }}
                    className="w-full flex items-center gap-3 rounded-xl bg-black/5 dark:bg-white/10 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-9 w-9 rounded-full flex items-center justify-center ${
                        item.direction === 'in'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                      }`}
                    >
                      {item.direction === 'in' ? '↓' : '↑'}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">
                        {item.direction === 'in' ? '+' : '-'}
                        {item.amount} {item.symbol}
                      </span>
                      <span className="block text-xs opacity-70 truncate">
                        {truncateAddress(item.counterparty)} · {relativeTime(item.timestamp)}
                      </span>
                    </span>
                    <span className="text-xs opacity-70">
                      {item.status === 'failed' ? 'Failed' : ''}
                    </span>
                  </button>
                ))
              )}
            </section>
          )}

          <Notice>{t('home.notice')}</Notice>
        </>
      ) : (
        <ErrorText>{t('settings.error')}</ErrorText>
      )}

      {sheet ? (
        <Sheet
          title={
            sheet.kind === 'receive'
              ? t('receive.title')
              : sheet.kind === 'activity'
                ? t('home.txDetails')
                : sheet.title
          }
          onClose={() => {
            setSheet(null);
          }}
        >
          {sheet.kind === 'receive' ? (
            <>
              {focusedEntry ? (
                <div className="flex flex-col items-center gap-2">
                  <QrCode value={focusedEntry.value} label={`QR code for ${focusedEntry.label}`} />
                  {focusedEntry.hint ? (
                    <span className="text-xs opacity-70">{focusedEntry.hint}</span>
                  ) : null}
                </div>
              ) : null}
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
          ) : sheet.kind === 'activity' ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-lg font-semibold">
                {sheet.item.direction === 'in' ? '+' : '-'}
                {sheet.item.amount} {sheet.item.symbol}
              </p>
              <p className="opacity-70">
                {sheet.item.direction === 'in' ? 'Received from' : 'Sent to'}{' '}
                {truncateAddress(sheet.item.counterparty)}
              </p>
              <p className="opacity-70">Fee: {sheet.item.fee} TON</p>
              <p className="opacity-70">Status: {sheet.item.status}</p>
              {sheet.item.comment ? (
                <p className="rounded bg-black/5 dark:bg-white/10 p-2">
                  Comment: {sheet.item.comment}
                </p>
              ) : null}
              <a
                className="underline text-blue-600 dark:text-blue-300 break-all"
                href={`https://testnet.tonviewer.com/transaction/${hashToHex(sheet.item.hash)}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on testnet.tonviewer.com
              </a>
            </div>
          ) : (
            <p className="text-sm">{sheet.body}</p>
          )}
        </Sheet>
      ) : null}
    </ScreenShell>
  );
}
