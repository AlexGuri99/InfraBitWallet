/**
 * Deposit (`Fund`) screen (DESIGN.md §5.3). v1 is a focused TON wallet: this screen shows the
 * TON receive address and QR ONLY. TRON/EVM deposit surfaces were removed on purpose — showing
 * an address for a chain the app cannot spend from is a fund-loss trap.
 * Purchase rows are clean non-functional shells — they never pretend to move money.
 */
import { useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { QrCode } from './qr';
import { useToast } from './toast';
import { Button, Card, PhoneFrame, ScreenHeader, TokenAvatar } from './common';
import { ChevronRightIcon, CopyIcon, GlobeIcon, PlusIcon, WalletIcon } from './icons';

export function DepositScreen({ tonAddress, onBack }: { tonAddress: string; onBack: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const address = tonAddress;

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
        <Card className="flex flex-col items-center gap-3 p-5 shadow-card">
          <div className="rounded-[24px] bg-white p-3">
            <QrCode value={address} size={200} label="QR code for TON address" />
          </div>
          <p className="text-center text-[12px] text-ink-muted">{t('receive.tonHint')}</p>
          <code
            data-testid="address-TON"
            className="w-full break-all rounded-2xl bg-surface-secondary px-3 py-2.5 text-center font-mono text-[11.5px] leading-relaxed text-ink-2"
          >
            {address}
          </code>
          <Button variant="secondary" onClick={() => void copy()}>
            <CopyIcon size={16} />
            {copied ? t('home.copied') : t('home.copyTon')}
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
          <TokenAvatar symbol="TON" size={40} />
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
