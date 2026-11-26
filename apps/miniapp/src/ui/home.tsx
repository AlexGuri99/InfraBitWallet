/**
 * Wallet Home (DESIGN.md §5.1–§5.2): top bar, connected hero + action dock, live funds and
 * activity lists, and the floating navigation bar.
 *
 * Data comes only from the same-origin `/api/ton/*` proxy. Loading shows a syncing state and an
 * upstream failure shows Offline + Retry — never a fabricated $0.00.
 */
import { useMemo, useState } from 'react';
import type { PublicAccountInfo } from '@onezerowallet/crypto-vault';
import {
  formatChange,
  formatDecimalShort,
  formatUsd,
  type TonActivityItem,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import { t } from '../i18n';
import type { AssetView } from './asset';
import { activityKind, activityStatusLabel, clockTime, groupActivity, shortAddress } from './asset';
import { usePreferences } from './preferences';
import { useFullscreenControl } from '../telegram/fullscreen';
import { useToast } from './toast';
import { QrCode } from './qr';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  EarnIcon,
  EyeIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  MoonIcon,
  QrIcon,
  RefreshIcon,
  SunIcon,
  SwapIcon,
} from './icons';
import { Button, Card, SectionHeader, Sheet, TokenAvatar } from './common';
import type { WalletTab } from './nav';

export type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error' };

export interface HomeActions {
  onOpenDeposit: () => void;
  onOpenSend: () => void;
  onOpenTrade: () => void;
  onOpenEarn: () => void;
  onOpenCoin: (asset: AssetView) => void;
  onOpenTx: (item: TonActivityItem) => void;
  onLock: () => void;
  onTabChange: (tab: WalletTab) => void;
}

function deltaUsd(portfolio: TonPortfolio): number | null {
  if (portfolio.totalUsd === null || portfolio.change24h === null) return null;
  const previous = portfolio.totalUsd / (1 + portfolio.change24h / 100);
  return portfolio.totalUsd - previous;
}

function StatusBadge({ item }: { item: TonActivityItem }) {
  const kind = activityKind(item);
  const tone =
    kind === 'in'
      ? 'bg-positive-bg text-positive'
      : kind === 'bounce'
        ? 'bg-swap-bg text-swap'
        : kind === 'pending'
          ? 'bg-surface-elevated text-ink-2'
          : 'bg-surface-secondary text-ink-2';
  const glyph =
    kind === 'in'
      ? '↙'
      : kind === 'out'
        ? '↗'
        : kind === 'bounce'
          ? '↩'
          : kind === 'pending'
            ? '…'
            : '↗';
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ${tone}`}
    >
      {glyph}
    </span>
  );
}

function ActivityRow({
  item,
  onOpen,
  guard,
}: {
  item: TonActivityItem;
  onOpen: (item: TonActivityItem) => void;
  guard: (value: string) => string;
}) {
  const kind = activityKind(item);
  const sign = kind === 'in' || kind === 'bounce' ? '+' : '-';
  const amount = `${sign}${guard(item.amount)} ${item.symbol}`;
  // Status and the optional comment live on the left; the time stays under the amount, unclipped.
  const detail = [relativeStatus(item), item.comment ? `“${item.comment.slice(0, 22)}”` : '']
    .filter((part) => part !== '')
    .join(' · ');
  return (
    <button
      type="button"
      data-testid={`activity-${item.id}`}
      onClick={() => {
        onOpen(item);
      }}
      className="pressable flex w-full items-center gap-3 px-4 py-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-link)]"
    >
      <StatusBadge item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {activityStatusLabel(item)}
        </span>
        <span className="block truncate text-[12.5px] text-ink-2">
          {kind === 'in' ? 'from ' : 'to '}
          {shortAddress(item.counterparty, 4, 4)}
        </span>
        {detail !== '' ? (
          <span
            data-testid={`activity-detail-${item.id}`}
            className="block truncate text-[11.5px] text-ink-muted"
          >
            {detail}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <span
          className={`tabular block text-[15px] font-semibold ${
            kind === 'in' ? 'text-positive' : 'text-ink'
          }`}
        >
          {amount}
        </span>
        <span
          data-testid={`activity-time-${item.id}`}
          className="tabular block text-[12px] text-ink-muted"
        >
          {clockTime(item.timestamp)}
        </span>
      </span>
    </button>
  );
}

function relativeStatus(item: TonActivityItem): string {
  if (item.status === 'failed') return 'Failed';
  if (item.status === 'pending') return 'Pending';
  return '';
}

function AssetRowView({
  asset,
  onOpen,
  guard,
}: {
  asset: AssetView;
  onOpen: (asset: AssetView) => void;
  guard: (value: string) => string;
}) {
  const balance = asset.chain !== 'ton' ? asset.balance : `${asset.balance} ${asset.symbol}`;
  const usd = asset.usdValue === null ? '—' : formatUsd(asset.usdValue);
  return (
    <button
      type="button"
      data-testid={asset.testId}
      aria-label={`${asset.name} ${asset.badge}`}
      onClick={() => {
        onOpen(asset);
      }}
      className="pressable flex w-full items-center gap-3 px-4 py-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-link)]"
    >
      <TokenAvatar symbol={asset.symbol} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {asset.name}
        </span>
        <span className="mt-0.5 inline-block rounded-full bg-surface-secondary px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-ink-2">
          {asset.badge}
        </span>
      </span>
      <span className="tabular shrink-0 text-right">
        <span className="block text-[15px] font-semibold text-ink">{guard(balance)}</span>
        <span className="block text-[12.5px] text-ink-2">{guard(usd)}</span>
      </span>
    </button>
  );
}

export interface WalletHomeProps extends HomeActions {
  info: PublicAccountInfo | null;
  tonAddress: string;
  portfolio: Load<TonPortfolio>;
  activity: Load<TonActivityItem[]>;
  pending: TonActivityItem | null;
  assets: AssetView[];
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function WalletHome({
  info,
  tonAddress,
  portfolio,
  activity,
  pending,
  assets,
  onRefresh,
  onOpenSettings,
  onOpenDeposit,
  onOpenSend,
  onOpenTrade,
  onOpenEarn,
  onOpenCoin,
  onOpenTx,
}: WalletHomeProps) {
  const { theme, toggleTheme, masked, toggleMasked, guard } = usePreferences();
  const fullscreen = useFullscreenControl();
  const toast = useToast();
  const [currency, setCurrency] = useState<'USD' | 'TON'>('USD');
  const [sheet, setSheet] = useState<'wallet' | 'qr' | null>(null);
  const [copied, setCopied] = useState(false);

  const portfolioReady = portfolio.state === 'ready' ? portfolio.value : null;
  const change = portfolioReady?.change24h ?? null;
  const delta = portfolioReady ? deltaUsd(portfolioReady) : null;

  const balanceDisplay = useMemo(() => {
    if (portfolio.state === 'loading') return '…';
    if (portfolio.state === 'error') return '—';
    if (masked) return '••••';
    if (currency === 'TON') {
      return `${formatDecimalShort(portfolio.value.balanceRaw, 9, 4)} TON`;
    }
    return formatUsd(portfolio.value.totalUsd);
  }, [portfolio, masked, currency]);

  const secondary = useMemo(() => {
    if (!portfolioReady) {
      return portfolio.state === 'error' ? t('home.offlineShort') : t('home.syncing');
    }
    return `${formatDecimalShort(portfolioReady.balanceRaw, 9, 4)} TON`;
  }, [portfolioReady, portfolio.state]);

  const deltaTone =
    change === null || change === 0
      ? 'text-hero-ink opacity-70'
      : change > 0
        ? 'text-positive'
        : 'text-negative';
  const deltaText =
    change === null
      ? null
      : `${change >= 0 ? '↑' : '↓'} ${delta === null ? '' : `${formatUsd(delta)} `}(${formatChange(change)})`;

  const copyAddress = async (value: string): Promise<void> => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.show(t('home.copied'));
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.show(t('home.copyFailed'));
    }
  };

  const incoming = activity.state === 'ready' ? activity.value : [];
  const allItems = pending ? [pending, ...incoming] : incoming;
  const groups = groupActivity(allItems);

  return (
    <div className="screen-enter flex flex-col pb-24">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <h1 className="sr-only">{t('app.name')}</h1>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSheet('wallet');
            }}
            className="pressable flex min-w-0 items-center gap-1.5 rounded-full bg-surface px-3 py-2 text-[14px] font-bold tracking-[-0.01em] text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
            aria-label={`${t('app.name')} wallet switcher`}
          >
            <span className="truncate">{t('app.name')}</span>
            <ChevronDownIcon size={15} className="shrink-0 text-ink-2" />
          </button>
          <span className="shrink-0 rounded-full bg-positive-bg px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.04em] text-positive">
            {t('home.testnet')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={toggleMasked}
            aria-label={masked ? t('home.showBalance') : t('home.hideBalance')}
            className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <EyeIcon hidden={masked} size={18} />
          </button>
          {fullscreen.isSupported ? (
            <button
              type="button"
              onClick={fullscreen.toggle}
              aria-label={
                fullscreen.isFullscreen ? t('home.fullscreenExit') : t('home.fullscreenEnter')
              }
              aria-pressed={fullscreen.isFullscreen}
              className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
            >
              {fullscreen.isFullscreen ? (
                <FullscreenExitIcon size={18} />
              ) : (
                <FullscreenEnterIcon size={18} />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            {theme === 'light' ? <MoonIcon size={18} /> : <SunIcon size={18} />}
          </button>
          <button
            type="button"
            onClick={() => {
              setSheet('qr');
            }}
            aria-label={t('home.quickQr')}
            className="pressable flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <QrIcon size={18} />
          </button>
        </div>
      </header>

      {portfolio.state === 'error' ? (
        <div
          role="alert"
          className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-2xl bg-surface-secondary px-4 py-3 text-[13px] font-medium text-negative"
        >
          <span>{t('home.offline')}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="pressable flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink"
          >
            <RefreshIcon size={14} />
            {t('home.retry')}
          </button>
        </div>
      ) : null}

      <section aria-label={t('home.mainWallet')} className="mx-4">
        <div className="rounded-t-[26px] bg-gradient-to-br from-hero to-hero-end px-5 pb-5 pt-4 text-hero-ink shadow-hero">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setCurrency((current) => (current === 'USD' ? 'TON' : 'USD'));
              }}
              aria-label={`Display currency: ${currency}. Tap to change.`}
              className="pressable flex items-center gap-1 rounded-full bg-hero-pill px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.02em] text-hero-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-ink"
            >
              {currency}
              <ChevronDownIcon size={13} />
            </button>
            <button
              type="button"
              onClick={() => void copyAddress(tonAddress)}
              data-testid="ton-address-pill"
              aria-label={t('home.copyTon')}
              className="pressable flex items-center gap-1.5 rounded-full bg-hero-pill px-3 py-1.5 font-mono text-[11.5px] font-medium text-hero-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hero-ink"
            >
              {shortAddress(tonAddress, 3, 4)}
              <CopyIcon size={12} />
              {copied ? <span className="sr-only">{t('home.copied')}</span> : null}
            </button>
          </div>

          <p
            data-testid="hero-balance"
            className="tabular mt-4 text-[38px] font-extrabold leading-none tracking-[-0.03em]"
          >
            {balanceDisplay}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-hero-pill px-2.5 py-1 text-[12px] font-semibold">
              {secondary}
            </span>
            {deltaText && portfolioReady && !masked ? (
              <span
                data-testid="hero-delta"
                className={`tabular rounded-full bg-hero-pill px-2.5 py-1 text-[12px] font-semibold ${deltaTone}`}
              >
                {prefixArrow(change)} {formatUsd(delta)} ({formatChange(change)})
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1 rounded-b-[26px] border-t border-hairline bg-surface px-2 py-3">
          {(
            [
              {
                id: 'deposit',
                label: t('home.deposit'),
                icon: <ArrowDownIcon size={20} />,
                run: onOpenDeposit,
              },
              {
                id: 'send',
                label: t('home.sendSell'),
                icon: <ArrowUpIcon size={20} />,
                run: onOpenSend,
              },
              {
                id: 'trade',
                label: t('home.trade'),
                icon: <SwapIcon size={20} />,
                run: onOpenTrade,
              },
              { id: 'earn', label: t('home.earn'), icon: <EarnIcon size={20} />, run: onOpenEarn },
            ] as const
          ).map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.run}
              aria-label={action.label}
              className="pressable flex flex-col items-center gap-1.5 rounded-2xl py-1 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-secondary text-ink">
                {action.icon}
              </span>
              <span className="text-[11.5px] font-semibold text-ink-2">{action.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="mt-5 px-4">
        <SectionHeader
          right={
            <button
              type="button"
              onClick={onRefresh}
              className="pressable flex h-7 w-7 items-center justify-center rounded-full bg-surface text-ink-2 shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
              aria-label={t('home.refresh')}
            >
              <RefreshIcon size={14} />
            </button>
          }
        >
          {t('home.availableFunds')}
        </SectionHeader>
        <Card>
          {assets.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted">{t('home.syncing')}</p>
          ) : (
            assets.map((asset, index) => (
              <div key={asset.key}>
                {index > 0 ? <div className="ml-16 h-px bg-hairline" aria-hidden="true" /> : null}
                <AssetRowView asset={asset} onOpen={onOpenCoin} guard={guard} />
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="mt-5 px-4">
        <SectionHeader>{t('home.activity')}</SectionHeader>
        <Card>
          {activity.state === 'loading' && !pending ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted" aria-live="polite">
              {t('home.syncing')}
            </p>
          ) : activity.state === 'error' && !pending ? (
            <div className="flex items-center justify-between gap-3 px-4 py-5 text-[13px] text-ink-2">
              <span>{t('home.offline')}</span>
              <Button
                variant="secondary"
                onClick={onRefresh}
                className="w-auto min-h-9 px-3 text-[12.5px]"
              >
                {t('home.retry')}
              </Button>
            </div>
          ) : allItems.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
              {t('home.activityEmpty')}
            </p>
          ) : (
            groups.map((group, groupIndex) => (
              <div key={`${group.label}-${String(groupIndex)}`}>
                <div className="flex justify-center bg-surface-secondary py-1.5">
                  <span className="rounded-full bg-surface-elevated px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-ink-2">
                    {group.label}
                  </span>
                </div>
                {group.items.map((item, index) => (
                  <div key={item.id}>
                    {index > 0 ? (
                      <div className="ml-16 h-px bg-hairline" aria-hidden="true" />
                    ) : null}
                    <ActivityRow item={item} onOpen={onOpenTx} guard={guard} />
                  </div>
                ))}
              </div>
            ))
          )}
        </Card>
      </div>

      <p className="px-6 py-5 text-center text-[11.5px] font-medium text-ink-muted">
        {t('home.notice')}
      </p>

      {sheet === 'wallet' ? (
        <Sheet
          title={t('home.wallets')}
          onClose={() => {
            setSheet(null);
          }}
        >
          <div className="flex items-center gap-3 rounded-[20px] bg-surface-secondary p-3.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-hero text-[12px] font-extrabold text-hero-ink">
              OZ
            </span>
            <span className="flex-1">
              <span className="block text-[15px] font-semibold text-ink">{t('app.name')}</span>
              <span className="block text-[12px] text-ink-2">
                {info ? shortAddress(tonAddress, 6, 4) : '—'}
              </span>
            </span>
            <span className="rounded-full bg-positive-bg px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] text-positive">
              {t('home.testnet')}
            </span>
          </div>
          <SheetRow
            title="Vault Savings"
            subtitle="Grow idle balances"
            badge="Coming soon"
            disabled
          />
          <SheetRow
            title="+ Add / Import Wallet"
            subtitle="Another wallet"
            badge="Coming soon"
            disabled
          />
          <button
            type="button"
            onClick={() => {
              setSheet(null);
              onOpenSettings();
            }}
            className="pressable rounded-full bg-surface-secondary py-3 text-[13px] font-semibold text-ink"
          >
            Open settings
          </button>
        </Sheet>
      ) : null}

      {sheet === 'qr' ? (
        <Sheet
          title={t('receive.title')}
          onClose={() => {
            setSheet(null);
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-[24px] bg-white p-3 shadow-card">
              <QrCode value={tonAddress} size={200} label="QR code for your TON address" />
            </div>
            <code className="break-all rounded-2xl bg-surface-secondary px-3 py-2 text-center font-mono text-[11.5px] text-ink-2">
              {tonAddress}
            </code>
            <Button variant="secondary" onClick={() => void copyAddress(tonAddress)}>
              <CopyIcon size={16} />
              {t('home.copyTon')}
            </Button>
            <p className="text-center text-[11.5px] text-ink-muted">{t('receive.tonHint')}</p>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function prefixArrow(change: number | null): string {
  if (change === null) return '';
  return change >= 0 ? '↑' : '↓';
}

function SheetRow({
  title,
  subtitle,
  badge,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  badge: string;
  disabled?: boolean;
}) {
  return (
    <div
      aria-disabled={disabled}
      className={`flex items-center gap-3 rounded-[20px] bg-surface-secondary p-3.5 ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-elevated text-ink-2">
        <span className="text-[12px] font-bold">+</span>
      </span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="block text-[12px] text-ink-2">{subtitle}</span>
      </span>
      <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
        {badge}
      </span>
    </div>
  );
}
