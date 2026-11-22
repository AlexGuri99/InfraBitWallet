/**
 * Home redesign tests: hero card, tabs, action grid, asset list with inline badges, the Receive
 * sheet with real vault-derived addresses, and ton-native-only filtering.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import { TelegramProvider } from '../telegram/TelegramProvider';
import { HomeScreen } from '../ui/wallet';
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

function renderHome(
  manager: VaultManager,
  handlers: { onLock?: () => void; onSettings?: () => void } = {},
) {
  return render(
    <TelegramProvider>
      <HomeScreen
        manager={manager}
        onLock={handlers.onLock ?? (() => {})}
        onSettings={handlers.onSettings ?? (() => {})}
      />
    </TelegramProvider>,
  );
}

describe('Home: wallet dashboard', () => {
  it('shows the hero card, tabs, actions and assets with badges', async () => {
    renderHome(await unlockedManager());
    expect(screen.getByRole('heading', { name: 'Your wallet' })).toBeInTheDocument();
    expect(screen.getByText('Main Wallet')).toBeInTheDocument();
    expect(screen.getByText('Testnet')).toBeInTheDocument();
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$0.00');
    expect(screen.getByRole('tab', { name: 'Wallet' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'false');

    for (const action of ['Receive', 'Send', 'Swap', 'Stake']) {
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    }

    expect(screen.getByTestId('asset-TON')).toHaveTextContent('Toncoin');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('TON');
    expect(screen.getByTestId('asset-USDT')).toHaveTextContent('Tether USD');
    expect(screen.getByTestId('asset-USDT')).toHaveTextContent('TON · Jetton');
    expect(screen.getByTestId('asset-TRX')).toHaveTextContent('TRC-20');
    expect(screen.getByTestId('asset-ETH')).toHaveTextContent('ERC-20');
    expect(screen.getByTestId('asset-TON')).toHaveTextContent('0 TON');
    expect(screen.getByTestId('asset-ETH')).toHaveTextContent('0 ETH');
  });

  it('masks and unmasks the balance', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByRole('button', { name: 'Hide balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('••••');
    await user.click(screen.getByRole('button', { name: 'Show balance' }));
    expect(screen.getByTestId('hero-balance')).toHaveTextContent('$0.00');
  });

  it('switches to Activity and shows the empty state', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText(/No transactions yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('asset-TON')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Wallet' }));
    expect(screen.getByTestId('asset-TON')).toBeInTheDocument();
  });

  it('Receive sheet shows the real derived TON, TRON and EVM addresses', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    const dialog = screen.getByRole('dialog', { name: 'Receive' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^UQ/);
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asset rows open the address sheet for their chain', async () => {
    const user = userEvent.setup();
    renderHome(await unlockedManager());
    await user.click(screen.getByTestId('asset-TRX'));
    const dialog = screen.getByRole('dialog', { name: 'Receive' });
    expect(dialog).toHaveTextContent('TRON');
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
  });

  it('action buttons open their notices and lock/settings callbacks fire', async () => {
    const user = userEvent.setup();
    const onLock = vi.fn();
    const onSettings = vi.fn();
    renderHome(await unlockedManager(), { onLock, onSettings });

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('dialog', { name: 'Send' })).toHaveTextContent(/P2/);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.getByRole('dialog', { name: 'Swap' })).toHaveTextContent(/Coming soon/);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Lock' }));
    expect(onLock).toHaveBeenCalledOnce();
  });

  it('ton-native-only hides TRON/EVM assets and addresses', async () => {
    renderHome(await unlockedManager('ton-native-only'));
    expect(screen.getByTestId('asset-TON')).toBeInTheDocument();
    expect(screen.getByTestId('asset-USDT')).toBeInTheDocument();
    expect(screen.queryByTestId('asset-TRX')).not.toBeInTheDocument();
    expect(screen.queryByTestId('asset-ETH')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Receive' }));
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^UQ/);
    expect(screen.queryByTestId('address-TRON')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
  });
});
