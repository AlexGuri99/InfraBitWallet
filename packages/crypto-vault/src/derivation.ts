/**
 * Multi-chain key derivation from a single BIP-39 seed.
 *
 * Supported chains:
 * - TON:  m/44'/607'/0'  (Ed25519, SLIP-10)
 * - TRON: m/44'/195'/0'/0/0 (secp256k1, BIP-32)
 * - EVM:  m/44'/60'/0'/0/0  (secp256k1, BIP-32)
 *
 * Sources:
 * - SLIP-10 Ed25519 derivation: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 * - SLIP-44 coin types: https://github.com/satoshilabs/slips/blob/master/slip-0044.md
 * - TON V5R1 address: https://docs.ton.org/contracts/standard/wallets/v5 (fetched 2026-11-20)
 * - BIP-44: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
 */
import { HDKey } from '@scure/bip32';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';

// ---------------------------------------------------------------------------
// SLIP-10 Ed25519 derivation
// ---------------------------------------------------------------------------

interface Slip10Key {
  privateKey: Uint8Array;
  chainCode: Uint8Array;
}

/**
 * Derive an Ed25519 key pair using SLIP-10.
 * See: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 */
function deriveSlip10Node(seed: Uint8Array, path: string): Slip10Key {
  if (!path.startsWith('m/')) {
    throw new Error(`Invalid SLIP-10 path: ${path}. Must start with "m/".`);
  }

  const segments = path.slice(2).split('/');
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32, 64);

  for (const segment of segments) {
    let index: number;
    if (segment.endsWith("'")) {
      index = parseInt(segment.slice(0, -1), 10) + 0x80000000;
    } else {
      throw new Error(`SLIP-10 Ed25519 only supports hardened derivation: ${segment}`);
    }

    const data = new Uint8Array(33 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index, false);

    const Ichild = hmac(sha512, chainCode, data);
    key = Ichild.slice(0, 32);
    chainCode = Ichild.slice(32, 64);
  }

  return { privateKey: key, chainCode };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DerivedKey {
  chain: 'ton' | 'tron' | 'evm';
  path: string;
  privateKey: Uint8Array;
  address: string;
}

/**
 * Derive a TON Ed25519 key pair.
 *
 * Path: m/44'/607'/0'  (SLIP-10, Ed25519)
 * Address: raw TON address format (workchain:pubkey_hash)
 * Full V5R1 address computed in chain-ton package.
 *
 * Source: SLIP-44 coin type 607
 */
export function deriveTonKey(seed: Uint8Array, accountIndex: number = 0): DerivedKey {
  const path = `m/44'/607'/${String(accountIndex)}'`;
  const { privateKey } = deriveSlip10Node(seed, path);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    chain: 'ton',
    path,
    privateKey,
    address: `0:${bytesToHex(publicKey)}`,
  };
}

/**
 * Derive a TRON secp256k1 key pair.
 *
 * Path: m/44'/195'/0'/0/0 (BIP-32, secp256k1)
 * Address (hex): 41 + keccak256(publicKey[1:])[-20:]
 * Full base58 address computed in chain-tron package.
 *
 * Sources:
 * - SLIP-44 coin type 195 (TRX)
 * - TRON accounts: https://developers.tron.network/docs/account
 */
export function deriveTronKey(seed: Uint8Array, accountIndex: number = 0): DerivedKey {
  const path = `m/44'/195'/${String(accountIndex)}'/0/0`;
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(path);
  if (!child.privateKey) {
    throw new Error(`Failed to derive TRON key at ${path}`);
  }

  const publicKey = secp256k1.getPublicKey(child.privateKey, false); // uncompressed (65 bytes)
  const pubKeyBytes = publicKey.slice(1); // remove 0x04 prefix
  const hash = keccak_256(pubKeyBytes);
  const tronHexAddress = `41${bytesToHex(hash.slice(-20))}`;

  return {
    chain: 'tron',
    path,
    privateKey: child.privateKey,
    address: tronHexAddress,
  };
}

/**
 * Derive an Ethereum secp256k1 key pair.
 *
 * Path: m/44'/60'/0'/0/0 (BIP-32, secp256k1)
 * Address: 0x + keccak256(publicKey[1:])[-20:] (lowercase; EIP-55 in chain-evm)
 *
 * Sources:
 * - BIP-44: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
 * - EIP-55: https://eips.ethereum.org/EIPS/eip-55
 * - SLIP-44 coin type 60
 */
export function deriveEvmKey(seed: Uint8Array, accountIndex: number = 0): DerivedKey {
  const path = `m/44'/60'/${String(accountIndex)}'/0/0`;
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(path);
  if (!child.privateKey) {
    throw new Error(`Failed to derive EVM key at ${path}`);
  }

  const publicKey = secp256k1.getPublicKey(child.privateKey, false);
  const pubKeyBytes = publicKey.slice(1);
  const hash = keccak_256(pubKeyBytes);
  const ethAddress = `0x${bytesToHex(hash.slice(-20))}`;

  return {
    chain: 'evm',
    path,
    privateKey: child.privateKey,
    address: ethAddress,
  };
}

export interface DerivedKeys {
  ton: DerivedKey;
  tron: DerivedKey;
  evm: DerivedKey;
}

/**
 * Derive keys for all supported chains from a single BIP-39 seed.
 */
export function deriveAllKeys(
  seed: Uint8Array,
  accountIndex: number = 0,
): DerivedKeys {
  return {
    ton: deriveTonKey(seed, accountIndex),
    tron: deriveTronKey(seed, accountIndex),
    evm: deriveEvmKey(seed, accountIndex),
  };
}

export { bytesToHex } from '@noble/hashes/utils';