/**
 * Published test vectors (no shape-only checks).
 *
 * Sources:
 * - BIP-39: https://github.com/trezor/python-mnemonic/blob/master/vectors.json
 *   (raw file saved as fixtures/bip39-trezor-vectors.json, sha256
 *   fa3b937b7cff9c9b8ecd3aa011faeb8d6dd67993174b72326e83f4de8fdb30f8, fetched 2026-11-21)
 * - SLIP-10 ed25519: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 * - Hardhat default accounts: https://v2.hardhat.org/hardhat-network/docs/reference
 *   (mnemonic "test test ... junk", first account 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { mnemonicToAccount } from 'viem/accounts';
import { HDNodeWallet } from 'ethers';
import { TronWeb } from 'tronweb';
import { mnemonicToSeed, normalizeMnemonic } from './mnemonic';
import { deriveEvmKey, deriveTronKey, deriveSlip10Node } from './derivation';
import {
  MNEMONIC_12_ABANDON,
  MNEMONIC_24_ABANDON,
  MNEMONIC_12_HARDHAT,
  HARDHAT_FIRST_ADDRESS,
} from './fixtures/mnemonics';

type Bip39Vector = [string, string, string, string];
const bip39 = JSON.parse(
  readFileSync(new URL('./fixtures/bip39-trezor-vectors.json', import.meta.url), 'utf-8'),
) as { english: Bip39Vector[] };

describe('BIP-39 official vectors (Trezor python-mnemonic)', () => {
  it('has all 24 english vectors', () => {
    expect(bip39.english).toHaveLength(24);
  });
  it.each(bip39.english.map((v, i) => [i, v[0], v[1], v[2]] as const))(
    'vector %i: entropy -> mnemonic -> seed (passphrase TREZOR)',
    (_i, entropy, mnemonic, seed) => {
      expect(entropyToMnemonic(hexToBytes(entropy), wordlist)).toBe(mnemonic);
      expect(bytesToHex(mnemonicToSeed(normalizeMnemonic(mnemonic), 'TREZOR'))).toBe(seed);
    },
  );
});

describe('fixtures are what their names say', () => {
  it('12-word fixtures have 12 words, 24-word has 24', () => {
    expect(MNEMONIC_12_ABANDON.split(' ')).toHaveLength(12);
    expect(MNEMONIC_12_HARDHAT.split(' ')).toHaveLength(12);
    expect(MNEMONIC_24_ABANDON.split(' ')).toHaveLength(24);
  });
});

const V1 = '000102030405060708090a0b0c0d0e0f';
const V2 =
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542';

// [seed, path, private key, chain code] from SLIP-0010 "Test vector 1/2 for ed25519"
const SLIP10_CASES: [string, string, string, string][] = [
  [
    V1,
    "m/0'",
    '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
    '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69',
  ],
  [
    V1,
    "m/0'/1'",
    'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2',
    'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14',
  ],
  [
    V1,
    "m/0'/1'/2'",
    '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9',
    '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c',
  ],
  [
    V1,
    "m/0'/1'/2'/2'",
    '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662',
    '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc',
  ],
  [
    V1,
    "m/0'/1'/2'/2'/1000000000'",
    '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
    '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230',
  ],
  [
    V2,
    "m/0'",
    '1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635',
    '0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d',
  ],
  [
    V2,
    "m/0'/2147483647'",
    'ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4',
    '138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f',
  ],
  [
    V2,
    "m/0'/2147483647'/1'",
    '3757c7577170179c7868353ada796c839135b3d30554bbb74a4b1e4a5a58505c',
    '73bd9fff1cfbde33a1b846c27085f711c0fe2d66fd32e139d3ebc28e5a4a6b90',
  ],
  [
    V2,
    "m/0'/2147483647'/1'/2147483646'",
    '5837736c89570de861ebc173b1086da4f505d4adb387c6a1b1342d5e4ac9ec72',
    '0902fe8a29f9140480a00ef244bd183e8a13288e4412d8389d140aac1794825a',
  ],
  [
    V2,
    "m/0'/2147483647'/1'/2147483646'/2'",
    '551d333177df541ad876a60ea71f00447931c0a9da16f227c11ea080d7391b8d',
    '5d70af781f3a37b829f0d060924d5e960bdc02e85423494afc0b1a41bbe196d4',
  ],
];

describe('SLIP-10 ed25519 official vectors', () => {
  it.each(SLIP10_CASES)('seed %#: path %s', (seedHex, path, priv, chain) => {
    const node = deriveSlip10Node(hexToBytes(seedHex), path);
    expect(bytesToHex(node.privateKey)).toBe(priv);
    expect(bytesToHex(node.chainCode)).toBe(chain);
  });
});

describe("EVM m/44'/60'/0'/0/0 exact address + independent implementations", () => {
  const key = deriveEvmKey(mnemonicToSeed(MNEMONIC_12_HARDHAT));
  it('matches the published Hardhat first account (lowercase; EIP-55 is Stage B)', () => {
    expect(key.rawAddress).toBe(HARDHAT_FIRST_ADDRESS.toLowerCase());
  });
  it('matches viem', () => {
    expect(key.rawAddress).toBe(mnemonicToAccount(MNEMONIC_12_HARDHAT).address.toLowerCase());
  });
  it('matches ethers (address and private key)', () => {
    const w = HDNodeWallet.fromPhrase(MNEMONIC_12_HARDHAT, '', "m/44'/60'/0'/0/0");
    expect(key.rawAddress).toBe(w.address.toLowerCase());
    expect(w.privateKey.slice(2)).toBe(bytesToHex(key.privateKey));
  });
});

describe("TRON m/44'/195'/0'/0/0 hex address vs TronWeb", () => {
  it.each([MNEMONIC_12_ABANDON, MNEMONIC_12_HARDHAT, MNEMONIC_24_ABANDON])(
    'matches TronWeb for fixture %#',
    (m) => {
      const tw = TronWeb.fromMnemonic(m, "m/44'/195'/0'/0/0");
      const key = deriveTronKey(mnemonicToSeed(m));
      expect(key.hexAddress).toBe(TronWeb.address.toHex(tw.address).toLowerCase());
      expect(tw.privateKey.replace(/^0x/, '')).toBe(bytesToHex(key.privateKey));
    },
  );
});
