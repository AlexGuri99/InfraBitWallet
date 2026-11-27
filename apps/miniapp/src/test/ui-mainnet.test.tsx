/**
 * Network wiring: the server (`/api/ton/config`) decides mainnet vs testnet. These tests drive
 * the UI with an explicit config and assert address forms, labels, explorer links, send
 * validation and the TON-only deposit surface for BOTH networks.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonPortfolio } from '@onezerowallet/chain-ton';
import type { TonReadApi, TonStakeApi, TonSwapApi, TonWriteApi } from '../ton/api';
import type { TonConfig } from '../ui/network';
import { TxDetailScreen } from '../ui/tx-detail';
import { renderWithProviders, makeVault, renderShell } from './ui-helpers';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

const MAINNET: TonConfig = {
  network: 'mainnet',
  swapEnabled: true,
  stakingEnabled: true,
  swapFeeBps: 35,
  referralConfigured: true,
};

const TESTNET: TonConfig = {
  network: 'testnet',
  swapEnabled: false,
  stakingEnabled: false,
  swapFeeBps: 0,
  referralConfigured: false,
};

function portfolio(network: 'mainnet' | 'testnet'): TonPortfolio {
  return {
    address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
    network,
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
    ],
    updatedAt: 1_700_000_000_000,
    source: 'toncenter',
  };
}

interface ApiCalls {
  portfolio: Array<{ address: string; network: string }>;
  walletState: Array<{ address: string; network: string }>;
  emulate: Array<{ boc: string; network: string }>;
  broadcast: Array<{ boc: string; network: string }>;
}

function apiWith(network: 'mainnet' | 'testnet'): {
  api: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi;
  calls: ApiCalls;
} {
  const calls: ApiCalls = { portfolio: [], walletState: [], emulate: [], broadcast: [] };
  return {
    calls,
    api: {
      getPortfolio: (address, net) => {
        calls.portfolio.push({ address, network: net });
        return Promise.resolve(portfolio(network));
      },
      getActivity: () => Promise.resolve([]),
      getWalletState: (address, net) => {
        calls.walletState.push({ address, network: net });
        return Promise.resolve({
          address,
          network: net,
          status: 'active',
          seqno: 1,
          balanceRaw: '2000000000',
          source: 'toncenter',
        });
      },
      emulate: (boc, net) => {
        calls.emulate.push({ boc, network: net });
        return Promise.resolve({
          ok: true,
          estimatedFeeRaw: '1000000',
          balanceChanges: [{ assetId: 'ton', symbol: 'TON', deltaRaw: '-101000000', decimals: 9 }],
          warnings: [],
          willBounce: false,
        });
      },
      broadcast: (boc, net) => {
        calls.broadcast.push({ boc, network: net });
        return Promise.resolve({ messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' } });
      },
      getSwapAssets: () => Promise.reject(new Error('not used')),
      getSwapQuote: () => Promise.reject(new Error('not used')),
      getStakingInfo: () => Promise.reject(new Error('not used')),
    },
  };
}

async function unlockedManager(): Promise<VaultManager> {
  const manager = new VaultManager({ sealStorage: new InMemoryStorage(), config: FAST });
  const imported = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
  expect(imported.ok).toBe(true);
  const unlocked = await manager.unlock(PASS);
  expect(unlocked.success).toBe(true);
  return manager;
}

describe('mainnet network wiring', () => {
  it('shows mainnet UQ addresses, no TESTNET badge, and TON-only deposit', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    const { api, calls } = apiWith('mainnet');
    renderShell({ ...makeVault(), manager }, api, { tonConfig: MAINNET });

    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    expect(screen.getByTestId('ton-address-pill')).toHaveTextContent(/^UQ/);
    expect(screen.queryByText('Testnet')).not.toBeInTheDocument();
    expect(calls.portfolio[0]?.network).toBe('mainnet');
    expect(calls.portfolio[0]?.address).toMatch(/^UQ/);

    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^UQ/);
    expect(screen.queryByTestId('address-TRON')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TRON' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EVM' })).not.toBeInTheDocument();
  });

  it('validates send recipients against the active network and signs on mainnet', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    const { api, calls } = apiWith('mainnet');
    const info = manager.getSession()?.getPublicInfo(0);
    if (!info) throw new Error('missing session info');
    renderShell({ ...makeVault(), manager }, api, { tonConfig: MAINNET });

    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Send / Sell' }));
    await screen.findByRole('heading', { name: 'Send TON' });
    await user.type(screen.getByLabelText('Amount'), '0.1');

    // A testnet-only address is rejected on mainnet.
    await user.type(
      screen.getByLabelText('Recipient'),
      '0QDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY',
    );
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Testnet-only address/);

    // The wallet's own mainnet UQ address is accepted and the request is mainnet-scoped.
    await user.clear(screen.getByLabelText('Recipient'));
    await user.type(screen.getByLabelText('Recipient'), info.ton.addressNonBounceable);
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    await screen.findByRole('heading', { name: 'Review transfer' });
    expect(calls.walletState.at(-1)?.network).toBe('mainnet');
    expect(calls.emulate.at(-1)?.network).toBe('mainnet');
    // Review shows the mainnet user-friendly form, never a testnet kQ/0Q address.
    expect(screen.queryByText(/^(?:kQ|0Q)/)).not.toBeInTheDocument();
  }, 30_000);

  it('testnet keeps 0Q addresses and the TESTNET badge while rejecting mainnet prefixes', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    const { api, calls } = apiWith('testnet');
    renderShell({ ...makeVault(), manager }, api, { tonConfig: TESTNET });

    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    expect(screen.getByTestId('ton-address-pill')).toHaveTextContent(/^0Q/);
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(calls.portfolio[0]?.network).toBe('testnet');

    await user.click(screen.getByRole('button', { name: 'Send / Sell' }));
    await screen.findByRole('heading', { name: 'Send TON' });
    await user.type(screen.getByLabelText('Amount'), '0.1');
    await user.type(
      screen.getByLabelText('Recipient'),
      'UQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY',
    );
    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Mainnet-only address/);
  }, 30_000);

  it('renders mainnet explorer links and UQ counterparties on the transaction detail', () => {
    renderWithProviders(
      <TxDetailScreen
        item={{
          id: 'tx-mainnet',
          direction: 'in',
          standard: 'native',
          symbol: 'TON',
          decimals: 9,
          amountRaw: '2000000000',
          amount: '2',
          counterparty: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
          timestamp: 1_700_000_000,
          feeRaw: '1000000',
          fee: '0.001',
          status: 'ok',
          hash: 'AAAA',
          comment: null,
          isScam: false,
        }}
        network="mainnet"
        onBack={() => undefined}
        onRepeat={() => undefined}
      />,
    );
    const explorer = screen.getByRole('link', { name: 'tonviewer.com' });
    expect(explorer.getAttribute('href')).toMatch(/^https:\/\/tonviewer\.com\/transaction\/0+$/);
    expect(document.body.textContent).toMatch(/UQ[A-Za-z0-9_-]{20,}/);
    expect(screen.queryByText('testnet.tonviewer.com')).not.toBeInTheDocument();
    expect(screen.queryByText(/TON Testnet/)).not.toBeInTheDocument();
  });
});
