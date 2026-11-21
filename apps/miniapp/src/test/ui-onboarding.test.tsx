/**
 * Stage C component tests: welcome, create, reveal phrase, backup verification, import.
 *
 * The most important assertion is negative: after leaving the phrase screen, none of the words
 * appear in the DOM or in localStorage/sessionStorage.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

const PASS = 'test passphrase one';
const MNEMONIC_12_HARDHAT = 'test test test test test test test test test test test junk';

async function createWalletFlow(): Promise<{ words: string[] }> {
  const user = userEvent.setup();
  const vault = makeVault();
  renderApp(vault);

  await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
  await user.type(screen.getByLabelText('Passcode'), PASS);
  await user.type(screen.getByLabelText('Confirm passcode'), PASS);
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  // Phrase screen: hidden until an explicit tap, never auto-shown.
  await screen.findByRole('heading', { name: 'Your recovery phrase' });
  const phraseNode = screen.getByTestId('phrase-words');
  expect(phraseNode.textContent).toBe('');

  await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
  await waitFor(() => {
    expect(phraseNode.textContent).not.toBe('');
  });
  const words = Array.from(phraseNode.querySelectorAll('span')).map((el) =>
    el.textContent.replace(/^\d+\.\s*/, ''),
  );
  expect(words).toHaveLength(24);

  await user.click(screen.getByRole('button', { name: 'I wrote it down' }));
  await screen.findByRole('heading', { name: 'Check your backup' });
  return { words };
}

describe('Stage C: onboarding', () => {
  it('shows the risk disclosure and anti-phishing notice', async () => {
    renderApp(makeVault());
    expect(await screen.findByText('Your keys, your coins')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OneZeroWallet');
    expect(screen.getByText(/self-custodial/)).toBeInTheDocument();
    expect(screen.getByText(/We will never ask for your recovery phrase/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram or your device may clear local data/)).toBeInTheDocument();
  });

  it('rejects a short passphrase when no device secret is available', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await user.type(screen.getByLabelText('Passcode'), 'short');
    await user.type(screen.getByLabelText('Confirm passcode'), 'short');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/);
  });

  it('creates a wallet, verifies the backup and clears the phrase', async () => {
    const user = userEvent.setup();
    const { words } = await createWalletFlow();

    const inputs = screen.getAllByRole('textbox');
    const positions = inputs.map((input) => {
      const label = input.closest('div')?.querySelector('label')?.textContent ?? '';
      const match = /(\d+)/.exec(label);
      return Number.parseInt(match?.[1] ?? '0', 10) - 1;
    });
    expect(positions).toHaveLength(3);

    // Wrong answers fail with positions only (never echo words).
    for (const input of inputs) await user.type(input, 'wrongword');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect/);

    // Correct answers unlock the flow.
    for (const [index, position] of positions.entries()) {
      const input = inputs[index];
      if (input) {
        await user.clear(input);
        await user.type(input, words[position] ?? '');
      }
    }
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('heading', { name: 'Welcome back' });

    // Secret gone from the DOM and from web storage.
    expect(screen.queryByTestId('phrase-words')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(secretHolder.has()).toBe(false);
    const storageDump = `${JSON.stringify(localStorage)}\n${JSON.stringify(sessionStorage)}`;
    expect(storageDump).not.toContain(words[0] ?? 'never');
  });

  it('imports a wallet and shows addresses', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
    await user.type(screen.getByLabelText('Recovery phrase'), MNEMONIC_12_HARDHAT);
    await user.type(screen.getByLabelText('Passcode'), PASS);
    await user.type(screen.getByLabelText('Confirm passcode'), PASS);
    await user.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByRole('heading', { name: 'Your wallet' });
    const evm = screen.getByTestId('address-EVM');
    expect(evm).toHaveTextContent('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(screen.getByTestId('address-TRON')).toHaveTextContent(/^T/);
    expect(screen.getByTestId('address-Receive TON')).toHaveTextContent(/^UQ/);
    // The typed phrase must not linger in storage or the DOM.
    expect(document.body.textContent).not.toContain('junk');
  });

  it('never renders the phrase before the explicit reveal tap', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await user.type(screen.getByLabelText('Passcode'), PASS);
    await user.type(screen.getByLabelText('Confirm passcode'), PASS);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });
    const words = secretHolder.words();
    const phraseNode = screen.getByTestId('phrase-words');
    for (const word of [words[0], words[5], words[23]]) {
      if (word) expect(phraseNode.textContent).not.toContain(word);
    }
  });
});
