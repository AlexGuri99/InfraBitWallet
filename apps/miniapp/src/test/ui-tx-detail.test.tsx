/**
 * Transaction / Pending Detail polish: the counterparty must render in the same testnet
 * user-friendly form as the Send Review screen, never as the raw `0:…` address carried by a
 * pending item.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { toTestnetDisplayAddress, type TonActivityItem } from '@onezerowallet/chain-ton';
import { TxDetailScreen } from '../ui/tx-detail';
import { renderWithProviders } from './ui-helpers';

const RAW_RECIPIENT = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';

const PENDING: TonActivityItem = {
  id: 'pending-ab12',
  direction: 'out',
  standard: 'native',
  symbol: 'TON',
  decimals: 9,
  amountRaw: '1949999999',
  amount: '1.949999999',
  counterparty: RAW_RECIPIENT,
  timestamp: 1_795_621_500,
  feeRaw: '0',
  fee: '0',
  status: 'pending',
  hash: 'qquq',
  comment: null,
  isScam: false,
};

describe('Transaction Detail (pending)', () => {
  it('renders a friendly testnet recipient instead of raw hex', () => {
    const { container } = renderWithProviders(
      <TxDetailScreen
        item={PENDING}
        network="testnet"
        onBack={() => undefined}
        onRepeat={() => undefined}
      />,
    );
    const text = container.textContent;
    // 48-char user-friendly testnet form (kQ… bounceable), no raw workchain address.
    expect(text).toMatch(/kQ[0-9A-Za-z_-]{46}/);
    expect(text).not.toContain('0:debd442a');
    expect(screen.getByRole('heading', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
  });

  it('leaves an already friendly recipient untouched', () => {
    const friendly = toTestnetDisplayAddress(RAW_RECIPIENT, true);
    const { container } = renderWithProviders(
      <TxDetailScreen
        item={{ ...PENDING, counterparty: friendly }}
        network="testnet"
        onBack={() => undefined}
        onRepeat={() => undefined}
      />,
    );
    expect(container.textContent).toContain(friendly);
  });
});
