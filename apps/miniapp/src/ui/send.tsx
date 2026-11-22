/**
 * 3-step TON Testnet send: form -> signed-BoC review + emulation -> submitted.
 *
 * The review renders ONLY the decoded signed BoC and the emulation result, so what is shown is
 * exactly what will be broadcast. Signing happens through the vault session (`signDigest`); no
 * private key ever reaches this component.
 */
import { useMemo, useState } from 'react';
import type { VaultManager, PublicAccountInfo } from '@onezerowallet/crypto-vault';
import {
  addressRequiresBounce,
  buildJettonTransfer,
  buildTonTransfer,
  formatDecimalShort,
  formatUsd,
  isProbablyTonAddress,
  maxTonAmountRaw,
  parseDecimal,
  SEND_MODE_MAX,
  type BuiltTransfer,
  type DecodedSignedTransfer,
  type TonAssetBalance,
  type TonPortfolio,
} from '@onezerowallet/chain-ton';
import { t } from '../i18n';
import type { EmulationPayload, TonReadApi, TonWriteApi } from '../ton/api';
import { Button, ErrorText, Field, Notice, PhraseInput, Sheet } from './common';

const MAX_COMMENT = 120;

type Step =
  | { kind: 'form' }
  | {
      kind: 'review';
      built: BuiltTransfer;
      decoded: DecodedSignedTransfer;
      emulation: EmulationPayload;
    }
  | { kind: 'sent'; hashHex: string; decoded: DecodedSignedTransfer };

function amountFor(asset: TonAssetBalance, value: string): bigint | null {
  return parseDecimal(value, asset.decimals);
}

export function SendSheet({
  manager,
  info,
  portfolio,
  api,
  onClose,
  onSubmitted,
}: {
  manager: VaultManager;
  info: PublicAccountInfo;
  portfolio: TonPortfolio;
  api: TonReadApi & TonWriteApi;
  onClose: () => void;
  onSubmitted: (
    decoded: DecodedSignedTransfer,
    asset: { symbol: string; decimals: number },
  ) => void;
}) {
  const assets = portfolio.assets.filter(
    (asset) => asset.standard === 'native' || asset.jettonWalletAddress !== undefined,
  );
  const [assetId, setAssetId] = useState(assets[0]?.id ?? 'ton');
  const [recipient, setRecipient] = useState('');
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
  const usdValue =
    asset && asset.standard === 'native' && portfolio.priceUsd !== null
      ? Number.parseFloat(amount || '0') * portfolio.priceUsd
      : null;

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
              comment: comment.trim() === '' ? undefined : comment.trim(),
              deploy: state.status === 'uninit',
              sendMode:
                nativeAsset && rawAmount === BigInt(maxTonAmountRaw(nativeAsset.balanceRaw))
                  ? SEND_MODE_MAX
                  : undefined,
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
              comment: comment.trim() === '' ? undefined : comment.trim(),
              deploy: state.status === 'uninit',
            },
            sign,
          );
      const decoded = built.decoded;
      const emulation = await api.emulate(built.boc, 'testnet');
      setStep({ kind: 'review', built, decoded, emulation });
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
      const reviewAsset = assets.find((entry) => entry.id === assetId);
      onSubmitted(step.decoded, {
        symbol: reviewAsset?.symbol ?? (step.decoded.asset.type === 'ton' ? 'TON' : 'JETTON'),
        decimals: reviewAsset?.decimals ?? 9,
      });
      setStep({ kind: 'sent', hashHex: result.messageHash.hex, decoded: step.decoded });
    } catch {
      setError('Broadcast failed. The transfer may not have been submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'sent') {
    return (
      <Sheet title={t('send.submitted')} onClose={onClose}>
        <p className="text-sm">{t('send.submittedBody')}</p>
        <p className="text-sm font-semibold">
          {step.decoded.amountRaw} {step.decoded.asset.type === 'ton' ? 'TON' : 'JETTON'}
        </p>
        <a
          className="underline text-blue-600 dark:text-blue-300 break-all text-xs"
          href={`https://testnet.tonviewer.com/message/${step.hashHex}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          testnet.tonviewer.com/message/{step.hashHex.slice(0, 16)}…
        </a>
        <Button onClick={onClose}>{t('home.close')}</Button>
      </Sheet>
    );
  }

  if (step.kind === 'review') {
    const { decoded, emulation } = step;
    const fatal = !emulation.ok;
    return (
      <Sheet title={t('send.review')} onClose={onClose}>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-xs opacity-70">{t('send.recipient')}</span>
          <code className="break-all text-xs">{decoded.recipient}</code>
          <span>
            {t('send.amount')}: <strong>{decoded.amountRaw}</strong>{' '}
            {decoded.asset.type === 'ton' ? 'TON (raw)' : 'JETTON (raw)'}
          </span>
          {decoded.comment ? (
            <span>
              {t('send.comment')}: {decoded.comment}
            </span>
          ) : null}
          {decoded.hasStateInit ? (
            <span className="rounded-full bg-blue-500/15 px-2 py-1 text-xs w-fit">
              {t('send.deployBadge')}
            </span>
          ) : null}
          <span className="text-xs opacity-70">
            Fee: {formatDecimalShort(emulation.estimatedFeeRaw, 9, 6)} TON · seqno {decoded.seqno}
          </span>
          {emulation.balanceChanges.map((change) => (
            <span key={change.assetId} className="text-xs">
              {change.symbol} change: {formatDecimalShort(change.deltaRaw, change.decimals, 6)}
            </span>
          ))}
          {emulation.warnings.length > 0 ? (
            <Notice tone="warning">{emulation.warnings.join(' · ')}</Notice>
          ) : null}
          {fatal ? <ErrorText>{t('send.emulationFailed')}</ErrorText> : null}
        </div>
        {error ? <ErrorText>{error}</ErrorText> : null}
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
      </Sheet>
    );
  }

  return (
    <Sheet title={t('send.title')} onClose={onClose}>
      <label className="text-sm font-medium" htmlFor="send-asset">
        {t('send.asset')}
      </label>
      <select
        id="send-asset"
        className="min-h-11 rounded-lg border border-gray-400/60 bg-transparent px-3 py-2"
        value={assetId}
        onChange={(event) => {
          setAssetId(event.target.value);
          setAmount('');
        }}
      >
        {assets.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.symbol} — {entry.balance}
          </option>
        ))}
      </select>

      <Field
        id="send-recipient"
        label={t('send.recipient')}
        value={recipient}
        onChange={(event) => {
          setRecipient(event.target.value);
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder="0Q… / kQ… / 0:…"
      />
      <Field
        id="send-amount"
        label={t('send.amount')}
        value={amount}
        onChange={(event) => {
          setAmount(event.target.value);
        }}
        inputMode="decimal"
        autoComplete="off"
        hint={usdValue === null ? undefined : `≈ ${formatUsd(usdValue)}`}
      />
      <Button
        variant="secondary"
        onClick={() => {
          maxAmount();
        }}
        className="w-auto self-start px-3 min-h-9 text-sm"
      >
        {t('send.max')}
      </Button>
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
      <Button onClick={() => void review()} disabled={busy}>
        {busy ? t('common.working') : t('send.reviewAction')}
      </Button>
      <Notice>{t('home.willNeverAsk')}</Notice>
    </Sheet>
  );
}
