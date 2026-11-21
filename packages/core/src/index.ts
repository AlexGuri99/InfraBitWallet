export type Chain = 'ton' | 'tron' | 'evm';

/**
 * Coin metadata is DATA, never a hardcoded constant.
 *
 * A native coin is identified by its protocol/chain plus `tokenAddress === null`, not by a symbol
 * string. Symbols come from configured provider metadata: a live TonAPI call on 2026-11-21
 * returned "TON" even though the brief describes a 2026-06-15 rename to "GRAM", so neither string
 * may be assumed. Fake jettons can impersonate a symbol; the protocol check is authoritative.
 * See docs/UNVERIFIED.md item 2.
 */
export interface AssetBalance {
  tokenAddress: string | null; // null for native coin
  symbol: string;
  name: string;
  decimals: number;
  amount: bigint;
  usdValue: number | null;
}

export interface FeeEstimate {
  nativeAssetAmount: bigint;
  usdValue: number | null;
  breakdown: Record<string, bigint>;
}

export interface TransactionPayload {
  to: string;
  value: bigint;
  data: string | null;
  chain: Chain;
  memo?: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export interface SwapQuote {
  provider: string;
  fromToken: string;
  toToken: string;
  fromAmount: bigint;
  toAmount: bigint;
  minReceived: bigint;
  priceImpact: number;
  route: string[];
  fee: {
    oneZeroWallet: { amount: bigint; bps: number };
    provider: { amount: bigint; bps: number } | null;
    network: bigint;
    total: bigint;
  };
  slippage: number;
  expiresAt: number;
}

export interface StakeInfo {
  provider: string;
  stakedAmount: bigint;
  stakedUsdValue: number | null;
  rewards: bigint;
  rewardsUsdValue: number | null;
  apy: number;
  apySource: string;
  unstakeDelay: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export type StakingFeePolicy = 'none' | 'provider_revenue_share' | 'explicit_fee';

export type UnstakeMode = 'instant' | 'best_rate' | 'regular';

export interface Duration {
  seconds: number;
  humanReadable: string;
}
