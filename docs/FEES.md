# OneZeroWallet — Fee Architecture

## 1. Fee Policy

### Swap Fee: 0.35% (35 bps)

Applied on all swaps across TON (v1) and Ethereum (v1). TRON swaps are deferred pending a provider with a verified atomic integrator-fee mechanism.

| Provider                              | Fee Mechanism                                                                                                                                                                          | Source                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **STON.fi (TON)** — direct DEX v2 SDK | `referralValue: 35` in basis points (35 bps = 0.35%). Fees accrue in DEX v2 Vault, withdrawn via SDK.                                                                                  | Verified — docs.ston.fi developer section (fetched 2026-11-20) |
| **0x Swap API (EVM)**                 | `swapFeeRecipient` + `swapFeeBps: 35` (or `swapFeePpm: 3500`). Fee token must be `buyToken` or `sellToken`. 0x may add its own network fee — check `fees.integratorFee` vs total cost. | Verified — docs.0x.org (fetched 2026-11-20)                    |
| **TRON swap**                         | **Deferred from v1** — no provider with a verified atomic integrator-fee mechanism found yet.                                                                                          | UNVERIFIED — see DECISIONS.md                                  |

**⚠️ WARNING: bps vs pips.** STON.fi OmniSton v1beta8 API uses `integrator_fee_pips` (pips = 0.0001%). The direct DEX v2 SDK uses `referralValue` in bps (0.01%). 0.35% = 35 bps = 3500 pips. **Never mix the two.** The swap-payload builder must use the correct unit for the chosen interface.

### Staking Fee: None in v1

Implemented via `StakingFeePolicy` enum:

```typescript
type StakingFeePolicy = 'none' | 'provider_revenue_share' | 'explicit_fee';
```

Default is `'none'` for v1. The enum is plumbed through so a future config change can switch the model without refactoring staking code paths.

P3b ships `STAKING_FEE_POLICY = 'none'` in `@onezerowallet/staking-ton`; the staking and unstaking
review cards show `Wallet fee 0%`. The Tonstakers deposit (1 TON) and unstake (1.05 TON) attached
gas are **protocol gas reserves, not wallet fees** — unused gas is refunded by the pool, and they
are listed separately from the fee line.

## 2. Fee Rules (enforced in client code)

1. **Every fee is shown as a line item** on the confirmation screen BEFORE the user signs.
2. **Hard cap at 1%** (100 bps) in client code. If the config server (or a compromised version of it) sends a fee >1%, the client clamps to 1% and warns. This is tested in unit tests.
3. **Fee-recipient addresses** live in reviewed, signed-off config (committed + reviewed, not fetched from an API at runtime).
4. **Fee calculations use `bigint`** in the smallest unit. Never use floating-point.
5. **Check whether 0x adds its own fee** on top of our integrator fee. The total cost shown to the user must include everything (protocol fee + integrator fee + network fee).
6. **Breakdown shown in swap confirmation:**
   - Exchange rate / price
   - Price impact
   - Minimum received (after slippage)
   - Provider/protocol fee (if any, e.g., 0x network fee)
   - OneZeroWallet fee (0.35%)
   - Network fee (gas / bandwidth / energy)
   - Total deducted from sender

## 3. Fee Hard-Cap Enforcement (Required Tests)

```typescript
// In packages/core/src/fees.ts — tested with Vitest
const MAX_SWAP_FEE_BPS = 100; // 1% hard cap

function computeSwapFee(
  amount: bigint,
  feeBps: number,
  decimals: number,
): { fee: bigint; appliedBps: number } {
  const appliedBps = Math.min(feeBps, MAX_SWAP_FEE_BPS);
  if (appliedBps !== feeBps) {
    // Log warning — config exceeded hard cap
  }
  const fee = (amount * BigInt(appliedBps)) / BigInt(10000);
  return { fee, appliedBps };
}
```

**Required unit tests:**

1. Build a real swap payload and assert the encoded fee equals exactly 0.35% of the amount.
2. Assert the 1% client-side cap rejects anything larger, including a mistaken pips value (e.g., `feeBps: 3500` should be clamped to 100, or rejected).

## 4. Provider-Specific Fee Details

### STON.fi (TON) — Direct DEX v2 SDK

- Interface: direct DEX v2 SDK (not OmniSton API for v1)
- Parameter: `referralValue: 35` (basis points — 35 bps = 0.35%)
- Fee accrues in DEX v2 Vault contract, withdrawn via STON.fi SDK
- **Do not confuse with OmniSton v1beta8** which uses `integrator_fee_pips` (pips)
- Source: https://docs.ston.fi/developer-section/omniston/referral-fees

### 0x Swap API (EVM)

- Parameters: `swapFeeRecipient`, `swapFeeBps` (or `swapFeePpm`), `swapFeeToken`
- 0.35% = **35 bps** (or **3500 ppm**)
- 0x may also charge its own protocol/network fee — included in `fees.integratorFee` vs full quote cost
- Max allowed by 0x: 1000 bps (10%) — but our client caps at 100 bps
- Trade surplus: can optionally be routed to integrator via `tradeSurplusRecipient` (custom plans only)
- Source: https://docs.0x.org/ (fetched 2026-11-20)
- **Legal:** Commercial terms need review before production — see `docs/LEGAL_TODO.md`

### TRON — Deferred

- No TRON swap fee in v1. See `docs/DECISIONS.md` for future-work status.

## 5. Treasury

See `docs/TREASURY.md` for full details on fee addresses, claiming/withdrawal process, and admin scripts.

### Fee Addresses (per chain)

One fee-recipient address per chain, controlled by a hardware wallet. A multisig is planned later.

- TON fee address: TBD (hardware wallet GRAM address)
- TRON fee address: TBD (hardware wallet TRX address) — note: no TRON swap fee in v1
- Ethereum fee address: TBD (hardware wallet ETH address)

**Rule:** Treasury key is never on the server, in the repo, or in any env var.
