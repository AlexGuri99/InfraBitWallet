/**
 * Send screen (DESIGN.md §5.3) with the live P2b TON flow.
 *
 * form -> signed BoC review + emulation -> broadcast -> submitted. The review renders ONLY the
 * decoded signed BoC and the emulation result, so what is shown is exactly what will be
 * broadcast. Signing happens through the vault session (`signDigest`); no private key ever
 * reaches this component. Sell is a designed shell with a disabled CTA.
 */
import { useMemo, useState } from 'react';
import type { PublicAccountInfo, VaultManager } from '@onezerowallet/crypto-vault';
import {
  addressRequiresBounce,
  buildJettonTransfer,
  buildTonTransfer,
  formatDecimal,
  formatDecimalShort,
  formatUsd,
  isProbablyTonAddress,
  maxTonAmountRaw,
  parseDecimal,
  SEND_MODE_MAX,
  toTestnetDisplayAddress,
  type BuiltTransfer,
  type DecodedSignedTransfer,
  type TonAssetBalance,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import { t } from '../i18n';
import type { EmulationPayload, TonReadApi, TonWriteApi } from '../ton/api';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Notice,
  PhoneFrame,
  PhraseInput,
  ScreenHeader,
  Segmented,
} from './common';
import { useToast } from './toast';
import { TokenAvatar } from './common';

const MAX_COMMENT = 120;

export interface SendPrefill {
  assetId?: string | undefined;
  recipient?: string | undefined;
}

type Step =
  | { kind: 'form' }
  | {
      kind: 'review';
      built: BuiltTransfer;
      decoded: DecodedSignedTransfer;
      emulation: EmulationPayload;
      /** Symbol/decimals frozen at review time so later asset changes can't alter the display. */
      symbol: string;
      decimals: number;
    }
  | {
      kind: 'sent';
      hashHex: string;
      decoded: DecodedSignedTransfer;
      symbol: string;
      decimals: number;
    };

function amountFor(asset: TonAssetBalance, value: string): bigint | null {
  return parseDecimal(value, asset.decimals);
}

function usdFor(value: string, price: number | null): number | null {
  if (price === null) return null;
  const parsed = Number.parseFloat(value || '0');
  return Number.isFinite(parsed) ? parsed * price : null;
}

export function SendScreen({
  manager,
  info,
  portfolio,
  api,
  prefill,
  onBack,
  onSubmitted,
}: {
  manager: VaultManager;
  info: PublicAccountInfo;
  portfolio: TonPortfolio;
  api: TonReadApi & TonWriteApi;
  prefill?: SendPrefill | undefined;
  onBack: () => void;
  onSubmitted: (
    decoded: DecodedSignedTransfer,
    asset: { symbol: string; decimals: number },
  ) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'send' | 'sell'>('send');
  const assets = portfolio.assets.filter(
    (asset) => asset.standard === 'native' || asset.jettonWalletAddress !== undefined,
  );
  const initialAsset = prefill?.assetId
    ? (assets.find((entry) => entry.id === prefill.assetId)?.id ?? assets[0]?.id ?? 'ton')
    : (assets[0]?.id ?? 'ton');
  const [assetId, setAssetId] = useState(initialAsset);
  const [recipient, setRecipient] = useState(prefill?.recipient ?? '');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const asset = useMemo(
    () => assets.find((entry) => entry.id === assetId) ?? assets[0],
    [assets, assetId],
  );
  const nativeAsset = assets.find((entry) => entry.standard === 'native');
  const usdValue = asset && asset.standard === 'native' ? usdFor(amount, portfolio.priceUsd) : null;

  const validate = (): string | null => {
    if (!asset) return 'No asset selected';
    if (!isProbablyTonAddress(recipient.trim())) return 'Enter a valid TON address';
    if (/^[EU]Q/.test(recipient.trim())) {
      return 'Mainnet-only address. Testnet mode accepts 0Q, kQ or a raw 0: address.';
    }
    const raw = amountFor(asset, amount.trim());
    if (raw === null || raw <= 0n) return 'Enter a positive amount';
    if (asset.standard === 'native') {
      const max = BigInt(maxTonAmountRaw(asset.balanceRaw));
      if (raw > max) return 'Amount exceeds balance minus network fee buffer';
    } else if (raw > BigInt(asset.balanceRaw)) {
      return 'Amount exceeds balance';
    }
    if (comment.length > MAX_COMMENT) return `Comment is limited to ${String(MAX_COMMENT)} chars`;
    return null;
  };

  const maxAmount = (): void => {
    if (!asset) return;
    if (asset.standard === 'native') {
      setAmount(formatDecimalShort(maxTonAmountRaw(asset.balanceRaw), asset.decimals, 9));
    } else {
      setAmount(asset.balance);
    }
  };

  const review = async (): Promise<void> => {
    if (!asset || busy) return;
    const invalid = validate();
    if (invalid) {
      setError(invalid);
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
      const state = await api.getWalletState(info.ton.addressTestnetNonBounceable, 'testnet');
      if (state.status === 'active' && state.seqno === 0) {
        setError('Could not read the wallet seqno. Retry before sending.');
        return;
      }
      const rawAmount = amountFor(asset, amount.trim());
      if (rawAmount === null) return;
      const sign = (digest: Uint8Array): Promise<Uint8Array> => {
        const signed = session.signDigest('ton', 0, digest);
        if (!signed.ok) return Promise.reject(new Error(signed.error));
        return Promise.resolve(signed.signature);
      };
      const destination = recipient.trim();
      const isNative = asset.standard === 'native';
      const built = isNative
        ? await buildTonTransfer(
            {
              publicKeyHex: info.ton.publicKeyHex,
              network: 'testnet',
              seqno: state.seqno,
              destination,
              amountRaw: rawAmount,
              bounce: addressRequiresBounce(destination),
              ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
              deploy: state.status === 'uninit',
              ...(nativeAsset && rawAmount === BigInt(maxTonAmountRaw(nativeAsset.balanceRaw))
                ? { sendMode: SEND_MODE_MAX }
                : {}),
            },
            sign,
          )
        : await buildJettonTransfer(
            {
              publicKeyHex: info.ton.publicKeyHex,
              network: 'testnet',
              seqno: state.seqno,
              jettonWallet: asset.jettonWalletAddress ?? '',
              destination,
              amountRaw: rawAmount,
              ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
              deploy: state.status === 'uninit',
            },
            sign,
          );
      const decoded = built.decoded;
      const emulation = await api.emulate(built.boc, 'testnet');
      setStep({
        kind: 'review',
        built,
        decoded,
        emulation,
        symbol: asset.symbol,
        decimals: asset.decimals,
      });
    } catch {
      setError('Could not build or emulate the transfer. Nothing was sent.');
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
      onSubmitted(step.decoded, { symbol: step.symbol, decimals: step.decimals });
      setStep({
        kind: 'sent',
        hashHex: result.messageHash.hex,
        decoded: step.decoded,
        symbol: step.symbol,
        decimals: step.decimals,
      });
      toast.show(t('send.submitted'));
    } catch {
      setError('Broadcast failed. The transfer may not have been submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'sent') {
    return (
      <PhoneFrame>
        <ScreenHeader title={t('send.submitted')} onBack={onBack} />
        <main className="flex flex-1 flex-col items-center gap-4 px-5 pt-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-positive-bg text-[26px] font-bold text-positive">
            ✓
          </div>
          <p className="text-center text-[13px] leading-relaxed text-ink-2">
            {t('send.submittedBody')}
          </p>
          <Card className="w-full p-4 text-center">
            <p className="tabular text-[22px] font-extrabold tracking-[-0.02em] text-ink">
              {formatDecimal(step.decoded.amountRaw, step.decimals)} {step.symbol}
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
    const { decoded, emulation } = step;
    const fatal = !emulation.ok;
    return (
      <PhoneFrame>
        <ScreenHeader
          title={t('send.review')}
          onBack={() => {
            setStep({ kind: 'form' });
          }}
        />
        <main className="flex flex-1 flex-col gap-4 px-4 pb-10">
          <Card className="flex flex-col gap-3 p-4">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                {t('send.recipient')}
              </p>
              <code className="mt-1 block break-all font-mono text-[12.5px] text-ink">
                {toTestnetDisplayAddress(decoded.recipient, decoded.bounce)}
              </code>
            </div>
            <div className="h-px bg-hairline" />
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                {t('send.amount')}
              </p>
              <p className="tabular mt-1 text-[15px] font-semibold text-ink">
                {formatDecimal(decoded.amountRaw, step.decimals)} {step.symbol}
              </p>
            </div>
            {decoded.comment ? (
              <>
                <div className="h-px bg-hairline" />
                <div>
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                    {t('send.comment')}
                  </p>
                  <p className="mt-1 text-[13px] text-ink">{decoded.comment}</p>
                </div>
              </>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink-2">Network fee (est.)</span>
              <span className="tabular text-[13px] font-semibold text-ink">
                ~{formatDecimalShort(emulation.estimatedFeeRaw, 9, 6)} TON
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink-2">Seqno</span>
              <span className="tabular text-[13px] font-semibold text-ink">{decoded.seqno}</span>
            </div>
            {decoded.hasStateInit ? (
              <span className="mt-1 w-fit rounded-full bg-swap-bg px-2.5 py-1 text-[11.5px] font-semibold text-swap">
                {t('send.deployBadge')}
              </span>
            ) : null}
            {emulation.balanceChanges.map((change) => (
              <div key={change.assetId} className="flex items-center justify-between">
                <span className="text-[13px] text-ink-2">{change.symbol} change</span>
                <span className="tabular text-[13px] font-semibold text-ink">
                  {formatDecimalShort(change.deltaRaw, change.decimals, 6)}
                </span>
              </div>
            ))}
          </Card>

          {emulation.warnings.length > 0 ? (
            <Notice tone="warning">{emulation.warnings.join(' · ')}</Notice>
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
              {busy ? t('common.working') : t('send.confirm')}
            </Button>
          </div>
        </main>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <ScreenHeader
        title={mode === 'send' ? t('send.title') : t('send.sellTitle')}
        onBack={onBack}
      />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-10">
        <Segmented
          label="Send or sell"
          value={mode}
          options={[
            { value: 'send', label: t('send.modeSend') },
            { value: 'sell', label: t('send.modeSell') },
          ]}
          onChange={setMode}
        />

        {mode === 'sell' ? (
          <SellShell />
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="send-asset" className="px-1 text-[12.5px] font-semibold text-ink-2">
                {t('send.asset')}
              </label>
              <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-3 py-2">
                <TokenAvatar symbol={asset?.symbol ?? 'TON'} size={40} />
                <select
                  id="send-asset"
                  className="min-h-10 flex-1 bg-transparent text-[15px] font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
                  value={assetId}
                  onChange={(event) => {
                    setAssetId(event.target.value);
                    setAmount('');
                    setError(null);
                  }}
                >
                  {assets.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.symbol} — {entry.balance}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Field
              id="send-recipient"
              label={t('send.recipient')}
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder="0Q… / kQ… / 0:…"
            />

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-1">
                <label htmlFor="send-amount" className="text-[12.5px] font-semibold text-ink-2">
                  {t('send.amount')}
                </label>
                <button
                  type="button"
                  onClick={maxAmount}
                  className="pressable rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-bold text-accent-link focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
                >
                  {t('send.max')}
                </button>
              </div>
              <input
                id="send-amount"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                }}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                className="tabular min-h-16 w-full rounded-2xl border border-hairline bg-surface px-4 font-mono text-[22px] font-semibold text-ink placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
              />
              <p className="px-1 text-[12px] text-ink-muted">
                {usdValue === null
                  ? `${asset?.balance ?? '—'} ${asset?.symbol ?? ''} available`
                  : `≈ ${formatUsd(usdValue)}`}
              </p>
            </div>

            <PhraseInput
              id="send-comment"
              label={t('send.comment')}
              hint={`${String(comment.length)}/${String(MAX_COMMENT)}`}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value.slice(0, MAX_COMMENT));
              }}
            />

            {error ? <ErrorText>{error}</ErrorText> : null}

            <div className="mt-auto flex flex-col gap-2.5 pt-2">
              <Button onClick={() => void review()} disabled={busy || !asset}>
                {busy ? t('common.working') : t('send.reviewAction')}
              </Button>
              <p className="text-center text-[11.5px] text-ink-muted">{t('home.notice')}</p>
            </div>
          </>
        )}
      </main>
    </PhoneFrame>
  );
}

function SellShell() {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  return (
    <>
      <div className="rounded-[24px] bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-ink-2">You Sell</span>
          <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-ink-2">
            TON
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            aria-label="Sell amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            placeholder="0.0"
            className="tabular min-w-0 flex-1 bg-transparent font-mono text-[26px] font-bold text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              toast.show('Payout — coming soon');
            }}
            className="pressable rounded-full bg-surface-secondary px-3 py-1.5 text-[11.5px] font-bold text-accent-link"
          >
            Max
          </button>
        </div>
      </div>

      <div className="rounded-[24px] bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-ink-2">Payout</span>
          <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-[11.5px] font-semibold text-ink-2">
            Bank transfer
          </span>
        </div>
        <p className="mt-3 text-[22px] font-extrabold tracking-[-0.02em] text-ink-muted">—</p>
        <p className="mt-1 text-[12px] text-ink-muted">
          A licensed off-ramp provider will be added in a later phase.
        </p>
      </div>

      <div className="mt-auto pt-2">
        <Button disabled>Coming soon</Button>
      </div>
    </>
  );
}
