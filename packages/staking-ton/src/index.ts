/**
 * @onezerowallet/staking-ton — Tonstakers liquid staking (tsTON) adapter.
 *
 * Pure, offline pieces shared by the Mini App and the API: the reviewed pool constants, the
 * zero-fee policy, the minimum/reserve rules, the internal message builder (`to`/`value`/`body`)
 * and a decoder for the anti-drainer review.
 */
export {
  STAKE_OPCODE,
  UNSTAKE_OPCODE,
  TONSTAKERS_POOL_MAINNET,
  TONSTAKERS_POOL_TESTNET,
  MIN_STAKE_TON,
  MIN_STAKE_RAW,
  STAKE_GAS_RESERVE_RAW,
  STAKE_MAX_RESERVE_RAW,
  UNSTAKE_GAS_RESERVE_RAW,
  STAKING_FEE_POLICY,
  isTonstakersPool,
  assertMinStake,
  maxStakeAmountRaw,
  buildStakePayload,
  buildUnstakePayload,
  decodeStakePayload,
  decodeUnstakePayload,
  decodeStakingPayload,
} from './payload.js';
export type {
  StakingFeePolicy,
  UnstakeMode,
  StakingAction,
  StakingPayload,
  BuildStakeInput,
  BuildUnstakeInput,
  DecodedStakePayload,
  DecodedUnstakePayload,
  DecodedStakingPayload,
} from './payload.js';
