/**
 * A9: VaultManager end-to-end against in-memory adapters.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { VaultManager } from './vault-manager';
import { InMemoryStorage, STORAGE_KEYS } from './storage';
import { mnemonicToSeed } from './mnemonic';
import { deriveEvmKey } from './derivation';
import { loadSeal } from './seal-store';
import { lockSession } from './session';
import { MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'my passphrase 1';
const PASS2 = 'my passphrase 2';

function makeManager(withSecure: boolean): {
  manager: VaultManager;
  bulk: InMemoryStorage;
  secure: InMemoryStorage;
} {
  const bulk = new InMemoryStorage();
  const secure = new InMemoryStorage();
  const manager = new VaultManager({
    sealStorage: bulk,
    secureStorage: withSecure ? secure : undefined,
    config: FAST,
  });
  return { manager, bulk, secure };
}

afterEach(() => {
  lockSession();
});

describe('A9: VaultManager create/import/unlock', () => {
  it('creates a wallet with a generated 24-word phrase shown once', async () => {
    const { manager } = makeManager(false);
    expect(await manager.hasVault()).toBe(false);
    const created = await manager.createWallet(PASS);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.mnemonic?.split(' ')).toHaveLength(24);
    expect(await manager.hasVault()).toBe(true);
  });

  it('imports a known phrase and unlocks to the matching public material', async () => {
    const { manager } = makeManager(false);
    const imported = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(imported.ok).toBe(true);

    const unlocked = await manager.unlock(PASS);
    expect(unlocked.success).toBe(true);
    if (!unlocked.success) return;
    const info = unlocked.session.getPublicInfo(0);
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    expect(info?.evm?.rawAddress).toBe(deriveEvmKey(seed).rawAddress);
  });

  it('rejects a second wallet while one exists', async () => {
    const { manager } = makeManager(false);
    await manager.createWallet(PASS);
    expect(await manager.createWallet(PASS)).toEqual({ ok: false, error: 'vault_exists' });
  });

  it('rejects an invalid imported phrase', async () => {
    const { manager } = makeManager(false);
    const r = await manager.importWallet('one two three', PASS);
    expect(r).toEqual({ ok: false, error: 'invalid_mnemonic' });
  });

  it('rejects a weak passcode', async () => {
    const { manager } = makeManager(false); // needs 12+ chars
    const r = await manager.importWallet(MNEMONIC_12_HARDHAT, 'short');
    expect(r).toMatchObject({ ok: false, error: 'weak_passcode' });
  });

  it('wrong passcode fails and creates no session', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(await manager.unlock('wrong passphrase')).toMatchObject({
      success: false,
      error: 'wrong_passcode',
    });
    expect(manager.getSession()).toBeNull();
  });
});

describe('A9: device secret placement and loss', () => {
  it('stores the device secret only in the secure adapter', async () => {
    const { manager, bulk, secure } = makeManager(true);
    const created = await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(created.ok).toBe(true);
    expect(await secure.get(STORAGE_KEYS.DEVICE_SECRET)).toMatch(/^[0-9a-f]{64}$/);
    expect(await bulk.get(STORAGE_KEYS.DEVICE_SECRET)).toBeNull();
    const sealed = await loadSeal(bulk);
    expect(sealed.ok && sealed.seal.hasDeviceSecret).toBe(true);
  });

  it('cannot open the seal if the device secret is lost; only re-import recovers', async () => {
    const { manager, secure } = makeManager(true);
    await manager.importWallet(MNEMONIC_24_ABANDON, PASS);

    await secure.clear(); // OS/Telegram cleared SecureStorage

    expect(await manager.unlock(PASS)).toEqual({
      success: false,
      error: 'device_secret_missing',
    });

    // Recovery: wipe the orphaned seal and import the phrase again.
    await manager.wipe();
    expect(await manager.hasVault()).toBe(false);
    const reimported = await manager.importWallet(MNEMONIC_24_ABANDON, PASS);
    expect(reimported.ok).toBe(true);
    expect((await manager.unlock(PASS)).success).toBe(true);
  });
});

describe('A9: changePasscode', () => {
  it('rejects a weak new passcode', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    expect(await manager.changePasscode(PASS, 'short')).toMatchObject({
      ok: false,
      error: 'weak_passcode',
    });
  });

  it('re-seals: new passcode works, old one does not', async () => {
    const { manager, bulk } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const changed = await manager.changePasscode(PASS, PASS2);
    expect(changed.ok).toBe(true);
    expect(await manager.unlock(PASS)).toMatchObject({ success: false, error: 'wrong_passcode' });
    // The failed old-passcode attempt opened a backoff window; let it elapse for this test.
    await bulk.set(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT, '0');
    expect((await manager.unlock(PASS2)).success).toBe(true);
  });

  it('recreates the biometric wrap and returns a fresh token', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    const enabled = await manager.enableBiometric(PASS);
    expect(enabled.ok).toBe(true);

    const changed = await manager.changePasscode(PASS, PASS2);
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.biometricToken).toMatch(/^[0-9a-f]{64}$/);

    // The old token is invalid; the new one opens the seal with the new passcode's vault key.
    expect((await manager.unlockWithBiometric(changed.biometricToken ?? '')).success).toBe(true);
  });
});

describe('A9: biometrics through the manager', () => {
  it('enable -> unlockWithBiometric -> disable requires the passcode', async () => {
    const { manager } = makeManager(false);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);

    const enabled = await manager.enableBiometric(PASS);
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;

    expect((await manager.unlockWithBiometric(enabled.token)).success).toBe(true);
    manager.lock();

    expect(await manager.disableBiometric('wrong passphrase')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
    expect(await manager.disableBiometric(PASS)).toEqual({ ok: true });
    expect(await manager.unlockWithBiometric(enabled.token)).toMatchObject({
      success: false,
      error: 'biometric_not_enabled',
    });
  });
});

describe('A9: wipe', () => {
  it('removes the seal and device secret', async () => {
    const { manager, bulk, secure } = makeManager(true);
    await manager.importWallet(MNEMONIC_12_HARDHAT, PASS);
    await manager.wipe();
    expect(await manager.hasVault()).toBe(false);
    expect(await bulk.get(STORAGE_KEYS.SEAL)).toBeNull();
    expect(await secure.get(STORAGE_KEYS.DEVICE_SECRET)).toBeNull();
  });
});
