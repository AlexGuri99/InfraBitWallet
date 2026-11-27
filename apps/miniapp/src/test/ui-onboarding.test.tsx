/**
 * Onboarding component tests: Create (phrase -> PIN), Import (12/24 grid with smart paste -> PIN)
 * and the security invariant that no phrase survives the flow.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

const PASS = '258036';
const MNEMONIC_12 = 'test test test test test test test test test test test junk';

function phraseWords(): string[] {
  return Array.from(screen.getByTestId('phrase-words').querySelectorAll('[data-role="word"]')).map(
    (el) => el.textContent,
  );
}

async function answerBackupQuiz(
  user: ReturnType<typeof userEvent.setup>,
  words: string[],
): Promise<void> {
  await screen.findByRole('heading', { name: 'Check your backup' });
  const inputs = screen.getAllByRole('textbox');
  for (const input of inputs) {
    const label = input.closest('div')?.querySelector('label')?.textContent ?? '';
    const position = Number.parseInt(/(\d+)/.exec(label)?.[1] ?? '0', 10) - 1;
    await user.type(input, words[position] ?? '');
  }
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

async function openImport(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
  await user.click(await screen.findByRole('button', { name: /Secret Words/ }));
  await screen.findByRole('heading', { name: 'Import a wallet' });
}

async function createToPasscode(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
  await screen.findByRole('heading', { name: 'Your recovery phrase' });
  expect(screen.getByTestId('phrase-words').textContent).toBe('');

  await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
  await waitFor(() => {
    expect(phraseWords().length).toBeGreaterThan(0);
  });
  const words = phraseWords();
  expect(words).toHaveLength(24);

  const next = screen.getByRole('button', { name: 'Next' });
  expect(next).toBeEnabled();
  await user.click(next);

  // Mandatory 3-word backup verification before the vault can be sealed.
  await answerBackupQuiz(user, words);
  await screen.findByRole('heading', { name: 'Set a passcode' });
  return words;
}

describe('Onboarding: create', () => {
  it('warns about local data, never asks for the phrase, and has no wallet-type selector', async () => {
    renderApp(makeVault());
    expect(await screen.findByText('Your keys, your coins')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('InfraBitWallet');
    expect(screen.getByText(/self-custodial/)).toBeInTheDocument();
    expect(screen.getByText(/We will never ask for your recovery phrase/)).toBeInTheDocument();
    expect(screen.getByText(/may clear local data/)).toBeInTheDocument();
    expect(screen.queryByText('Wallet type')).not.toBeInTheDocument();
  });

  it('phrase is hidden until revealed, then Next leads to the mandatory 3-word quiz', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getByTestId('phrase-words').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(phraseWords()).toHaveLength(24);
    });
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Check your backup' });
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
  });

  it('creates the wallet after phrase + PIN and clears the phrase', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    const words = await createToPasscode(user);

    expect(screen.getByText(/Enter a 6-digit PIN/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN', { exact: true }), PASS);
    await user.type(screen.getByLabelText('Confirm PIN'), PASS);
    expect(screen.getByRole('status')).toHaveTextContent(/Requirements met/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByTestId('hero-balance', {}, { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    // v1 deposit is TON-only: no TRON/EVM addresses can be shown to receive funds.
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^0Q/);
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-TRON')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('phrase-words')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(secretHolder.has()).toBe(false);
    const dump = `${JSON.stringify(localStorage)}\n${JSON.stringify(sessionStorage)}`;
    expect(dump).not.toContain(words[0] ?? 'never');
  }, 30_000);

  it('shows the device-secret PIN requirements and accepts a 6-digit PIN', async () => {
    const user = userEvent.setup();
    renderApp(makeVault({ secure: true }));
    await createToPasscode(user);
    expect(screen.getByText(/Enter a 6-digit PIN/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('PIN', { exact: true }), '258036');
    await user.type(screen.getByLabelText('Confirm PIN'), '258036');
    expect(screen.getByRole('status')).toHaveTextContent(/Requirements met/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByTestId('hero-balance', {}, { timeout: 10_000 });
  });

  it('rejects a trivial PIN when a device secret exists', async () => {
    const user = userEvent.setup();
    renderApp(makeVault({ secure: true }));
    await createToPasscode(user);
    await user.type(screen.getByLabelText('PIN', { exact: true }), '123456');
    await user.type(screen.getByLabelText('Confirm PIN'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too easy to guess/);
  });

  it('rejects a non-6-digit PIN and stays on the passcode step', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await createToPasscode(user);
    await user.type(screen.getByLabelText('PIN', { exact: true }), '123');
    await user.type(screen.getByLabelText('Confirm PIN'), '123');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/6-digit PIN/);
    expect(screen.getByRole('heading', { name: 'Set a passcode' })).toBeInTheDocument();
  });
});

describe('Onboarding: import', () => {
  it('shows 24 boxes by default, switches to 12, fills from a paste, and imports', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await openImport(user);
    expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(24);

    await user.click(screen.getByRole('button', { name: '12 words' }));
    expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(12);

    fireEvent.paste(screen.getByLabelText('Word 1'), {
      clipboardData: { getData: () => MNEMONIC_12 },
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Word 12').value).toBe('junk');
    });
    expect(screen.getByLabelText<HTMLInputElement>('Word 1').value).toBe('test');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Set a passcode' });
    await user.type(screen.getByLabelText('PIN', { exact: true }), PASS);
    await user.type(screen.getByLabelText('Confirm PIN'), PASS);
    await user.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByTestId('hero-balance', {}, { timeout: 10_000 });
    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    expect(screen.getByTestId('address-TON')).toHaveTextContent(/^0Q/);
    expect(screen.queryByTestId('address-EVM')).not.toBeInTheDocument();
    expect(secretHolder.has()).toBe(false);
  });

  it('auto-switches from 24 to 12 when a 12-word phrase is pasted', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await openImport(user);
    fireEvent.paste(screen.getByLabelText('Word 1'), {
      clipboardData: { getData: () => MNEMONIC_12 },
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Word 12').value).toBe('junk');
    });
    expect(screen.getByRole('button', { name: '12 words' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByLabelText(/^Word \d+$/)).toHaveLength(12);
  });

  it('rejects an invalid phrase without echoing words', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await openImport(user);
    await user.click(screen.getByRole('button', { name: '12 words' }));
    fireEvent.paste(screen.getByLabelText('Word 1'), {
      clipboardData: {
        getData: () =>
          'zzsecretzz abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      },
    });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('zzsecretzz');
    expect(screen.getByLabelText('Word 1', { exact: true }).className).toContain('border-negative');
    expect(screen.getByRole('heading', { name: 'Import a wallet' })).toBeInTheDocument();
  });
});
