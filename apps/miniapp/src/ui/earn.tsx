/**
 * Earn / Add Stake — P3 placeholder (DESIGN.md §5.3).
 *
 * Layout-only shell: amount well, Max helper, fee estimate and staking details. It never stakes
 * anything and is labelled "Coming in P3".
 */
import { useState } from 'react';
import { t } from '../i18n';
import { Button, Card, PhoneFrame, ScreenHeader } from './common';
import { ChevronDownIcon, ShieldIcon } from './icons';

export function EarnScreen({ onBack }: { onBack: () => void }) {
  const [amount, setAmount] = useState('');
  const [safeOpen, setSafeOpen] = useState(false);

  return (
    <PhoneFrame>
      <ScreenHeader
        title={t('earn.title')}
        onBack={onBack}
        right={
          <span className="rounded-full bg-positive-bg px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.02em] text-positive">
            Coming in P3
          </span>
        }
      />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-10">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">Amount</span>
            <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-ink-2">
              TON
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              aria-label="Stake amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
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
          <p className="mt-1 text-[12px] text-ink-muted">Fee ~ 0.02 TON · ≈ $0.00</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-ink">Staking Details</h2>
            <span className="rounded-full bg-positive-bg px-2.5 py-1 text-[11.5px] font-bold text-positive tabular">
              13.62% APY
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2 text-[13px]">
            <Row label="Current APY" value="13.62%" />
            <Row label="Est. yearly earnings" value="—" />
            <Row label="Total staked" value="—" />
            <Row label="Total stakers" value="—" />
          </div>
          <button
            type="button"
            aria-expanded={safeOpen}
            onClick={() => {
              setSafeOpen((value) => !value);
            }}
            className="pressable mt-3 flex w-full items-center justify-between rounded-2xl bg-surface-secondary px-3 py-2.5 text-[12.5px] font-semibold text-ink"
          >
            <span className="flex items-center gap-1.5">
              <ShieldIcon size={15} className="text-positive" />
              Why this is safe
            </span>
            <ChevronDownIcon
              size={15}
              className={`text-ink-2 transition-transform ${safeOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {safeOpen ? (
            <p className="mt-2 rounded-2xl bg-surface-secondary px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
              Staking moves TON into an audited staking contract. Your principal stays under your
              control through a deterministic exit request; rewards depend on validator performance.
              This build does not execute stakes.
            </p>
          ) : null}
        </Card>

        <div className="mt-auto pt-2">
          <Button disabled>Coming in P3</Button>
          <p className="mt-2 text-center text-[11.5px] text-ink-muted">
            Staking is not enabled in this build.
          </p>
        </div>
      </main>
    </PhoneFrame>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-2">{label}</span>
      <span className="tabular font-semibold text-ink">{value}</span>
    </div>
  );
}
