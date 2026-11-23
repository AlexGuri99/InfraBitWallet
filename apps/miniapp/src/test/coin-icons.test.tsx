/**
 * Coin icons: branded inline SVG for supported coins, deterministic monogram for jettons,
 * and never an <img> (strict CSP / no remote image hosts).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CoinIcon } from '../ui/coin-icons';

describe('CoinIcon', () => {
  it('renders branded inline SVG for supported coins and aliases', () => {
    for (const symbol of ['TON', 'USDT', 'TRX', 'ETH', 'TRON', 'EVM']) {
      const { container, unmount } = render(<CoinIcon symbol={symbol} size={40} />);
      expect(container.querySelector('svg')).not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.width).toBe('40px');
      expect(wrapper.style.height).toBe('40px');
      unmount();
    }
  });

  it('renders a deterministic 2-letter monogram for unknown jettons', () => {
    const first = render(<CoinIcon symbol="FOO" size={40} />);
    expect(first.container.textContent).toBe('FO');
    expect(first.container.querySelector('svg')).toBeNull();
    const tone = (first.container.firstElementChild as HTMLElement).className;
    first.unmount();

    const second = render(<CoinIcon symbol="FOO" size={56} />);
    expect(second.container.textContent).toBe('FO');
    expect((second.container.firstElementChild as HTMLElement).className).toBe(tone);
  });

  it('normalizes punctuation and case before taking the monogram', () => {
    const { container } = render(<CoinIcon symbol=" fo-o " />);
    expect(container.textContent).toBe('FO');
  });
});
