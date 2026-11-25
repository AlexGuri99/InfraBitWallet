/**
 * @onezerowallet/swap-ton — STON.fi DEX v2 swap adapter.
 *
 * Pure, offline pieces shared by the Mini App and the API: fee/slippage policy, the internal
 * message builder (`to`/`value`/`body`), and a decoder for the anti-drainer review.
 */
export {
  SWAP_FEE_BPS,
  MAX_SWAP_FEE_BPS,
  SLIPPAGE_PRESETS_BPS,
  MIN_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  assertReferralFeeBps,
  assertSlippageBps,
  minReceivedRaw,
} from './fees.js';

export {
  JETTON_TRANSFER_OPCODE,
  PTON_TON_TRANSFER_OPCODE,
  DEX_SWAP_OPCODE,
  buildSwapPayload,
  decodeSwapPayload,
} from './payload.js';
export type {
  SwapDirection,
  SwapRouterInfo,
  SwapAssetSide,
  BuildSwapPayloadInput,
  SwapPayload,
  DecodedSwapPayload,
} from './payload.js';
