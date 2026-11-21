/**
 * User-facing address forms (B1).
 *
 * - EVM: EIP-55 checksummed address.
 * - TRON: base58check ("T…") from the 0x41-prefixed 21-byte form.
 * - TON: Wallet V5R1 address (hash of the wallet contract StateInit) in raw and user-friendly
 *   bounceable/non-bounceable forms, mainnet and testnet.
 *
 * Sources (fetched 2026-11-21):
 * - EIP-55: https://eips.ethereum.org/EIPS/eip-55
 * - TON address formats: https://docs.ton.org/v3/documentation/smart-contracts/addresses/address-formats
 *   Raw = "workchain:account_id"; user-friendly = flags(1)+workchain(1)+account(32)+CRC16(2),
 *   base64url. Flags: 0x11 bounceable, 0x51 non-bounceable, +0x80 testnet-only.
 *   "Use non-bounceable addresses for wallet contracts so funds can be credited even if the
 *   recipient is uninitialized."
 * - TON Wallet V5R1: @ton/ton (MIT) WalletContractV5R1; wallet id = global_id ^ context,
 *   global_id -239 mainnet / -3 testnet, default workchain 0, subwallet 0.
 * - Base58check: @scure/base (MIT), double SHA-256, 4-byte checksum.
 * - TRON hex address: 0x41 + last 20 bytes of keccak256(uncompressed pubkey[1:]).
 */
// Order matters: the buffer polyfill and zod's jitless config must run before @ton modules load.
import './buffer-polyfill';
import './zod-jitless';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { Address, contractAddress } from '@ton/core';
import { WalletContractV5R1 } from '@ton/ton';
import { Buffer as NodeBuffer } from 'buffer';

const base58check = createBase58check(sha256);

// ---------------------------------------------------------------------------
// EVM — EIP-55
// ---------------------------------------------------------------------------

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 checksum for a 20-byte address given in lowercase hex (with or without 0x). */
export function toEip55Address(address: string): string {
  const raw = address.startsWith('0x') ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]{40}$/.test(raw)) throw new Error('INVALID_EVM_ADDRESS');
  const lower = raw.toLowerCase();
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const ch = lower[i] ?? '';
    const nibble = Number.parseInt(hash[i] ?? '0', 16);
    out += nibble >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

/**
 * Validate an EVM address. Digits and prefix are checked; an all-lower or all-upper address is
 * accepted (no checksum information), a mixed-case address must match EIP-55.
 */
export function isValidEvmAddress(address: string): boolean {
  if (!EVM_ADDRESS.test(address)) return false;
  const raw = address.slice(2);
  if (raw === raw.toLowerCase() || raw === raw.toUpperCase()) return true;
  return toEip55Address(address) === address;
}

// ---------------------------------------------------------------------------
// TRON — base58check
// ---------------------------------------------------------------------------

/**
 * Base58check "T…" address from the 21-byte 0x41-prefixed hex form
 * (e.g. "41" + 40 hex chars). Throws on a malformed input.
 */
export function toBase58TronAddress(hexAddress: string): string {
  if (!/^41[0-9a-fA-F]{40}$/.test(hexAddress)) throw new Error('INVALID_TRON_HEX_ADDRESS');
  return base58check.encode(hexToBytes(hexAddress.toLowerCase()));
}

/** Validate a base58check TRON address: decodes to 21 bytes starting with 0x41. */
export function isValidTronAddress(address: string): boolean {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  try {
    const bytes = base58check.decode(address);
    return bytes.length === 21 && bytes[0] === 0x41;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// TON — Wallet V5R1 addresses
// ---------------------------------------------------------------------------

export const TON_MAINNET_GLOBAL_ID = -239;
export const TON_TESTNET_GLOBAL_ID = -3;

export interface TonAddressForms {
  /** "workchain:account_id" */
  raw: string;
  /** Mainnet, requires bounces (EQ…). */
  bounceable: string;
  /** Mainnet, permits non-bounceable messages (UQ…). */
  nonBounceable: string;
  /** Testnet-only, requires bounces (kQ…). */
  testnetBounceable: string;
  /** Testnet-only, permits non-bounceable messages (0Q…). */
  testnetNonBounceable: string;
}

/** Stable label for the default V5R1 wallet id: mainnet, workchain 0, subwallet 0. */
export const TON_V5R1_DEFAULT_WALLET_ID = {
  mainnet: 2147483409,
  testnet: 2147483645,
} as const;

function createV5R1(publicKeyHex: string, networkGlobalId: number): WalletContractV5R1 {
  const publicKey = NodeBuffer.from(hexToBytes(publicKeyHex.toLowerCase()));
  return WalletContractV5R1.create({
    workchain: 0,
    publicKey,
    walletId: { networkGlobalId },
  });
}

/**
 * All address forms for an Ed25519 public key using Wallet V5R1 (mainnet and testnet).
 * Account index is NOT part of the address: each derived key has its own address with
 * subwallet number 0.
 */
export function tonAddressesFromPublicKey(publicKeyHex: string): TonAddressForms {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) throw new Error('INVALID_TON_PUBLIC_KEY');
  const main = createV5R1(publicKeyHex, TON_MAINNET_GLOBAL_ID).address;
  const test = createV5R1(publicKeyHex, TON_TESTNET_GLOBAL_ID).address;
  return {
    raw: main.toRawString(),
    bounceable: main.toString({ bounceable: true, urlSafe: true }),
    nonBounceable: main.toString({ bounceable: false, urlSafe: true }),
    testnetBounceable: test.toString({ bounceable: true, urlSafe: true, testOnly: true }),
    testnetNonBounceable: test.toString({ bounceable: false, urlSafe: true, testOnly: true }),
  };
}

/**
 * Independent cross-check of tonAddressesFromPublicKey: rebuild the wallet StateInit and hash it
 * with contractAddress. Used in tests to catch a wallet-id or serialization mistake.
 * Exported for tests only (not part of the package's public API).
 */
export function tonRawAddressViaStateInit(
  publicKeyHex: string,
  networkGlobalId: number = TON_MAINNET_GLOBAL_ID,
): string {
  const contract = createV5R1(publicKeyHex, networkGlobalId);
  return contractAddress(0, { code: contract.init.code, data: contract.init.data }).toRawString();
}

export interface TonAddressValidation {
  valid: boolean;
  /** Raw "workchain:hex" form when valid. */
  raw?: string;
  /** Whether the input declared the testnet-only flag (user-friendly forms only). */
  testnet?: boolean | undefined;
}

/**
 * Validate a TON address in raw or user-friendly form. Uses @ton/core parsing, which verifies
 * the CRC16 checksum of user-friendly forms.
 */
export function validateTonAddress(input: string): TonAddressValidation {
  if (typeof input !== 'string' || input.trim() === '') return { valid: false };
  try {
    const address = Address.parse(input.trim());
    const testnet = /^[k0]/.test(input.trim()) && !input.trim().includes(':') ? true : undefined;
    return { valid: true, raw: address.toRawString(), testnet };
  } catch {
    return { valid: false };
  }
}
