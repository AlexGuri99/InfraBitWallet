/**
 * Pure formatting and safety helpers for TON read data.
 *
 * Balances are decimal integer strings and are formatted with BigInt math only — no floating
 * point is ever used for a token amount. USD values may be floating point because they are
 * display-only estimates.
 */
import type { TonActivityItem } from './types.js';

const MAX_COMMENT_LENGTH = 200;

/** Matches http(s) and www URLs anywhere in a comment. */
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+/gi;
/** Replace C0 control characters without a regex literal (keeps lint rule coverage intact). */
function stripControlCharacters(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  return out;
}

/** "1234567890" + 9 -> "1.23456789"; exact BigInt math, trailing zeros trimmed. */
export function formatDecimal(raw: string, decimals: number): string {
  if (!/^-?\d+$/.test(raw)) return '0';
  if (decimals <= 0) return raw;
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  const body = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative && body !== '0' ? `-${body}` : body;
}

/** Parse a human decimal string into smallest units, exactly. Returns null when invalid. */
export function parseDecimal(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

/**
 * Compact display amount: at most `maxFractionDigits` decimals (truncated, not rounded) with
 * trailing zeros trimmed. Full precision stays available via formatDecimal for detail views.
 */
export function formatDecimalShort(raw: string, decimals: number, maxFractionDigits = 4): string {
  if (!/^-?\d+$/.test(raw)) return '0';
  if (decimals <= 0 || maxFractionDigits >= decimals) return formatDecimal(raw, decimals);
  const factor = 10n ** BigInt(decimals - maxFractionDigits);
  const value = BigInt(raw);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const truncated = (magnitude / factor) * factor;
  const text = formatDecimal(`${negative ? '-' : ''}${truncated.toString()}`, decimals);
  return text;
}

/** "$1,234.56"; null/NaN renders as "$0.00" without implying a loaded balance on its own. */
export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '$0.00';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 24h change, e.g. "+3.05%" / "-4.48%". */
export function formatChange(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return '0.00%';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

export function truncateAddress(address: string, head = 4, tail = 4): string {
  return address.length > head + tail + 1
    ? `${address.slice(0, head)}…${address.slice(-tail)}`
    : address;
}

/**
 * Remove URLs from a transfer comment before it reaches the UI. This is an anti-phishing
 * guardrail: inbound comments are attacker-controlled and frequently contain "claim your
 * airdrop" links. Control characters are stripped and the text is length-capped.
 */
export function neutralizeComment(comment: string | null | undefined): string | null {
  if (comment === null || comment === undefined) return null;
  const stripped = stripControlCharacters(comment).replace(URL_PATTERN, '[link removed]');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return collapsed.length > MAX_COMMENT_LENGTH
    ? `${collapsed.slice(0, MAX_COMMENT_LENGTH).trimEnd()}…`
    : collapsed;
}

/** True when a raw comment contains a URL (before neutralization). */
export function commentHasLink(comment: string | null | undefined): boolean {
  if (!comment) return false;
  URL_PATTERN.lastIndex = 0;
  return URL_PATTERN.test(comment);
}

/**
 * Filter for the activity list: zero-value transfers (dust) and scam-flagged items are hidden,
 * and comment URLs are neutralized before anything is returned to the UI.
 */
export function sanitizeActivityItem(item: TonActivityItem): TonActivityItem | null {
  if (item.amountRaw === '0' || item.amountRaw === '') return null;
  const comment = neutralizeComment(item.comment);
  return { ...item, comment, isScam: item.isScam };
}

export function filterActivity(items: TonActivityItem[]): TonActivityItem[] {
  const out: TonActivityItem[] = [];
  for (const item of items) {
    const sanitized = sanitizeActivityItem(item);
    if (sanitized && !sanitized.isScam) out.push(sanitized);
  }
  return out;
}

/** Choose the user-facing address for the active network (receive: non-bounceable). */
export function tonAddressForNetwork(
  forms: {
    nonBounceable: string;
    bounceable: string;
    testnetNonBounceable: string;
    testnetBounceable: string;
  },
  network: 'testnet' | 'mainnet',
  bounceable = false,
): string {
  if (network === 'testnet') {
    return bounceable ? forms.testnetBounceable : forms.testnetNonBounceable;
  }
  return bounceable ? forms.bounceable : forms.nonBounceable;
}

/** Testnet user-friendly addresses start with k (bounceable) or 0 (non-bounceable). */
export function isTestnetUserFriendlyAddress(address: string): boolean {
  return /^[k0]/.test(address) && !address.includes(':');
}

/** True when a string looks like a TON user-friendly or raw address (shallow check). */
export function isProbablyTonAddress(address: string): boolean {
  return /^(?:-?\d+:[0-9a-fA-F]{64}|[A-Za-z0-9_-]{48})$/.test(address.trim());
}
