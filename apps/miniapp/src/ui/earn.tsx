/**
 * Earn screen — live Tonstakers liquid staking (DESIGN.md §5.3).
 *
 * Flow: form → same-origin pool metrics → build the Tonstakers message with
 * @onezerowallet/staking-ton → sign through the vault closure (V5R1) → decode the signed BoC →
 * emulate (fail-closed) → broadcast → Pending activity. The review renders the decoded payload and
 * the emulation result, never the form state. Nothing here talks to TonAPI directly
 * (CSP `connect-src 'self'`), and the wallet takes no staking fee.
 */
import { useEffect, useState } from 'react';
import type { PublicAccountInfo, VaultManager } from '@onezerowallet/crypto-vault';
import {
  buildSwapTransfer,
  formatDecimal,
  formatDecimalShort,
  parseDecimal,
  toTestnetDisplayAddress,
  tonAddressEquals,
  type BuiltTransfer,
  type DecodedSignedTransfer,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import {
  MIN_STAKE_RAW,
  STAKE_GAS_RESERVE_RAW,
  UNSTAKE_GAS_RESERVE_RAW,
  buildStakePayload,
  buildUnstakePayload,
  decodeStakingPayload,
  maxStakeAmountRaw,
  type DecodedStakingPayload,
  type UnstakeMode,
} from '@onezerowallet/staking-ton';
import { t } from '../i18n';
import type {
  EmulationPayload,
  StakingInfoPayload,
  TonReadApi,
  TonStakeApi,
  TonWriteApi,
} from '../ton/api';
import { Button, Card, ErrorText, Notice, PhoneFrame, ScreenHeader, Segmented } from './common';
import { useToast } from './toast';

type EarnApi = TonReadApi & TonWriteApi & TonStakeApi;

type InfoState =
  { kind: 'loading' } | { kind: 'ready'; value: StakingInfoPayload } | { kind: 'unavailable' };

type Mode = 'stake' | 'unstake';

const UNSTAKE_MODES: ReadonlyArray<{ value: UnstakeMode; label: string }> = [
  { value: 'standard', label: 'Standard' },
  { value: 'instant', label: 'Instant' },
  { value: 'best-rate', label: 'Best rate' },
];

const UNSTAKE_MODE_HINT: Record<UnstakeMode, string> = {
  standard: 'Withdraw at the round rate. You receive a withdrawal NFT you can redeem later.',
  instant: 'Fill-or-kill against the pool’s instant liquidity, if enough TON is available now.',
  'best-rate': 'Wait for the next round and unstake at the projected (best) rate.',
};

type Step =
  | { kind: 'form' }
  | {
      kind: 'review';
      mode: Mode;
      built: BuiltTransfer;
      decoded: DecodedSignedTransfer;
      staking: DecodedStakingPayload;
      emulation: EmulationPayload;
      info: StakingInfoPayload;
      estimateTon: string | null;
    }
  | { kind: 'sent'; hashHex: string; symbol: string; amountRaw: string; decimals: number };

function nativeBalance(portfolio: TonPortfolio): string {
  return portfolio.assets.find((asset) => asset.standard === 'native')?.balanceRaw ?? '0';
}

function estimateOut(mode: Mode, amountRaw: bigint, rate: number): number {
  const value = Number(amountRaw) / 1e9;
  return mode === 'stake' ? value / rate : value * rate;
}

function formatEstimate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value.toFixed(6).replace(/\.?0+$/, '');
}

export function EarnScreen({
  manager,
  info,
  portfolio,
  api,
  onBack,
  onSubmitted,
}: {
  manager: VaultManager;
  info: PublicAccountInfo;
  portfolio: TonPortfolio;
  api: EarnApi;
  onBack: () => void;
  onSubmitted: (
    decoded: DecodedSignedTransfer,
    asset: { symbol: string; decimals: number; amountRaw?: string | undefined },
  ) => void;
}) {
  const toast = useToast();
  const [pool, setPool] = useState<InfoState>({ kind: 'loading' });
  const [mode, setMode] = useState<Mode>('stake');
  const [unstakeMode, setUnstakeMode] = useState<UnstakeMode>('standard');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'form' });

  useEffect(() => {
    let cancelled = false;
    api
      .getStakingInfo('testnet')
      .then((value) => {
        if (!cancelled) setPool({ kind: 'ready', value });
      })
      .catch(() => {
        if (!cancelled) setPool({ kind: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const staking = pool.kind === 'ready' ? pool.value : null;
  const rate = staking?.exchangeRate ?? null;
  const tonBalanceRaw = nativeBalance(portfolio);
  const tsTonAsset =
    staking === null
      ? undefined
      : portfolio.assets.find((asset) => tonAddressEquals(asset.id, staking.tsTonMasterAddress));
  const tsTonBalanceRaw = tsTonAsset?.balanceRaw ?? '0';
  const tsTonDecimals = staking?.tsTonDecimals ?? 9;

  const amountRaw =
    mode === 'stake' ? parseDecimal(amount.trim(), 9) : parseDecimal(amount.trim(), tsTonDecimals);
  const estimate =
    amountRaw !== null && amountRaw > 0n && rate !== null
      ? estimateOut(mode, amountRaw, rate)
      : null;
  const outputSymbol = mode === 'stake' ? (staking?.tsTonSymbol ?? 'tsTON') : 'TON';

  const setMax = (): void => {
    if (mode === 'stake') {
      setAmount(formatDecimalShort(maxStakeAmountRaw(tonBalanceRaw), 9, 9));
    } else {
      setAmount(formatDecimal(tsTonBalanceRaw, tsTonDecimals));
    }
    setError(null);
  };

  const validate = (): string | null => {
    if (pool.kind !== 'ready') return 'Staking is not available right now.';
    if (amountRaw === null || amountRaw <= 0n) return 'Enter a positive amount';
    if (mode === 'stake') {
      if (amountRaw < MIN_STAKE_RAW) return t('earn.minimum');
      const spendable = BigInt(maxStakeAmountRaw(tonBalanceRaw));
      if (amountRaw > spendable) return 'Amount exceeds balance minus the 1.1 TON gas reserve';
    } else {
      if (amountRaw > BigInt(tsTonBalanceRaw)) return 'Amount exceeds your tsTON balance';
      if (!tsTonAsset?.jettonWalletAddress) return 'No tsTON wallet found for this account';
      if (BigInt(tonBalanceRaw) < UNSTAKE_GAS_RESERVE_RAW) {
        return 'Keep at least 1.05 TON in your wallet for the unstake gas';
      }
    }
    return null;
  };

  const review = async (): Promise<void> => {
    if (busy || pool.kind !== 'ready') return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (amountRaw === null) return;
    const session = manager.getSession();
    if (!session) {
      setError('Session locked');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const state = await api.getWalletState(info.ton.addressTestnetNonBounceable, 'testnet');
      if (state.status === 'active' && state.seqno === 0) {
        setError('Could not read the wallet seqno. Retry before staking.');
        return;
      }
      let payload: { to: string; valueRaw: string; bodyBoc: string };
      if (mode === 'stake') {
        payload = buildStakePayload({
          poolAddress: pool.value.poolAddress,
          amountRaw: amountRaw.toString(),
        });
      } else {
        if (!tsTonAsset?.jettonWalletAddress) {
          setError('No tsTON wallet found for this account');
          return;
        }
        payload = buildUnstakePayload({
          jettonWalletAddress: tsTonAsset.jettonWalletAddress,
          amountRaw: amountRaw.toString(),
          ownerAddress: info.ton.addressTestnetNonBounceable,
          mode: unstakeMode,
        });
      }
      const sign = (digest: Uint8Array): Promise<Uint8Array> => {
        const signed = session.signDigest('ton', 0, digest);
        if (!signed.ok) return Promise.reject(new Error(signed.error));
        return Promise.resolve(signed.signature);
      };
      const built = await buildSwapTransfer(
        {
          publicKeyHex: info.ton.publicKeyHex,
          network: 'testnet',
          seqno: state.seqno,
          to: payload.to,
          valueRaw: payload.valueRaw,
          bodyBoc: payload.bodyBoc,
          deploy: state.status === 'uninit',
        },
        sign,
      );
      // Decode the exact body being signed, then emulate it fail-closed.
      const stakingDecoded = decodeStakingPayload(payload.valueRaw, payload.bodyBoc);
      const emulation = await api.emulate(built.boc, 'testnet');
      setStep({
        kind: 'review',
        mode,
        built,
        decoded: built.decoded,
        staking: stakingDecoded,
        emulation,
        info: pool.value,
        estimateTon: estimate === null ? null : formatEstimate(estimate),
      });
    } catch {
      setError('Could not build or emulate the staking transaction. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  };

  const broadcast = async (): Promise<void> => {
    if (step.kind !== 'review' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.broadcast(step.built.boc, 'testnet');
      // Stake leaves TON; unstake burns tsTON. Both are what the Activity row should show.
      const symbol = step.mode === 'stake' ? 'TON' : step.info.tsTonSymbol;
      const decimals = step.mode === 'stake' ? 9 : step.info.tsTonDecimals;
      const amountRaw = step.staking.amountRaw;
      onSubmitted(step.decoded, { symbol, decimals, amountRaw });
      setStep({ kind: 'sent', hashHex: result.messageHash.hex, symbol, amountRaw, decimals });
      toast.show(t('send.submitted'));
    } catch {
      setError('Broadcast failed. The staking transaction may not have been submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'sent') {
    return (
      <PhoneFrame>
        <ScreenHeader title="Staking submitted" onBack={onBack} />
        <main className="flex flex-1 flex-col items-center gap-4 px-5 pt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-positive-bg text-[26px] font-bold text-positive">
            ✓
          </div>
          <p className="text-center text-[13px] leading-relaxed text-ink-2">
            {t('send.submittedBody')}
          </p>
          <Card className="w-full p-4 text-center">
            <p className="tabular text-[22px] font-extrabold tracking-[-0.02em] text-ink">
              {formatDecimal(step.amountRaw, step.decimals)} {step.symbol}
            </p>
            <a
              className="mt-2 block break-all text-[11.5px] font-medium text-accent-link underline"
              href={`https://testnet.tonviewer.com/message/${step.hashHex}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              testnet.tonviewer.com/message/{step.hashHex.slice(0, 16)}…
            </a>
          </Card>
          <Button
            onClick={() => {
              setStep({ kind: 'form' });
              onBack();
            }}
          >
            {t('common.done')}
          </Button>
        </main>
      </PhoneFrame>
    );
  }

  if (step.kind === 'review') {
    const fatal = !step.emulation.ok;
    const stakingDecoded = step.staking;
    const stakingStake = stakingDecoded.action === 'stake';
    return (
      <PhoneFrame>
        <ScreenHeader
          title={step.mode === 'stake' ? 'Review stake' : 'Review unstake'}
          onBack={() => {
            setStep({ kind: 'form' });
          }}
        />
        <main className="flex flex-1 flex-col gap-4 px-4 pb-10">
          <Card className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                {step.mode === 'stake' ? 'Staking pool' : 'tsTON wallet'}
              </p>
              <code className="mt-1 block break-all font-mono text-[12.5px] text-ink">
                {toTestnetDisplayAddress(step.decoded.recipient, true)}
              </code>
            </div>
            <div className="h-px bg-hairline" />
            {stakingStake ? (
              <>
                <Row
                  label="You stake"
                  value={`${formatDecimal(stakingDecoded.amountRaw, 9)} TON`}
                />
                <Row
                  label="Gas reserve"
                  value={`${formatDecimalShort(STAKE_GAS_RESERVE_RAW.toString(), 9, 2)} TON`}
                />
              </>
            ) : (
              <>
                <Row
                  label="You unstake"
                  value={`${formatDecimal(stakingDecoded.amountRaw, step.info.tsTonDecimals)} ${step.info.tsTonSymbol}`}
                />
                <Row
                  label="Gas reserve"
                  value={`${formatDecimalShort(UNSTAKE_GAS_RESERVE_RAW.toString(), 9, 2)} TON`}
                />
                <Row
                  label="Mode"
                  value={
                    UNSTAKE_MODES.find((entry) => entry.value === stakingDecoded.mode)?.label ??
                    'Standard'
                  }
                />
              </>
            )}
            <Row
              label={`Estimated ${step.mode === 'stake' ? step.info.tsTonSymbol : 'TON'}`}
              value={
                step.estimateTon === null
                  ? '—'
                  : `≈ ${step.estimateTon} ${step.mode === 'stake' ? step.info.tsTonSymbol : 'TON'}`
              }
            />
            <Row label="Rate" value={formatRate(step.info.exchangeRate)} />
            <Row label="Wallet fee" value="0%" />
            <Row label="Seqno" value={String(step.decoded.seqno)} />
            {step.decoded.hasStateInit ? (
              <span className="mt-1 w-fit rounded-full bg-swap-bg px-2.5 py-1 text-[11.5px] font-semibold text-swap">
                {t('send.deployBadge')}
              </span>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <Row
              label="Network fee (est.)"
              value={`~${formatDecimalShort(step.emulation.estimatedFeeRaw, 9, 6)} TON`}
            />
            {step.emulation.balanceChanges.map((change) => (
              <Row
                key={change.assetId}
                label={`${change.symbol} change`}
                value={formatDecimalShort(change.deltaRaw, change.decimals, 6)}
              />
            ))}
          </Card>

          {step.emulation.warnings.length > 0 ? (
            <Notice tone="warning">{step.emulation.warnings.join(' · ')}</Notice>
          ) : null}
          {fatal ? <ErrorText>{t('send.emulationFailed')}</ErrorText> : null}
          {error ? <ErrorText>{error}</ErrorText> : null}

          <div className="mt-auto flex flex-col gap-2.5 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setStep({ kind: 'form' });
              }}
              disabled={busy}
            >
              {t('settings.back')}
            </Button>
            <Button onClick={() => void broadcast()} disabled={busy || fatal}>
              {busy
                ? t('common.working')
                : step.mode === 'stake'
                  ? 'Confirm & Stake'
                  : 'Confirm & Unstake'}
            </Button>
          </div>
        </main>
      </PhoneFrame>
    );
  }

  const unavailable = pool.kind === 'unavailable';
  const canReview = pool.kind === 'ready' && !busy && amount.trim() !== '';
  const stakingPct = staking === null ? null : staking.apy.toFixed(2);
  const tsTonBalance =
    staking === null ? null : formatDecimal(tsTonBalanceRaw, staking.tsTonDecimals);
  const tsTonTonValue =
    staking === null || rate === null
      ? null
      : (Number(tsTonBalanceRaw) / 10 ** staking.tsTonDecimals) * rate;

  return (
    <PhoneFrame>
      <ScreenHeader
        title={t('earn.title')}
        onBack={onBack}
        right={
          stakingPct === null ? undefined : (
            <span
              data-testid="earn-apy"
              className="rounded-full bg-positive-bg px-2.5 py-1 text-[11.5px] font-bold text-positive tabular"
            >
              {stakingPct}% APY
            </span>
          )
        }
      />
      <main className="flex flex-1 flex-col gap-3 px-4 pb-10">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-ink">Staking overview</h2>
            <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-ink-2">
              Tonstakers · tsTON
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2 text-[13px]">
            <Row
              label="Your tsTON"
              value={
                tsTonBalance === null ? '—' : `${tsTonBalance} ${staking?.tsTonSymbol ?? 'tsTON'}`
              }
            />
            <Row
              label="TON value"
              value={
                tsTonTonValue === null
                  ? '—'
                  : `≈ ${formatDecimalShort(String(Math.trunc(tsTonTonValue * 1e9)), 9, 4)} TON`
              }
            />
            <Row label="Exchange rate" value={rate === null ? '—' : formatRate(rate)} />
            <Row
              label="Total staked"
              value={staking === null ? '—' : `${formatDecimalShort(staking.tvlRaw, 9, 2)} TON`}
            />
            <Row
              label="Stakers"
              value={staking === null ? '—' : staking.stakers.toLocaleString('en-US')}
            />
            <Row
              label="Instant liquidity"
              value={
                staking === null
                  ? '—'
                  : `${formatDecimalShort(staking.instantLiquidityRaw, 9, 2)} TON`
              }
            />
            <Row label="Wallet fee" value="0%" />
          </div>
        </Card>

        <Segmented
          label="Stake or unstake"
          value={mode}
          options={[
            { value: 'stake', label: 'Stake' },
            { value: 'unstake', label: 'Unstake' },
          ]}
          onChange={(value) => {
            setMode(value);
            setAmount('');
            setError(null);
          }}
        />

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">
              {mode === 'stake' ? 'Amount to stake' : 'Amount to unstake'}
            </span>
            <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-ink-2">
              {mode === 'stake' ? 'TON' : (staking?.tsTonSymbol ?? 'tsTON')}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              aria-label={mode === 'stake' ? 'Stake amount' : 'Unstake amount'}
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
              }}
              placeholder="0.0"
              className="tabular min-w-0 flex-1 bg-transparent font-mono text-[30px] font-extrabold tracking-[-0.02em] text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
            />
            <button
              type="button"
              onClick={setMax}
              className="pressable rounded-full bg-surface-secondary px-3 py-1.5 text-[11.5px] font-bold text-accent-link"
            >
              {t('send.max')}
            </button>
          </div>
          <p className="mt-1 text-[12px] text-ink-muted">
            {mode === 'stake'
              ? `Balance ${formatDecimal(tonBalanceRaw, 9)} TON · min 1 TON`
              : `Balance ${formatDecimal(tsTonBalanceRaw, tsTonDecimals)} ${staking?.tsTonSymbol ?? 'tsTON'}`}
          </p>
        </Card>

        {mode === 'unstake' ? (
          <>
            <Segmented
              label="Unstake mode"
              value={unstakeMode}
              options={UNSTAKE_MODES}
              size="sm"
              onChange={(value) => {
                setUnstakeMode(value);
                setError(null);
              }}
            />
            <p className="px-1 text-[11.5px] leading-relaxed text-ink-muted">
              {UNSTAKE_MODE_HINT[unstakeMode]}
            </p>
          </>
        ) : null}

        {rate !== null ? (
          <Card className="flex flex-col gap-2 p-4 text-[13px]">
            <Row
              label={mode === 'stake' ? 'Estimated tsTON received' : 'Estimated TON received'}
              value={estimate === null ? '—' : `≈ ${formatEstimate(estimate)} ${outputSymbol}`}
            />
            <Row label="Rate" value={formatRate(rate)} />
            <Row
              label="Gas reserve"
              value={
                mode === 'stake'
                  ? `${formatDecimalShort(STAKE_GAS_RESERVE_RAW.toString(), 9, 2)} TON`
                  : `${formatDecimalShort(UNSTAKE_GAS_RESERVE_RAW.toString(), 9, 2)} TON`
              }
            />
            <Row label="Staking fee" value="0%" />
          </Card>
        ) : null}

        {unavailable ? (
          <Notice tone="warning">
            Staking is unavailable on this network until live Tonstakers metrics are configured.
          </Notice>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="mt-auto pt-2">
          <Button onClick={() => void review()} disabled={!canReview}>
            {busy ? t('common.working') : mode === 'stake' ? 'Review stake' : 'Review unstake'}
          </Button>
          <p className="mt-2 text-center text-[11.5px] text-ink-muted">
            Simulated before signing · no wallet fee · unused gas is refunded
          </p>
        </div>
      </main>
    </PhoneFrame>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span className="tabular font-semibold text-ink">{value}</span>
    </div>
  );
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  return `1 tsTON ≈ ${rate.toFixed(4)} TON`;
}
