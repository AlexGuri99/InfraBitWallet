/** Shared, provider-agnostic TON read models. Amounts are decimal strings backed by BigInt. */

export type TonNetwork = 'testnet' | 'mainnet';
export type TonAccountStatus = 'uninit' | 'active' | 'frozen' | 'nonexist';
export type TonAssetStandard = 'native' | 'jetton';
export type TonActivityStatus = 'ok' | 'failed' | 'pending';

export interface TonAssetBalance {
  /** "ton" for the native coin, otherwise the jetton master address. */
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  standard: TonAssetStandard;
  /** Smallest-unit balance as a decimal integer string. */
  balanceRaw: string;
  /** Human-readable balance, e.g. "1.25". */
  balance: string;
  /** USD value when a price is known; null for unknown jettons. */
  usdValue: number | null;
  isScam?: boolean;
}

export interface TonPortfolio {
  address: string;
  network: TonNetwork;
  status: TonAccountStatus;
  /** Native balance in nanoTON (decimal integer string). */
  balanceRaw: string;
  /** Native balance, e.g. "1.25". */
  balance: string;
  /** Native coin USD price at fetch time. */
  priceUsd: number | null;
  /** 24h change in percent (e.g. -4.48) when available. */
  change24h: number | null;
  /** Sum of known USD values (native + priced jettons). */
  totalUsd: number | null;
  assets: TonAssetBalance[];
  /** Epoch ms when the upstream data was fetched. */
  updatedAt: number;
  source: 'toncenter' | 'tonapi';
}

export interface TonActivityItem {
  id: string;
  direction: 'in' | 'out';
  standard: TonAssetStandard;
  symbol: string;
  decimals: number;
  /** Smallest-unit amount (decimal integer string). */
  amountRaw: string;
  /** Human-readable amount. */
  amount: string;
  /** Other party address (user-friendly when known). */
  counterparty: string;
  /** Epoch seconds from the chain transaction. */
  timestamp: number;
  /** Transaction fee in nanoTON (decimal integer string). */
  feeRaw: string;
  fee: string;
  status: TonActivityStatus;
  /** Base64 transaction hash as returned by the provider. */
  hash: string;
  /** Comment after URL neutralization; null when absent. */
  comment: string | null;
  /** True when the provider or our filters consider this a scam/dust item. */
  isScam: boolean;
}

export interface TonReadProvider {
  getPortfolio(address: string, network: TonNetwork): Promise<TonPortfolio>;
  getActivity(address: string, network: TonNetwork, limit: number): Promise<TonActivityItem[]>;
}

export interface TonAddressFormsLike {
  raw: string;
  bounceable: string;
  nonBounceable: string;
  testnetBounceable: string;
  testnetNonBounceable: string;
}
