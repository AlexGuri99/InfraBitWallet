/**
 * Trade screen — P3 placeholder (DESIGN.md §5.3).
 *
 * This is a UI shell: it lays out the swap experience so the navigation and visual rhythm are
 * complete, but it never builds or signs a swap payload. The CTA is disabled and labelled
 * "Coming in P3".
 */
import { useState } from 'react';
import { t } from '../i18n';
import { Button, Card, PhoneFrame, ScreenHeader, TokenAvatar } from './common';
import { ChevronDownIcon, SwapIcon } from './icons';

const SLIPPAGE = '0.5%';

export function TradeScreen({ onBack }: { onBack: () => void }) {
  const [sellAmount, setSellAmount] = useState('');
  const [details, setDetails] = useState(false);

  return (
    <PhoneFrame>
      <ScreenHeader
        title={t('trade.title')}
        onBack={onBack}
        right={
          <span className="rounded-full bg-swap-bg px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.02em] text-swap">
            Coming in P3
          </span>
        }
      />
      <main className="flex flex-1 flex-col gap-2 px-4 pb-10">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">You Sell</span>
            <button
              type="button"
              className="pressable flex items-center gap-1.5 rounded-full bg-surface-secondary px-2.5 py-1.5 text-[12px] font-bold text-ink"
            >
              <TokenAvatar symbol="TON" size={20} />
              TON
              <ChevronDownIcon size={13} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              aria-label="You sell amount"
              inputMode="decimal"
              value={sellAmount}
              onChange={(event) => {
                setSellAmount(event.target.value);
              }}
              placeholder="0.0"
              className="tabular min-w-0 flex-1 bg-transparent font-mono text-[30px] font-extrabold tracking-[-0.02em] text-ink placeholder:text-ink-muted focus:outline-none"
            />
            <button
              type="button"
              className="pressable rounded-full bg-surface-secondary px-3 py-1.5 text-[11.5px] font-bold text-accent-link"
            >
              {t('send.max')}
            </button>
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">≈ $0.00 · Balance —</p>
        </Card>

        <div className="relative flex h-0 items-center justify-center">
          <span className="absolute -top-5 flex h-10 w-10 items-center justify-center rounded-full bg-swap text-white shadow-card">
            <SwapIcon size={18} />
          </span>
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">You Buy</span>
            <button
              type="button"
              className="pressable flex items-center gap-1.5 rounded-full bg-surface-secondary px-2.5 py-1.5 text-[12px] font-bold text-ink"
            >
              <TokenAvatar symbol="USDT" size={20} />
              USDT
              <ChevronDownIcon size={13} />
            </button>
          </div>
          <p className="tabular mt-3 text-[30px] font-extrabold tracking-[-0.02em] text-ink-muted">
            0.0
          </p>
          <p className="mt-1 text-[12px] text-ink-muted">
            Output is calculated by the swap provider.
          </p>
        </Card>

        <button
          type="button"
          aria-expanded={details}
          onClick={() => {
            setDetails((value) => !value);
          }}
          className="pressable mt-2 flex items-center justify-between rounded-full bg-surface px-4 py-3 text-[13px] font-semibold text-ink shadow-card"
        >
          Details
          <ChevronDownIcon
            size={15}
            className={`text-ink-2 transition-transform ${details ? 'rotate-180' : ''}`}
          />
        </button>

        {details ? (
          <Card className="flex flex-col gap-2 p-4 text-[13px]">
            <DetailRow label="Rate" value="Secured by provider (P3)" />
            <DetailRow label="Slippage tolerance" value={SLIPPAGE} />
            <DetailRow label="Route" value="STON.fi v2" />
            <DetailRow label="Network fee" value="~ 0.02 TON" />
            <DetailRow label="Swap fee" value="0.35%" />
          </Card>
        ) : null}

        <div className="mt-auto pt-4">
          <Button disabled>Coming in P3</Button>
          <p className="mt-2 text-center text-[11.5px] text-ink-muted">
            Swap execution is not enabled in this build.
          </p>
        </div>
      </main>
    </PhoneFrame>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}
