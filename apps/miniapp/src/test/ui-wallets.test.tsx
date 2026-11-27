/**
 * InfraBit logo, tab-separated recovery-phrase copying and the multi-wallet manager UI.
 *
 * The vault is a real VaultManager over in-memory adapters (fast KDF); the TON read API is a
 * stub so nothing leaves the test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InMemoryStorage, VaultManager } from '@onezerowallet/crypto-vault';
import type { TonPortfolio } from '@onezerowallet/chain-ton';
import type { TonReadApi, TonStakeApi, TonSwapApi, TonWriteApi } from '../ton/api';
import { UI_TON_NETWORK } from '../ui/wallet-shell';
import { shortAddress } from '../ui/asset';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderApp, renderShell } from './ui-helpers';
import {
  cancelClipboardClear,
  copyPhraseToClipboard,
  PHRASE_CLIPBOARD_CLEAR_MS,
  phraseClipboardText,
} from '../ui/clipboard';
import { secretHolder } from '../vault/secret-holder';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };

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
    ],
    updatedAt: 1_700_000_000_000,
    source: 'toncenter',
  };
}

function apiStub(): TonReadApi & TonWriteApi & TonSwapApi & TonStakeApi {
  return {
    getPortfolio: () => Promise.resolve(portfolio()),
    getActivity: () => Promise.resolve([]),
    getWalletState: () => Promise.reject(new Error('not used')),
    emulate: () => Promise.reject(new Error('not used')),
    broadcast: () => Promise.reject(new Error('not used')),
    getSwapAssets: () => Promise.reject(new Error('not used')),
    getSwapQuote: () => Promise.reject(new Error('not used')),
    getStakingInfo: () => Promise.reject(new Error('not used')),
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

function installClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function phraseWordsInDom(): string[] {
  return Array.from(screen.getByTestId('phrase-words').querySelectorAll('[data-role="word"]')).map(
    (element) => element.textContent,
  );
}

afterEach(() => {
  cancelClipboardClear();
  secretHolder.clear();
});

describe('InfraBit logo', () => {
  it('replaces the monogram on the welcome screen', async () => {
    renderApp(makeVault());
    const logo = await screen.findByTestId('infrabit-logo');
    expect(logo.getAttribute('src')).toContain('infrabit-logo');
    expect(logo).toHaveAttribute('alt', 'InfraBit');
  });

  it('renders on the unlock screen and the settings card', async () => {
    const vault = makeVault();
    const seeded = await vault.manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(seeded.ok).toBe(true);
    const unlock = renderApp(vault);
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByTestId('infrabit-logo').getAttribute('src')).toContain('infrabit-logo');
    unlock.unmount();

    renderShell({ ...vault, manager: vault.manager }, apiStub(), { tab: 'settings' });
    expect(await screen.findByTestId('infrabit-logo')).toBeInTheDocument();
  });
});

describe('recovery phrase copy', () => {
  it('copies all words in order separated by tabs', async () => {
    // userEvent installs its own clipboard stub, so install ours AFTER setup().
    const user = userEvent.setup();
    const writeText = installClipboard();
    renderApp(makeVault());

    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });
    await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(phraseWordsInDom()).toHaveLength(24);
    });
    const words = phraseWordsInDom();

    await user.click(screen.getByRole('button', { name: 'Copy phrase' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(words.join('\t'));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(screen.getByText(/cleared after 60 seconds/)).toBeInTheDocument();
  });

  it('joins with tabs and auto-clears the clipboard after one minute', async () => {
    vi.useFakeTimers();
    try {
      const writeText = installClipboard();
      expect(phraseClipboardText(['alpha', 'beta', 'gamma'])).toBe('alpha\tbeta\tgamma');
      await expect(copyPhraseToClipboard(['alpha', 'beta'])).resolves.toBe(true);
      expect(writeText).toHaveBeenLastCalledWith('alpha\tbeta');

      vi.advanceTimersByTime(PHRASE_CLIPBOARD_CLEAR_MS - 1);
      expect(writeText).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2);
      expect(writeText).toHaveBeenLastCalledWith('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('my wallets', () => {
  it('shows the active wallet label in the top pill and opens the manager', async () => {
    const manager = await unlockedManager();
    const user = userEvent.setup();
    renderShell({ ...makeVault(), manager }, apiStub());

    const pill = await screen.findByTestId('wallet-switcher');
    expect(pill).toHaveTextContent('Wallet 1');
    await user.click(pill);
    expect(await screen.findByRole('heading', { name: 'My Wallets' })).toBeInTheDocument();
    expect(screen.getByText('Wallet 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create new wallet' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Import existing wallet' })).toBeEnabled();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('creates a second wallet, switches to it, then removes it with its phrase', async () => {
    const manager = await unlockedManager();
    const user = userEvent.setup();
    renderShell({ ...makeVault(), manager }, apiStub());

    await user.click(await screen.findByRole('button', { name: 'My Wallets — Wallet 1' }));
    await user.click(await screen.findByRole('button', { name: 'Create new wallet' }));

    await user.click(await screen.findByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(phraseWordsInDom()).toHaveLength(24);
    });
    const newWords = phraseWordsInDom();
    await user.click(screen.getByLabelText("I've stored the seed phrase in a secure place."));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByRole('heading', { name: 'Confirm your PIN' });
    await user.type(screen.getByLabelText('Current PIN'), PASS);
    await user.click(screen.getByRole('button', { name: 'Add wallet' }));

    await screen.findByRole('heading', { name: 'My Wallets' });
    await waitFor(() => {
      expect(manager.getSession()?.listWallets()).toHaveLength(2);
    });
    const wallets = manager.getSession()?.listWallets() ?? [];
    const second = wallets.find((wallet) => wallet.label === 'Wallet 2');
    expect(second).toBeDefined();
    if (!second) return;
    expect(second.active).toBe(true);

    // Switch back to the first wallet, then back to the second.
    await user.click(screen.getByRole('button', { name: 'Wallet 1 · Use this wallet' }));
    await waitFor(() => {
      expect(manager.getSession()?.getActiveWalletId()).toBe(wallets[0]?.id);
    });
    await user.click(screen.getByRole('button', { name: /Wallet 2 · Use this wallet/ }));
    await waitFor(() => {
      expect(manager.getSession()?.getActiveWalletId()).toBe(second.id);
    });

    // The home pill shows the active wallet after leaving the manager.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const pill = await screen.findByTestId('wallet-switcher');
    expect(pill).toHaveTextContent('Wallet 2');

    // Remove wallet 2 by typing its recovery phrase (row order = storage order).
    await user.click(pill);
    await screen.findByRole('heading', { name: 'My Wallets' });
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[1] as HTMLElement);
    await screen.findByRole('heading', { name: 'Remove wallet' });
    await user.type(screen.getByLabelText('Recovery phrase'), newWords.join(' '));
    await user.click(screen.getByRole('button', { name: 'Remove wallet' }));

    await screen.findByRole('heading', { name: 'My Wallets' });
    await waitFor(() => {
      expect(manager.getSession()?.listWallets()).toHaveLength(1);
    });
    expect(manager.getSession()?.listWallets()[0]?.label).toBe('Wallet 1');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(secretHolder.has()).toBe(false);
  });

  it('shows each wallet’s testnet address in the list', async () => {
    const manager = await unlockedManager();
    const user = userEvent.setup();
    renderShell({ ...makeVault(), manager }, apiStub());
    await user.click(await screen.findByRole('button', { name: 'My Wallets — Wallet 1' }));
    const address = manager.getSession()?.listWallets()[0]?.tonAddress ?? '';
    expect(address).toMatch(/^0Q/);
    expect(screen.getByText(shortAddress(address, 6, 4))).toBeInTheDocument();
  });
});
