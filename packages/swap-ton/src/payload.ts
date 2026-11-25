/**
 * STON.fi DEX v2 swap payload builder (pure, offline).
 *
 * Mirrors the official SDK flow (docs.ston.fi "Swap"): a `SWAP` body is built by the router
 * contract wrapper and wrapped either in a pTON `TON_TRANSFER` (native offer) or a TEP-74 jetton
 * transfer (jetton offer). Wallet-address resolution is not performed here — the caller passes
 * the addresses the quote resolved on-chain, so this builder never touches the network.
 */
import { Address, beginCell, Cell } from '@ton/core';
import { pTON, routerFactory } from '@ston-fi/sdk';
import { SWAP_FEE_BPS, assertReferralFeeBps } from './fees.js';

/** TEP-74 `transfer` opcode. */
export const JETTON_TRANSFER_OPCODE = 0x0f8a7ea5;
/** STON.fi pTON v2.1 `TON_TRANSFER` opcode (from @ston-fi/sdk 2.7.0). */
export const PTON_TON_TRANSFER_OPCODE = 32_736_093;
/** STON.fi DEX v2 `SWAP` opcode (from @ston-fi/sdk 2.7.0). */
export const DEX_SWAP_OPCODE = 1_717_886_506;

export type SwapDirection = 'ton->jetton' | 'jetton->ton' | 'jetton->jetton';

export interface SwapRouterInfo {
  address: string;
  majorVersion: number;
  minorVersion: number;
  routerType?: string | undefined;
  /** pTON master for the router's DEX version. */
  ptonMasterAddress: string;
  /** The router's own pTON wallet (destination of a native offer / ask wallet for TON). */
  ptonWalletAddress: string;
}

export interface SwapAssetSide {
  kind: 'native' | 'jetton';
  /** Jetton master address; required when kind === 'jetton'. */
  address?: string | undefined;
  /** The user's own jetton wallet; required for a jetton offer. */
  walletAddress?: string | undefined;
}

export interface BuildSwapPayloadInput {
  router: SwapRouterInfo;
  direction: SwapDirection;
  userWalletAddress: string;
  offer: SwapAssetSide;
  /** Jetton wallet that receives the ask tokens (from the quote). */
  askJettonWalletAddress: string;
  offerAmountRaw: string;
  minAskAmountRaw: string;
  /** Reviewed fee-recipient from server config. When absent the router stores no address. */
  referralAddress?: string | undefined;
}

export interface SwapPayload {
  direction: SwapDirection;
  /** Internal-message destination (router pTON wallet or the user's jetton wallet). */
  to: string;
  /** Attached nanoTON: offer + forwarding gas for native offers, gas budget otherwise. */
  valueRaw: string;
  /** Base64 BoC of the internal message body. */
  bodyBoc: string;
}

interface RouterLike {
  createSwapBody(params: {
    askJettonWalletAddress: string;
    receiverAddress: string;
    minAskAmount: string | bigint;
    refundAddress: string;
    excessesAddress?: string;
    referralAddress?: string;
    referralValue?: number;
  }): Promise<Cell>;
  gasConstants: {
    swapTonToJetton: { forwardGasAmount: bigint };
    swapJettonToJetton: { gasAmount: bigint; forwardGasAmount: bigint };
    swapJettonToTon: { gasAmount: bigint; forwardGasAmount: bigint };
  };
}

function raw(address: string): string {
  return Address.parse(address).toRawString();
}

function requireDigits(value: string, code: string): bigint {
  if (!/^\d+$/.test(value) || value === '0') throw new Error(code);
  return BigInt(value);
}

function buildJettonTransferBody(params: {
  amountRaw: bigint;
  destination: string;
  responseDestination: string;
  forwardTonAmount: bigint;
  forwardPayload: Cell;
}): Cell {
  return beginCell()
    .storeUint(JETTON_TRANSFER_OPCODE, 32)
    .storeUint(0, 64) // queryId
    .storeCoins(params.amountRaw)
    .storeAddress(Address.parse(params.destination))
    .storeAddress(Address.parse(params.responseDestination))
    .storeBit(false) // custom_payload
    .storeCoins(params.forwardTonAmount)
    .storeBit(true)
    .storeRef(params.forwardPayload)
    .endCell();
}

/**
 * Build the internal message (`to`, attached value, body BoC) for a STON.fi v2 swap.
 *
 * Fails closed on unsupported DEX versions, missing wallet addresses, a non-positive amount, or a
 * referral fee outside [0, 100] bps.
 */
export async function buildSwapPayload(input: BuildSwapPayloadInput): Promise<SwapPayload> {
  const { router, direction } = input;
  if (router.majorVersion !== 2) throw new Error('UNSUPPORTED_DEX_VERSION');
  // The 35 bps policy is validated here and encoded into the SWAP body by the router wrapper.
  assertReferralFeeBps(SWAP_FEE_BPS);
  const offerAmount = requireDigits(input.offerAmountRaw, 'INVALID_OFFER_AMOUNT');
  const minAskAmount = requireDigits(input.minAskAmountRaw, 'INVALID_MIN_ASK_AMOUNT');
  const user = raw(input.userWalletAddress);

  const routerContract = routerFactory({
    address: raw(router.address),
    majorVersion: router.majorVersion,
    minorVersion: router.minorVersion,
    ...(router.routerType ? { routerType: router.routerType } : {}),
  }) as unknown as RouterLike;

  const swapBody = await routerContract.createSwapBody({
    askJettonWalletAddress: raw(input.askJettonWalletAddress),
    receiverAddress: user,
    minAskAmount,
    refundAddress: user,
    excessesAddress: user,
    ...(input.referralAddress ? { referralAddress: raw(input.referralAddress) } : {}),
    referralValue: SWAP_FEE_BPS,
  });

  if (input.offer.kind === 'native') {
    if (direction === 'jetton->ton' || direction === 'jetton->jetton') {
      throw new Error('DIRECTION_ASSET_MISMATCH');
    }
    const pton = pTON.v2_1.create(raw(router.ptonMasterAddress));
    const forwardGas = routerContract.gasConstants.swapTonToJetton.forwardGasAmount;
    const body = await pton.createTonTransferBody({
      tonAmount: offerAmount,
      refundAddress: user,
      forwardPayload: swapBody,
    });
    return {
      direction,
      to: raw(router.ptonWalletAddress),
      valueRaw: (offerAmount + forwardGas + pton.gasConstants.tonTransfer).toString(),
      bodyBoc: body.toBoc().toString('base64'),
    };
  }

  if (direction === 'ton->jetton') throw new Error('DIRECTION_ASSET_MISMATCH');
  if (!input.offer.walletAddress) throw new Error('MISSING_OFFER_JETTON_WALLET');
  const gas =
    direction === 'jetton->ton'
      ? routerContract.gasConstants.swapJettonToTon
      : routerContract.gasConstants.swapJettonToJetton;
  const body = buildJettonTransferBody({
    amountRaw: offerAmount,
    destination: raw(router.address),
    responseDestination: user,
    forwardTonAmount: gas.forwardGasAmount,
    forwardPayload: swapBody,
  });
  return {
    direction,
    to: raw(input.offer.walletAddress),
    valueRaw: gas.gasAmount.toString(),
    bodyBoc: body.toBoc().toString('base64'),
  };
}

export interface DecodedSwapPayload {
  direction: SwapDirection;
  offerAmountRaw: string;
  minAskAmountRaw: string;
  referralValueBps: number;
}

/**
 * Decode the builder's own body back into the intent the confirmation screen shows. Uses the
 * actual cells that will be signed, never UI state.
 */
export function decodeSwapPayload(bodyBoc: string, direction: SwapDirection): DecodedSwapPayload {
  const cells = Cell.fromBoc(Buffer.from(bodyBoc, 'base64'));
  const cell = cells[0];
  if (!cell) throw new Error('INVALID_BOC');
  const outer = cell.beginParse();
  const op = outer.loadUint(32);
  let offerAmount: bigint;
  let swapCell: Cell;
  if (op === PTON_TON_TRANSFER_OPCODE) {
    if (direction !== 'ton->jetton') throw new Error('DIRECTION_OPCODE_MISMATCH');
    outer.loadUint(64); // queryId
    offerAmount = outer.loadCoins();
    outer.loadAddress(); // refund
    if (!outer.loadBit()) throw new Error('MISSING_SWAP_PAYLOAD');
    swapCell = outer.loadRef();
  } else if (op === JETTON_TRANSFER_OPCODE) {
    if (direction === 'ton->jetton') throw new Error('DIRECTION_OPCODE_MISMATCH');
    outer.loadUint(64); // queryId
    offerAmount = outer.loadCoins();
    outer.loadAddress(); // destination
    outer.loadAddress(); // response destination
    if (outer.loadBit()) outer.loadRef(); // custom payload
    outer.loadCoins(); // forward TON
    if (!outer.loadBit()) throw new Error('MISSING_SWAP_PAYLOAD');
    swapCell = outer.loadRef();
  } else {
    throw new Error('UNKNOWN_SWAP_OPCODE');
  }

  const swap = swapCell.beginParse();
  if (swap.loadUint(32) !== DEX_SWAP_OPCODE) throw new Error('UNKNOWN_SWAP_OPCODE');
  swap.loadAddress(); // ask jetton wallet
  swap.loadAddress(); // refund
  swap.loadAddress(); // excesses
  swap.loadUint(64); // deadline
  const inner = swap.loadRef().beginParse();
  const minAskAmount = inner.loadCoins();
  inner.loadAddress(); // receiver
  inner.loadCoins(); // dex custom payload forward gas
  if (inner.loadBit()) inner.loadRef(); // dex custom payload
  inner.loadCoins(); // refund forward gas
  if (inner.loadBit()) inner.loadRef(); // refund payload
  const referralValueBps = inner.loadUint(16);
  inner.loadMaybeAddress(); // referral address (none when not configured)

  return {
    direction,
    offerAmountRaw: offerAmount.toString(),
    minAskAmountRaw: minAskAmount.toString(),
    referralValueBps,
  };
}
