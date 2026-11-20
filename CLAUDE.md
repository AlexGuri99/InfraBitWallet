# OneZeroWallet — Claude Code rules

> Generated from `PROJECT_BRIEF.md` v2. Do not override; update from brief when brief changes.

## 1. Legal constraint (non-negotiable)

- **Clean-room only.** Never open, copy from, or derive from MyTonWallet (github.com/mytonwallet-org/mytonwallet). Their license forbids copying, modifying, deploying, or deriving.
- Flag any copyleft or restrictive dependency BEFORE adding it. Maintain `THIRD_PARTY_LICENSES.md`.

## 2. Chains and assets

| Chain              | Native coin                                                | Stablecoins (v1)            | Notes                                                                        |
| ------------------ | ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| **TON**            | GRAM (renamed from TON on 2026-06-15; addresses unchanged) | USDT (native Tether jetton) | Wallet V5R1. USDC on TON = bridged only — hide or label clearly.             |
| **TRON**           | TRX                                                        | USDT (TRC-20)               | Handle energy/bandwidth explicitly. No USDC on TRON (Circle ended it).       |
| **Ethereum** (EVM) | ETH                                                        | USDT, USDC (ERC-20)         | EIP-1559, EIP-55, chainId checks. Base/BNB/Arbitrum addable by config later. |

Rules:

- Coin metadata is data-driven. Never hardcode "TON" as coin name. Identify native coin by protocol, warn on fake "GRAM" jettons.
- Never hardcode addresses/opcodes/routers from memory. Fetch from official docs, cite source, keep allowlist.

## 3. Fee rules

- Swap fee: **0.35% (35 bps)** via provider's integrator-fee mechanism.
  - TON: STON.fi direct DEX v2 SDK, `referralValue: 35` in bps. Note: OmniSton v1beta8 uses pips (`3500` = 0.35%) — never mix bps and pips.
  - EVM: 0x Swap API `swapFeeBps: 35`.
  - TRON: out of scope for v1 — needs a provider with a verified atomic integrator-fee mechanism.
- Staking fee: **none in v1** (`StakingFeePolicy = none` — enum: `none` | `provider_revenue_share` | `explicit_fee`).
- Every fee is a line item on confirmation screen before signing.
- Hard-cap at 1% in client code (config server can't exceed).
- Required tests: (a) build real swap payload, assert encoded fee = 0.35% of amount; (b) assert 1% cap rejects larger values (including mistaken pips).
- Fee-recipient addresses in reviewed signed-off config, never fetched blindly.
- Check whether 0x adds its own fee on top of ours — total fee shown to user must include everything.
- Document everything in `docs/FEES.md` and `docs/TREASURY.md`.

## 4. Security rules (highest priority)

- Keys generated and used ONLY client-side. Never transmitted, logged, or sent to analytics.
- Vault: AES-256-GCM via WebCrypto. Vault key wrapped by passcode-derived key (Argon2id → scrypt/PBKDF2 fallback). Optionally also wrapped by biometric secret.
- **Do not assume any Bot API version.** Feature-detect with `isVersionAtLeast` and object-existence checks.
- Biometrics never replace passcode or 24 words. Passcode is always the fallback (Desktop/Web may lack biometrics).
- Use Telegram `SecureStorage` (Keychain/Keystore, ≤10 items) for wrapped key material if available. Use IndexedDB/`DeviceStorage` for ciphertext vault — **IndexedDB stores only passcode-wrapped ciphertext, never a plain vault key**. Never use `CloudStorage` for secrets.
- Auto-lock on inactivity and background. Memory wiping via zero-fill `Uint8Array`. Exponential backoff on passcode attempts, optional wipe after N failures.
- Seed screens: warn screenshots, never auto-copy to clipboard.
- Human-readable preview from **actual payload being signed**, not UI state.
- Simulate before signing (TON emulation, `eth_call`, TRON constant-call).
- Verified-token registry. Warn on unverified/new/honeypot tokens.
- For swaps/stakes: verify target contracts and calldata against allowlist. **Fail closed.**
- Strict CSP (no `unsafe-inline`/`unsafe-eval`). No third-party scripts. SRI for external assets. Pinned deps via pnpm (install scripts disabled unless allowlisted). Dependabot/Renovate + `npm audit` + license scan in CI.
- Host: hardware-key 2FA on GitHub + host, protected main branch, signed commits, immutable deploys, manual prod promotion, deploy alerts, kill switch.
- Anti-phishing: official bot/domain only (in config). Sanitize all remote data. Never render remote HTML.
- Produce `docs/THREAT_MODEL.md`.

## 5. Engineering standards

- TypeScript (strict), React, Vite, Zustand, Tailwind, `@telegram-apps/sdk` (verify it's the same as `@tma.js/sdk` and its license before installing).
- Crypto: `@ton/crypto`, `@ton/ton`, `@scure/bip39`, `@scure/bip32`, `@noble/*`, `viem`, official TRON SDK only. No custom crypto.
- Monorepo with pnpm (install scripts disabled unless explicitly allowlisted): `/apps/miniapp`, `/packages/core`, `/packages/crypto-vault`, `/packages/chain-ton`, `/packages/chain-tron`, `/packages/chain-evm`, `/packages/swap-ton`, `/packages/swap-evm`, `/packages/staking-ton`, `/services/api`, `/docs`.
- Amounts: `bigint` in smallest unit, formatted at UI boundary only. Never floats.
- Tests: Vitest unit, fast-check property, testnet integration, Playwright E2E. Required fee tests: (a) swap payload fee = 0.35%; (b) 1% cap rejects larger.
- CI: lint → type-check → test → audit → license scan → build hash.
- UX: mobile-first, Telegram theme + safe areas, onboarding ≤5 screens, WCAG AA, i18n scaffold.

## 6. "Stop and ask" rules

Stop and ask me BEFORE:

- Adding a dependency with unclear or restrictive license
- Deploying to production
- Creating or using any treasury address
- Enabling mainnet
- Spending any real funds
- Changing a fee value
- Any non-reversible action

## 7. Operating rules

- One branch per phase, conventional commits, PR summary at end of each phase.
- Maintain `docs/PROGRESS.md` and `docs/DECISIONS.md`.
- Never ask for, accept, or store real seed phrases, private keys, or API secrets. Test mnemonics on testnets only. Never commit secrets (`.env.example` only).
- Use web search/fetch for current docs when unsure. Cite source. Never guess.
- Before declaring a phase done: run lint, type-check, tests. Show results. State what's untested.
- Never claim the wallet is "secure" or "audited". Recommend independent audit + bug bounty before mainnet.
