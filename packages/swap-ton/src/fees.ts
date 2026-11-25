/**
 * Swap fee policy and slippage math (pure).
 *
 * The direct DEX v2 referral fee is expressed in BASIS POINTS: `referralValue: 35` = 0.35%.
 * Omniston (a different product) uses PIPS where 3500 = 0.35% — the names must never be mixed,
 * so every value that reaches a payload passes through `assertReferralFeeBps`.
 */

/** Policy fee: 0.35% in basis points. */
export const SWAP_FEE_BPS = 35 as const;

/** Hard cap from CLAUDE.md (§3): the client refuses anything above 1%. */
export const MAX_SWAP_FEE_BPS = 100 as const;

/** Slippage presets (0.5%, 1%, 3%) and accepted range (0.1%–5%) in basis points. */
export const SLIPPAGE_PRESETS_BPS = [50, 100, 300] as const;
export const MIN_SLIPPAGE_BPS = 10 as const;
export const MAX_SLIPPAGE_BPS = 500 as const;

const BPS_DENOMINATOR = 10_000n;

/**
 * Validate a referral fee in basis points. Rejects anything that is not an integer in
 * `[0, MAX_SWAP_FEE_BPS]` — notably pips-style values such as 3500.
 */
export function assertReferralFeeBps(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SWAP_FEE_BPS) {
    throw new Error('REFERRAL_FEE_BPS_OUT_OF_RANGE');
  }
  return value;
}

export function assertSlippageBps(value: number): number {
  if (!Number.isInteger(value) || value < MIN_SLIPPAGE_BPS || value > MAX_SLIPPAGE_BPS) {
    throw new Error('SLIPPAGE_BPS_OUT_OF_RANGE');
  }
  return value;
}

/**
 * Minimum acceptable output after slippage: `floor(askUnits * (10000 - slippageBps) / 10000)`.
 * Exact BigInt math; the transaction is never built with a larger minimum.
 */
export function minReceivedRaw(askUnitsRaw: string, slippageBps: number): string {
  if (!/^\d+$/.test(askUnitsRaw)) throw new Error('INVALID_ASK_UNITS');
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error('INVALID_SLIPPAGE_BPS');
  }
  const ask = BigInt(askUnitsRaw);
  const min = (ask * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
  return min.toString();
}
