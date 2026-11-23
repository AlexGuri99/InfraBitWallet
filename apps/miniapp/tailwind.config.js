/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        'surface-2': 'var(--bg-surface-secondary)',
        'surface-elevated': 'var(--bg-surface-elevated)',
        glass: 'var(--bg-glass)',
        hero: 'var(--hero-bg)',
        'hero-end': 'var(--hero-bg-end)',
        'hero-ink': 'var(--hero-ink)',
        'hero-pill': 'var(--hero-pill-bg)',
        'accent-primary': 'var(--accent-primary)',
        'accent-ink': 'var(--accent-primary-ink)',
        'accent-link': 'var(--accent-link)',
        'tab-active': 'var(--tab-active-bg)',
        ink: 'var(--text-primary)',
        'ink-2': 'var(--text-secondary)',
        'ink-muted': 'var(--text-muted)',
        positive: 'var(--status-positive)',
        'positive-bg': 'var(--status-positive-bg)',
        negative: 'var(--status-negative)',
        swap: 'var(--status-swap)',
        'swap-bg': 'var(--status-swap-bg)',
        hairline: 'var(--border-subtle)',
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans Variable"',
          '"Plus Jakarta Sans"',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        hero: 'var(--shadow-hero)',
      },
    },
  },
  plugins: [],
};
