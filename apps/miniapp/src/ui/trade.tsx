/**
 * Trade screen — live STON.fi DEX v2 swap (DESIGN.md §5.3).
 *
 * Flow: form → debounced same-origin quote → build the swap message with @onezerowallet/swap-ton
 * → sign through the vault closure (V5R1) → decode the signed BoC → emulate (fail-closed) →
 * broadcast → Pending activity. The review renders the decoded payload and the emulation result,
 * never the form state. Nothing here talks to STON.fi directly (CSP `connect-src 'self'`).
 */
import { useEffect, useState } from 'react';
import type { PublicAccountInfo, VaultManager } from '@onezerowallet/crypto-vault';
import {
  buildSwapTransfer,
  formatDecimal,
  formatDecimalShort,
  formatUsd,
  maxTonAmountRaw,
  parseDecimal,
  type TonNetwork,
  tonAddressEquals,
  type BuiltTransfer,
  type DecodedSignedTransfer,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import {
  buildSwapPayload,
  decodeSwapPayload,
  SLIPPAGE_PRESETS_BPS,
  type DecodedSwapPayload,
} from '@onezerowallet/swap-ton';
import { t } from '../i18n';
import type {
  EmulationPayload,
  SwapAssetPayload,
  SwapQuotePayload,
  TonReadApi,
  TonSwapApi,
  TonWriteApi,
} from '../ton/api';
import {
  Button,
  Card,
  ErrorText,
  Notice,
  PhoneFrame,
  ScreenHeader,
  Segmented,
  TokenAvatar,
} from './common';
import { ChevronDownIcon, SwapIcon } from './icons';
import { useToast } from './toast';
import { activeTonAddress, displayTonAddress, explorerHost, explorerMessageUrl } from './network';

/** Reserved nanoTON for the swap's attached value while using Max on the native side. */
const NATIVE_SWAP_GAS_RESERVE_RAW = 400_000_000n;
const QUOTE_DEBOUNCE_MS = 450;

type SwapApi = TonReadApi & TonWriteApi & TonSwapApi;

type AssetsState =
  { kind: 'loading' } | { kind: 'ready'; assets: SwapAssetPayload[] } | { kind: 'unavailable' };

type QuoteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; quote: SwapQuotePayload }
  | { kind: 'error' };

type Step =
  | { kind: 'form' }
  | {
      kind: 'review';
      quote: SwapQuotePayload;
      built: BuiltTransfer;
      decoded: DecodedSignedTransfer;
      swap: DecodedSwapPayload;
      emulation: EmulationPayload;
      offer: SwapAssetPayload;
      ask: SwapAssetPayload;
    }
  | { kind: 'sent'; hashHex: string; offer: SwapAssetPayload; amountRaw: string };

function balanceFor(portfolio: TonPortfolio, asset: SwapAssetPayload): string | null {
  const match = portfolio.assets.find((entry) =>
    asset.kind === 'native'
      ? entry.standard === 'native'
      : tonAddressEquals(entry.id, asset.contractAddress),
  );
  return match ? match.balanceRaw : null;
}

function jettonWalletFor(portfolio: TonPortfolio, asset: SwapAssetPayload): string | undefined {
  if (asset.kind !== 'jetton') return undefined;
  return portfolio.assets.find((entry) => tonAddressEquals(entry.id, asset.contractAddress))
    ?.jettonWalletAddress;
}

export function TradeScreen({
  manager,
  info,
  portfolio,
  api,
  network,
  onBack,
  onSubmitted,
}: {
  manager: VaultManager;
  info: PublicAccountInfo;
  portfolio: TonPortfolio;
  api: SwapApi;
  network: TonNetwork;
  onBack: () => void;
  onSubmitted: (
    decoded: DecodedSignedTransfer,
    asset: { symbol: string; decimals: number; amountRaw?: string | undefined },
  ) => void;
}) {
  const toast = useToast();
  const [assets, setAssets] = useState<AssetsState>({ kind: 'loading' });
  const [offerId, setOfferId] = useState('native');
  const [askId, setAskId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(100);
  const [quote, setQuote] = useState<QuoteState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'form' });

  useEffect(() => {
    let cancelled = false;
    api
      .getSwapAssets(network)
      .then((list) => {
        if (cancelled) return;
        if (list.length === 0) {
          setAssets({ kind: 'unavailable' });
          return;
        }
        setAssets({ kind: 'ready', assets: list });
        const firstJetton = list.find((asset) => asset.kind === 'jetton');
        setAskId((current) => current ?? firstJetton?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setAssets({ kind: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, network]);

  const list = assets.kind === 'ready' ? assets.assets : [];
  const offer = list.find((asset) => asset.id === offerId) ?? list.find((a) => a.kind === 'native');
  const ask =
    (askId !== null ? list.find((asset) => asset.id === askId) : undefined) ??
    list.find((asset) => asset.kind === 'jetton');

  const offerBalanceRaw = offer ? balanceFor(portfolio, offer) : null;
  const offerBalance =
    offer && offerBalanceRaw !== null ? formatDecimal(offerBalanceRaw, offer.decimals) : null;
  const offerUsd =
    offer?.kind === 'native' && portfolio.priceUsd !== null
      ? (Number.parseFloat(amount || '0') || 0) * portfolio.priceUsd
      : null;

  useEffect(() => {
    if (!offer || !ask || offer.id === ask.id) {
      setQuote({ kind: 'idle' });
      return;
    }
    const units = parseDecimal(amount.trim(), offer.decimals);
    if (units === null || units <= 0n) {
      setQuote({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setQuote({ kind: 'loading' });
      const offerJettonWallet = jettonWalletFor(portfolio, offer);
      api
        .getSwapQuote({
          network,
          offerAsset: offer.contractAddress,
          askAsset: ask.contractAddress,
          offerKind: offer.kind,
          askKind: ask.kind,
          offerUnits: units.toString(),
          slippageBps,
          userAddress: activeTonAddress(info.ton, network),
          ...(offerJettonWallet ? { offerJettonWallet } : {}),
        })
        .then((value) => {
          if (!cancelled) setQuote({ kind: 'ready', quote: value });
        })
        .catch(() => {
          if (!cancelled) setQuote({ kind: 'error' });
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, amount, offer, ask, slippageBps, portfolio, info, network]);

  const setMax = (): void => {
    if (!offer || offerBalanceRaw === null) return;
    if (offer.kind === 'native') {
      setAmount(
        formatDecimalShort(
          maxTonAmountRaw(offerBalanceRaw, NATIVE_SWAP_GAS_RESERVE_RAW),
          offer.decimals,
          offer.decimals,
        ),
      );
    } else {
      setAmount(formatDecimal(offerBalanceRaw, offer.decimals));
    }
  };

  const flip = (): void => {
    if (!offer || !ask) return;
    setOfferId(ask.id);
    setAskId(offer.id);
    setAmount('');
    setQuote({ kind: 'idle' });
    setError(null);
  };

  const review = async (): Promise<void> => {
    if (!offer || !ask || quote.kind !== 'ready' || busy) return;
    const units = parseDecimal(amount.trim(), offer.decimals);
    if (units === null || units <= 0n) {
      setError('Enter a positive amount');
      return;
    }
    if (offerBalanceRaw === null || units > BigInt(offerBalanceRaw)) {
      setError('Amount exceeds balance');
      return;
    }
    const session = manager.getSession();
    if (!session) {
      setError('Session locked');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const state = await api.getWalletState(activeTonAddress(info.ton, network), network);
      if (state.status === 'active' && state.seqno === 0) {
        setError('Could not read the wallet seqno. Retry before swapping.');
        return;
      }
      const q = quote.quote;
      const offerJettonWallet = jettonWalletFor(portfolio, offer);
      const payload = await buildSwapPayload({
        router: q.router,
        direction: q.direction,
        userWalletAddress: activeTonAddress(info.ton, network),
        offer: {
          kind: offer.kind,
          ...(offer.kind === 'jetton' ? { address: offer.contractAddress } : {}),
          ...(offerJettonWallet ? { walletAddress: offerJettonWallet } : {}),
        },
        askJettonWalletAddress: q.askJettonWalletAddress,
        offerAmountRaw: q.offer.units,
        minAskAmountRaw: q.minReceivedRaw,
        ...(q.referralAddress ? { referralAddress: q.referralAddress } : {}),
      });
      const sign = (digest: Uint8Array): Promise<Uint8Array> => {
        const signed = session.signDigest('ton', 0, digest);
        if (!signed.ok) return Promise.reject(new Error(signed.error));
        return Promise.resolve(signed.signature);
      };
      const built = await buildSwapTransfer(
        {
          publicKeyHex: info.ton.publicKeyHex,
          network,
          seqno: state.seqno,
          to: payload.to,
          valueRaw: payload.valueRaw,
          bodyBoc: payload.bodyBoc,
          deploy: state.status === 'uninit',
        },
        sign,
      );
      const swap = decodeSwapPayload(payload.bodyBoc, q.direction);
      const emulation = await api.emulate(built.boc, network);
      setStep({
        kind: 'review',
        quote: q,
        built,
        decoded: built.decoded,
        swap,
        emulation,
        offer,
        ask,
      });
    } catch {
      setError('Could not build or emulate the swap. Nothing was sent.');
    } finally {
      setBusy(false);
    }
  };

  const broadcast = async (): Promise<void> => {
    if (step.kind !== 'review' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.broadcast(step.built.boc, network);
      onSubmitted(step.decoded, {
        symbol: step.offer.symbol,
        decimals: step.offer.decimals,
        amountRaw: step.swap.offerAmountRaw,
      });
      setStep({
        kind: 'sent',
        hashHex: result.messageHash.hex,
        offer: step.offer,
        amountRaw: step.swap.offerAmountRaw,
      });
      toast.show(t('send.submitted'));
    } catch {
      setError('Broadcast failed. The swap may not have been submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'sent') {
    return (
      <PhoneFrame>
        <ScreenHeader title="Swap submitted" onBack={onBack} />
        <main className="flex flex-1 flex-col items-center gap-4 px-5 pt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-positive-bg text-[26px] font-bold text-positive">
            ✓
          </div>
          <p className="text-center text-[13px] leading-relaxed text-ink-2">
            {t('send.submittedBody')}
          </p>
          <Card className="w-full p-4 text-center">
            <p className="tabular text-[22px] font-extrabold tracking-[-0.02em] text-ink">
              {formatDecimal(step.amountRaw, step.offer.decimals)} {step.offer.symbol}
            </p>
            <a
              className="mt-2 block break-all text-[11.5px] font-medium text-accent-link underline"
              href={explorerMessageUrl(network, step.hashHex)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {explorerHost(network)}/message/{step.hashHex.slice(0, 16)}…
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
    return (
      <PhoneFrame>
        <ScreenHeader
          title="Review swap"
          onBack={() => {
            setStep({ kind: 'form' });
          }}
        />
        <main className="flex flex-1 flex-col gap-4 px-4 pb-10 pt-3">
          <Card className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                Router
              </p>
              <code className="mt-1 block break-all font-mono text-[12.5px] text-ink">
                {displayTonAddress(step.decoded.recipient, network, true)}
              </code>
            </div>
            <div className="h-px bg-hairline" />
            <Row
              label="You pay"
              value={`${formatDecimal(step.swap.offerAmountRaw, step.offer.decimals)} ${step.offer.symbol}`}
            />
            <Row
              label="Minimum received"
              value={`${formatDecimal(step.swap.minAskAmountRaw, step.ask.decimals)} ${step.ask.symbol}`}
            />
            <Row label="Slippage" value={`${(step.quote.slippageBps / 100).toFixed(2)}%`} />
            <Row label="Swap fee" value={`${(step.quote.feeBps / 100).toFixed(2)}%`} />
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
            <Row label="Price impact" value={formatImpact(step.quote.priceImpact)} />
            <Row
              label="Min. received (quoted)"
              value={`${formatDecimal(step.quote.minReceivedRaw, step.ask.decimals)} ${step.ask.symbol}`}
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
              {busy ? t('common.working') : 'Confirm & Swap'}
            </Button>
          </div>
        </main>
      </PhoneFrame>
    );
  }

  const unavailable = assets.kind === 'unavailable';
  const canReview = quote.kind === 'ready' && !unavailable && !busy;
  const quoteValue = quote.kind === 'ready' ? quote.quote : null;

  return (
    <PhoneFrame>
      <ScreenHeader title={t('trade.title')} onBack={onBack} />
      <main className="flex flex-1 flex-col gap-2 px-4 pb-10 pt-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">You Sell</span>
            <AssetSelect
              label="Sell asset"
              value={offer?.id ?? 'native'}
              assets={list}
              onChange={(id) => {
                setOfferId(id);
                setAmount('');
                setError(null);
              }}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              aria-label="You sell amount"
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
            {offerUsd === null
              ? `Balance ${offerBalance ?? '—'} ${offer?.symbol ?? ''}`
              : `≈ ${formatUsd(offerUsd)} · Balance ${offerBalance ?? '—'}`}
          </p>
        </Card>

        <div className="relative flex h-0 items-center justify-center">
          <button
            type="button"
            aria-label="Flip assets"
            onClick={flip}
            className="pressable absolute -top-5 flex h-10 w-10 items-center justify-center rounded-full bg-swap text-white shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
          >
            <SwapIcon size={18} />
          </button>
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">You Buy</span>
            <AssetSelect
              label="Buy asset"
              value={ask?.id ?? ''}
              assets={list}
              onChange={(id) => {
                setAskId(id);
                setError(null);
              }}
            />
          </div>
          <p className="tabular mt-3 text-[30px] font-extrabold tracking-[-0.02em] text-ink-muted">
            {quoteValue
              ? formatDecimalShort(quoteValue.ask.units, ask?.decimals ?? 9, 6)
              : quote.kind === 'loading'
                ? '…'
                : '0.0'}
          </p>
          <p className="mt-1 text-[12px] text-ink-muted">
            {quote.kind === 'error'
              ? 'No route for this pair or amount.'
              : 'Quoted by STON.fi DEX v2.'}
          </p>
        </Card>

        <Segmented
          label="Slippage tolerance"
          value={String(slippageBps)}
          options={SLIPPAGE_PRESETS_BPS.map((bps) => ({
            value: String(bps),
            label: `${(bps / 100).toFixed(1)}%`,
          }))}
          onChange={(value) => {
            setSlippageBps(Number.parseInt(value, 10));
          }}
        />

        {quoteValue ? (
          <Card className="flex flex-col gap-2 p-4 text-[13px]">
            <Row label="Rate" value={formatRate(quoteValue)} />
            <Row label="Price impact" value={formatImpact(quoteValue.priceImpact)} />
            <Row
              label="Minimum received"
              value={`${formatDecimalShort(quoteValue.minReceivedRaw, ask?.decimals ?? 9, 6)} ${ask?.symbol ?? ''}`}
            />
            <Row label="Network fee" value={`~${gasTon(quoteValue)} TON`} />
            <Row label="Swap fee" value={`${(quoteValue.feeBps / 100).toFixed(2)}%`} />
          </Card>
        ) : null}

        {unavailable ? (
          <Notice tone="warning">
            Swaps are unavailable on this network until a STON.fi quote endpoint is configured.
          </Notice>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="mt-auto pt-4">
          <Button onClick={() => void review()} disabled={!canReview}>
            {busy
              ? t('common.working')
              : quote.kind === 'loading'
                ? 'Getting quote…'
                : t('send.reviewAction')}
          </Button>
          <p className="mt-2 text-center text-[11.5px] text-ink-muted">
            Simulated before signing · 0.35% swap fee when configured
          </p>
        </div>
      </main>
    </PhoneFrame>
  );
}

function AssetSelect({
  label,
  value,
  assets,
  onChange,
}: {
  label: string;
  value: string;
  assets: SwapAssetPayload[];
  onChange: (id: string) => void;
}) {
  const asset = assets.find((entry) => entry.id === value);
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-surface-secondary pl-1.5 pr-2.5">
      <TokenAvatar symbol={asset?.symbol ?? 'TON'} size={20} />
      <select
        aria-label={label}
        className="min-h-8 max-w-[130px] appearance-none bg-transparent text-[12px] font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {assets.length === 0 ? (
          <option value={value}>{asset?.symbol ?? 'TON'}</option>
        ) : (
          assets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.symbol}
            </option>
          ))
        )}
      </select>
      <ChevronDownIcon size={13} className="text-ink-2" />
    </div>
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

function formatImpact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

function formatRate(quote: SwapQuotePayload): string {
  if (quote.swapRate === null || !Number.isFinite(quote.swapRate)) return '—';
  return quote.swapRate.toFixed(6);
}

function gasTon(quote: SwapQuotePayload): string {
  const raw = quote.gas.estimatedGasConsumption ?? quote.gas.gasBudget;
  return raw ? formatDecimalShort(raw, 9, 6) : '—';
}
