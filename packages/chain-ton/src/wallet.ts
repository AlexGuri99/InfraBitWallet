/**
 * Wallet V5R1 transfer construction and independent signed-BoC decoding.
 *
 * The wallet id MUST use TON_NETWORK_GLOBAL_ID (testnet -3 / mainnet -239), exactly like the
 * address derivation in packages/crypto-vault. A different id produces a different StateInit
 * hash, so the signed message would not open the displayed wallet.
 *
 * Signing is delegated to a callback (the vault session's signDigest); this package never sees a
 * private key.
 */
import './buffer-polyfill.js';
import {
  Address,
  Cell,
  SendMode,
  beginCell,
  comment as commentBody,
  external,
  internal,
  loadMessage,
  loadOutList,
  storeMessage,
  type MessageRelaxed,
  type Slice,
} from '@ton/core';
import { WalletContractV5R1 } from '@ton/ton';
import { Buffer as NodeBuffer } from 'buffer';
import { TON_NETWORK_GLOBAL_ID, type TonNetwork } from './types.js';

export const V5R1_DEFAULT_VALID_SECONDS = 300;
export const SEND_MODE_DEFAULT = SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS;
export const SEND_MODE_MAX = SendMode.CARRY_ALL_REMAINING_BALANCE + SendMode.IGNORE_ERRORS;
export const JETTON_TRANSFER_OPCODE = 0x0f8a7ea5;
export const JETTON_ATTACHED_TON_RAW = 50_000_000n;
export const JETTON_FORWARD_TON_RAW = 1n;
export const NATIVE_MAX_GAS_RESERVE_RAW = 50_000_000n;

export type TransferSigner = (digest: Uint8Array) => Promise<Uint8Array>;

export interface WalletAddressInfo {
  raw: string;
  bounceable: string;
  nonBounceable: string;
  testnetBounceable: string;
  testnetNonBounceable: string;
}

/** The V5R1 wallet address for a public key on a network (same code path as crypto-vault). */
export function v5r1WalletAddress(publicKeyHex: string, network: TonNetwork): WalletAddressInfo {
  if (!/^[0-9a-fA-F]{64}$/.test(publicKeyHex)) throw new Error('INVALID_TON_PUBLIC_KEY');
  const publicKey = NodeBuffer.from(publicKeyHex, 'hex');
  const contract = WalletContractV5R1.create({
    workchain: 0,
    publicKey,
    walletId: { networkGlobalId: TON_NETWORK_GLOBAL_ID[network] },
  });
  const address = contract.address;
  return {
    raw: address.toRawString(),
    bounceable: address.toString({ bounceable: true, urlSafe: true }),
    nonBounceable: address.toString({ bounceable: false, urlSafe: true }),
    testnetBounceable: address.toString({ bounceable: true, urlSafe: true, testOnly: true }),
    testnetNonBounceable: address.toString({
      bounceable: false,
      urlSafe: true,
      testOnly: true,
    }),
  };
}

/**
 * Render a raw (`0:…`) address as the testnet user-friendly form (`0Q…`/`kQ…`) for display.
 *
 * The confirmation screen must show the same address a sender can verify in a TON explorer, so
 * the review uses the user-friendly encoding, not the raw form decoded from the signed BoC.
 * Returns the input unchanged when it cannot be parsed (the caller still fails closed upstream).
 */
export function toTestnetDisplayAddress(raw: string, bounceable: boolean): string {
  try {
    return Address.parse(raw).toString({ testOnly: true, bounceable, urlSafe: true });
  } catch {
    return raw;
  }
}

/** True when the user-friendly prefix requires bounces (EQ/kQ) — false for UQ/0Q. */
export function addressRequiresBounce(address: string): boolean {
  if (/^UQ/.test(address)) return false; // mainnet non-bounceable
  if (/^EQ/.test(address)) return true; // mainnet bounceable
  if (/^kQ/.test(address)) return true; // testnet bounceable
  if (/^0Q/.test(address)) return false; // testnet non-bounceable
  return true;
}

/** Max TON amount leaving a safe gas reserve (BigInt math). */
export function maxTonAmountRaw(
  balanceRaw: string,
  reserveRaw: bigint = NATIVE_MAX_GAS_RESERVE_RAW,
): string {
  if (!/^\d+$/.test(balanceRaw)) return '0';
  const balance = BigInt(balanceRaw);
  return balance > reserveRaw ? (balance - reserveRaw).toString() : '0';
}

export interface TonTransferRequest {
  publicKeyHex: string;
  network: TonNetwork;
  seqno: number;
  destination: string;
  amountRaw: string | bigint;
  bounce: boolean;
  comment?: string | undefined;
  /** Attach the wallet StateInit (first outgoing transaction from an uninit wallet). */
  deploy?: boolean;
  validUntil?: number | undefined;
  sendMode?: number | undefined;
}

export interface JettonTransferRequest {
  publicKeyHex: string;
  network: TonNetwork;
  seqno: number;
  /** The sender's jetton wallet contract (from portfolio metadata). */
  jettonWallet: string;
  destination: string;
  amountRaw: string | bigint;
  comment?: string | undefined;
  deploy?: boolean;
  validUntil?: number | undefined;
  sendMode?: number | undefined;
  attachedTonRaw?: string | bigint | undefined;
  forwardTonRaw?: string | bigint | undefined;
}

export interface DecodedTransferAsset {
  type: 'ton' | 'jetton';
  jettonWallet?: string | undefined;
}

export interface DecodedSignedTransfer {
  sender: string;
  recipient: string;
  amountRaw: string;
  bounce: boolean;
  asset: DecodedTransferAsset;
  comment: string | null;
  seqno: number;
  validUntil: number;
  hasStateInit: boolean;
  messageHash: { hex: string; base64: string };
}

export interface BuiltTransfer {
  boc: string;
  decoded: DecodedSignedTransfer;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function signerFor(sign: TransferSigner): (message: Cell) => Promise<NodeBuffer> {
  return async (message) => {
    const digest = new Uint8Array(message.hash());
    return NodeBuffer.from(await sign(digest));
  };
}

async function buildWalletMessage(
  request: TonTransferRequest | JettonTransferRequest,
  message: MessageRelaxed,
  sign: TransferSigner,
): Promise<BuiltTransfer> {
  const publicKey = NodeBuffer.from(request.publicKeyHex, 'hex');
  const contract = WalletContractV5R1.create({
    workchain: 0,
    publicKey,
    walletId: { networkGlobalId: TON_NETWORK_GLOBAL_ID[request.network] },
  });
  const validUntil = request.validUntil ?? nowSeconds() + V5R1_DEFAULT_VALID_SECONDS;
  const sendMode = request.sendMode ?? SEND_MODE_DEFAULT;
  const body = await contract.createTransfer({
    seqno: request.seqno,
    timeout: validUntil,
    // SendMode is a bitmask enum; '+' produces a number with the same bits. Reason documented
    // in docs/LINT_EXCEPTIONS.md.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment
    sendMode,
    messages: [message],
    signer: signerFor(sign),
  });
  const ext = external({
    to: contract.address,
    init: request.deploy === true ? contract.init : undefined,
    body,
  });
  const cell = beginCell().store(storeMessage(ext)).endCell();
  const boc = cell.toBoc().toString('base64');
  return { boc, decoded: decodeSignedTransfer(boc) };
}

/** Native TON transfer (optional text comment, op=0). */
export async function buildTonTransfer(
  request: TonTransferRequest,
  sign: TransferSigner,
): Promise<BuiltTransfer> {
  const body =
    request.comment !== undefined && request.comment !== ''
      ? commentBody(request.comment)
      : beginCell().endCell();
  const message = internal({
    to: Address.parse(request.destination),
    value: BigInt(request.amountRaw),
    bounce: request.bounce,
    body,
  });
  return buildWalletMessage(request, message, sign);
}

/** TEP-74 jetton transfer to the sender's jetton wallet, excess returned to the sender. */
export async function buildJettonTransfer(
  request: JettonTransferRequest,
  sign: TransferSigner,
): Promise<BuiltTransfer> {
  const sender = v5r1WalletAddress(request.publicKeyHex, request.network);
  const forwardTon = BigInt(request.forwardTonRaw ?? JETTON_FORWARD_TON_RAW);
  const attached = BigInt(request.attachedTonRaw ?? JETTON_ATTACHED_TON_RAW);
  const payload =
    request.comment !== undefined && request.comment !== '' ? commentBody(request.comment) : null;
  const builder = beginCell()
    .storeUint(JETTON_TRANSFER_OPCODE, 32)
    .storeUint(0, 64)
    .storeCoins(BigInt(request.amountRaw))
    .storeAddress(Address.parse(request.destination))
    .storeAddress(Address.parse(sender.raw))
    .storeBit(false) // custom_payload: none
    .storeCoins(forwardTon);
  if (payload) builder.storeBit(true).storeRef(payload);
  else builder.storeBit(false);
  const message = internal({
    to: Address.parse(request.jettonWallet),
    value: attached,
    bounce: true,
    body: builder.endCell(),
  });
  return buildWalletMessage(request, message, sign);
}

function readComment(slice: Slice): string | null {
  try {
    if (slice.remainingBits < 32) return null;
    const op = slice.loadUint(32);
    if (op !== 0) return null;
    const text = slice.loadStringTail();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

function decodeBody(body: Cell): {
  asset: DecodedTransferAsset;
  recipient?: string | undefined;
  amountRaw?: string | undefined;
  comment: string | null;
} {
  try {
    const slice = body.beginParse();
    if (slice.remainingBits >= 32 && slice.preloadUint(32) === JETTON_TRANSFER_OPCODE) {
      slice.loadUint(32);
      slice.loadUintBig(64);
      const amount = slice.loadCoins();
      const destination = slice.loadAddress();
      slice.loadAddress(); // response destination (sender)
      if (slice.loadBit()) slice.loadRef(); // custom payload (not used)
      slice.loadCoins(); // forward TON amount
      let comment: string | null = null;
      if (slice.loadBit()) {
        comment = readComment(slice.loadRef().beginParse());
      }
      return {
        asset: { type: 'jetton' },
        recipient: destination.toRawString(),
        amountRaw: amount.toString(),
        comment,
      };
    }
    return { asset: { type: 'ton' }, comment: readComment(slice) };
  } catch {
    return { asset: { type: 'ton' }, comment: null };
  }
}

/**
 * Decode a signed V5R1 external message back into its transfer intent. The confirmation UI uses
 * this output, never form state, so what is shown is exactly what will be broadcast.
 */
export function decodeSignedTransfer(boc: string): DecodedSignedTransfer {
  const cells = Cell.fromBoc(NodeBuffer.from(boc, 'base64'));
  const cell = cells[0];
  if (!cell) throw new Error('INVALID_BOC');
  const message = loadMessage(cell.beginParse());
  if (message.info.type !== 'external-in') throw new Error('NOT_EXTERNAL_MESSAGE');
  const sender = message.info.dest.toRawString();
  // V5R1 packs the signature at the TAIL (signing message first), unlike V3/V4.
  const body = message.body.beginParse();
  const op = body.loadUint(32);
  if (op !== 0x7369676e) throw new Error('NOT_V5R1_SIGNED_REQUEST');
  body.loadInt(32); // wallet id (construction-verified; not displayed)
  const validUntil = body.loadUint(32);
  const seqno = body.loadUint(32);
  const outListRef = body.loadMaybeRef();
  if (!outListRef) throw new Error('NO_SEND_ACTION');
  const actions = loadOutList(outListRef.beginParse());
  const send = actions.find((action) => action.type === 'sendMsg');
  if (!send) throw new Error('NO_SEND_ACTION');
  const inner = send.outMsg;
  if (inner.info.type !== 'internal') throw new Error('NOT_INTERNAL_TRANSFER');
  const decodedBody = decodeBody(inner.body);
  const recipient = inner.info.dest.toRawString();
  const messageHash = {
    hex: cell.hash().toString('hex'),
    base64: cell.hash().toString('base64'),
  };

  if (decodedBody.asset.type === 'jetton') {
    return {
      sender,
      recipient: decodedBody.recipient ?? recipient,
      amountRaw: decodedBody.amountRaw ?? '0',
      bounce: inner.info.bounce,
      asset: { type: 'jetton', jettonWallet: recipient },
      comment: decodedBody.comment,
      seqno,
      validUntil,
      hasStateInit: message.init !== undefined && message.init !== null,
      messageHash,
    };
  }
  return {
    sender,
    recipient,
    amountRaw: inner.info.value.coins.toString(),
    bounce: inner.info.bounce,
    asset: { type: 'ton' },
    comment: decodedBody.comment,
    seqno,
    validUntil,
    hasStateInit: message.init !== undefined && message.init !== null,
    messageHash,
  };
}

/** True when validUntil is in the future (sanity check before broadcast). */
export function isTransferStillValid(validUntil: number, now = nowSeconds()): boolean {
  return validUntil > now;
}
