/**
 * Market tab — UI shell (DESIGN.md §5.6).
 *
 * Search and category chips work; the coin list is clearly tagged as preview data. Tapping a
 * row opens the Coin Detail shell. No live market feed is implied.
 */
import { useMemo, useState } from 'react';
import { useToast } from './toast';
import { Card, PhoneFrame, TokenAvatar } from './common';
import { SearchIcon } from './icons';

type Category = 'All' | 'Top Gainers' | 'Layer 1' | 'DeFi';

interface PreviewCoin {
  symbol: string;
  name: string;
  category: Exclude<Category, 'All'>;
  change: string;
}

const COINS: PreviewCoin[] = [
  { symbol: 'TON', name: 'Toncoin', category: 'Layer 1', change: '+2.40%' },
  { symbol: 'TRX', name: 'TRON', category: 'Layer 1', change: '+1.12%' },
  { symbol: 'ETH', name: 'Ethereum', category: 'Layer 1', change: '-0.84%' },
  { symbol: 'USDT', name: 'Tether USD', category: 'DeFi', change: '+0.01%' },
  { symbol: 'STON', name: 'STON.fi', category: 'DeFi', change: '+6.35%' },
  { symbol: 'NOT', name: 'Notcoin', category: 'Top Gainers', change: '+11.20%' },
];

export function MarketScreen() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return COINS.filter((coin) => {
      const inCategory = category === 'All' || coin.category === category;
      const matches =
        term === '' ||
        coin.symbol.toLowerCase().includes(term) ||
        coin.name.toLowerCase().includes(term);
      return inCategory && matches;
    });
  }, [query, category]);

  return (
    <PhoneFrame>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-[96px] pt-4">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink">Market</h1>

        <div className="flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 shadow-card">
          <SearchIcon size={17} className="text-ink-muted" />
          <input
            aria-label="Search coins"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search coins"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-muted focus:outline-none"
          />
        </div>

        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
          {(['All', 'Top Gainers', 'Layer 1', 'DeFi'] as const).map((value) => {
            const active = value === category;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCategory(value);
                }}
                className={`pressable shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${
                  active ? 'bg-accent-primary text-accent-ink' : 'bg-surface text-ink-2 shadow-card'
                }`}
              >
                {value}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 rounded-2xl bg-surface-secondary px-3 py-2 text-[11.5px] font-semibold text-ink-2">
          <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9.5px] uppercase tracking-[0.02em]">
            Preview
          </span>
          Live market data coming soon
        </div>

        <Card>
          {filtered.map((coin, index) => (
            <div key={coin.symbol}>
              {index > 0 ? <div className="ml-16 h-px bg-hairline" aria-hidden="true" /> : null}
              <button
                type="button"
                onClick={() => {
                  toast.show('Market detail — coming soon');
                }}
                className="pressable flex w-full items-center gap-3 px-4 py-[14px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent-link)]"
              >
                <TokenAvatar symbol={coin.symbol} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{coin.name}</span>
                  <span className="block text-[12.5px] text-ink-2">{coin.symbol}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[15px] font-semibold text-ink">—</span>
                  <span className="tabular block text-[12.5px] text-ink-2">{coin.change}</span>
                </span>
              </button>
            </div>
          ))}
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-muted">No coins match.</p>
          ) : null}
        </Card>
      </main>
    </PhoneFrame>
  );
}
