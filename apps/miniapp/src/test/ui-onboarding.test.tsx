/**
 * Onboarding component tests: Create (phrase -> verify -> passcode), Import (12/24 grid with
 * smart paste -> passcode) and the security invariant that no phrase survives the flow.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

const PASS = 'test passphrase one';
const MNEMONIC_12 = 'test test test test test test test test test test test junk';

function phraseWords(): string[] {
  return Array.from(screen.getByTestId('phrase-words').querySelectorAll('[data-role="word"]')).map(
    (el) => el.textContent,
  );
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

  const checkbox = screen.getByLabelText("I've stored the seed phrase in a secure place.");
  const next = screen.getByRole('button', { name: 'Next' });
  expect(next).toBeDisabled();
  await user.click(checkbox);
  expect(next).toBeEnabled();
  await user.click(next);

  await screen.findByRole('heading', { name: 'Check your backup' });
  const inputs = screen.getAllByRole('textbox');
  for (const input of inputs) {
    const label = input.closest('div')?.querySelector('label')?.textContent ?? '';
    const position = Number.parseInt(/(\d+)/.exec(label)?.[1] ?? '0', 10) - 1;
    await user.type(input, words[position] ?? '');
  }
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: 'Set a passcode' });
  return words;
}

describe('Onboarding: create', () => {
  it('warns about local data, never asks for the phrase, and has no wallet-type selector', async () => {
    renderApp(makeVault());
    expect(await screen.findByText('Your keys, your coins')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OneZeroWallet');
    expect(screen.getByText(/self-custodial/)).toBeInTheDocument();
    expect(screen.getByText(/We will never ask for your recovery phrase/)).toBeInTheDocument();
    expect(screen.getByText(/may clear local data/)).toBeInTheDocument();
    expect(screen.queryByText('Wallet type')).not.toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
  });

  it('phrase is hidden until revealed and Next requires reveal + checkbox', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Create a wallet' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });
    expect(screen.getByTestId('phrase-words').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(phraseWords()).toHaveLength(24);
    });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('creates the wallet after verify + passcode and clears the phrase', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    const words = await createToPasscode(user);

    expect(screen.getByText(/Minimum 12 characters/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode', { exact: true }), PASS);
    await user.type(screen.getByLabelText('Confirm passcode'), PASS);
    expect(screen.getByRole('status')).toHaveTextContent(/Requirements met/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Your wallet' });
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(/^0x/);
    expect(screen.queryByTestId('phrase-words')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(secretHolder.has()).toBe(false);
    const dump = `${JSON.stringify(localStorage)}\n${JSON.stringify(sessionStorage)}`;
    expect(dump).not.toContain(words[0] ?? 'never');
  });

  it('shows the device-secret PIN/password requirements and accepts a 6-digit PIN', async () => {
    const user = userEvent.setup();
    renderApp(makeVault({ secure: true }));
    await createToPasscode(user);
    expect(screen.getByText(/6\+ digit PIN/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode', { exact: true }), '482915');
    await user.type(screen.getByLabelText('Confirm passcode'), '482915');
    expect(screen.getByRole('status')).toHaveTextContent(/Requirements met/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Your wallet' });
  });

  it('rejects a trivial PIN when a device secret exists', async () => {
    const user = userEvent.setup();
    renderApp(makeVault({ secure: true }));
    await createToPasscode(user);
    await user.type(screen.getByLabelText('Passcode', { exact: true }), '123456');
    await user.type(screen.getByLabelText('Confirm passcode'), '123456');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too easy to guess/);
  });

  it('rejects a short passphrase and stays on the passcode step', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await createToPasscode(user);
    await user.type(screen.getByLabelText('Passcode', { exact: true }), 'short');
    await user.type(screen.getByLabelText('Confirm passcode'), 'short');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12 characters/);
    expect(screen.getByRole('heading', { name: 'Set a passcode' })).toBeInTheDocument();
  });
});

describe('Onboarding: import', () => {
  it('shows 24 boxes by default, switches to 12, fills from a paste, and imports', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
    await screen.findByRole('heading', { name: 'Import a wallet' });
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
    await user.type(screen.getByLabelText('Passcode', { exact: true }), PASS);
    await user.type(screen.getByLabelText('Confirm passcode'), PASS);
    await user.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByRole('heading', { name: 'Your wallet' });
    expect(screen.getByTestId('address-EVM')).toHaveTextContent(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
    expect(secretHolder.has()).toBe(false);
  });

  it('auto-switches from 24 to 12 when a 12-word phrase is pasted', async () => {
    const user = userEvent.setup();
    renderApp(makeVault());
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
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
    await user.click(await screen.findByRole('button', { name: 'Import a wallet' }));
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
    expect(screen.getByLabelText('Word 1', { exact: true }).className).toContain('border-red-500');
    expect(screen.getByRole('heading', { name: 'Import a wallet' })).toBeInTheDocument();
  });
});
