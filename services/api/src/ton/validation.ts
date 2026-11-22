/**
 * Strict query validation for the read endpoints. Anything that is not a parseable TON address
 * (raw or user-friendly, any network flag) is rejected before a provider call is made.
 */
import { Address } from '@ton/core';
import type { TonNetwork } from '@onezerowallet/chain-ton';

/** Returns the raw "workchain:hex" form, or null when the input is not a TON address. */
export function normalizeTonAddress(input: unknown): string | null {
  if (typeof input !== 'string' || input.trim() === '' || input.length > 100) return null;
  try {
    return Address.parse(input.trim()).toRawString();
  } catch {
    return null;
  }
}

/** The network query must be testnet or mainnet; callers then enforce which is allowed. */
export function readTonNetwork(input: unknown): TonNetwork | null {
  if (input === 'testnet' || input === 'mainnet') return input;
  return null;
}

/** Parse a positive integer query parameter with bounds. */
export function readLimit(input: unknown, fallback: number, max: number): number {
  if (typeof input !== 'string' || !/^\d+$/.test(input)) return fallback;
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, max);
}
