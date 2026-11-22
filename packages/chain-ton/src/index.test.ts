/**
 * P2a: pure TON read helpers — BigInt formatting, testnet address selection, comment
 * neutralization and spam filtering.
 */
import { describe, it, expect } from 'vitest';
import {
  formatDecimal,
  parseDecimal,
  formatUsd,
  formatChange,
  truncateAddress,
  neutralizeComment,
  commentHasLink,
  filterActivity,
  tonAddressForNetwork,
  isTestnetUserFriendlyAddress,
  isProbablyTonAddress,
  type TonActivityItem,
} from './index.js';

const FORMS = {
  raw: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
  bounceable: 'EQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiShaVv',
  nonBounceable: 'UQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiShaVv',
  testnetBounceable: 'kQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiShhZ',
  testnetNonBounceable: '0QDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY',
};

function item(overrides: Partial<TonActivityItem> = {}): TonActivityItem {
  return {
    id: '1',
    direction: 'in',
    standard: 'native',
    symbol: 'TON',
    decimals: 9,
    amountRaw: '2000000000',
    amount: '2',
    counterparty: 'UQ…',
    timestamp: 1_700_000_000,
    feeRaw: '0',
    fee: '0',
    status: 'ok',
    hash: 'abc=',
    comment: null,
    isScam: false,
    ...overrides,
  };
}

describe('BigInt decimal formatting', () => {
  it.each([
    ['0', 9, '0'],
    ['1', 9, '0.000000001'],
    ['1000000000', 9, '1'],
    ['1234567890', 9, '1.23456789'],
    ['1234567890000', 9, '1234.56789'],
    ['500', 3, '0.5'],
    ['1000000', 6, '1'],
    ['-1500000000', 9, '-1.5'],
    ['9007199254740993', 9, '9007199.254740993'],
  ])('%s with %i decimals -> %s', (raw, decimals, expected) => {
    expect(formatDecimal(raw, decimals)).toBe(expected);
  });

  it('parses decimal strings exactly and rejects over-precision', () => {
    expect(parseDecimal('1.5', 9)).toBe(1500000000n);
    expect(parseDecimal('1.2345678912', 9)).toBeNull();
    expect(parseDecimal('abc', 9)).toBeNull();
    expect(parseDecimal('0', 9)).toBe(0n);
  });

  it('formats USD and 24h change', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(null)).toBe('$0.00');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
    expect(formatChange(3.05)).toBe('+3.05%');
    expect(formatChange(-4.48)).toBe('-4.48%');
    expect(formatChange(null)).toBe('0.00%');
  });

  it('truncates addresses without echoing the middle', () => {
    expect(truncateAddress('0QDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY')).toBe('0QDe…h3EY');
    expect(truncateAddress('short')).toBe('short');
  });
});

describe('network-aware TON addresses', () => {
  it('selects testnet 0Q/kQ by default and mainnet UQ/EQ otherwise', () => {
    expect(tonAddressForNetwork(FORMS, 'testnet')).toBe(FORMS.testnetNonBounceable);
    expect(tonAddressForNetwork(FORMS, 'testnet', true)).toBe(FORMS.testnetBounceable);
    expect(tonAddressForNetwork(FORMS, 'mainnet')).toBe(FORMS.nonBounceable);
    expect(tonAddressForNetwork(FORMS, 'mainnet', true)).toBe(FORMS.bounceable);
  });

  it('detects testnet user-friendly prefixes and plausible addresses', () => {
    expect(isTestnetUserFriendlyAddress(FORMS.testnetNonBounceable)).toBe(true);
    expect(isTestnetUserFriendlyAddress(FORMS.testnetBounceable)).toBe(true);
    expect(isTestnetUserFriendlyAddress(FORMS.nonBounceable)).toBe(false);
    expect(isTestnetUserFriendlyAddress(FORMS.raw)).toBe(false);
    expect(isProbablyTonAddress(FORMS.raw)).toBe(true);
    expect(isProbablyTonAddress(FORMS.testnetNonBounceable)).toBe(true);
    expect(isProbablyTonAddress('not an address')).toBe(false);
  });
});

describe('comment neutralization and spam filtering', () => {
  it('removes URLs, control characters and caps length', () => {
    expect(neutralizeComment('Claim at https://scam.example/airdrop now')).toBe(
      'Claim at [link removed] now',
    );
    expect(neutralizeComment('visit www.bad.example')).toBe('visit [link removed]');
    expect(neutralizeComment('a\u0000b\u001fc')).toBe('a b c');
    expect(neutralizeComment('   ')).toBeNull();
    expect(neutralizeComment(null)).toBeNull();
    const long = neutralizeComment('x'.repeat(500));
    expect(long?.length).toBeLessThanOrEqual(201);
    expect(commentHasLink('https://scam')).toBe(true);
    expect(commentHasLink('hello')).toBe(false);
  });

  it('filters zero-value dust and scam items, and neutralizes comments', () => {
    const items = [
      item({ id: 'keep', comment: 'pay https://scam' }),
      item({ id: 'dust', amountRaw: '0', amount: '0' }),
      item({ id: 'scam', isScam: true }),
    ];
    const out = filterActivity(items);
    expect(out.map((entry) => entry.id)).toEqual(['keep']);
    expect(out[0]?.comment).toBe('pay [link removed]');
  });
});
