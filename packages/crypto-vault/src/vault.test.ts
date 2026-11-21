/**
 * Vault seal tests (A4, A10 tamper-by-XOR). Every negative test asserts the SPECIFIC error,
 * so it cannot pass because of an unrelated failure.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { argon2id } from 'hash-wasm';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  sealVault,
  unsealVault,
  createSeal,
  changePasscode,
  migrateLegacySeal,
  buildAad,
  KDF_BOUNDS,
  type VaultSeal,
  type LegacyVaultSeal,
} from './vault';
import { mnemonicToSeed, normalizeMnemonic } from './mnemonic';
import {
  MNEMONIC_12_ABANDON,
  MNEMONIC_12_HARDHAT,
  MNEMONIC_24_ABANDON,
} from './fixtures/mnemonics';

vi.mock('hash-wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hash-wasm')>();
  return { ...actual, argon2id: vi.fn(actual.argon2id) };
});

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'correct horse battery staple';
const DEVICE_SECRET = new Uint8Array(32).fill(0xab);

/** Flip one bit with XOR (never "set to a constant", which is a no-op 1 time in 256). */
function flipBit(hex: string, byteIndex = 0): string {
  const b = hexToBytes(hex);
  b[byteIndex] = (b[byteIndex] ?? 0) ^ 0x01;
  return bytesToHex(b);
}

function seedOf(m: string): Uint8Array {
  return mnemonicToSeed(normalizeMnemonic(m));
}

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, usage);
}

async function gcmEncrypt(pt: Uint8Array, key: Uint8Array, aad: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad as BufferSource },
    await aesKey(key, ['encrypt']),
    pt as BufferSource,
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** Test-side re-implementation of key unwrap, so tests can forge VALID-key / WRONG-AAD seals. */
async function openVaultKey(seal: VaultSeal, passcode: string, ds?: Uint8Array) {
  const pk = await argon2id({
    password: passcode.normalize('NFKD'),
    salt: hexToBytes(seal.passcodeSalt),
    parallelism: seal.argon2Parallelism,
    iterations: seal.argon2TimeCost,
    memorySize: seal.argon2MemoryCost,
    hashLength: 32,
    outputType: 'binary',
  });
  const wrapping = ds ? hkdf(sha256, pk, ds, 'onezerowallet-vault-combined', 32) : pk;
  const wrapped = hexToBytes(seal.passcodeWrappedKey);
  const params = {
    argon2TimeCost: seal.argon2TimeCost,
    argon2MemoryCost: seal.argon2MemoryCost,
    argon2Parallelism: seal.argon2Parallelism,
  };
  const vk = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: wrapped.slice(0, 12),
      additionalData: buildAad(
        'vault-key',
        seal.version,
        seal.hasDeviceSecret,
        params,
      ) as BufferSource,
    },
    await aesKey(wrapping, ['decrypt']),
    wrapped.slice(12),
  );
  return { vaultKey: new Uint8Array(vk), params };
}

describe('A4: seal round trip', () => {
  let seal: VaultSeal;
  beforeAll(async () => {
    seal = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
  });

  it('round trips seed and mnemonic', async () => {
    const r = await unsealVault(seal, PASS);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.mnemonic).toBe(MNEMONIC_12_ABANDON);
      expect(r.seed).toEqual(seedOf(MNEMONIC_12_ABANDON));
    }
  });

  it('seal has no stored aad field', () => {
    expect(Object.keys(seal)).not.toContain('aad');
  });

  it('wrong passcode -> wrong_passcode', async () => {
    expect(await unsealVault(seal, 'nope nope nope')).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('IVs are unique across seals and within a seal', async () => {
    const seals = await Promise.all(
      [1, 2, 3, 4].map(() => createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST)),
    );
    const all = seals.flatMap((s) => [s.iv, s.mnemonicIv, s.passcodeWrappedKey.slice(0, 24)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('createSeal rejects an invalid mnemonic', async () => {
    await expect(createSeal('abandon '.repeat(11) + 'zoo', PASS, undefined, FAST)).rejects.toThrow(
      'INVALID_MNEMONIC',
    );
  });
});

describe('A4: AAD binding and tamper detection (each asserts the specific error)', () => {
  let seal: VaultSeal;
  beforeAll(async () => {
    seal = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
  });

  it('changing version -> unsupported_version (no decrypt attempted)', async () => {
    for (const v of [1, 2, 4, 0, -1]) {
      expect(await unsealVault({ ...seal, version: v }, PASS)).toEqual({
        success: false,
        error: 'unsupported_version',
      });
    }
  });

  it('AAD binds version: a seed ciphertext made under another version fails with tampered_data', async () => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      seedOf(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('seed', 99, false, params),
    );
    const r = await unsealVault(
      { ...seal, encryptedSeed: bytesToHex(forged.ct), iv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it.each([
    ['argon2TimeCost', FAST.argon2TimeCost + 1],
    ['argon2MemoryCost', FAST.argon2MemoryCost + 1024],
    ['argon2Parallelism', 2],
  ] as const)(
    'changing %s -> wrong_passcode (KDF output and AAD both change)',
    async (field, value) => {
      expect(await unsealVault({ ...seal, [field]: value }, PASS)).toEqual({
        success: false,
        error: 'wrong_passcode',
      });
    },
  );

  it.each([
    ['argon2TimeCost', FAST.argon2TimeCost + 1],
    ['argon2MemoryCost', FAST.argon2MemoryCost + 1024],
    ['argon2Parallelism', 2],
  ] as const)('AAD binds %s independently of the KDF output', async (field, value) => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      seedOf(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('seed', seal.version, false, { ...params, [field]: value }),
    );
    const r = await unsealVault(
      { ...seal, encryptedSeed: bytesToHex(forged.ct), iv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it('AAD binds the role: seed bytes encrypted under the mnemonic role -> tampered_data', async () => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      seedOf(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('mnemonic', seal.version, false, params),
    );
    const r = await unsealVault(
      { ...seal, encryptedSeed: bytesToHex(forged.ct), iv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it('AAD binds the role: mnemonic encrypted under the seed role -> tampered_data', async () => {
    const { vaultKey, params } = await openVaultKey(seal, PASS);
    const forged = await gcmEncrypt(
      new TextEncoder().encode(MNEMONIC_12_ABANDON),
      vaultKey,
      buildAad('seed', seal.version, false, params),
    );
    const r = await unsealVault(
      { ...seal, encryptedMnemonic: bytesToHex(forged.ct), mnemonicIv: bytesToHex(forged.iv) },
      PASS,
    );
    expect(r).toEqual({ success: false, error: 'tampered_data' });
  });

  it('flipping one bit of encryptedSeed / iv / encryptedMnemonic / mnemonicIv -> tampered_data', async () => {
    for (const field of ['encryptedSeed', 'iv', 'encryptedMnemonic', 'mnemonicIv'] as const) {
      const r = await unsealVault({ ...seal, [field]: flipBit(seal[field], 3) }, PASS);
      expect(r, field).toEqual({ success: false, error: 'tampered_data' });
    }
  });

  it('flipping one bit of the wrapped key -> wrong_passcode (GCM cannot distinguish)', async () => {
    expect(
      await unsealVault(
        { ...seal, passcodeWrappedKey: flipBit(seal.passcodeWrappedKey, 20) },
        PASS,
      ),
    ).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });

  it('removing mnemonic fields from a seal -> malformed_seal (no silent downgrade)', async () => {
    const noMn: Record<string, unknown> = { ...seal };
    delete noMn['encryptedMnemonic'];
    delete noMn['mnemonicIv'];
    expect(await unsealVault(noMn as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'malformed_seal',
    });
  });

  it('mnemonic that does not regenerate the seed -> seed_mnemonic_mismatch', async () => {
    const mismatched = await sealVault(
      seedOf(MNEMONIC_12_ABANDON),
      MNEMONIC_12_HARDHAT,
      PASS,
      undefined,
      FAST,
    );
    expect(await unsealVault(mismatched, PASS)).toEqual({
      success: false,
      error: 'seed_mnemonic_mismatch',
    });
  });

  it.each([
    ['non-hex salt', { passcodeSalt: 'zz'.repeat(16) }],
    ['short salt', { passcodeSalt: 'ab'.repeat(8) }],
    ['odd-length iv', { iv: 'abc' }],
    ['non-string field', { encryptedSeed: 42 }],
  ])('malformed hex (%s) -> malformed_seal', async (_name, patch) => {
    expect(await unsealVault({ ...seal, ...patch } as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'malformed_seal',
    });
  });

  it('non-object seal -> malformed_seal', async () => {
    expect(await unsealVault(null as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'malformed_seal',
    });
  });
});

describe('A4: KDF bounds are enforced BEFORE Argon2 runs', () => {
  it.each([
    ['timeCost too low', { argon2TimeCost: KDF_BOUNDS.argon2TimeCost.min - 1 }],
    ['timeCost too high', { argon2TimeCost: KDF_BOUNDS.argon2TimeCost.max + 1 }],
    ['memory too low', { argon2MemoryCost: KDF_BOUNDS.argon2MemoryCost.min - 1 }],
    ['memory too high (DoS)', { argon2MemoryCost: 4_000_000 }],
    ['parallelism too high', { argon2Parallelism: KDF_BOUNDS.argon2Parallelism.max + 1 }],
    ['non-integer', { argon2TimeCost: 2.5 }],
  ])('%s -> invalid_params and argon2id is never called', async (_n, patch) => {
    const seal = await createSeal(MNEMONIC_12_ABANDON, PASS, undefined, FAST);
    vi.mocked(argon2id).mockClear();
    const r = await unsealVault({ ...seal, ...patch }, PASS);
    expect(r).toEqual({ success: false, error: 'invalid_params' });
    expect(argon2id).not.toHaveBeenCalled();
  });

  it('sealVault refuses out-of-range parameters', async () => {
    await expect(
      sealVault(seedOf(MNEMONIC_12_ABANDON), MNEMONIC_12_ABANDON, PASS, undefined, {
        argon2TimeCost: 1,
      }),
    ).rejects.toThrow('INVALID_KDF_PARAMS');
  });
});

describe('A4: device secret', () => {
  let seal: VaultSeal;
  beforeAll(async () => {
    seal = await createSeal(MNEMONIC_24_ABANDON, PASS, DEVICE_SECRET, FAST);
  });

  it('passcode + device secret opens it', async () => {
    expect((await unsealVault(seal, PASS, DEVICE_SECRET)).success).toBe(true);
  });
  it('missing device secret -> device_secret_missing, and argon2id is not called', async () => {
    vi.mocked(argon2id).mockClear();
    expect(await unsealVault(seal, PASS)).toEqual({
      success: false,
      error: 'device_secret_missing',
    });
    expect(argon2id).not.toHaveBeenCalled();
  });
  it('wrong-length device secret -> device_secret_missing', async () => {
    expect(await unsealVault(seal, PASS, new Uint8Array(5))).toEqual({
      success: false,
      error: 'device_secret_missing',
    });
  });
  it('wrong device secret -> wrong_passcode', async () => {
    expect(await unsealVault(seal, PASS, new Uint8Array(32).fill(0xcd))).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });
  it('right device secret, wrong passcode -> wrong_passcode', async () => {
    expect(await unsealVault(seal, 'wrong', DEVICE_SECRET)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });
  it('flipping hasDeviceSecret to false does not give a passcode-only path', async () => {
    const r = await unsealVault({ ...seal, hasDeviceSecret: false }, PASS);
    expect(r).toEqual({ success: false, error: 'wrong_passcode' });
  });
});

describe('A4: changePasscode (return type is reworked in A10)', () => {
  it('re-seals with a fresh vault key, salt and IVs; old passcode stops working on the new seal', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    const next = await changePasscode(seal, PASS, 'another passphrase 987', undefined, FAST);
    expect('version' in next).toBe(true);
    const ns = next as VaultSeal;
    expect(ns.passcodeSalt).not.toBe(seal.passcodeSalt);
    expect(ns.passcodeWrappedKey).not.toBe(seal.passcodeWrappedKey);
    expect(ns.encryptedSeed).not.toBe(seal.encryptedSeed);
    expect((await unsealVault(ns, 'another passphrase 987')).success).toBe(true);
    expect(await unsealVault(ns, PASS)).toEqual({ success: false, error: 'wrong_passcode' });
  });
  it('wrong old passcode returns the error result', async () => {
    const seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
    expect(await changePasscode(seal, 'bad', 'x', undefined, FAST)).toEqual({
      success: false,
      error: 'wrong_passcode',
    });
  });
});

// ---------------------------------------------------------------------------
// Legacy migration. The legacy writer is re-implemented here exactly as the old code did:
// stored aad (JSON), no AAD on the key wrap, version 1 without / version 2 with a mnemonic.
// ---------------------------------------------------------------------------
async function makeLegacySeal(
  version: 1 | 2,
  mnemonic: string,
  passcode: string,
  ds?: Uint8Array,
): Promise<LegacyVaultSeal> {
  const params = FAST;
  const seed = seedOf(mnemonic);
  const vaultKey = crypto.getRandomValues(new Uint8Array(32));
  const aad = new TextEncoder().encode(
    JSON.stringify({
      v: version,
      t: params.argon2TimeCost,
      m: params.argon2MemoryCost,
      p: params.argon2Parallelism,
    }),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pk = await argon2id({
    password: passcode.normalize('NFKD'),
    salt,
    parallelism: params.argon2Parallelism,
    iterations: params.argon2TimeCost,
    memorySize: params.argon2MemoryCost,
    hashLength: 32,
    outputType: 'binary',
  });
  const wrapping = ds ? hkdf(sha256, pk, ds, 'onezerowallet-vault-combined', 32) : pk;
  const seedEnc = await gcmEncrypt(seed, vaultKey, aad);
  const wrapEnc = await gcmEncrypt(vaultKey, wrapping, new Uint8Array(0));
  const legacy: LegacyVaultSeal = {
    version,
    passcodeWrappedKey: bytesToHex(wrapEnc.iv) + bytesToHex(wrapEnc.ct),
    hasDeviceSecret: ds !== undefined,
    encryptedSeed: bytesToHex(seedEnc.ct),
    iv: bytesToHex(seedEnc.iv),
    aad: bytesToHex(aad),
    passcodeSalt: bytesToHex(salt),
    argon2TimeCost: params.argon2TimeCost,
    argon2MemoryCost: params.argon2MemoryCost,
    argon2Parallelism: params.argon2Parallelism,
  };
  if (version === 2) {
    const mnEnc = await gcmEncrypt(new TextEncoder().encode(mnemonic), vaultKey, aad);
    legacy.encryptedMnemonic = bytesToHex(mnEnc.ct);
    legacy.mnemonicIv = bytesToHex(mnEnc.iv);
  }
  return legacy;
}

describe('A4: migration of v1/v2 seals', () => {
  it('current-format seals are rejected by unsealVault as unsupported_version when presented as legacy', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await unsealVault(legacy as unknown as VaultSeal, PASS)).toEqual({
      success: false,
      error: 'unsupported_version',
    });
  });

  it('v2 seal migrates to v3 and opens with the same passcode and mnemonic', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_HARDHAT, PASS);
    const m = await migrateLegacySeal(legacy, PASS);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.seal.version).toBe(3);
    expect(Object.keys(m.seal)).not.toContain('aad');
    const r = await unsealVault(m.seal, PASS);
    expect(r.success && r.mnemonic).toBe(MNEMONIC_12_HARDHAT);
  });

  it('v1 seal needs the recovery phrase: absent -> mnemonic_required', async () => {
    const legacy = await makeLegacySeal(1, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal(legacy, PASS)).toEqual({
      ok: false,
      error: 'mnemonic_required',
    });
  });

  it('v1 seal + correct phrase migrates; wrong phrase -> seed_mnemonic_mismatch', async () => {
    const legacy = await makeLegacySeal(1, MNEMONIC_12_ABANDON, PASS);
    const bad = await migrateLegacySeal(legacy, PASS, undefined, MNEMONIC_12_HARDHAT);
    expect(bad).toEqual({ ok: false, error: 'seed_mnemonic_mismatch' });
    const good = await migrateLegacySeal(legacy, PASS, undefined, MNEMONIC_12_ABANDON);
    expect(good.ok).toBe(true);
    if (good.ok) expect((await unsealVault(good.seal, PASS)).success).toBe(true);
  });

  it('v1 seal with device secret migrates only with the device secret', async () => {
    const legacy = await makeLegacySeal(1, MNEMONIC_12_ABANDON, PASS, DEVICE_SECRET);
    expect(await migrateLegacySeal(legacy, PASS, undefined, MNEMONIC_12_ABANDON)).toEqual({
      ok: false,
      error: 'device_secret_missing',
    });
    const m = await migrateLegacySeal(legacy, PASS, DEVICE_SECRET, MNEMONIC_12_ABANDON);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.seal.hasDeviceSecret).toBe(true);
      expect((await unsealVault(m.seal, PASS, DEVICE_SECRET)).success).toBe(true);
    }
  });

  it('wrong passcode -> wrong_passcode', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal(legacy, 'wrong')).toEqual({
      ok: false,
      error: 'wrong_passcode',
    });
  });

  it('v2 seal with mnemonic fields removed -> malformed_seal (no silent downgrade)', async () => {
    const legacy: Record<string, unknown> = {
      ...(await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS)),
    };
    delete legacy['encryptedMnemonic'];
    delete legacy['mnemonicIv'];
    expect(await migrateLegacySeal(legacy as unknown as LegacyVaultSeal, PASS)).toEqual({
      ok: false,
      error: 'malformed_seal',
    });
  });

  it('tampered legacy stored aad -> tampered_data', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal({ ...legacy, aad: flipBit(legacy.aad, 2) }, PASS)).toEqual({
      ok: false,
      error: 'tampered_data',
    });
  });

  it('legacy seal with out-of-range params -> invalid_params without running Argon2', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    vi.mocked(argon2id).mockClear();
    expect(await migrateLegacySeal({ ...legacy, argon2TimeCost: 1 }, PASS)).toEqual({
      ok: false,
      error: 'invalid_params',
    });
    expect(argon2id).not.toHaveBeenCalled();
  });

  it('unknown version -> unsupported_version', async () => {
    const legacy = await makeLegacySeal(2, MNEMONIC_12_ABANDON, PASS);
    expect(await migrateLegacySeal({ ...legacy, version: 3 }, PASS)).toEqual({
      ok: false,
      error: 'unsupported_version',
    });
  });
});
