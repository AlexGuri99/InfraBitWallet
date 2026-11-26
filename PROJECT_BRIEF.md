# InfraBitWallet: Project Brief

(Working name. Keep it in one config constant.)

## 1. What we're building

A **self-custodial, multi-chain crypto wallet delivered as a Telegram Mini App**. The user holds the keys. No backend of ours can ever access keys or seed phrases, or sign on a user's behalf.

Features (v1): **receive, send, swap (convert), stake**.
Chains (v1): **TON, TRON, Ethereum (built as a generic EVM adapter)**.

## 2. Legal constraint (non-negotiable)

This is _functionally inspired_ by MyTonWallet (github.com/mytonwallet-org/mytonwallet), whose "My Wallet Source-Available License" forbids copying, modifying, deploying, or deriving from its code.

- **Clean-room only.** Do NOT open that repo to copy, paraphrase, port, or translate any code, assets, text, icons or branding. Build from official public docs and permissively licensed libraries (MIT / Apache-2.0 / BSD).
- Flag any copyleft or restrictive dependency BEFORE adding it. Maintain `THIRD_PARTY_LICENSES.md`.

## 3. Chains and assets

Everything sits behind a `ChainAdapter` interface (`deriveAccount`, `getBalances`, `buildTransfer`, `estimateFee`, `signAndSend`, `getHistory`, `buildSwap`, `buildStake`, `validateAddress`). Build order: **TON, then TRON, then Ethereum.**

| Chain                      | Native coin                                                                                              | Stablecoins in v1           | Notes                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **TON**                    | **GRAM** (renamed from Toncoin/TON on 2026-06-15; ticker TON to GRAM; no migration, addresses unchanged) | USDT (native Tether jetton) | Wallet contract V5R1. USDC on TON is bridged only: hide it or label it clearly as bridged.                                            |
| **TRON**                   | TRX                                                                                                      | USDT (TRC-20)               | Handle energy/bandwidth explicitly. Circle ended native USDC on TRON: don't offer it.                                                 |
| **Ethereum** (EVM adapter) | ETH                                                                                                      | USDT and USDC (ERC-20)      | EIP-1559 fees, EIP-55 checksum addresses, strict chainId checks. Design so Base, BNB Chain and Arbitrum can be added by config later. |

Rules:

- Coin metadata is data-driven. Never hardcode "TON" as the coin name. Identify the native coin by protocol, not by jetton name, and warn on fake "GRAM" jettons.
- Never hardcode contract addresses, program IDs, opcodes or router addresses from memory. Fetch them from the provider's official docs, cite the source in a comment, and keep an allowlist.

## 4. Features (v1)

1. **Create / import.** One BIP-39 24-word phrase derives all three chains. Verify current derivation paths from official docs and document them (expected: TON m/44'/607'/0', TRON m/44'/195'/0'/0/0, Ethereum m/44'/60'/0'/0/0). Also support importing a legacy TON-native 24-word phrase as a TON-only account. A forced backup-verification step is mandatory.
2. **Receive.** Address, QR, copy, share. Explain chain specifics in plain language (TON bounceable vs non-bounceable, "send only USDT on TRON", EVM network warnings).
3. **Send.** Native coin and tokens. Address validation, memo where supported, fee estimate, and a confirmation screen with recipient, amount, fee and total. Warn on first-time recipients and wrong-network risk.
4. **Swap (same-chain only).**
   - TON (v1): STON.fi (direct DEX v2 SDK, referralValue in bps).
   - Ethereum (v1): an aggregator that supports an integrator fee (e.g. 0x Swap API).
   - TRON: out of scope for v1. See section 5 for rationale.
   - Show quote, price impact, minimum received, slippage (default 1%, warn above 5%), route, and an itemized fee breakdown.
   - ERC-20 approvals: **never unlimited by default**. Approve the exact amount (or use a verified Permit2 flow). Show the approval as its own clear step.
5. **Stake (v1: GRAM on TON only).** One liquid-staking provider (e.g. Tonstakers), chosen after reading current docs and explained. Show APY with its source, balance, rewards, unstake delay and risks. Explain "liquid staking vs pool staking" in plain language in-app. TRX and ETH staking are v2.
6. **Portfolio & history.** Fiat-valued balances with a cited price source, and a unified transaction history.

Out of scope for v1: fiat on/off-ramp, NFTs, dApp browser / TON Connect / WalletConnect, hardware wallets, AI agent, gasless transfers, cross-chain bridging, TRX/ETH staking.

## 5. Monetization (transparent, capped)

- **Swap fee: 0.35% (35 bps) on all swaps**, via each provider's native referral or integrator-fee mechanism:
  - TON (v1): STON.fi direct DEX v2 SDK with `referralValue` in basis points (`referralValue: 35` = 0.35%). Note: STON.fi OmniSton v1beta8 uses pips (`integrator_fee_pips: 3500` = 0.35%) — do NOT mix bps and pips. The swap-payload build must assert the encoded fee exactly equals 0.35% of the amount.
  - EVM (v1): 0x Swap API integrator fee (`swapFeeBps: 35`).
  - TRON: out of scope for v1 — needs a provider with a verified atomic integrator-fee mechanism before enabling swaps.
- **Staking fee: none in v1.** Implement a `StakingFeePolicy` (`none` | `provider_revenue_share` | `explicit_fee`) with the default `none`, so we can change it later without refactoring.
- Rules:
  - Every fee is shown as a line item in the confirmation screen BEFORE signing.
  - The swap fee is hard-capped at 1% in client code, so a compromised config server can't raise it.
    - Required tests: (a) build a real swap payload and assert the encoded fee equals exactly 0.35% of the amount; (b) assert the 1% client-side cap rejects anything larger, including a mistaken pips value.
  - Fee-recipient addresses live in reviewed, signed-off config, not fetched blindly at runtime.
  - The treasury key is never on the server, in the repo, or in any env var. Treasury = one fee address per chain, controlled by a hardware wallet (a multisig is planned later). You write only a `docs/TREASURY.md` explaining how to set it up and how to claim and withdraw accrued fees (STON.fi referral fees accrue in vault contracts), plus an admin script that builds, but never signs, withdrawal transactions.
  - Document everything in `docs/FEES.md`.

## 6. Security requirements (highest priority)

**Keys and unlock**

- Mnemonic and keys are generated and used ONLY on the client. They are never transmitted, logged, or sent to analytics or crash reporters.
- Vault: a random 256-bit vault key encrypts the seed (AES-256-GCM via WebCrypto). The vault key is wrapped by a passcode-derived key (Argon2id; fall back to scrypt/PBKDF2 with high cost if WASM isn't available). Optionally, it is also wrapped by a secret released after Telegram `BiometricManager` authentication (Face ID / fingerprint). Biometrics never replace the passcode or the 24 words. The passcode is always the fallback, since Desktop/Web clients may lack biometrics.
- Evaluate Telegram `SecureStorage` (backed by Keychain/Keystore, 10 items per bot per user) for wrapped key material, and IndexedDB or `DeviceStorage` for the ciphertext vault. **Do not assume any Bot API version is available** — feature-detect with `isVersionAtLeast` and object-existence checks. **Never** use `CloudStorage` for secrets. IndexedDB may store only passcode-wrapped ciphertext, never a plain vault key.
- Local data may be cleared by Telegram or the OS. Design for restore-from-24-words and test it.
- Auto-lock on inactivity and on backgrounding. Best-effort memory wiping (`Uint8Array`, zero-fill, no secrets in global state or the DOM). Exponential backoff on passcode attempts, with an optional wipe after N failures.
- Seed screens: warn against screenshots, use Telegram protective controls where available, and never auto-copy the phrase to the clipboard.

**Transactions**

- Human-readable preview built from the **actual payload being signed**, not UI state.
- Address validation and lookalike / clipboard-swap warnings (re-show first and last characters).
- Simulate before signing wherever the chain allows (TON emulation, `eth_call` / gas estimation, TRON constant-call) and surface warnings.
- Verified-token registry. Warn on unverified or newly created tokens, honeypot behavior, and fake native-coin lookalikes.
- For swaps and stakes: verify that the target contracts and calldata match the provider allowlist. **Fail closed.**

**App and hosting**

- Strict CSP (no `unsafe-inline` / `unsafe-eval`), no third-party scripts, SRI for any external asset, pinned and locked dependencies (pnpm, install scripts disabled unless explicitly allowlisted), Dependabot/Renovate, `npm audit` and license scan in CI, and a published build hash.
- The host is part of the attack surface (whoever can alter the deployed JS can steal seeds). Require hardware-key 2FA on GitHub and the host, a protected main branch with required review and signed commits, immutable deployments, manual promotion to production, and deploy alerts. Provide a kill switch (an emergency "stop signing" flag plus a maintenance banner) and an incident-response runbook.
- Anti-phishing: the app works only from the official bot and domain (in config). Sanitize all remote data (token names, memos, URLs). Never render remote HTML.
- Produce `docs/THREAT_MODEL.md` (STRIDE-style): XSS, supply chain, compromised host, malicious RPC/API responses, Telegram account takeover, device theft, clipboard hijack, fake-token scams, phishing mini-apps.

## 7. Infrastructure

- Frontend plus a thin, stateless, **keyless** API on **Vercel** (production needs a paid plan, as the free Hobby tier is non-commercial). Keep everything portable to Cloudflare Pages/Workers. No Railway for now — our API is stateless and fits Vercel Edge/Functions.
- The API only: validates Telegram `initData`, proxies provider API keys, rate-limits, and caches. It never receives keys or mnemonics.
- Providers are pluggable with fallbacks, and all responses are schema-validated (zod).
- Environments: local, testnet (TON testnet, TRON Nile/Shasta, Ethereum Sepolia), staging, production. Mainnet is gated behind an explicit flag and `docs/LAUNCH_CHECKLIST.md`.

## 8. Compliance hooks (jurisdiction undecided)

Feature flags per chain, feature and region. A geo/region-restriction hook. A sanctions-screening interface (no vendor chosen). A ToS and privacy-policy scaffold. Risk disclosures before the first swap and stake. Never claim regulatory approval, and flag items needing legal review in `docs/LEGAL_TODO.md`.

## 9. Engineering standards

- TypeScript (strict), React, Vite, Zustand or Redux Toolkit, Tailwind, `@telegram-apps/sdk`.
- Crypto: only established libraries (`@ton/crypto`, `@ton/ton`, `@scure/bip39`, `@scure/bip32`, `@noble/*`, `viem`, the official TRON SDK). No custom cryptography.
- Monorepo with **pnpm** (dependency install scripts disabled unless explicitly allowlisted): `/apps/miniapp`, `/packages/core`, `/packages/crypto-vault`, `/packages/chain-ton`, `/packages/chain-tron`, `/packages/chain-evm`, `/packages/swap-*`, `/packages/staking-*`, `/services/api`, `/docs`.
- Amounts are `bigint` in the smallest unit, formatted only at the UI boundary, with per-token decimals. Never floats.
- Tests: Vitest unit tests (vault, derivation test vectors, address handling, amount/fee/slippage math, fee-cap enforcement), fast-check property tests, testnet integration tests per chain, and Playwright E2E with a mocked Telegram environment.
- CI: lint, type-check, tests, audit, license scan, build hash. Analytics are opt-in and privacy-preserving only.
- UX: mobile-first, respects Telegram theme and safe areas, onboarding in 5 screens or fewer, clear loading/offline/error states, WCAG AA, i18n scaffolding (English first).

## 10. Operating rules for Claude Code

- Work in small, reviewable steps. One branch per phase, conventional commits, and open a PR summary at the end of each phase.
- Maintain `docs/PROGRESS.md` (what's done, what's next, open questions) and `docs/DECISIONS.md` (short ADRs) so any new session can resume. Also create a concise `CLAUDE.md` from sections 2, 3, 5, 6 and 9 of this brief.
- **Never** ask me for, accept, or store real seed phrases, private keys or API secrets in chat. Use test mnemonics on testnets only. Never commit secrets (only `.env.example`).
- **Stop and ask me** before: adding a dependency with an unclear or restrictive license, deploying to production, creating or using any treasury address, enabling mainnet, spending any real funds, changing a fee value, or making any non-reversible action.
- Use web search and fetch to read current official docs whenever you're unsure about an API, SDK method, address, opcode, derivation path or fee mechanism. Cite the source. Never guess.
- Before declaring a phase done: run lint, type-check and tests, show the results, and state honestly what is untested or assumed.
- Never claim the wallet is "secure" or "audited". Recommend an independent audit and a bug bounty before mainnet with real funds.

## 11. Phases

- **P0:** Scaffold (pnpm), CI (lint, type-check, test, audit, license scan, build hash), Telegram SDK integration, theming, Vercel preview, docs skeleton.
- **P1:** Vault, unlock (passcode + biometrics), multi-chain derivation, backup and restore.
- **P2:** TON: receive, balances, history, prices, send (GRAM, USDT).
- **P3:** TON swap (0.35% fee) and GRAM staking.
- **P4:** TRON: receive, send (TRX, USDT), energy handling. TRON swap is deferred — needs a verified atomic integrator-fee mechanism.
- **P5:** Ethereum/EVM: receive, send (ETH, USDT, USDC), swap with exact-amount approvals.
- **P6:** Hardening, accessibility, i18n, docs, treasury runbook, mainnet launch checklist.

## 13. Key differentiators (why this wallet exists)

What distinguishes InfraBitWallet from other self-custodial wallets:

| Differentiator                                                                                  | Where it's built                 | Phase |
| ----------------------------------------------------------------------------------------------- | -------------------------------- | ----- |
| **Clean-room, MyTonWallet-inspired design** — same UX patterns, zero copied code                | All                              | P0+   |
| **Multi-chain from one seed** — TON, TRON, EVM from one BIP-39 24-word phrase                   | packages/crypto-vault            | P1    |
| **Passcode + biometrics + device-secret combined** — no single point of failure for unlock      | packages/crypto-vault            | P1    |
| **Transparent, capped fees** — every fee line-item, 1% hard cap, never unlimited approvals      | packages/core, all swap packages | P2+   |
| **Keyless API** — our server can never access keys, sign transactions, or censor sends          | services/api                     | P0    |
| **Telegram Mini App native** — no install, no browser extension, works in any Telegram client   | apps/miniapp                     | P0    |
| **Data-driven assets** — coin metadata from config, not hardcoded, with verified-token registry | packages/core                    | P2    |
| **Fail-closed contract allowlist** — swaps/stakes only to verified contracts                    | All swap/stake packages          | P3+   |
| **Portable infrastructure** — Vercel today, Cloudflare Pages/Workers tomorrow                   | services/api, deploy config      | P0    |

## 14. Dependencies license audit

## 12. Definition of done (v1)

- On testnets and in a real Telegram bot, a new user can create a wallet, verify the backup, unlock with passcode or biometrics, receive and send native coins and stablecoins, swap, and stake GRAM, with every fee shown before signing.
- No secret appears in network traffic, logs, unencrypted storage or analytics, verified by a test or a documented manual check.
- Fee caps are enforced client-side and tested. CI is green, docs are complete, and the license inventory is clean.
