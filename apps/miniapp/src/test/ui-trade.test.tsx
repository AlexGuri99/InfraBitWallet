/**
 * Trade screen component test: mocked same-origin quote/emulate/broadcast.
 * Covers the debounced quote card, the decoded-payload review, and the submitted step.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonPortfolio } from '@onezerowallet/chain-ton';
import { UI_TON_NETWORK } from '../ui/wallet-shell';
import type {
  StakingInfoPayload,
  SwapQuotePayload,
  TonReadApi,
  TonStakeApi,
  TonSwapApi,
  TonWriteApi,
} from '../ton/api';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderShell } from './ui-helpers';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

const NATIVE = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const JETTON = '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const JETTON_WALLET = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const ROUTER = '0:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const PTON_MASTER = '0:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const PTON_WALLET = '0:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

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
        jettonWalletAddress: JETTON_WALLET,
      },
    ],
    updatedAt: 1_700_000_000_000,
    source: 'toncenter',
  };
}

const STAKING_INFO: StakingInfoPayload = {
  network: 'testnet',
  poolAddress: '0:a45b17f28409229b78360e3290420f13e4fe20f90d7e2bf8c4ac6703259e22fa',
  tsTonMasterAddress: '0:bdf3fa8098d129b54b4f73b5bac5d1e1fd91eb054169c3916dfc8ccd536d1000',
  tsTonSymbol: 'tsTON',
  tsTonDecimals: 9,
  apy: 12.84,
  tvlRaw: '150000000000000000',
  stakers: 1000,
  instantLiquidityRaw: '1000000000000000',
  exchangeRate: 1.2,
  verified: true,
  updatedAt: 0,
};

const QUOTE: SwapQuotePayload = {
  network: 'testnet',
  offer: { address: NATIVE, units: '1000000000' },
  ask: { address: JETTON, units: '2500000', minUnits: '2475000' },
  minReceivedRaw: '2475000',
  slippageBps: 100,
  priceImpact: 0.001,
  swapRate: 2.5,
  providerMinUnits: '2475000',
  feeBps: 35,
  feeUnits: '3500',
  referralAddress: null,
  router: {
    address: ROUTER,
    majorVersion: 2,
    minorVersion: 1,
    routerType: 'ConstantProduct',
    ptonMasterAddress: PTON_MASTER,
    ptonWalletAddress: PTON_WALLET,
    ptonVersion: '2.1',
    poolAddress: '0:9999999999999999999999999999999999999999999999999999999999999999',
  },
  direction: 'ton->jetton',
  offerJettonWalletAddress: null,
  askJettonWalletAddress: JETTON_WALLET,
  gas: { gasBudget: '1310000000', forwardGas: '100000000', estimatedGasConsumption: '120000000' },
  quotedAt: 0,
};

function apiWith(
  quote: SwapQuotePayload = QUOTE,
): TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi {
  return {
    getPortfolio: () => Promise.resolve(portfolio()),
    getActivity: () => Promise.resolve([]),
    getWalletState: () =>
      Promise.resolve({
        address: '0:wallet',
        network: 'testnet',
        status: 'active',
        seqno: 5,
        balanceRaw: '1500000000',
        source: 'toncenter',
      }),
    emulate: () =>
      Promise.resolve({
        ok: true,
        estimatedFeeRaw: '31000000',
        balanceChanges: [],
        warnings: [],
        willBounce: false,
      }),
    broadcast: () => Promise.resolve({ messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' } }),
    getSwapAssets: () =>
      Promise.resolve([
        {
          id: 'native',
          symbol: 'TON',
          name: 'Gram',
          decimals: 9,
          kind: 'native',
          contractAddress: NATIVE,
          imageUrl: null,
          verified: true,
        },
        {
          id: JETTON,
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 6,
          kind: 'jetton',
          contractAddress: JETTON,
          imageUrl: null,
          verified: true,
        },
      ]),
    getSwapQuote: () => Promise.resolve(quote),
    getStakingInfo: () => Promise.resolve(STAKING_INFO),
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

describe('Trade (live swap)', () => {
  it('quotes, reviews the decoded payload and submits', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    renderShell({ ...makeVault(), manager }, apiWith());
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });

    await user.click(screen.getByRole('button', { name: 'Trade' }));
    expect(await screen.findByRole('heading', { name: 'Trade' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('You sell amount'), '1');

    // Debounced quote card.
    expect(await screen.findByText('Minimum received')).toBeInTheDocument();
    expect(screen.getAllByText('0.35%').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Review transfer' }));
    expect(await screen.findByRole('heading', { name: 'Review swap' })).toBeInTheDocument();
    // Review renders the decoded payload and the emulated fee.
    expect(screen.getByText(/~0\.031 TON/)).toBeInTheDocument();
    expect(screen.getAllByText(/2\.475 USDT/).length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/kQ[0-9A-Za-z_-]{46}/);

    await user.click(screen.getByRole('button', { name: 'Confirm & Swap' }));
    expect(await screen.findByRole('heading', { name: 'Swap submitted' })).toBeInTheDocument();
    expect(screen.getByText(/testnet\.tonviewer\.com\/message/)).toBeInTheDocument();
  });

  it('disables the swap when the network has no quote endpoint', async () => {
    const user = userEvent.setup();
    const manager = await unlockedManager();
    const api = apiWith();
    api.getSwapAssets = () => Promise.reject(new Error('swap_unavailable'));
    renderShell({ ...makeVault(), manager }, api);
    await waitFor(() => {
      expect(screen.getByTestId('hero-balance')).toHaveTextContent('$2.25');
    });
    await user.click(screen.getByRole('button', { name: 'Trade' }));
    expect(await screen.findByText(/Swaps are unavailable on this network/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review transfer' })).toBeDisabled();
  });
});
