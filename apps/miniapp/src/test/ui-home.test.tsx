/**
 * Wallet Home tests with a mocked same-origin read API:
 * loaded balances, skeleton/error (never a false $0.00), activity list + detail, Deposit QR,
 * privacy masking and ton-native-only filtering.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonActivityItem, TonPortfolio } from '@onezerowallet/chain-ton';
import { UI_TON_NETWORK } from '../ui/wallet-shell';
import {
  TonApiError,
  type TonReadApi,
  type TonStakeApi,
  type TonSwapApi,
  type TonWriteApi,
} from '../ton/api';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderShell } from './ui-helpers';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const TON_NATIVE_MNEMONIC = [
  'hospital',
  'stove',
  'relief',
  'fringe',
  'tongue',
  'always',
  'charge',
  'angry',
  'urge',
  'sentence',
  'again',
  'match',
  'nerve',
  'inquiry',
  'senior',
  'coconut',
  'label',
  'tumble',
  'carry',
  'category',
  'beauty',
  'bean',
  'road',
  'solution',
].join(' ');
const JETTON = '-1:27b3b038792c090b59897fbd890c4f5bc8a63d9ffc716f5861968972f617908b';

function portfolio(): TonPortfolio {
  return {
    address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
    network: UI_TON_NETWORK,
    status: 'active',
    balanceRaw: '1500000000',
    balance: '1.5',
    priceUsd: 1.5,
    change24h: 2,
    totalUsd: 2.25,
    assets: [
      {
        id: 'ton',
        symbol: 'TON',
        name: 'Toncoin',
        decimals: 9,
        standard: 'native',
        balanceRaw: '1500000000',
        balance: '1.5',
        usdValue: 2.25,
      },
      {
        id: JETTON,
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        standard: 'jetton',
        balanceRaw: '2500000',
        balance: '2.5',
        usdValue: null,
      },
    ],
    updatedAt: 1_700_000_000_000,
    source: 'toncenter',
  };
}

const ACTIVITY: TonActivityItem[] = [
  {
    id: 'tx-1',
    direction: 'in',
    standard: 'native',
    symbol: 'TON',
    decimals: 9,
    amountRaw: '2000000000',
    amount: '2',
    counterparty: 'UQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY',
    timestamp: Math.floor(Date.now() / 1000) - 120,
    feeRaw: '1000000',
    fee: '0.001',
    status: 'ok',
    hash: 'AAAA',
    comment: 'hello [link removed]',
    isScam: false,
  },
];

function apiWith(
  value: TonPortfolio | (() => Promise<TonPortfolio>),
  activity: TonActivityItem[] = [],
): TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi {
  return {
    getPortfolio: () => (typeof value === 'function' ? value() : Promise.resolve(value)),
    getActivity: () => Promise.resolve(activity),
    getWalletState: () => Promise.reject(new Error('not used')),
    emulate: () => Promise.reject(new Error('not used')),
    broadcast: () => Promise.reject(new Error('not used')),
    getSwapAssets: () => Promise.reject(new Error('not used')),
    getSwapQuote: () => Promise.reject(new Error('not used')),
    getStakingInfo: () => Promise.reject(new Error('not used')),
  };
}

async function unlockedManager(
  accountType: 'bip39-multichain' | 'ton-native-only' = 'bip39-multichain',
): Promise<VaultManager> {
  const manager = new VaultManager({ sealStorage: new InMemoryStorage(), config: FAST });
  const phrase = accountType === 'ton-native-only' ? TON_NATIVE_MNEMONIC : MNEMONIC_12_HARDHAT;
  const imported = await manager.importWallet(phrase, PASS, { accountType });
  expect(imported.ok).toBe(true);
  const unlocked = await manager.unlock(PASS);
  expect(unlocked.success).toBe(true);
  return manager;
}

describe('Wallet home: live TON data', () => {
  it('shows loaded balances, jettons and totals', async () => {
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio()));
    expect(await screen.findByTestId('hero-balance')).toHaveTextContent('$2.25');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('1.5 TON');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('$2.25');
    expect(screen.getByTestId('asset-USDT')).toHaveTextContent('2.5 USDT');
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(screen.getByTestId('ton-address-pill')).toHaveTextContent(/^0Q/);
    expect(screen.getByRole('tab', { name: 'Wallet' })).toHaveAttribute('aria-selected', 'true');
  });

  it('queries the exact testnet address it displays (same 256-bit hash)', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    const api: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi = {
      getPortfolio: (address) => {
        requested.push(address);
        return Promise.resolve(portfolio());
      },
      getActivity: (address) => {
        requested.push(address);
        return Promise.resolve([]);
      },
      getWalletState: () => Promise.reject(new Error('not used')),
      emulate: () => Promise.reject(new Error('not used')),
      broadcast: () => Promise.reject(new Error('not used')),
      getSwapAssets: () => Promise.reject(new Error('not used')),
      getSwapQuote: () => Promise.reject(new Error('not used')),
      getStakingInfo: () => Promise.reject(new Error('not used')),
    };
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, api);
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });

    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    const displayed = screen.getByTestId('address-TON').textContent;
    expect(displayed).toMatch(/^0Q/);

    const hashOf = (address: string): string => {
      const binary = atob(address.replace(/-/g, '+').replace(/_/g, '/'));
      return Array.from(binary.slice(2, 34))
        .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
    };
    expect(requested.length).toBeGreaterThan(0);
    for (const address of requested) {
      expect(address).toBe(displayed);
      expect(hashOf(address)).toBe(hashOf(displayed));
      expect(address).not.toMatch(/^0:/);
    }
  });

  it('formats the hero TON amount to at most four decimals', async () => {
    const p = portfolio();
    p.balanceRaw = '3999999979';
    p.balance = '3.999999979';
    const native = p.assets[0];
    if (!native) throw new Error('missing native asset');
    p.totalUsd = 6;
    p.assets = [{ ...native, balanceRaw: '3999999979', balance: '3.999999979', usdValue: 6 }];
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(p));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$6.00');
    });
    expect(screen.getByText(/3\.9999 TON/)).toBeInTheDocument();
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('3.999999979 TON');
  });

  it('labels bounced refunds and opens the live detail view', async () => {
    const user = userEvent.setup();
    const baseItem = ACTIVITY[0];
    if (!baseItem) throw new Error('missing activity fixture');
    const bounced: TonActivityItem[] = [
      {
        ...baseItem,
        id: 'bounce-1',
        direction: 'out',
        amountRaw: '49933333',
        amount: '0.049933333',
        isBounce: true,
      },
    ];
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio(), bounced));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    const row = await screen.findByTestId('activity-bounce-1');
    expect(row).toHaveTextContent('Bounced');
    await user.click(row);
    expect(screen.getByRole('heading', { name: 'Bounced' })).toBeInTheDocument();
  });

  it('masks every balance from the top bar', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio()));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Hide balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('••••');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('••••');
    await user.click(screen.getByRole('button', { name: 'Show balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
  });

  it('shows a loading state, never a false $0.00', async () => {
    let resolve!: (value: TonPortfolio) => void;
    const pending = new Promise<TonPortfolio>((res) => {
      resolve = res;
    });
    const manager = await unlockedManager();
    renderShell(
      { ...makeVault(), manager },
      apiWith(() => pending),
    );
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('…');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('…');
    resolve(portfolio());
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
  });

  it('shows an offline banner with Retry and no $0.00 on error', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const api: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi = {
      getPortfolio: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new TonApiError('offline'));
        return Promise.resolve(portfolio());
      },
      getActivity: () => Promise.resolve([]),
      getWalletState: () => Promise.reject(new Error('not used')),
      emulate: () => Promise.reject(new Error('not used')),
      broadcast: () => Promise.reject(new Error('not used')),
      getSwapAssets: () => Promise.reject(new Error('not used')),
      getSwapQuote: () => Promise.reject(new Error('not used')),
      getStakingInfo: () => Promise.reject(new Error('not used')),
    };
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, api);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Offline/);
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('—');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('—');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
  });

  it('Deposit screen shows the testnet address, multichain addresses and an inline QR', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio()));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    expect(screen.getByRole('heading', { name: 'Fund' })).toBeInTheDocument();
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^0Q/);
    await user.click(screen.getByRole('button', { name: 'TRON' }));
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
    await user.click(screen.getByRole('button', { name: 'EVM' }));
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(/^0x/);
    expect(document.querySelector('svg[role="img"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
  });

  it('renders activity and opens a sanitized detail view', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio(), ACTIVITY));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    expect(await screen.findByTestId('activity-tx-1')).toHaveTextContent('+2 TON');
    await user.click(screen.getByTestId('activity-tx-1'));
    const heading = screen.getByRole('heading', { name: 'Received' });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('hello [link removed]')).toBeInTheDocument();
    expect(document.querySelector('a[href*="testnet.tonviewer.com/transaction"]')).not.toBeNull();
  });

  it('labels today as Today and keeps the time under the amount', async () => {
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio(), ACTIVITY));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    const row = await screen.findByTestId('activity-tx-1');
    // The date-group pill is relative for the current day.
    expect(screen.getByText('Today')).toBeInTheDocument();

    // Time sits in the right-hand column, directly under the amount.
    const time = within(row).getByTestId('activity-time-tx-1');
    expect(time).toHaveTextContent(/^([01]\d|2[0-3]):[0-5]\d$/);
    const rightColumn = time.parentElement;
    expect(rightColumn).not.toBeNull();
    expect(rightColumn).toHaveTextContent('+2 TON');

    // The counterparty line no longer carries a "· HH:MM" suffix (address keeps its room).
    expect(within(row).getByText(/^from /)).not.toHaveTextContent(/\d{2}:\d{2}/);
    // A comment is separated on the left, so it can never clip the time.
    expect(within(row).getByTestId('activity-detail-tx-1')).toHaveTextContent(
      'hello [link removed]',
    );
  });

  it('shows the empty activity state', async () => {
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio(), []));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
  });

  it('ton-native-only hides TRON/EVM assets and addresses', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager('ton-native-only');
    renderShell({ ...makeVault(), manager }, apiWith(portfolio()));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    expect(screen.queryByTestId('asset-TRX')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asset-ETH')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^0Q/);
    expect(screen.queryByTestId('address-TRON')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
  });

  it('runs the send flow from signed payload + emulation, rejecting mainnet prefixes', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    const info = manager.getSession()?.getPublicInfo(0);
    if (!info) throw new Error('no info');
    const api: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi = {
      getPortfolio: () => Promise.resolve(portfolio()),
      getActivity: () => Promise.resolve([]),
      getWalletState: () =>
        Promise.resolve({
          address: info.ton.addressTestnetNonBounceable,
          network: 'testnet',
          status: 'uninit',
          seqno: 0,
          balanceRaw: '1500000000',
          source: 'toncenter',
        }),
      emulate: () =>
        Promise.resolve({
          ok: true,
          estimatedFeeRaw: '1000000',
          balanceChanges: [{ assetId: 'ton', symbol: 'TON', deltaRaw: '-101000000', decimals: 9 }],
          warnings: [],
          willBounce: false,
        }),
      broadcast: () => Promise.resolve({ messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' } }),
      getSwapAssets: () => Promise.reject(new Error('not used')),
      getSwapQuote: () => Promise.reject(new Error('not used')),
      getStakingInfo: () => Promise.reject(new Error('not used')),
    };
    renderShell({ ...makeVault(), manager }, api);
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Send / Sell' }));
    expect(await screen.findByRole('heading', { name: 'Send TON' })).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Recipient'),
      `EQ${info.ton.addressTestnetNonBounceable.slice(2)}`,
    );
    await user.type(screen.getByLabelText('Amount'), '0.1');
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Mainnet-only/);

    await user.clear(screen.getByLabelText('Recipient'));
    await user.type(screen.getByLabelText('Recipient'), info.ton.addressTestnetNonBounceable);
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByText(/First send — deploys Wallet V5R1/)).toBeInTheDocument();
    expect(screen.getByText(/Network fee/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm & Send' }));
    expect(await screen.findByRole('heading', { name: 'Submitted' })).toBeInTheDocument();
    expect(screen.getByText(/testnet\.tonviewer\.com\/message/)).toBeInTheDocument();
  });

  it('wires the floating navigation tabs', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith(portfolio()), { onTabChange });
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(onTabChange).toHaveBeenCalledWith('settings');
    await user.click(screen.getByRole('tab', { name: 'Market' }));
    expect(onTabChange).toHaveBeenCalledWith('market');
  });
});
