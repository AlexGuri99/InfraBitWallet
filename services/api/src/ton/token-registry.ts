/**
 * Token metadata registry. Native TON is fixed here; jettons get their metadata from the
 * provider and fall back to a neutral, clearly-unknown label. The native symbol is always
 * "TON" — never "GRAM" (B3 finding, docs/UNVERIFIED.md #2).
 */
import type { TonAssetBalance } from '@onezerowallet/chain-ton';
import { formatDecimal } from '@onezerowallet/chain-ton';
import type { TonApiJettonMeta } from './tonapi.js';

export const NATIVE_TON = {
  id: 'ton',
  symbol: 'TON',
  name: 'Toncoin',
  decimals: 9,
  standard: 'native',
} as const;

export function nativeAsset(balanceRaw: string, priceUsd: number | null): TonAssetBalance {
  const balance = formatDecimal(balanceRaw, NATIVE_TON.decimals);
  const numeric = Number.parseFloat(balance);
  return {
    id: NATIVE_TON.id,
    symbol: NATIVE_TON.symbol,
    name: NATIVE_TON.name,
    decimals: NATIVE_TON.decimals,
    standard: NATIVE_TON.standard,
    balanceRaw,
    balance,
    usdValue: priceUsd === null || !Number.isFinite(numeric) ? null : numeric * priceUsd,
  };
}

export function jettonAsset(
  master: string,
  balanceRaw: string,
  meta: TonApiJettonMeta | null,
): TonAssetBalance {
  const symbol = meta?.symbol ?? 'JETTON';
  const decimals = meta?.decimals ?? 9;
  return {
    id: master,
    symbol,
    name: meta?.name ?? 'Unknown jetton',
    decimals,
    standard: 'jetton',
    balanceRaw,
    balance: formatDecimal(balanceRaw, decimals),
    // Jetton USD prices are not part of the v1 registry; never guess "$1" for USDT.
    usdValue: null,
    isScam: meta?.isScam ?? false,
  };
}
