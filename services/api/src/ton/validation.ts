/**
 * Strict query validation for the read endpoints. Anything that is not a parseable TON address
 * (raw or user-friendly, any network flag) is rejected before a provider call is made.
 */
import { Address, Cell } from '@ton/core';
import { Buffer } from 'node:buffer';
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

const MAX_BOC_CHARS = 120_000;

/**
 * Validate a base64 (or base64url) BoC and return standard base64. Size-capped and decoded with
 * @ton/core so garbage never reaches a provider.
 */
export function validateBocBase64(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_BOC_CHARS) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(input)) return null;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const cells = Cell.fromBoc(Buffer.from(normalized, 'base64'));
    return cells.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

/** Parse a positive integer query parameter with bounds. */
export function readLimit(input: unknown, fallback: number, max: number): number {
  if (typeof input !== 'string' || !/^\d+$/.test(input)) return fallback;
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, max);
}
