/**
 * Home dashboard tests with a mocked same-origin read API:
 * loaded balances, skeleton/error (never a false $0.00), activity list + detail, Receive QR and
 * ton-native-only filtering.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonActivityItem, TonPortfolio } from '@onezerowallet/chain-ton';
import { TelegramProvider } from '../telegram/TelegramProvider';
import { HomeScreen, UI_TON_NETWORK } from '../ui/home';
import { TonApiError, type TonReadApi, type TonWriteApi } from '../ton/api';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';

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
): TonReadApi & TonWriteApi {
  return {
    getPortfolio: () => (typeof value === 'function' ? value() : Promise.resolve(value)),
    getActivity: () => Promise.resolve(activity),
    getWalletState: () => Promise.reject(new Error('not used')),
    emulate: () => Promise.reject(new Error('not used')),
    broadcast: () => Promise.reject(new Error('not used')),
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

function renderHome(manager: VaultManager, api: TonReadApi & TonWriteApi) {
  return render(
    <TelegramProvider>
      <HomeScreen manager={manager} onLock={() => {}} onSettings={() => {}} api={api} />
    </TelegramProvider>,
  );
}

describe('Home: live TON data', () => {
  it('shows loaded balances, jettons and totals', async () => {
    renderHome(await unlockedManager(), apiWith(portfolio()));
    expect(await screen.findByTestId('hero-balance')).toHaveTextContent('$2.25');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('1.5 TON');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('$2.25');
    expect(screen.getByTestId('asset-USDT')).toHaveTextContent('2.5 USDT');
    expect(screen.getByText(/Main Wallet/)).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(screen.getByTestId('ton-address-pill')).toHaveTextContent(/^0Q/);
  });

  it('queries the exact testnet address it displays (same 256-bit hash)', async () => {
    const user = userEvent.setup();
    const requested: string[] = [];
    const api: TonReadApi & TonWriteApi = {
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
    };
    renderHome(await unlockedManager(), api);
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });

    await user.click(screen.getByRole('button', { name: 'Receive' }));
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
      // The mainnet raw hash (0:…) must never be queried in testnet mode.
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
    p.assets = [
      { ...native, balanceRaw: '3999999979', balance: '3.999999979', usdValue: 6 },
      ...p.assets.slice(1),
    ];
    renderHome(await unlockedManager(), apiWith(p));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$6.00');
    });
    expect(screen.getByText(/3\.9999 TON ·/)).toBeInTheDocument();
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('3.999999979 TON');
  });

  it('labels bounced refunds instead of presenting them as a send', async () => {
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
    renderHome(await unlockedManager(), apiWith(portfolio(), bounced));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const row = await screen.findByTestId('activity-bounce-1');
    expect(row).toHaveTextContent('Bounced');
    await user.click(row);
    expect(screen.getByRole('dialog', { name: 'Transaction' })).toHaveTextContent('Bounced refund');
  });

  it('masks the balance', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager(), apiWith(portfolio()));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Hide balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('••••');
    await user.click(screen.getByRole('button', { name: 'Show balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
  });

  it('shows a loading skeleton, never a false $0.00', async () => {
    let resolve!: (value: TonPortfolio) => void;
    const pending = new Promise<TonPortfolio>((res) => {
      resolve = res;
    });
    renderHome(
      await unlockedManager(),
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
    const api: TonReadApi & TonWriteApi = {
      getPortfolio: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new TonApiError('offline'));
        return Promise.resolve(portfolio());
      },
      getActivity: () => Promise.resolve([]),
      getWalletState: () => Promise.reject(new Error('not used')),
      emulate: () => Promise.reject(new Error('not used')),
      broadcast: () => Promise.reject(new Error('not used')),
    };
    renderHome(await unlockedManager(), api);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Offline/);
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('—');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('—');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
  });

  it('Receive sheet shows the testnet address and an inline QR code', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager(), apiWith(portfolio()));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive' });
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^0Q/);
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(/^0x/);
    expect(dialog.querySelector('svg[role="img"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));
  });

  it('renders activity and opens a sanitized detail view', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager(), apiWith(portfolio(), ACTIVITY));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByTestId('activity-tx-1')).toHaveTextContent('+2 TON');
    await user.click(screen.getByTestId('activity-tx-1'));
    const dialog = screen.getByRole('dialog', { name: 'Transaction' });
    expect(dialog).toHaveTextContent('hello [link removed]');
    expect(dialog.querySelector('a')?.getAttribute('href')).toContain('testnet.tonviewer.com');
  });

  it('shows the empty activity state', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager(), apiWith(portfolio(), []));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText(/No transactions yet/)).toBeInTheDocument();
  });

  it('ton-native-only hides TRON/EVM assets and addresses', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager('ton-native-only'), apiWith(portfolio()));
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    expect(screen.queryByTestId('asset-TRX')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asset-ETH')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^0Q/);
    expect(screen.queryByTestId('address-TRON')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
  });

  it('runs the send flow from signed payload + emulation, rejecting mainnet prefixes', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    const info = manager.getSession()?.getPublicInfo(0);
    if (!info) throw new Error('no info');
    const api: TonReadApi & TonWriteApi = {
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
    };
    renderHome(manager, api);
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send TON' });

    await user.type(
      within(dialog).getByLabelText('Recipient'),
      `EQ${info.ton.addressTestnetNonBounceable.slice(2)}`,
    );
    await user.type(within(dialog).getByLabelText('Amount'), '0.1');
    await user.click(within(dialog).getByRole('button', { name: 'Review transfer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Mainnet-only/);

    await user.clear(within(dialog).getByLabelText('Recipient'));
    await user.type(
      within(dialog).getByLabelText('Recipient'),
      info.ton.addressTestnetNonBounceable,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByText(/First send — deploys Wallet V5R1/)).toBeInTheDocument();
    expect(screen.getByText(/Fee:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm & Send' }));
    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText(/testnet\.tonviewer\.com\/message/)).toBeInTheDocument();
  });

  it('wires lock and settings buttons', async () => {
    const user = userEvent.setup();
    const onLock = vi.fn();
    const onSettings = vi.fn();
    const manager = await unlockedManager();
    render(
      <TelegramProvider>
        <HomeScreen
          manager={manager}
          onLock={onLock}
          onSettings={onSettings}
          api={apiWith(portfolio())}
        />
      </TelegramProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Lock' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onLock).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledOnce();
  });
});
