/**
 * Earn screen component test: mocked same-origin staking info/emulate/broadcast.
 * Covers the live overview, the 1 TON minimum, the Max gas reserve, the decoded-payload review
 * with unstake modes, fail-closed emulation and the unavailable network state.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonPortfolio } from '@onezerowallet/chain-ton';
import { UI_TON_NETWORK } from '../ui/wallet-shell';
import type {
  EmulationPayload,
  StakingInfoPayload,
  TonReadApi,
  TonStakeApi,
  TonSwapApi,
  TonWriteApi,
} from '../ton/api';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderShell } from './ui-helpers';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

const TON_POOL = '0:a45b17f28409229b78360e3290420f13e4fe20f90d7e2bf8c4ac6703259e22fa';
const TS_TON_MASTER = '0:bdf3fa8098d129b54b4f73b5bac5d1e1fd91eb054169c3916dfc8ccd536d1000';
const TS_TON_WALLET = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function stakingInfo(): StakingInfoPayload {
  return {
    network: 'testnet',
    poolAddress: TON_POOL,
    tsTonMasterAddress: TS_TON_MASTER,
    tsTonSymbol: 'tsTON',
    tsTonDecimals: 9,
    apy: 12.84,
    tvlRaw: '153977655101523586',
    stakers: 147_970,
    instantLiquidityRaw: '1006115160479073',
    exchangeRate: 1.2,
    verified: true,
    updatedAt: 0,
  };
}

function portfolio(): TonPortfolio {
  return {
    address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
    network: UI_TON_NETWORK,
    status: 'active',
    balanceRaw: '10000000000',
    balance: '10',
    priceUsd: 1.5,
    change24h: 2,
    totalUsd: 15,
    assets: [
      {
        id: 'ton',
        symbol: 'TON',
        name: 'Toncoin',
        decimals: 9,
        standard: 'native',
        balanceRaw: '10000000000',
        balance: '10',
        usdValue: 15,
      },
      {
        id: TS_TON_MASTER,
        symbol: 'tsTON',
        name: 'Tonstakers TON',
        decimals: 9,
        standard: 'jetton',
        balanceRaw: '5000000000',
        balance: '5',
        usdValue: null,
        jettonWalletAddress: TS_TON_WALLET,
      },
    ],
    updatedAt: 1_700_000_000_000,
    source: 'toncenter',
  };
}

function apiWith(
  overrides: {
    info?: (() => Promise<StakingInfoPayload>) | undefined;
    emulate?: (() => Promise<EmulationPayload>) | undefined;
  } = {},
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
        balanceRaw: '10000000000',
        source: 'toncenter',
      }),
    emulate:
      overrides.emulate ??
      (() =>
        Promise.resolve({
          ok: true,
          estimatedFeeRaw: '31000000',
          balanceChanges: [],
          warnings: [],
          willBounce: false,
        })),
    broadcast: () => Promise.resolve({ messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' } }),
    getSwapAssets: () => Promise.reject(new Error('not used')),
    getSwapQuote: () => Promise.reject(new Error('not used')),
    getStakingInfo: overrides.info ?? (() => Promise.resolve(stakingInfo())),
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

async function openEarn(api: TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi): Promise<void> {
  const manager = await unlockedManager();
  renderShell({ ...makeVault(), manager }, api);
  await waitFor(() => {
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$15.00');
  });
  await userEvent.setup().click(screen.getByRole('button', { name: 'Earn' }));
  expect(await screen.findByRole('heading', { name: 'Add Stake' })).toBeInTheDocument();
}

describe('Earn (live Tonstakers)', () => {
  it('renders live pool metrics and enforces the 1 TON minimum', async () => {
    const user = userEvent.setup();
    await openEarn(apiWith());

    expect(await screen.findByTestId('earn-apy')).toHaveTextContent('12.84% APY');
    expect(screen.getByText('5 tsTON')).toBeInTheDocument();
    expect(screen.getAllByText('1 tsTON ≈ 1.2000 TON').length).toBeGreaterThan(0);
    expect(screen.getByText('153977655.1 TON')).toBeInTheDocument();
    expect(screen.getByText('147,970')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Stake amount'), '0.5');
    await user.click(screen.getByRole('button', { name: 'Review stake' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Minimum stake is 1 TON');
    // Nothing was built or emulated.
    expect(screen.queryByRole('heading', { name: 'Review stake' })).not.toBeInTheDocument();
  });

  it('fills Max with the 1.1 TON gas reserve', async () => {
    const user = userEvent.setup();
    await openEarn(apiWith());
    await screen.findByTestId('earn-apy');
    await user.click(screen.getByRole('button', { name: 'Max' }));
    expect(screen.getByLabelText('Stake amount')).toHaveValue('8.9');
  });

  it('reviews the decoded stake payload and submits', async () => {
    const user = userEvent.setup();
    await openEarn(apiWith());
    await screen.findByTestId('earn-apy');

    await user.type(screen.getByLabelText('Stake amount'), '2');
    await user.click(screen.getByRole('button', { name: 'Review stake' }));
    expect(await screen.findByRole('heading', { name: 'Review stake' })).toBeInTheDocument();
    expect(screen.getByText('2 TON')).toBeInTheDocument();
    expect(screen.getByText('1 TON')).toBeInTheDocument(); // gas reserve line
    expect(screen.getByText('0%')).toBeInTheDocument(); // no wallet fee
    // Recipient is the pool, shown in testnet user-friendly form.
    expect(document.body.textContent).toMatch(/kQ[0-9A-Za-z_-]{46}/);

    await user.click(screen.getByRole('button', { name: 'Confirm & Stake' }));
    expect(await screen.findByRole('heading', { name: 'Staking submitted' })).toBeInTheDocument();
    expect(screen.getByText(/testnet\.tonviewer\.com\/message/)).toBeInTheDocument();
  });

  it('unstakes with a selectable mode and burns tsTON', async () => {
    const user = userEvent.setup();
    await openEarn(apiWith());
    await screen.findByTestId('earn-apy');

    await user.click(screen.getByRole('button', { name: 'Unstake' }));
    await user.type(screen.getByLabelText('Unstake amount'), '5');
    await user.click(screen.getByRole('button', { name: 'Instant' }));
    await user.click(screen.getByRole('button', { name: 'Review unstake' }));

    expect(await screen.findByRole('heading', { name: 'Review unstake' })).toBeInTheDocument();
    expect(screen.getAllByText('5 tsTON').length).toBeGreaterThan(0);
    expect(screen.getByText('Instant')).toBeInTheDocument();
    expect(screen.getByText('≈ 6 TON')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm & Unstake' }));
    expect(await screen.findByRole('heading', { name: 'Staking submitted' })).toBeInTheDocument();
    // The submitted amount is the burned tsTON, not a fabricated TON credit.
    expect(screen.getAllByText('5 tsTON').length).toBeGreaterThan(0);
  });

  it('fails closed when emulation does not succeed', async () => {
    const user = userEvent.setup();
    await openEarn(
      apiWith({
        emulate: () =>
          Promise.resolve({
            ok: false,
            estimatedFeeRaw: '0',
            balanceChanges: [],
            warnings: ['Emulation returned no transactions'],
            willBounce: false,
          }),
      }),
    );
    await screen.findByTestId('earn-apy');
    await user.type(screen.getByLabelText('Stake amount'), '2');
    await user.click(screen.getByRole('button', { name: 'Review stake' }));
    expect(await screen.findByRole('heading', { name: 'Review stake' })).toBeInTheDocument();
    expect(screen.getByText('Emulation failed — sending is disabled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm & Stake' })).toBeDisabled();
  });

  it('shows a clean unavailable state on testnet', async () => {
    const user = userEvent.setup();
    await openEarn(apiWith({ info: () => Promise.reject(new Error('staking_unavailable')) }));
    expect(await screen.findByText(/Staking is unavailable on this network/)).toBeInTheDocument();
    expect(screen.queryByTestId('earn-apy')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Stake amount'), '2');
    expect(screen.getByRole('button', { name: 'Review stake' })).toBeDisabled();
  });
});
