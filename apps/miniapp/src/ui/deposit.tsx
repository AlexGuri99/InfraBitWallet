/**
 * Deposit (`Fund`) screen (DESIGN.md §5.3). Live TON receive address + inline QR; multichain
 * addresses appear only when the account actually derives them. Purchase rows are clean
 * non-functional shells — they never pretend to move money.
 */
import { useState, type ReactNode } from 'react';
import type { PublicAccountInfo } from '@onezerowallet/crypto-vault';
import { t } from '../i18n';
import { QrCode } from './qr';
import { useToast } from './toast';
import { Button, Card, PhoneFrame, ScreenHeader, TokenAvatar } from './common';
import { ChevronRightIcon, CopyIcon, GlobeIcon, PlusIcon, WalletIcon } from './icons';

type NetworkId = 'ton' | 'tron' | 'evm';

export function DepositScreen({
  info,
  tonAddress,
  onBack,
}: {
  info: PublicAccountInfo;
  tonAddress: string;
  onBack: () => void;
}) {
  const toast = useToast();
  const [network, setNetwork] = useState<NetworkId>('ton');
  const [copied, setCopied] = useState(false);

  const networks: Array<{ id: NetworkId; label: string; address: string }> = [
    { id: 'ton', label: 'TON', address: tonAddress },
    ...(info.tron ? [{ id: 'tron' as const, label: 'TRON', address: info.tron.address }] : []),
    ...(info.evm ? [{ id: 'evm' as const, label: 'EVM', address: info.evm.address }] : []),
  ];
  const extra = ['Solana', 'BNB', 'Base'];
  const selected = networks.find((entry) => entry.id === network) ?? networks[0];
  const address = selected?.address ?? tonAddress;
  const multichain = networks.length > 1;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.show(t('home.copied'));
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      toast.show(t('home.copyFailed'));
    }
  };

  const comingSoon = (label: string): void => {
    toast.show(`${label} — coming soon`);
  };

  return (
    <PhoneFrame>
      <ScreenHeader title={t('deposit.title')} onBack={onBack} />
      <main className="flex flex-1 flex-col gap-4 px-4 pb-10">
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
          {networks.map((entry) => {
            const active = entry.id === network;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setNetwork(entry.id);
                }}
                className={`pressable shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${
                  active ? 'bg-accent-primary text-accent-ink' : 'bg-surface text-ink-2 shadow-card'
                }`}
              >
                {entry.label}
              </button>
            );
          })}
          {multichain
            ? extra.map((label) => (
                <span
                  key={label}
                  aria-disabled="true"
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink-muted shadow-card"
                >
                  {label}
                  <span className="rounded-full bg-surface-elevated px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.02em]">
                    Soon
                  </span>
                </span>
              ))
            : null}
        </div>

        <Card className="flex flex-col items-center gap-3 p-5 shadow-card">
          <div className="rounded-[24px] bg-white p-3">
            <QrCode
              value={address}
              size={200}
              label={`QR code for ${selected?.label ?? 'TON'} address`}
            />
          </div>
          <p className="text-center text-[12px] text-ink-muted">
            {selected?.label === 'TON' ? t('receive.tonHint') : t('deposit.networkHint')}
          </p>
          <code
            data-testid={`address-${(selected?.label ?? 'TON').toUpperCase()}`}
            className="w-full break-all rounded-2xl bg-surface-secondary px-3 py-2.5 text-center font-mono text-[11.5px] leading-relaxed text-ink-2"
          >
            {address}
          </code>
          <Button variant="secondary" onClick={() => void copy()}>
            <CopyIcon size={16} />
            {copied ? t('home.copied') : `${t('home.copy')} ${selected?.label ?? ''} address`}
          </Button>
        </Card>

        <section aria-label="Ways to deposit">
          <Card>
            <DepositRow
              icon={<PlusIcon size={18} />}
              title="Buy with Card"
              subtitle="Card payment via a licensed provider"
              onClick={() => {
                comingSoon('Buy with Card');
              }}
            />
            <div className="ml-16 h-px bg-hairline" aria-hidden="true" />
            <DepositRow
              icon={<WalletIcon size={18} />}
              title="Buy with Crypto"
              subtitle="Transfer from another wallet"
              onClick={() => {
                comingSoon('Buy with Crypto');
              }}
            />
            <div className="ml-16 h-px bg-hairline" aria-hidden="true" />
            <DepositRow
              icon={<GlobeIcon size={18} />}
              title="Create Deposit Link"
              subtitle="Share a reusable payment link"
              onClick={() => {
                comingSoon('Create Deposit Link');
              }}
            />
          </Card>
        </section>

        <Card className="flex items-center gap-3 p-4">
          <TokenAvatar symbol={selected?.label ?? 'TON'} size={40} />
          <p className="flex-1 text-[12px] leading-relaxed text-ink-2">{t('deposit.sendOnly')}</p>
        </Card>
      </main>
    </PhoneFrame>
  );
}

function DepositRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable flex w-full items-center gap-3 px-4 py-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-link)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-secondary text-ink">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </span>
        <span className="block truncate text-[12.5px] text-ink-2">{subtitle}</span>
      </span>
      <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.02em] text-ink-muted">
        Coming soon
      </span>
      <ChevronRightIcon size={16} className="text-ink-muted" />
    </button>
  );
}
