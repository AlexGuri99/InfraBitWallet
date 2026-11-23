/**
 * Branded coin icons and monogram fallbacks.
 *
 * Only the coins this build actually supports are imported by name from `react-web3-icons`
 * (MIT, `sideEffects: false`), so Vite tree-shakes every other icon out of the bundle. Icons are
 * inline SVG — no remote image host, no `data:` URI, CSP stays `img-src 'self' data:`/`self`.
 *
 * Unknown dynamic jettons never fetch a remote logo: they render a deterministic tinted monogram
 * derived only from their symbol.
 */
import type { ComponentType } from 'react';
import { EthCircle, Ton, Trx, UsdtCircle } from 'react-web3-icons/coin';

type IconComponent = ComponentType<{
  size?: number | string;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

/** Every brand we ship today. Add an entry here only when the coin is supported. */
const KNOWN_ICONS: Record<string, IconComponent> = {
  TON: Ton,
  USDT: UsdtCircle,
  TRX: Trx,
  ETH: EthCircle,
};

/** Aliases that appear in the UI but resolve to a known coin brand. */
const ALIASES: Record<string, string> = {
  TONCOIN: 'TON',
  GRAM: 'TON',
  TRON: 'TRX',
  EVM: 'ETH',
  ETHEREUM: 'ETH',
  TETHER: 'USDT',
};

const MONOGRAM_TONES = [
  'bg-positive-bg text-positive',
  'bg-swap-bg text-swap',
  'bg-surface-elevated text-ink',
  'bg-hero text-hero-ink',
  'bg-surface-secondary text-ink-2',
] as const;

function normalize(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  return ALIASES[upper] ?? upper;
}

function monogramTone(symbol: string): string {
  let hash = 0;
  for (let index = 0; index < symbol.length; index++) {
    hash = (hash * 31 + symbol.charCodeAt(index)) >>> 0;
  }
  return MONOGRAM_TONES[hash % MONOGRAM_TONES.length] ?? MONOGRAM_TONES[0];
}

function monogramText(symbol: string): string {
  const cleaned = symbol.replace(/[^A-Za-z0-9]/g, '');
  return (cleaned.length > 0 ? cleaned : '?').slice(0, 2).toUpperCase();
}

export function CoinIcon({
  symbol,
  size = 40,
  className = '',
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const key = normalize(symbol);
  const Icon = KNOWN_ICONS[key];

  if (Icon) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-hairline ${className}`}
        style={{ width: size, height: size }}
      >
        <Icon size={size} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.02em] ${monogramTone(
        key,
      )} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
    >
      {monogramText(symbol)}
    </span>
  );
}
