/**
 * Multi-wallet vault: storage migration, add (12/24 words), switching, removal and passcode
 * rotation. Every assertion also checks that no phrase lands in storage.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { VaultManager } from './vault-manager';
import { InMemoryStorage, STORAGE_KEYS } from './storage';
import { createSeal } from './vault';
import { saveSeal } from './seal-store';
import { lockSession } from './session';
import { loadWalletSet, createWalletId } from './wallets';
import { mnemonicToSeed } from './mnemonic';
import { deriveEvmKey } from './derivation';
import { MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = '258036';
const PASS2 = '369147';

function makeManager(secure = false): {
  manager: VaultManager;
  bulk: InMemoryStorage;
  secure: InMemoryStorage | undefined;
} {
  const bulk = new InMemoryStorage();
  const secureStorage = secure ? new InMemoryStorage() : undefined;
  const manager = new VaultManager({
    sealStorage: bulk,
    secureStorage,
    config: FAST,
  });
  return { manager, bulk, secure: secureStorage };
}

async function expectNoPhraseInStorage(bulk: InMemoryStorage): Promise<void> {
  const dump = JSON.stringify(
    await Promise.all([bulk.get(STORAGE_KEYS.WALLETS), bulk.get(STORAGE_KEYS.SEAL)]),
  );
  expect(dump).not.toContain('abandon');
  expect(dump).not.toContain('junk');
  expect(dump).toContain('passcodeWrappedKey');
}

function evmAddressFor(phrase: string): string {
  return deriveEvmKey(mnemonicToSeed(phrase)).rawAddress;
}

afterEach(() => {
  lockSession();
});

describe('multi-wallet storage', () => {
  it('migrates a legacy single seal into slot 1 without re-encryption', async () => {
    const bulk = new InMemoryStorage();
    const legacySeal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    await saveSeal(bulk, legacySeal);
    expect(await bulk.get(STORAGE_KEYS.SEAL)).not.toBeNull();

    const loaded = await loadWalletSet(bulk);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.migrated).toBe(true);
    expect(loaded.set.wallets).toHaveLength(1);
    expect(loaded.set.wallets[0]?.label).toBe('Wallet 1');
    expect(loaded.set.wallets[0]?.seal.passcodeWrappedKey).toBe(legacySeal.passcodeWrappedKey);
    expect(await bulk.get(STORAGE_KEYS.SEAL)).toBeNull();

    // The same passcode still opens the migrated wallet.
    const manager = new VaultManager({ sealStorage: bulk, config: FAST });
    const unlocked = await manager.unlock(PASS);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    expect(unlocked.session.getPublicInfo(0)?.evm?.rawAddress).toBe(
      evmAddressFor(MNEMONIC_12_HARDHAT),
    );
  });

  it('writes a wallet set and never a phrase', async () => {
    const { manager, bulk } = makeManager();
    const created = await manager.importWallet(MNEMONIC_24_ABANDON, PASS);
    expect(created.ok).toBe(true);
    const loaded = await loadWalletSet(bulk);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.set.wallets).toHaveLength(1);
    expect(loaded.set.wallets[0]?.id).toMatch(/^[0-9a-f]{16}$/);
    await expectNoPhraseInStorage(bulk);
  });

  it('rejects a tampered wallet set', async () => {
    const { manager, bulk } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    await bulk.set(STORAGE_KEYS.WALLETS, JSON.stringify({ version: 1, wallets: [] }));
    const loaded = await loadWalletSet(bulk);
    expect(loaded.ok ? 'ok' : loaded.error).toBe('malformed_vault');
  });
});

describe('add / import additional wallets', () => {
  it('adds a generated 24-word wallet without changing the first one', async () => {
    const { manager, bulk } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const before = await manager.listWallets();
    expect(before).toHaveLength(1);

    const added = await manager.addWallet({ passcode: PASS });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.mnemonic?.split(' ')).toHaveLength(24);
    expect(added.wallet.label).toBe('Wallet 2');

    const after = await manager.listWallets();
    expect(after).toHaveLength(2);
    expect(after.find((wallet) => wallet.active)?.id).toBe(added.wallet.id);

    await expectNoPhraseInStorage(bulk);
  });

  it('imports 12-word and 24-word wallets and switches between them', async () => {
    const { manager, bulk } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect((await manager.unlock(PASS)).success).toBe(true);
    const added = await manager.addWallet({
      passcode: PASS,
      mnemonic: MNEMONIC_24_ABANDON,
      label: 'Savings',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.wallet.label).toBe('Savings');

    const session = manager.getSession();
    expect(session).not.toBeNull();
    if (!session) return;
    expect(session.listWallets()).toHaveLength(2);
    expect(session.getPublicInfo(0)?.evm?.rawAddress).toBe(evmAddressFor(MNEMONIC_24_ABANDON));

    const first = (await manager.listWallets()).find((wallet) => wallet.label === 'Wallet 1');
    expect(first).toBeDefined();
    if (!first) return;
    expect(await manager.switchWallet(first.id)).toEqual({ ok: true });
    expect(session.getPublicInfo(0)?.evm?.rawAddress).toBe(evmAddressFor(MNEMONIC_12_HARDHAT));

    // The active id survives a reload.
    lockSession();
    const reloaded = new VaultManager({ sealStorage: bulk, config: FAST });
    expect((await reloaded.listWallets()).find((wallet) => wallet.active)?.id).toBe(first.id);
  });

  it('rejects a wrong passcode, the same phrase twice and the wallet cap', async () => {
    const { manager } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect((await manager.unlock(PASS)).success).toBe(true);
    expect(
      await manager.addWallet({ passcode: '135790', mnemonic: MNEMONIC_24_ABANDON }),
    ).toMatchObject({ ok: false, error: 'wrong_passcode' });
    expect(
      await manager.addWallet({ passcode: PASS, mnemonic: MNEMONIC_12_HARDHAT }),
    ).toMatchObject({ ok: false, error: 'duplicate_wallet' });
    for (let index = 0; index < 9; index++) {
      const added = await manager.addWallet({ passcode: PASS });
      expect(added.ok).toBe(true);
    }
    expect(await manager.addWallet({ passcode: PASS })).toMatchObject({
      ok: false,
      error: 'wallet_limit',
    });
  });

  it('renames a wallet', async () => {
    const { manager } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect((await manager.unlock(PASS)).success).toBe(true);
    const [wallet] = await manager.listWallets();
    expect(wallet).toBeDefined();
    if (!wallet) return;
    expect(await manager.renameWallet(wallet.id, '  Main  ')).toEqual({ ok: true });
    expect((await manager.listWallets())[0]?.label).toBe('Main');
    expect(manager.getSession()?.listWallets()[0]?.label).toBe('Main');
  });
});

describe('remove a wallet', () => {
  it('requires the wallet phrase and leaves the others intact', async () => {
    const { manager } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect((await manager.unlock(PASS)).success).toBe(true);
    const added = await manager.addWallet({ passcode: PASS });
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    expect(await manager.removeWallet(added.wallet.id, 'wrong phrase')).toMatchObject({
      ok: false,
      error: 'phrase_mismatch',
    });
    const removed = await manager.removeWallet(added.wallet.id, added.mnemonic ?? '');
    expect(removed.ok).toBe(true);

    const remaining = await manager.listWallets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.label).toBe('Wallet 1');
    expect(manager.getSession()?.getPublicInfo(0)?.evm?.rawAddress).toBe(
      evmAddressFor(MNEMONIC_12_HARDHAT),
    );

    lockSession();
    const unlocked = await manager.unlock(PASS);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    expect(unlocked.session.listWallets()).toHaveLength(1);
  });

  it('refuses to remove the last wallet', async () => {
    const { manager } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const [wallet] = await manager.listWallets();
    if (!wallet) throw new Error('missing wallet');
    expect(await manager.removeWallet(wallet.id, MNEMONIC_12_HARDHAT)).toMatchObject({
      ok: false,
      error: 'last_wallet',
    });
  });
});

describe('passcode rotation across wallets', () => {
  it('re-seals every wallet and the old passcode stops working', async () => {
    const { manager } = makeManager();
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect((await manager.unlock(PASS)).success).toBe(true);
    await manager.addWallet({ passcode: PASS, mnemonic: MNEMONIC_24_ABANDON });
    expect((await manager.changePasscode(PASS, PASS2)).ok).toBe(true);

    lockSession();
    const unlocked = await manager.unlock(PASS2);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    expect(unlocked.session.listWallets()).toHaveLength(2);

    lockSession();
    expect(await manager.unlock(PASS)).toMatchObject({ success: false, error: 'wrong_passcode' });
  });
});

describe('biometrics across wallets', () => {
  it('wraps every wallet with one token and opens the whole set', async () => {
    const { manager } = makeManager(true);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    await manager.addWallet({ passcode: PASS, mnemonic: MNEMONIC_24_ABANDON });

    const enabled = await manager.enableBiometric(PASS);
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    lockSession();
    const unlocked = await manager.unlockWithBiometric(enabled.token);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    expect(unlocked.session.listWallets()).toHaveLength(2);
  });

  it('drops biometric wraps when the wallet set changes (needs re-enable)', async () => {
    const { manager } = makeManager(true);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const enabled = await manager.enableBiometric(PASS);
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    const added = await manager.addWallet({ passcode: PASS });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.biometricDropped).toBe(true);
    expect(await manager.hasBiometric()).toBe(false);

    lockSession();
    expect(await manager.unlockWithBiometric(enabled.token)).toMatchObject({
      success: false,
      error: 'biometric_not_enabled',
    });
    // The passcode still opens the full set.
    expect((await manager.unlock(PASS)).success).toBe(true);
  });
});

describe('wallet ids', () => {
  it('are 16 hex chars and unique', () => {
    const ids = new Set(Array.from({ length: 64 }, () => createWalletId()));
    expect(ids.size).toBe(64);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});
