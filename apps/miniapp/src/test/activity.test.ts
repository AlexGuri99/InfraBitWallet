/**
 * Activity date grouping: local `Today` / `Yesterday` pills and the older month/day form.
 * A fixed `now` keeps the assertions independent of the wall clock.
 */
import { describe, it, expect } from 'vitest';
import type { TonActivityItem } from '@onezerowallet/chain-ton';
import { dateLabel, groupActivity } from '../ui/asset';

function item(id: string, timestamp: number): TonActivityItem {
  return {
    id,
    direction: 'out',
    standard: 'native',
    symbol: 'TON',
    decimals: 9,
    amountRaw: '1000000000',
    amount: '1',
    counterparty: '0:counterparty',
    timestamp,
    feeRaw: '0',
    fee: '0',
    status: 'ok',
    hash: id,
    comment: null,
    isScam: false,
    isBounce: false,
  };
}

/** Local noon on a given local date. */
function localNoon(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 12, 0, 0);
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

describe('dateLabel', () => {
  const now = localNoon(2026, 10, 26); // 26 November 2026, local time

  it('labels today and yesterday, then falls back to month/day', () => {
    expect(dateLabel(unix(localNoon(2026, 10, 26)), now)).toBe('Today');
    expect(dateLabel(unix(localNoon(2026, 10, 25)), now)).toBe('Yesterday');
    expect(dateLabel(unix(localNoon(2026, 10, 23)), now)).toBe('November 23');
  });

  it('uses calendar days, not a 24-hour window', () => {
    // 00:05 today and 23:55 yesterday are ~5 minutes apart but in different groups.
    const justAfterMidnight = new Date(2026, 10, 26, 0, 5, 0);
    const lateLastNight = new Date(2026, 10, 25, 23, 55, 0);
    expect(dateLabel(unix(justAfterMidnight), now)).toBe('Today');
    expect(dateLabel(unix(lateLastNight), now)).toBe('Yesterday');
  });
});

describe('groupActivity', () => {
  const now = localNoon(2026, 10, 26);

  it('groups consecutive items under Today, Yesterday and older dates', () => {
    const groups = groupActivity(
      [
        item('a', unix(new Date(2026, 10, 26, 10, 0))),
        item('b', unix(new Date(2026, 10, 26, 9, 0))),
        item('c', unix(new Date(2026, 10, 25, 18, 0))),
        item('d', unix(new Date(2026, 10, 20, 12, 0))),
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday', 'November 20']);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(groups[1]?.items.map((entry) => entry.id)).toEqual(['c']);
    expect(groups[2]?.items.map((entry) => entry.id)).toEqual(['d']);
  });
});
