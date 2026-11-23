/**
 * View models and display helpers shared by the wallet screens.
 *
 * Values come straight from the same-origin read proxy; nothing here invents a price. Static
 * TRON/EVM rows render an em dash until the multichain read layer exists.
 */
import type { TonActivityItem, TonAssetBalance } from '@onezerowallet/chain-ton';

export type ChainKey = 'ton' | 'tron' | 'evm';

export interface AssetView {
  key: string;
  /** Stable id used for selection ('ton', jetton master, 'trx', 'eth'). */
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  standard: 'native' | 'jetton' | 'tron' | 'evm';
  balanceRaw: string;
  balance: string;
  usdValue: number | null;
  jettonWalletAddress?: string | undefined;
  chain: ChainKey;
  badge: string;
  /** False for chains whose balances are not wired yet. */
  live: boolean;
  testId: string;
}

export function tonAssetView(asset: TonAssetBalance, index: number): AssetView {
  const native = asset.standard === 'native';
  return {
    key: `${asset.id}-${String(index)}`,
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    standard: asset.standard,
    balanceRaw: asset.balanceRaw,
    balance: asset.balance,
    usdValue: asset.usdValue,
    jettonWalletAddress: asset.jettonWalletAddress,
    chain: 'ton',
    badge: native ? 'TON' : 'TON · Jetton',
    live: true,
    testId: native
      ? 'asset-TON'
      : `asset-${asset.symbol.toUpperCase()}${
          asset.symbol.toUpperCase() === 'USDT' ? '' : `-${String(index)}`
        }`,
  };
}

export function staticChainAssets(hasTron: boolean, hasEvm: boolean): AssetView[] {
  const rows: AssetView[] = [
    {
      key: 'trx',
      id: 'trx',
      symbol: 'TRX',
      name: 'TRON',
      decimals: 6,
      standard: 'tron',
      balanceRaw: '0',
      balance: '—',
      usdValue: null,
      chain: 'tron',
      badge: 'TRC-20',
      live: false,
      testId: 'asset-TRX',
    },
    {
      key: 'eth',
      id: 'eth',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      standard: 'evm',
      balanceRaw: '0',
      balance: '—',
      usdValue: null,
      chain: 'evm',
      badge: 'ERC-20',
      live: false,
      testId: 'asset-ETH',
    },
  ];
  return rows.filter((row) => (row.chain === 'tron' ? hasTron : hasEvm));
}

export function shortAddress(value: string, head = 4, tail = 4): string {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

export function hashToHex(hash: string): string {
  try {
    return Array.from(atob(hash))
      .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return hash;
  }
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function dateLabel(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
  });
}

export function fullTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export interface ActivityGroup {
  label: string;
  items: TonActivityItem[];
}

/** Most-recent-first grouping with a centred date label. */
export function groupActivity(items: TonActivityItem[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const item of items) {
    const label = dateLabel(item.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export type ActivityKind = 'in' | 'out' | 'swap' | 'bounce' | 'pending';

export function activityKind(item: TonActivityItem): ActivityKind {
  if (item.isBounce === true) return 'bounce';
  if (item.status === 'pending') return 'pending';
  if (item.direction === 'in') return 'in';
  return 'out';
}

export function activityStatusLabel(item: TonActivityItem): string {
  const kind = activityKind(item);
  if (kind === 'bounce') return 'Bounced';
  if (kind === 'pending') return 'Pending';
  if (kind === 'in') return 'Received';
  if (item.status === 'failed') return 'Failed';
  return 'Sent';
}

/** Splits a formatted amount into integer and fractional parts for the detail hero. */
export function splitAmount(value: string): { whole: string; fraction: string } {
  const clean = value.startsWith('-') ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = clean.split('.');
  return { whole, fraction: fraction.length > 0 ? `.${fraction}` : '' };
}
