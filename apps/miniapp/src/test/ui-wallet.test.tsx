/**
 * Stage C component tests: unlock errors, backoff notice, settings re-auth reveal, wipe.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MNEMONIC_12_HARDHAT, PASS } from './fixtures';
import { makeVault, renderApp } from './ui-helpers';
import { secretHolder } from '../vault/secret-holder';

async function seededVault(): Promise<ReturnType<typeof makeVault>> {
  const vault = makeVault();
  const imported = await vault.manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
  expect(imported.ok).toBe(true);
  return vault;
}

async function unlockUi(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('heading', { name: 'Welcome back' });
  await user.type(screen.getByLabelText('PIN'), PASS);
  await user.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByRole('heading', { name: 'Your wallet' });
}

describe('Stage C: unlock and settings', () => {
  it('shows wrong-passcode and then a rate-limit message', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await screen.findByRole('heading', { name: 'Welcome back' });

    await user.type(screen.getByLabelText('PIN'), '1357');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');

    await user.type(screen.getByLabelText('PIN'), '1357');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Too many attempts/);
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('reveals the phrase only after re-authentication and clears it on leaving', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await unlockUi(user);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText('Enter your passcode to continue'), PASS);
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    await screen.findByRole('heading', { name: 'Your recovery phrase' });

    const node = screen.getByTestId('phrase-words');
    expect(node.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: 'Show recovery phrase' }));
    await waitFor(() => {
      expect(node.textContent).not.toBe('');
    });
    const words = Array.from(node.querySelectorAll('span')).map((el) =>
      el.textContent.replace(/^\d+\.\s*/, ''),
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(document.body.textContent).not.toContain(words.join(' '));
    expect(document.body.textContent.toLowerCase()).not.toContain('junk');
    expect(secretHolder.has()).toBe(false);
  });

  it('a wrong passcode in settings does not open the phrase', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText('Enter your passcode to continue'), '1357');
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passcode');
    expect(screen.queryByRole('heading', { name: 'Your recovery phrase' })).not.toBeInTheDocument();
    expect(secretHolder.has()).toBe(false);
  });

  it('offers no biometric unlock when the adapter reports unavailable', async () => {
    const user = userEvent.setup();
    renderApp(await seededVault());
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(
      screen.queryByRole('button', { name: 'Unlock with biometrics' }),
    ).not.toBeInTheDocument();
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('heading', { name: /Biometric unlock/ })).not.toBeInTheDocument();
  });

  it('wipes the wallet after typed confirmation', async () => {
    const user = userEvent.setup();
    const vault = await seededVault();
    renderApp(vault);
    await unlockUi(user);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });

    await user.type(screen.getByLabelText(/Type WIPE to confirm/), 'WIPE');
    await user.click(screen.getByRole('button', { name: 'Wipe' }));
    await screen.findByRole('heading', { name: 'Your keys, your coins' });
    expect(await vault.manager.hasVault()).toBe(false);
    expect(secretHolder.has()).toBe(false);
  });
});
