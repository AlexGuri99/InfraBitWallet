/**
 * Floating translucent bottom navigation (DESIGN.md §4).
 * Four equal tabs; the active tab gets a solid pill highlight.
 */
import { MarketIcon, SettingsIcon, SparkleIcon, WalletIcon } from './icons';

export type WalletTab = 'wallet' | 'market' | 'assistant' | 'settings';

const TABS: ReadonlyArray<{ id: WalletTab; label: string }> = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'market', label: 'Market' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'settings', label: 'Settings' },
];

function TabIcon({ id, size }: { id: WalletTab; size: number }) {
  if (id === 'wallet') return <WalletIcon size={size} />;
  if (id === 'market') return <MarketIcon size={size} />;
  if (id === 'assistant') return <SparkleIcon size={size} />;
  return <SettingsIcon size={size} />;
}

export function BottomNav({
  active,
  onChange,
}: {
  active: WalletTab;
  onChange: (tab: WalletTab) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(env(safe-area-inset-bottom)+16px)]"
    >
      <div className="pointer-events-auto flex h-16 w-[calc(100%-32px)] max-w-[398px] items-center gap-1 rounded-full border border-hairline bg-glass p-1.5 shadow-card backdrop-blur-[18px]">
        <div className="grid w-full grid-cols-4 gap-1" role="tablist" aria-label="Primary">
          {TABS.map((tab) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={tab.label}
                onClick={() => {
                  onChange(tab.id);
                }}
                className={`pressable flex h-full flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[10.5px] font-semibold tracking-[0.01em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-link)] ${
                  selected
                    ? 'bg-tab-active text-[color:var(--hero-ink)]'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                <TabIcon id={tab.id} size={19} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
