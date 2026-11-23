# OneZeroWallet — Decisions

## Decision: TON Swap Provider → STON.fi (direct DEX v2 SDK)

**Status:** Accepted

**Recommendation:** STON.fi DEX v2 via the direct DEX v2 SDK, using `referralValue` in basis points.

**Reasons:**

- Established TON DEX with deepest liquidity.
- Direct SDK supports `referralValue` parameter (bps): 35 bps = 0.35%.
- Fee accrues in DEX v2 Vault for controlled withdrawal.
- Permissively documented API — no copyleft concerns.

**Source:** https://docs.ston.fi/developer-section/omniston/referral-fees (fetched 2026-11-20)

**License:** STON.fi SDK is MIT. API usage is free. No restrictive terms identified.

**Fee mechanism (v1):** Direct DEX v2 SDK with `referralValue: 35` (35 bps = 0.35%) and a referral/receiving address.

**⚠️ bps vs pips warning:** STON.fi OmniSton v1beta8 API (`integrator_fee_pips`) uses pips (1 pip = 0.0001%). The direct DEX v2 SDK (`referralValue`) uses bps (1 bps = 0.01%). 0.35% = **35 bps** = **3500 pips**. The swap-payload builder must use the correct unit for the chosen interface. A mistaken pips value (3500) passed as bps would be rejected by the 1% client-side cap (test required).

**Risks:**

- API rate limits (mitigate: cache quotes, fallback mode).
- SDK versioning — breaking changes.
- DEX V2 Vault withdrawal requires SDK integration.

---

## Decision: EVM Swap Aggregator → 0x Swap API

**Status:** Accepted (provisional — legal review needed)

**Recommendation:** 0x Swap API (https://0x.org)

**Reasons:**

- Leading EVM swap aggregator, routes through all major DEXes.
- Native integrator fee support via `swapFeeRecipient`, `swapFeeBps`, `swapFeeToken`.
- Supports multi-recipient fee splitting.
- Free tier available (higher volume needs custom pricing).
- Covers Ethereum mainnet + potential future chains (Base, BNB, Arbitrum).

**Source:** https://docs.0x.org/ (fetched 2026-11-20)

**License:** 0x API License Agreement (terms apply for commercial use). Free tier available for dev/test. **Must review commercial terms before production revenue-sharing use** — see `docs/LEGAL_TODO.md`.

**Fee mechanism:** `swapFeeRecipient` address receives `swapFeeBps: 35` (0.35%) of sellAmount. Fee token must be buyToken or sellToken. Trade surplus optional via `tradeSurplusRecipient` (custom plan). 0x may also add its own protocol/network fee — the total cost shown to the user must include everything.

**Risks:**

- API dependency — 0x could change terms, pricing, or availability.
- Centralization risk — single point of failure for EVM swaps.
- **Could 0x add its own fee?** UNVERIFIED — need to check `fees.integratorFee` vs total quote cost before P5.
- License terms for commercial use need legal review.
- API rate limits on free tier.

---

## Decision: TRON Swap — DEFERRED from v1

**Status:** Future work — no suitable provider found for v1

**Finding:** SunSwap V4 (https://sun.io) is the dominant DEX on TRON (current version is V4, which replaces the earlier JustSwap/SunSwap V1-V3 branding). SUN.io also offers SunCurve (stablecoins) and PSM. However, **no documented integrator fee mechanism** was found in the available SunSwap or TRON developer documentation that would support a verifiable atomic fee collection at swap time.

**Source:** https://docs.sun.io/ (fetched 2026-11-20)

**What was checked:**

- SunSwap V4 documentation — swap contract interfaces
- TRON developer hub — TRC-20 swap standards
- SUN.io documentation pages

**Requirement for future inclusion:**
A TRON swap provider must support a verified, atomic integrator-fee mechanism that:

1. Encodes the fee in the swap transaction itself (not a separate transfer).
2. Prevents the user or the swap contract from bypassing the fee.
3. Supports a verifiable fee amount (0.35%) at quote/execution time.

Until then, TRON v1 covers receive and send (TRX, USDT) with energy handling only.

**Risks:**

- Two-transaction fee approach (swap + parallel transfer) was considered and rejected per project guidance: excessive TRON energy/bandwidth costs.
- TRON DeFi ecosystem less mature than EVM — aggregator options are limited.
- SunSwap's terms of service need review.

---

## Decision: GRAM Staking Provider → Tonstakers

**Status:** Accepted

**Recommendation:** Tonstakers (https://tonstakers.com)

**Reasons:**

- Largest TON liquid staking protocol by TVL.
- Full TypeScript SDK available (`tonstakers-sdk` on npm, MIT license).
- `partnerCode` field in SDK allows tracking referrals (no fee in v1, but infrastructure ready).
- Liquid staking via tsTON — users can use tsTON in DeFi.
- Instant unstaking available ("within minutes").
- `getCurrentApy()` returns live APY.
- Automatic compounding ~every 18 hours.

**Source:** https://tonstakers.com/ and https://github.com/tonstakers/tonstakers-sdk (fetched 2026-11-20)

**License:** Tonstakers SDK: MIT.

**Fee mechanism:** None in v1 (`StakingFeePolicy: 'none'`). The SDK's `partnerCode` field is available for future revenue share if policy changes.

**Risks:**

- Smart contract risk (though established protocol).
- Instant unstaking liquidity depends on pool.
- APY is variable and market-dependent.
- Unstaking gas reserve: SDK adds 1 TON fee reserve on stake, 1.05 TON gas for unstake.

---

## Decision: TON Data Provider → TON Center API (with tonconsole.com fallback)

**Status:** Accepted (provisional — GRAM rename impact UNVERIFIED)

**Recommendation:** TON Center API (https://toncenter.com/api/v2/) with fallback to tonconsole.com (https://tonconsole.com/api).

**Reasons:**

- Free tier available (rate-limited).
- REST API for addresses, balances, transactions, jettons.
- Well-documented, widely used.
- Supports testnet.

**Source:** https://toncenter.com/api/v2/ (fetched 2026-11-20)

**License:** Free API tier — rate limits apply. Terms of service standard.

**Risks:**

- **GRAM rename impact UNVERIFIED:** Need to check live TON Center/TonAPI responses in P2 for what they return post-rename. Assumption that they still return "TON" needs verification.
- Rate limits on free tier may require API key (paid upgrade) for production.
- API deprecation risk.
- Mitigation: abstract behind a `TonDataProvider` interface with fallback chaining.

---

## Decision: TRON Data Provider → TronGrid (with fallback to full node RPC)

**Status:** Accepted

**Recommendation:** TronGrid (https://trongrid.io) with FullNode HTTP API as local fallback.

**Reasons:**

- Official TRON infrastructure provider by TRON DAO.
- Scales to production.
- REST + gRPC endpoints for balances, TRC-20, transactions, resources (energy/bandwidth).
- Free tier with API key.

**Source:** https://developers.tron.network/ (fetched 2026-11-20)

**License:** Free tier available. Paid tiers for higher rate limits.

**Risks:**

- Centralization — TronGrid is the primary provider.
- API key needed for rate limits.
- Mitigation: maintain ability to connect directly to public FullNode HTTP endpoints.

---

## Decision: EVM Data Provider → Alchemy (with Infura fallback)

**Status:** Accepted

**Recommendation:** Alchemy (https://alchemy.com) with Infura (https://infura.io) as fallback.

**Reasons:**

- Leading EVM RPC provider, supports all EVM chains.
- Rich API: balances, token metadata, transaction history (via Transfers API), gas estimation.
- Free tier generous enough for development.
- Viem support (our chosen EVM library).

**License:** Standard API terms. Free tier, paid for production scale.

**Risks:**

- Rate limits on free tier.
- API key exposure mitigated by proxying through our keyless API.
- Mitigation: abstract behind `EvmDataProvider` interface, fallback to Infura or public RPCs.

---

## Decision: State Management → Zustand

**Status:** Accepted

**Reasons:**

- Minimal boilerplate compared to Redux Toolkit.
- First-class TypeScript support.
- Works well with React without context providers.
- Lightweight (~1KB).
- Easy to test with store outside React components.

---

## Decision: Package Manager → pnpm

**Status:** Accepted

**Reasons:**

- Strict dependency isolation prevents phantom dependencies.
- Faster installs with content-addressable store.
- Built-in workspace support for monorepo.
- Dependency install scripts disabled unless explicitly allowlisted (security).

**CI impact:** CI uses `pnpm install --frozen-lockfile`. Audit uses `pnpm audit`.

---

## Complete Findings List (Research Results from 2026-11-20)

**10 items identified:**

| #   | Item                                                                                                                                                                                                                  | Verdict                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | **STON.fi fee parameter** — Brief says `referralValue: 35` (bps). Current OmniSton v1beta8 uses `integrator_fee_pips: 3500` (pips). Direct DEX v2 SDK uses `referralValue` in bps. For v1 we use direct SDK with bps. | ✅ bps corrected; pips warning added  |
| 2   | **SunSwap version** — Brief says "e.g. SunSwap." Current docs show SunSwap V4 is latest (not V2). Ecosystem includes SunCurve, PSM, Universal Router.                                                                 | ✅ V4 noted; TRON swaps deferred      |
| 3   | **SunSwap integrator fee undocumented** — No fee mechanism found for atomic collection.                                                                                                                               | 🚫 TRON swap excluded from v1         |
| 4   | **`@telegram-apps/sdk` vs `@tma.js/sdk`** — Brief references `@telegram-apps/sdk`. Docs reference `@tma.js/sdk@4`. Need to verify if same project.                                                                    | UNVERIFIED — verify before P0 install |
| 5   | **GRAM rename — API impact** — Brief says TON→GRAM 2026-06-15. Tonstakers uses "GRAM." SLIP-44 still shows "TON." Impact on TON Center API responses unknown.                                                         | UNVERIFIED — add P2 check task        |
| 6   | **TRON derivation path** — `m/44'/195'/0'/0/0` confirmed from SLIP-44. Some wallets vary change/address_index usage.                                                                                                  | ✅ Confirmed per SLIP-44              |
| 7   | **0x API commercial terms** — Free tier available. API License Agreement needs review before production revenue-sharing.                                                                                              | → docs/LEGAL_TODO.md                  |
| 8   | **TRON "no USDC" claim** — Brief says Circle ended native USDC on TRON. Date and current status of existing USDC need verification.                                                                                   | UNVERIFIED — verify in P4             |
| 9   | **TON wallet V5R1** — Confirmed: "Most wallet apps use Wallet V5R1... by default."                                                                                                                                    | ✅ Confirmed                          |
| 10  | **Derivation paths confirmed** — TON `m/44'/607'/0'`, TRON `m/44'/195'/0'/0/0`, ETH `m/44'/60'/0'/0/0` all from SLIP-44.                                                                                              | ✅ Confirmed                          |

---

## Decision: Account-index convention in derivation paths (OPEN — needs owner approval)

**Status:** Proposed (2026-11-21). Code has NOT changed; current behaviour is described below.

**What the code does now**

| Chain    | Path                | Account index lives on |
| -------- | ------------------- | ---------------------- |
| TON      | `m/44'/607'/N'`     | hardened account level |
| TRON     | `m/44'/195'/N'/0/0` | hardened account level |
| Ethereum | `m/44'/60'/N'/0/0`  | hardened account level |

So account 0 matches the common single-account path on every chain. Account 1 and beyond take a
different branch from wallets that vary the last (non-hardened) component instead.

**Verified facts**

- BIP-44 defines `m / purpose' / coin_type' / account' / change / address_index`; purpose, coin
  type and account are hardened; change and address_index use public derivation. Accounts are
  numbered from 0. Source: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
  (fetched 2026-11-21).
- SLIP-44 fixes the coin types (607 TON, 195 TRON, 60 ETH). Source:
  https://github.com/satoshilabs/slips/blob/master/slip-0044.md

**Not verified this session** (see UNVERIFIED.md): the exact path each of MetaMask, Ledger Live,
TronLink and Tonkeeper uses for _additional_ accounts, and whether they place the index on the
hardened account level or the non-hardened address_index. Source fetches returned 404/redirects.

**Options**

1. Keep `…/N'/…` (current; matches the common "account" reading of BIP-44 and Ledger-Live-style
   hardened account levels, per the fact above).
2. Use `…/0/…/N` (address_index), matching wallets that derive extra accounts as addresses of
   account 0.
3. Expose a per-chain convention setting at import time and store which one was used.

**Recommendation:** option 1 for v1 **plus** a documented import note explaining that only
account 0 is guaranteed to match other wallets until the conventions are confirmed, and option 3
later if users report import mismatches. Do not change the derivation until the owner approves and
the per-wallet conventions are verified with sources.

**Consequence if we get it wrong:** a user who imports their 24 words into another wallet and
selects "account 2" in our app may see a different address there, and may think funds are lost.
The recovery phrase is the same; only the account branch differs.

---

## Decision: TON account model — BIP-39 default, TON-native import supported

**Status:** Accepted (2026-11-21; owner approved Stage B). The code now supports both account types in the seal
(`accountType: 'bip39-multichain' | 'ton-native-only'`). The default for new wallets remains
`bip39-multichain`. The branding/UX choice is NOT final and needs the owner's approval.

### Verified facts (sources fetched 2026-11-21)

- **TON-native derivation** (`@ton/crypto`, MIT — `mnemonic/mnemonic.js`, mirroring
  `ton-blockchain/ton tonlib/keys/Mnemonic.cpp`):
  `entropy = HMAC-SHA512(words, "")`; valid iff
  `PBKDF2-SHA512(entropy, "TON seed version", 100000/256, 64)[0] === 0`;
  seed = `PBKDF2-SHA512(entropy, "TON default seed", 100000, 64)`; Ed25519 key = seed[0..32].
  It uses the BIP-39 English wordlist but NOT the BIP-39 checksum or seed derivation.
- **BIP-39 derivation** is different: `PBKDF2-SHA512("mnemonic"+passphrase, "mnemonic", 2048)`.
  The same 24 words therefore give unrelated keys under the two schemes.
- **Tonkeeper** (`tonkeeper/tonkeeper-web`, Apache-2.0, public source):
  - validates TON phrases with `@ton/crypto mnemonicValidate`;
  - also accepts BIP-39 phrases and derives TON with `mnemonicToSeed` + SLIP-10
    `pathFor('ton') = "m/44'/607'/0'"` + `keyPairFromSeed` (files: `service/mnemonicService.ts`,
    `chains/derivation.ts`);
  - classifies a phrase that is valid both ways as "two readings compete … the two derive
    different keys" (`service/importWalletKindPreviewService.ts`);
  - previews holdings "across every wallet version".
- **Ledger TON** (`ton-core/ton-ledger-ts` README, MIT):
  path `[44, 607, network, chain, account, 0]` (network 0 mainnet/1 testnet, chain 0 for wc 0 /
  255 for wc -1), and "Ledger Nanoapp works with Wallet v4 for now". Custom paths "could be
  incompatible with other apps".
- **Address depends on wallet version**: our addresses use Wallet **V5R1**, subwallet 0.

### Answers

1. **Our BIP-39 words into Keeper:** Keeper's BIP-39 path is `m/44'/607'/0'`, the same as our
   account 0, so the derived key matches. The address matches only if Keeper's active wallet
   version is **V5R1** with subwallet 0; with V4R2 the address differs (Keeper previews all
   versions, so funds should still be discoverable). Which version Keeper defaults to is
   UNVERIFIED.
2. **Our BIP-39 words into Ledger:** the default Ledger path is different
   (`m/44'/607'/0/0/<account>/0`) and Ledger uses Wallet V4, so the address does **not** match
   without a custom path and a V5-capable app.
3. **Our words into a wallet that only reads TON-native phrases:** usually rejected (they fail
   the TON seed check) rather than imported to a different address. Edge case: a phrase that
   happens to pass both checks is interpreted as TON-native by such wallets, giving a different
   key — our seal therefore stores the account type explicitly and the UI will state which kind
   of phrase is being shown.
4. My Wallet (MyTonWallet) was deliberately NOT inspected (license prohibits deriving from it).
   Its behaviour is UNVERIFIED.

### Options

1. **BIP-39 for all chains with documented import instructions (current).** One phrase, three
   chains; EVM/TRON import matches common wallets; TON account 0 matches Keeper's BIP-39 path
   and our V5R1 address. Importing into Ledger needs a custom path.
2. **TON-native phrase for TON + separate BIP-39 for TRON/EVM.** Matches native TON wallets but
   requires two backups and is easy to confuse.
3. **Support both at creation (implemented):** default BIP-39; offer "I have a TON wallet phrase"
   import that creates a `ton-native-only` account. No EVM/TRON claims for that account.

**Recommendation: option 3.** Default to BIP-39 multichain; offer TON-native import with an
explicit warning that it is TON-only. Document that Ledger users need a custom path and see V4
addresses. **Approved:** BIP-39 remains the default; TON-native import is offered for TON-only accounts.

### Consequences in code

- Seal v5 stores `accountType`; v1–v4 seals migrate to `bip39-multichain`.
- `deriveTonKey(seed, index, accountType)` yields the native Ed25519 key for `ton-native-only`
  (account index must be 0) and the SLIP-10 key otherwise.
- `getPublicInfo()` exposes TON only for native accounts; `signDigest` rejects other chains and
  non-zero indices for them.
- Tests: `account-type.test.ts` (official @ton/crypto vector), `vault.test.ts › B2: migration of
v4 seals`, `session.test.ts`, `vault-manager.test.ts`.

---

## Decision: Passcode policy temporarily relaxed to a 4-digit PIN

**Status:** Accepted (2026-11-22), temporary and explicitly time-boxed to pre-mainnet development.

**What changed**

- `evaluatePasscodeStrength` now accepts exactly `^\d{4}$` in both environments (with and without
  a device secret) and rejects everything else.
- Weak PINs are still rejected: all identical digits (`0000`–`9999`) and consecutive
  ascending/descending runs (`0123`, `1234`, `2345`, `4321`, …).
- Argon2id parameters, unlock backoff/lockout, device-secret wrapping and biometric wrapping are
  unchanged.

**Why**

Early Testnet/UX iteration: a 4-digit PIN is the expected Telegram Mini App pattern and keeps the
onboarding fast while there are no real funds.

**Security consequence (must be reversed before mainnet)**

- A 4-digit PIN has 10,000 combinations. On-device guessing is limited by the persisted backoff,
  but a 4-digit PIN **without** a device secret (Web/Desktop, where SecureStorage is unavailable)
  is brute-forceable offline if the IndexedDB envelope is copied: Argon2id slows each guess but
  cannot make 10,000 candidates infeasible.
- Before mainnet: either restore the stricter policy without a device secret (12+ character
  passphrase) or gate Web/Desktop wallets behind a passphrase, and re-run the Argon2id timing
  measurements. Tracked in `docs/UNVERIFIED.md` #21 and `docs/THREAT_MODEL.md` T11.

**Tests:** `packages/crypto-vault/src/policy.test.ts`; UI tests use `2580` and assert `1234`/`0000`
are rejected.

---

## Decision: Mandatory Create-time backup verification temporarily skipped

**Status:** Accepted (2026-11-22), temporary dev-UX concession.

**What changed**

- The Create Wallet flow is now two steps: Recovery Phrase (reveal + "I've stored the seed
  phrase" acknowledgement) → Set 4-digit PIN. The vault is sealed on the PIN step; the temporary
  mnemonic stays in the module-scoped holder until then and is wiped on back/background/completion.
- The 3-word `VerifyScreen` is no longer part of Create. It remains in use for **Settings → Test
  your backup**, which re-authenticates, reveals the phrase into the holder, asks for three random
  positions, and clears the holder afterward.

**Why**

Faster onboarding iteration while no real funds are at stake; the acknowledgement checkbox still
forces the user to reveal and confirm they stored the phrase.

**Risk / reversal**

- A user can acknowledge the phrase without actually writing it down; there is no proof of backup
  at creation.
- Before mainnet, reconsider restoring mandatory backup verification (or an equivalent proof such
  as re-entering random words) at creation. Tracked in `docs/UNVERIFIED.md` #22.

**Tests:** component and Playwright create flows assert the 2-step flow ("Step 1 of 2" / "Step 2
of 2"), and Settings → Test your backup is covered in both.

---

## Decision: TON provider API keys are server-side only

**Status:** Accepted (2026-11-22).

- `services/api/src/config.ts` reads `TON_DATA_PROVIDER` (`toncenter` | `tonapi`),
  `TON_NETWORK` (`testnet` default | `mainnet`), `TONCENTER_TESTNET_API_KEY` and
  `TONCENTER_API_KEY` (sent as `X-API-Key` for the matching network), and `TONAPI_API_KEY`
  (sent as `Authorization: Bearer …`). Empty/whitespace values count as "not configured" and the
  public endpoints are used with lower rate limits. Testnet uses
  `https://testnet.toncenter.com`; mainnet is gated behind an explicit `TON_NETWORK=mainnet` and
  the owner's approval.
- Errors are generic (`INVALID_SERVER_ENV`) and never echo a key; the key is only ever placed in
  the outbound provider header, never in a URL or log.
- Local values go in `services/api/.env.local` (gitignored); deployed values go in the Vercel
  project's Environment Variables for the API service.
- The Mini App must call our API, not a key-bearing provider endpoint. **No key may appear in
  `apps/miniapp`, in any `VITE_*` variable, in `docs/`, in tests or in chat.** Public provider
  endpoints without a key are acceptable for early development.

Variable names and local usage are documented in `services/api/README.md`; no `.env.example` is committed (`.gitignore` blocks `.env*`). Tests: `services/api/src/config.test.ts`.

**Not done yet:** the API service is not deployed as a serverless function and there is no proxy
route that consumes these keys; that lands with the P2 TON read path.

---

## Decision: one canonical testnet address per wallet (fix for the live address mismatch)

**Root cause (found in Telegram testing):** Home displayed `info.ton.addressTestnetNonBounceable`
(a V5R1 StateInit built with `networkGlobalId = -3`, address `0QC5Zf…`) but queried the API with
`info.ton.addressRaw`, which is the **mainnet** StateInit hash (`networkGlobalId = -239`). The two
addresses are different accounts (`0:b965…` vs `0:2200…`), so the portfolio belonged to a wallet
the UI never showed.

**Fix:** in testnet mode the Home screen now uses the **0Q user-friendly testnet address as the
single canonical value** for the hero pill, copy button, Receive sheet and QR code, and for
`/api/ton/portfolio` and `/api/ton/activity`. The API validates and normalizes it back to the same
testnet raw hash before calling providers. A component/E2E test asserts the queried address string
and decoded 256-bit hash equal the displayed address.

**V5R1 convention (must match P2b signing/deployment):**
`TON_NETWORK_GLOBAL_ID = { testnet: -3, mainnet: -239 }`, exported from `@onezerowallet/chain-ton`.
The wallet id (and therefore the StateInit hash/address) XORs this id, so a wallet's testnet and
mainnet addresses are different accounts even with the same public key. Signing/deploying must use
the same network id as the address that was derived and displayed.

**Bounced refunds:** messages with TON Center `bounced: true`, an outbound body opcode
`0xffffffff`, or TonAPI `bounced` are marked `isBounce` on `TonActivityItem` and shown with a
**Bounced** badge / "Bounced refund" status instead of looking like a user send. They remain in the
list (they are real chain events) but are clearly labelled.

**Hero formatting:** the hero secondary pill truncates to 4 decimals (`formatDecimalShort`), while
asset rows and the transaction detail keep full BigInt precision.

---

## Decision: self-hosted fonts and CSS-variable theming (P2c)

**Fonts.** Plus Jakarta Sans and JetBrains Mono ship as `@fontsource-variable/*` packages
(OFL-1.1) and are imported from `main.tsx`. Vite bundles the `.woff2` files into `dist/assets`.
`build.assetsInlineLimit` is `0` so no font is emitted as a `data:` URI: the production CSP keeps
`font-src 'self'` and the app makes zero requests to Google Fonts or any CDN. An E2E test asserts
all network requests share the app origin and that `woff2` responses are same-origin.

**Theme.** Every colour is a semantic custom property on `:root` (Mint Light, the default) and
`[data-theme='dark']` (Forest & Citron). `PreferencesProvider` sets `data-theme` on `<html>`,
persists the choice in `localStorage` under `ozw.theme`, and mirrors the palette into the Telegram
chrome (`setBackgroundColor` and, in light mode, `setHeaderColor`). No component hardcodes a hex
value. `tabular-nums` is applied to every monetary surface so live balances and masking never
jitter.

**Navigation.** Settings remains a bottom-nav tab, not a modal, but secret-touching sub-flows
(reveal phrase, test backup) stay in the App-level state machine so backgrounding can still wipe
the phrase holder and return to safety. The wallet shell owns only public chain data and routing.

**Shells.** Trade, Earn, Market, Assistant and the purchase rows on Deposit are labelled UI
shells: they render the designed layout with disabled or toast-only CTAs and never build, sign or
broadcast a payload. Live actions remain Deposit (address/QR), Send (P2b), Coin Detail and
Transaction Detail.

---

## Decision: Telegram fullscreen with a browser fallback and combined safe areas (P2e)

**Detection.** The control is shown only when `requestFullscreen` **and** `exitFullscreen` exist
and `isVersionAtLeast('8.0')` is not false. Outside Telegram it falls back to the standard
Fullscreen API, but only when `document.fullscreenEnabled` is true and both
`documentElement.requestFullscreen` and `document.exitFullscreen` exist. Otherwise the button is
not rendered at all (no dead control).

**State.** `isFullscreen` starts from `tg.isFullscreen` (or `document.fullscreenElement`) and
follows the `fullscreenChanged` event. Toggle calls are wrapped in `try/catch`, and rejected
promises are caught; `fullscreenFailed` and any thrown/rejected error surface the app-owned toast
`"Fullscreen isn't available on this device"`. Every listener is removed with `offEvent` on
unmount.

**Safe areas.** `safeAreaInset` and `contentSafeAreaInset` are read on mount and on
`safeAreaChanged` / `contentSafeAreaChanged`. Their top/bottom values are summed into
`--app-safe-top` = `max(env(safe-area-inset-top), safe + content)px` (and the bottom equivalent)
on `<html>`; `PhoneFrame` consumes `--app-safe-top`, so fullscreen shifts the Wallet top bar below
the device notch and Telegram's floating Close/menu controls. Vars are reset on unmount so they
cannot leak across sessions/screens.

**Layout.** The utility cluster is now privacy eye, fullscreen, theme, QR with `6px` gaps. The
left wallet pill is `flex-1 min-w-0` with a truncating label, keeping the bar single-line down to
360px.
