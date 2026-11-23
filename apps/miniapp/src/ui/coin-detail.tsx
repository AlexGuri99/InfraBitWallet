/**
 * Coin Detail (DESIGN.md §5.4) — live balance and activity, static preview chart.
 *
 * The chart and tokenomics are clearly labelled preview data and never overwrite the user's real
 * balance. Activity is filtered to the selected token only.
 */
import { useMemo, useState } from 'react';
import { formatChange, formatUsd, type TonActivityItem } from '@onezerowallet/chain-ton';
import { t } from '../i18n';
import type { AssetView } from './asset';
import { activityStatusLabel, clockTime, dateLabel, groupActivity, shortAddress } from './asset';
import { usePreferences } from './preferences';
import { useToast } from './toast';
import { Button, Card, PhoneFrame, ScreenHeader, SectionHeader, TokenAvatar } from './common';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, SendIcon, SwapIcon } from './icons';

const TIMEFRAMES = ['All', 'Y', '3M', 'M', 'W', 'D'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

export function CoinDetailScreen({
  asset,
  activity,
  change24h = null,
  onBack,
  onDeposit,
  onSend,
  onOpenTx,
}: {
  asset: AssetView;
  activity: TonActivityItem[];
  change24h?: number | null;
  onBack: () => void;
  onDeposit: () => void;
  onSend: (asset: AssetView) => void;
  onOpenTx: (item: TonActivityItem) => void;
}) {
  const { guard, masked } = usePreferences();
  const toast = useToast();
  const [timeframe, setTimeframe] = useState<Timeframe>('M');

  const filtered = useMemo(
    () =>
      activity.filter(
        (item) =>
          item.symbol.toUpperCase() === asset.symbol.toUpperCase() &&
          (asset.chain === 'ton' || asset.standard === 'tron' || asset.standard === 'evm'),
      ),
    [activity, asset.symbol, asset.chain, asset.standard],
  );
  const groups = groupActivity(filtered);

  const balanceText = asset.live ? `${asset.balance} ${asset.symbol}` : '—';
  const fiatText = asset.usdValue === null ? '—' : formatUsd(asset.usdValue);

  return (
    <PhoneFrame>
      <ScreenHeader title={asset.name} onBack={onBack} />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-10">
        <section className="flex flex-col items-center gap-2 pt-1 text-center">
          <TokenAvatar symbol={asset.symbol} size={56} />
          <p
            data-testid="coin-balance"
            className="tabular text-[34px] font-extrabold tracking-[-0.025em] text-ink"
          >
            {guard(balanceText)}
          </p>
          <div className="flex items-center gap-2">
            <span className="tabular text-[13px] font-medium text-ink-2">{guard(fiatText)}</span>
            {change24h !== null ? (
              <span
                className={`tabular rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  change24h >= 0
                    ? 'bg-positive-bg text-positive'
                    : 'bg-surface-secondary text-negative'
                }`}
              >
                {formatChange(change24h)}
              </span>
            ) : null}
          </div>
        </section>

        <div className="grid grid-cols-4 gap-2">
          {(
            [
              {
                id: 'buy',
                label: 'Buy',
                icon: <ArrowDownIcon size={19} />,
                run: () => {
                  toast.show('Buy — coming soon');
                },
              },
              {
                id: 'sell',
                label: 'Sell',
                icon: <ArrowUpIcon size={19} />,
                run: () => {
                  toast.show('Sell — coming soon');
                },
              },
              { id: 'fund', label: 'Fund', icon: <SwapIcon size={19} />, run: onDeposit },
              {
                id: 'send',
                label: 'Send',
                icon: <SendIcon size={19} />,
                run: () => {
                  onSend(asset);
                },
              },
            ] as const
          ).map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.run}
              aria-label={action.label}
              className="pressable flex flex-col items-center gap-1.5 rounded-2xl bg-surface py-3 text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-secondary text-ink">
                {action.icon}
              </span>
              <span className="text-[11.5px] font-semibold text-ink-2">{action.label}</span>
            </button>
          ))}
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">{timeframe} chart</span>
            <span className="rounded-full bg-surface-secondary px-2 py-1 text-[10px] font-bold uppercase tracking-[0.02em] text-ink-muted">
              Preview — static data
            </span>
          </div>
          <PreviewChart />
          <div className="mt-2 flex items-center justify-between text-[11.5px] font-medium text-ink-muted">
            <span>Start</span>
            <span>Now</span>
          </div>
          <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto">
            {TIMEFRAMES.map((value) => {
              const active = value === timeframe;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTimeframe(value);
                  }}
                  className={`pressable min-h-7 flex-1 rounded-full px-2 text-[11.5px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${
                    active ? 'bg-accent-primary text-accent-ink' : 'bg-surface-secondary text-ink-2'
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-ink">Info & Tokenomics</h2>
            <span className="rounded-full bg-surface-secondary px-2 py-1 text-[10px] font-bold uppercase tracking-[0.02em] text-ink-muted">
              Preview
            </span>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            {asset.name} is a {asset.chain === 'ton' ? 'TON' : asset.chain.toUpperCase()} asset.
            Market statistics appear here once the live market feed ships.
          </p>
          <div className="flex flex-wrap gap-2">
            {['𝕏 X', 'Telegram', 'Website'].map((label) => (
              <span
                key={label}
                className="rounded-full bg-surface-secondary px-3 py-1.5 text-[11.5px] font-semibold text-ink-2"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="h-px bg-hairline" />
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-ink-2">Market Cap</span>
              <span className="font-semibold text-ink">—</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-ink-2">Circulating Supply</span>
              <span className="font-semibold text-ink">—</span>
            </div>
          </div>
        </Card>

        <div>
          <SectionHeader>Activity</SectionHeader>
          <Card>
            {filtered.length === 0 ? (
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
                      <button
                        type="button"
                        data-testid={`coin-activity-${item.id}`}
                        onClick={() => {
                          onOpenTx(item);
                        }}
                        className="pressable flex w-full items-center gap-3 px-4 py-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-link)]"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-[14px] font-bold text-ink-2">
                          {item.direction === 'in' ? '↙' : '↗'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-semibold text-ink">
                            {activityStatusLabel(item)}
                          </span>
                          <span className="block truncate text-[12.5px] text-ink-2">
                            {shortAddress(item.counterparty)} · {clockTime(item.timestamp)} ·{' '}
                            {dateLabel(item.timestamp)}
                          </span>
                        </span>
                        <span
                          className={`tabular text-[14.5px] font-semibold ${
                            item.direction === 'in' ? 'text-positive' : 'text-ink'
                          }`}
                        >
                          {item.direction === 'in' ? '+' : '-'}
                          {guard(item.amount)} {item.symbol}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </Card>
        </div>

        {masked ? (
          <p className="text-center text-[11.5px] text-ink-muted">
            Balances are hidden by privacy mode.
          </p>
        ) : null}

        <Button
          variant="secondary"
          onClick={() => {
            toast.show('Market data — coming soon');
          }}
        >
          <ChevronRightIcon size={15} />
          View live market data
        </Button>
      </main>
    </PhoneFrame>
  );
}

function PreviewChart() {
  return (
    <svg
      viewBox="0 0 320 120"
      role="img"
      aria-label="Static preview price chart"
      className="mt-3 h-[120px] w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="coin-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--status-positive)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--status-positive)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 92 C 24 88, 36 74, 56 78 C 78 82, 88 58, 110 60 C 132 62, 142 40, 166 46 C 188 52, 198 30, 220 34 C 244 38, 252 22, 274 24 C 294 26, 304 14, 320 12 L320 120 L0 120 Z"
        fill="url(#coin-area)"
      />
      <path
        d="M0 92 C 24 88, 36 74, 56 78 C 78 82, 88 58, 110 60 C 132 62, 142 40, 166 46 C 188 52, 198 30, 220 34 C 244 38, 252 22, 274 24 C 294 26, 304 14, 320 12"
        fill="none"
        stroke="var(--status-positive)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
