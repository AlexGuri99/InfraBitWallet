export type Chain = 'ton' | 'tron' | 'evm';

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
