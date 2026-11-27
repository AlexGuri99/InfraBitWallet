/**
 * Self-hosted Terms of Use and Privacy Policy (no external links: strict CSP stays `'self'`).
 *
 * Written to state the facts plainly: non-custodial keys, irreversible seed loss, third-party
 * DeFi protocol risk, the transparent 0.35% swap fee, and that there are no ad/tracker SDKs.
 */
import { useState } from 'react';
import { t } from '../i18n';
import { Sheet } from './common';

export type LegalKind = 'terms' | 'privacy';

const TERMS: ReadonlyArray<string> = [
  'InfraBitWallet is a self-custodial wallet. We never receive, see or store your recovery phrase, private keys or funds. Everything is generated and used on your device.',
  'You alone control your wallet. If you lose your recovery phrase, your funds are permanently lost — nobody, including us, can restore them. Back it up offline on paper.',
  'Swaps are executed by third-party DeFi protocols (STON.fi on TON). Those smart contracts carry their own risk (bugs, exploits, liquidity loss). Staking through Tonstakers likewise exposes your funds to that protocol. Only use what you can afford to lose.',
  'A 0.35% fee is charged on swaps and shown as a line item before you sign. Staking has no wallet fee. Network fees are paid to the network, not to us.',
  'The app is provided “as is”, without warranties. You are responsible for complying with the laws of your jurisdiction.',
];

const PRIVACY: ReadonlyArray<string> = [
  'Keys and recovery phrases never leave your device and are never sent to our servers or any third party. The vault is stored locally as passcode-wrapped ciphertext.',
  'Our API only receives the wallet addresses you ask us to look up and, when authentication is required, the Telegram-signed initData needed to verify the request. We do not sell or share this data.',
  'There are zero third-party advertising or tracking SDKs in the app. No analytics, crash-reporting or fingerprinting libraries are bundled. The only storage used is your device-local preferences and encrypted vault.',
  'Swaps and staking send your signed transaction to the network; the on-chain data of that transaction is public by nature.',
  'Local app data can be cleared by Telegram or your operating system. Your recovery phrase is the only backup.',
];

function Paragraphs({ items }: { items: ReadonlyArray<string> }) {
  return (
    <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-2">
      {items.map((item) => (
        <p key={item.slice(0, 24)}>{item}</p>
      ))}
    </div>
  );
}

export function LegalSheet({ kind, onClose }: { kind: LegalKind; onClose: () => void }) {
  return (
    <Sheet title={kind === 'terms' ? 'Terms of Use' : 'Privacy Policy'} onClose={onClose}>
      <Paragraphs items={kind === 'terms' ? TERMS : PRIVACY} />
      <p className="px-1 text-[11.5px] text-ink-muted">{t('welcome.never.ask')}</p>
    </Sheet>
  );
}

/** Two inline links that open the legal sheets locally. */
export function LegalLinks({ align = 'center' }: { align?: 'center' | 'start' }) {
  const [open, setOpen] = useState<LegalKind | null>(null);
  const row = align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <>
      <div className={`flex items-center gap-3 ${row}`}>
        <button
          type="button"
          onClick={() => {
            setOpen('terms');
          }}
          className="pressable rounded-full px-2 py-1 text-[12px] font-semibold text-accent-link underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
        >
          Terms of Use
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen('privacy');
          }}
          className="pressable rounded-full px-2 py-1 text-[12px] font-semibold text-accent-link underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)]"
        >
          Privacy Policy
        </button>
      </div>
      {open ? (
        <LegalSheet
          kind={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}
