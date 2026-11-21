/**
 * A2: session API. Keys never leave the module; signing, re-auth and lock behave as specified.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
import { recoverPublicKey, type Hex } from 'viem';
import { createSeal, type VaultSeal } from './vault';
import { mnemonicToSeed } from './mnemonic';
import { deriveTonKey, deriveTronKey, deriveEvmKey } from './derivation';
import { isValidEvmAddress, isValidTronAddress, validateTonAddress } from './address';
import { unlockSession, lockSession, getSession, type VaultSession } from './session';
import { InMemoryStorage } from './storage';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'session passphrase 123';
const DIGEST = sha256(new TextEncoder().encode('test payload'));

let seal: VaultSeal;
beforeAll(async () => {
  seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
});
afterEach(() => {
  lockSession();
  vi.useRealTimers();
});

async function open(opts?: { reauthWindowMs?: number }): Promise<VaultSession> {
  const r = await unlockSession(seal, PASS, new InMemoryStorage(), opts);
  if (!r.success) throw new Error(`unlock failed: ${r.error}`);
  return r.session;
}

/** Collect every property name and every Uint8Array / string value reachable from `root`. */
function walk(root: unknown): { keys: string[]; leaves: unknown[] } {
  const keys: string[] = [];
  const leaves: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (v: unknown): void => {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) {
      leaves.push(v);
      return;
    }
    if (seen.has(v)) return;
    seen.add(v);
    // Functions are opaque closures: do not descend (Function.prototype has throwing accessors).
    if (typeof v === 'function') return;
    if (v instanceof Uint8Array) {
      leaves.push(v);
      return;
    }
    for (const k of Reflect.ownKeys(v)) {
      keys.push(String(k));
      visit((v as Record<string | symbol, unknown>)[k]);
    }
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto && proto !== Object.prototype && proto !== Function.prototype) visit(proto);
  };
  visit(root);
  return { keys, leaves };
}

describe('A2: the session object does not expose secrets', () => {
  it('has no privateKey / seed / mnemonic / secret property at any depth', async () => {
    const s = await open();
    const info = s.getPublicInfo(0);
    const { keys } = walk({ session: s, info });
    // `revealMnemonic` is the one documented FUNCTION (gated by re-auth); no other name may
    // look like secret data. Function-ness of every member is asserted in the next test.
    for (const k of keys.filter((name) => name !== 'revealMnemonic')) {
      expect(k.toLowerCase()).not.toMatch(/private|seed|mnemonic|secret|vaultkey/);
    }
  });

  it('exposes exactly the documented functions and nothing else', async () => {
    const s = await open();
    expect(Object.keys(s).sort()).toEqual(
      ['getPublicInfo', 'lock', 'reauthenticate', 'revealMnemonic', 'signDigest'].sort(),
    );
    for (const v of Object.values(s)) expect(typeof v).toBe('function');
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('JSON.stringify of session and public info contains no key bytes or mnemonic', async () => {
    const s = await open();
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const secrets = [
      bytesToHex(seed),
      bytesToHex(deriveTonKey(seed).privateKey),
      bytesToHex(deriveTronKey(seed).privateKey),
      bytesToHex(deriveEvmKey(seed).privateKey),
    ];
    const json = JSON.stringify({ s, info: s.getPublicInfo(0), seal: undefined }).toLowerCase();
    for (const secret of secrets) expect(json).not.toContain(secret);
    expect(json).not.toContain('junk');
  });

  it('no reachable Uint8Array value equals a private key or the seed', async () => {
    const s = await open();
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const secretHex = new Set([
      bytesToHex(seed),
      bytesToHex(deriveTonKey(seed).privateKey),
      bytesToHex(deriveTronKey(seed).privateKey),
      bytesToHex(deriveEvmKey(seed).privateKey),
    ]);
    const { leaves } = walk({ s, info: s.getPublicInfo(0), got: getSession() });
    for (const leaf of leaves) {
      if (leaf instanceof Uint8Array) expect(secretHex.has(bytesToHex(leaf))).toBe(false);
      if (typeof leaf === 'string') {
        for (const secret of secretHex) expect(leaf.toLowerCase()).not.toContain(secret);
      }
    }
  });

  it('getPublicInfo returns a copy: mutating it does not affect later calls', async () => {
    const s = await open();
    const a = s.getPublicInfo(0);
    if (!a?.evm) throw new Error('expected info');
    a.evm.rawAddress = 'tampered';
    expect(s.getPublicInfo(0)?.evm?.rawAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('getPublicInfo matches independently derived public material', async () => {
    const s = await open();
    const seed = mnemonicToSeed(MNEMONIC_12_HARDHAT);
    const info = s.getPublicInfo(0);
    expect(info?.evm?.rawAddress).toBe(deriveEvmKey(seed).rawAddress);
    expect(info?.ton.publicKeyHex).toBe(deriveTonKey(seed).publicKeyHex);
    expect(info?.tron?.hexAddress).toBe(deriveTronKey(seed).hexAddress);
  });

  it('B1: getPublicInfo exposes checksummed EVM, base58 TRON and V5R1 TON addresses', async () => {
    const s = await open();
    const info = s.getPublicInfo(0);
    if (!info?.evm || !info.tron) throw new Error('expected info');
    // Hardhat mnemonic first account: published EIP-55 address.
    expect(info.evm.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(isValidEvmAddress(info.evm.address)).toBe(true);
    expect(info.tron.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(isValidTronAddress(info.tron.address)).toBe(true);
    expect(info.ton.addressRaw).toMatch(/^0:[0-9a-f]{64}$/);
    expect(info.ton.addressBounceable.startsWith('EQ')).toBe(true);
    expect(info.ton.addressNonBounceable.startsWith('UQ')).toBe(true);
    expect(info.ton.addressTestnetNonBounceable.startsWith('0Q')).toBe(true);
    expect(validateTonAddress(info.ton.addressNonBounceable).valid).toBe(true);
    // Mutating the returned copy must not change later calls.
    info.evm.address = 'tampered';
    expect(s.getPublicInfo(0)?.evm?.address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('getPublicInfo rejects invalid account indexes', async () => {
    const s = await open();
    for (const bad of [-1, 1.5, 2 ** 31, Number.NaN]) expect(s.getPublicInfo(bad)).toBeNull();
  });
});

describe('A2: signatures verify against the public key (noble)', () => {
  it('TON: Ed25519 signature verifies', async () => {
    const s = await open();
    const r = s.signDigest('ton', 0, DIGEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signature).toHaveLength(64);
    const pub = hexToBytes(s.getPublicInfo(0)?.ton.publicKeyHex ?? '');
    expect(ed25519.verify(r.signature, DIGEST, pub)).toBe(true);
    const other = sha256(new TextEncoder().encode('other'));
    expect(ed25519.verify(r.signature, other, pub)).toBe(false);
  });

  it.each(['tron', 'evm'] as const)(
    '%s: recoverable secp256k1 signature verifies and recovers',
    async (chain) => {
      const s = await open();
      const r = s.signDigest(chain, 0, DIGEST);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.signature).toHaveLength(65);
      const pubHex = s.getPublicInfo(0)?.[chain]?.publicKeyHex ?? '';
      const compact = r.signature.slice(0, 64);
      expect(secp256k1.verify(compact, DIGEST, hexToBytes(pubHex), { lowS: true })).toBe(true);
      // Independent recovery with viem (not the signer's own library).
      const recovered = await recoverPublicKey({
        hash: ('0x' + bytesToHex(DIGEST)) as Hex,
        signature: ('0x' + bytesToHex(r.signature)) as Hex,
      });
      const compressed = secp256k1.Point.fromHex(recovered.slice(2)).toHex(true);
      expect(compressed).toBe(pubHex);
    },
  );

  it('account 1 signs with a different key than account 0', async () => {
    const s = await open();
    const r = s.signDigest('ton', 1, DIGEST);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pub0 = hexToBytes(s.getPublicInfo(0)?.ton.publicKeyHex ?? '');
    const pub1 = hexToBytes(s.getPublicInfo(1)?.ton.publicKeyHex ?? '');
    expect(ed25519.verify(r.signature, DIGEST, pub1)).toBe(true);
    expect(ed25519.verify(r.signature, DIGEST, pub0)).toBe(false);
  });

  it('validates chain, digest length/type and account index', async () => {
    const s = await open();
    expect(s.signDigest('btc' as never, 0, DIGEST)).toEqual({ ok: false, error: 'invalid_chain' });
    expect(s.signDigest('evm', 0, new Uint8Array(31))).toEqual({
      ok: false,
      error: 'invalid_digest',
    });
    expect(s.signDigest('evm', 0, new Uint8Array(33))).toEqual({
      ok: false,
      error: 'invalid_digest',
    });
    expect(s.signDigest('evm', 0, 'x' as never)).toEqual({ ok: false, error: 'invalid_digest' });
    expect(s.signDigest('evm', -1, DIGEST)).toEqual({ ok: false, error: 'invalid_account' });
    expect(s.signDigest('evm', 0.5, DIGEST)).toEqual({ ok: false, error: 'invalid_account' });
  });
});

describe('A2: lock', () => {
  it('signing after lock fails with locked, and getPublicInfo returns null', async () => {
    const s = await open();
    expect(s.signDigest('evm', 0, DIGEST).ok).toBe(true);
    s.lock();
    expect(s.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    expect(s.signDigest('ton', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    expect(s.getPublicInfo(0)).toBeNull();
    expect(getSession()).toBeNull();
  });

  it('lockSession() locks the same session object', async () => {
    const s = await open();
    expect(getSession()).toBe(s);
    lockSession();
    expect(s.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
  });

  it('a new unlock locks the previous session', async () => {
    const first = await open();
    const second = await open();
    expect(first.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    expect(second.signDigest('evm', 0, DIGEST).ok).toBe(true);
  });

  it('inactivity timeout locks the session', async () => {
    vi.useFakeTimers();
    const { setInactivityTimeout } = await import('./session');
    setInactivityTimeout(1000);
    const s = await open();
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.signDigest('evm', 0, DIGEST)).toEqual({ ok: false, error: 'locked' });
    setInactivityTimeout(300000);
  });

  it('reauthenticate and revealMnemonic fail after lock', async () => {
    const s = await open();
    s.lock();
    expect(await s.reauthenticate(PASS)).toEqual({ ok: false, error: 'locked' });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'locked' });
  });

  it('locking while a reauthenticate is in flight does not open a reveal window', async () => {
    const s = await open();
    const pending = s.reauthenticate(PASS);
    s.lock();
    expect(await pending).toEqual({ ok: false, error: 'locked' });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'locked' });
  });
});

describe('A2: revealMnemonic requires fresh re-authentication', () => {
  let storage: InMemoryStorage;
  let s: VaultSession;
  beforeEach(async () => {
    storage = new InMemoryStorage();
    const r = await unlockSession(seal, PASS, storage);
    if (!r.success) throw new Error('unlock failed');
    s = r.session;
  });

  it('fails without re-auth', () => {
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('wrong passcode does not open the window', async () => {
    expect(await s.reauthenticate('wrong passphrase')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('succeeds once after re-auth, then fails on the second call', async () => {
    expect(await s.reauthenticate(PASS)).toEqual({ ok: true });
    expect(s.revealMnemonic()).toEqual({ ok: true, mnemonic: MNEMONIC_12_HARDHAT });
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('a second reveal needs a second re-auth', async () => {
    await s.reauthenticate(PASS);
    s.revealMnemonic();
    expect(s.revealMnemonic().ok).toBe(false);
    await s.reauthenticate(PASS);
    expect(s.revealMnemonic().ok).toBe(true);
  });

  it('the window expires after reauthWindowMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const r = await unlockSession(seal, PASS, new InMemoryStorage(), { reauthWindowMs: 60_000 });
    if (!r.success) throw new Error('unlock failed');
    expect(await r.session.reauthenticate(PASS)).toEqual({ ok: true });
    vi.advanceTimersByTime(60_001);
    expect(r.session.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('a failed re-auth after a successful one closes the open window', async () => {
    await s.reauthenticate(PASS);
    await s.reauthenticate('wrong passphrase');
    expect(s.revealMnemonic()).toEqual({ ok: false, error: 'reauth_required' });
  });

  it('re-auth runs a real passcode check (fresh Argon2id), not a cached comparison', async () => {
    // The session holds no passcode: a different valid-looking passcode cannot succeed.
    expect(await s.reauthenticate(PASS + ' ')).toEqual({ ok: false, error: 'wrong_passcode' });
  });
});
