import { useTelegram } from './telegram';

export function App() {
  const { theme, platform } = useTelegram();

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: theme?.backgroundColor ?? 'var(--tg-theme-bg-color, #fff)',
        color: theme?.textColor ?? 'var(--tg-theme-text-color, #000)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <header
        className="px-4 py-3"
        style={{
          backgroundColor: theme?.headerBgColor ?? 'var(--tg-theme-header-bg-color, #f0f0f0)',
        }}
      >
        <h1 className="text-lg font-semibold">OneZeroWallet</h1>
        <span className="text-xs opacity-60">Platform: {platform ?? 'unknown'}</span>
      </header>
      <main className="flex-1 px-4 py-6 flex items-center justify-center">
        <p
          className="text-center"
          style={{ color: theme?.hintColor ?? 'var(--tg-theme-hint-color, #999)' }}
        >
          OneZeroWallet — self-custodial multi-chain wallet
          <br />
          <span className="text-sm">Coming soon</span>
        </p>
      </main>
    </div>
  );
}
