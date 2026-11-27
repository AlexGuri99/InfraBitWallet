/**
 * Transaction Detail (DESIGN.md §5.5) — live data.
 *
 * Renders exactly the on-chain item: status, hero amount, full counterparty with a dimmed middle,
 * the 64-char hash with a network-appropriate explorer link, and a Repeat action that pre-fills Send.
 */
import type { TonActivityItem, TonNetwork } from '@onezerowallet/chain-ton';
import { t } from '../i18n';
import { activityKind, activityStatusLabel, fullTimestamp, hashToHex, splitAmount } from './asset';
import { usePreferences } from './preferences';
import { useToast } from './toast';
import { Button, Card, PhoneFrame, ScreenHeader } from './common';
import { CopyIcon } from './icons';
import { displayTonAddress, explorerHost, explorerTransactionUrl } from './network';

function AddressDisplay({ address }: { address: string }) {
  const head = address.slice(0, 6);
  const tail = address.slice(-6);
  const middle = address.length > 12 ? address.slice(6, -6) : '';
  return (
    <span className="break-all font-mono text-[12.5px] leading-relaxed">
      <span className="font-semibold text-ink">{head}</span>
      <span className="text-ink-muted">{middle}</span>
      <span className="font-semibold text-ink">{tail}</span>
    </span>
  );
}

function CopyLine({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            toast.show(t('home.copied'));
          })
          .catch(() => {
            toast.show(t('home.copyFailed'));
          });
      }}
      className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
    >
      <CopyIcon size={16} />
    </button>
  );
}

export function TxDetailScreen({
  item,
  network,
  onBack,
  onRepeat,
}: {
  item: TonActivityItem;
  network: TonNetwork;
  onBack: () => void;
  onRepeat: (item: TonActivityItem) => void;
}) {
  const { guard } = usePreferences();
  const toast = useToast();
  const kind = activityKind(item);
  const incoming = kind === 'in';
  const { whole, fraction } = splitAmount(item.amount);
  const hashHex = hashToHex(item.hash);
  const sign = incoming ? '+' : '-';
  // Pending items carry the raw address decoded from the signed BoC; show the same user-friendly
  // form (mainnet UQ/EQ vs testnet 0Q/kQ) as the Send Review screen so history and review agree.
  const counterparty = displayTonAddress(item.counterparty, network, true);

  return (
    <PhoneFrame>
      <ScreenHeader title={activityStatusLabel(item)} onBack={onBack} />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-10 pt-3">
        <div className="text-center">
          <p className="text-[12.5px] font-medium text-ink-2">{fullTimestamp(item.timestamp)}</p>
        </div>

        <div
          className={`flex flex-col items-center gap-2 rounded-[22px] px-4 py-6 text-center ${
            incoming ? 'bg-positive-bg' : 'bg-surface'
          }`}
        >
          <p className="text-[13px] font-semibold text-ink-2">
            {incoming ? 'Received' : 'Sent'} · {activityStatusLabel(item)}
          </p>
          <p className="tabular flex items-baseline justify-center gap-1">
            <span
              className={`text-[36px] font-extrabold leading-none tracking-[-0.03em] ${
                incoming ? 'text-positive' : 'text-ink'
              }`}
            >
              {sign}
              {guard(whole)}
            </span>
            <span className="text-[18px] font-bold tracking-[-0.01em] text-ink-2">
              {fraction} {item.symbol}
            </span>
          </p>
          <span className="rounded-full bg-surface-secondary px-3 py-1 text-[12px] font-semibold text-ink-2">
            {item.status === 'ok' ? 'Confirmed' : item.status === 'pending' ? 'Pending' : 'Failed'}
          </span>
        </div>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                {incoming ? t('tx.from') : t('tx.to')}
              </p>
              <p className="mt-1">
                <AddressDisplay address={counterparty} />
              </p>
            </div>
            <CopyLine value={counterparty} label={t('tx.copyAddress')} />
          </div>
          <div className="h-px bg-hairline" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                {t('tx.hash')}
              </p>
              <p className="mt-1 break-all font-mono text-[11.5px] leading-relaxed text-ink-muted">
                {hashHex}
              </p>
            </div>
            <CopyLine value={hashHex} label={t('tx.copyHash')} />
          </div>
          <a
            className="text-[12.5px] font-semibold text-accent-link underline"
            href={explorerTransactionUrl(network, hashHex)}
            target="_blank"
            rel="noreferrer noopener"
          >
            {explorerHost(network)}
          </a>
        </Card>

        <Card className="flex flex-col gap-2 p-4 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-ink-2">{t('tx.fee')}</span>
            <span className="tabular font-semibold text-ink">{guard(item.fee)} TON</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-ink-2">Network</span>
            <span className="font-semibold text-ink">
              {network === 'testnet' ? `TON ${t('home.testnet')}` : 'TON'}
            </span>
          </div>
          {item.comment ? (
            <>
              <div className="h-px bg-hairline" />
              <div>
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
                  Comment
                </p>
                <p className="mt-1 break-words text-[13px] text-ink">{item.comment}</p>
              </div>
            </>
          ) : null}
        </Card>

        <div className="mt-auto pt-4">
          {incoming ? (
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(explorerTransactionUrl(network, hashHex))
                  .then(() => {
                    toast.show(t('home.copied'));
                  })
                  .catch(() => {
                    toast.show(t('home.copyFailed'));
                  });
              }}
            >
              {t('tx.shareReceipt')}
            </Button>
          ) : (
            <Button
              onClick={() => {
                onRepeat(item);
              }}
            >
              {t('tx.repeat')}
            </Button>
          )}
        </div>
      </main>
    </PhoneFrame>
  );
}
