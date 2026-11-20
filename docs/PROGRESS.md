# OneZeroWallet — Progress

Project start: 2026-11-20

## Phase Plan

### P0: Scaffold — CI — Telegram SDK — Theming — Vercel — Docs

**Status:** ✅ Complete (2026-11-20)

| Task                                                                    | Status                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Create pnpm monorepo structure (workspaces)                             | ✅ Done                                                                                         |
| Initialize `apps/miniapp` (React + Vite + Tailwind + TypeScript strict) | ✅ Done                                                                                         |
| Initialize all packages with tsconfig + vitest                          | ✅ Done                                                                                         |
| Verify `@telegram-apps/sdk` identity and license                        | ✅ Done — same project as `@tma.js/sdk`, renamed. MIT license. Source: npm registry (pnpm view) |
| Install and configure Telegram SDK                                      | ✅ Done                                                                                         |
| Create mock Telegram environment for local dev                          | ✅ Done                                                                                         |
| Set up Telegram theming + safe areas                                    | ✅ Done                                                                                         |
| Set up CI pipeline                                                      | ✅ Done                                                                                         |
| Set up ESLint + Prettier                                                | ✅ Done                                                                                         |
| Set up Vitest + Playwright skeleton                                     | ✅ Done                                                                                         |
| Vercel preview config with strict CSP                                   | ✅ Done                                                                                         |
| Create docs skeleton                                                    | ✅ Done                                                                                         |
| Create THIRD_PARTY_LICENSES.md                                          | ✅ Done                                                                                         |
| Create UNVERIFIED.md                                                    | ✅ Done                                                                                         |
| Create LEGAL_TODO.md                                                    | ✅ Done                                                                                         |
| Create SECURITY_HEADERS.md with CSP rationale                           | ✅ Done                                                                                         |
| Pin Node to LTS v22 (.nvmrc, engines, CI)                               | ✅ Done                                                                                         |
| Pin GitHub Actions to full commit SHAs                                  | ✅ Done                                                                                         |
| Add Renovate config                                                     | ✅ Done                                                                                         |
| Fix pnpm install scripts (allow esbuild)                                | ✅ Done                                                                                         |
| Fix CSP for Telegram iframe embedding                                   | ✅ Done                                                                                         |
| Add CSP security test                                                   | ✅ Done                                                                                         |
| Add section 13 (differentiators) to PROJECT_BRIEF.md                    | ✅ Done                                                                                         |
| Verify all CI checks pass (lint, type-check, test, format)              | ✅ Done                                                                                         |

---

### P1a: Vault and Derivation (Library Only)

**Status:** ✅ Complete (2026-11-20)

All P1a tasks are now complete. The vault module (`packages/crypto-vault`) implements:

- BIP-39 mnemonic generation, validation, normalization (@scure/bip39)
- Multi-chain derivation: TON (SLIP-10/Ed25519), TRON (BIP-32/secp256k1), EVM (BIP-32/secp256k1)
- AES-256-GCM seed encryption (WebCrypto)
- Passcode wrap (Argon2id via hash-wasm)
- Device-secret wrap (HKDF-SHA256 combined with passcode key)
- Biometric wrap (AES-256-GCM with biometric token)
- StorageAdapter interface (SecureStorage, IndexedDB, InMemory)
- Session handling (narrow sign API, zero-fill, auto-lock)
- Exponential backoff + optional wipe
- No secret leakage tests (console stubbing, error messages)
- Unit tests: BIP-39 vectors, address derivation vectors, vault round trips
- Property tests (fast-check) for mnemonic normalization + vault round trips (5-20 runs)
- Bundle scan for secrets in unit tests
- docs/VAULT_DESIGN.md, docs/SECURITY_HEADERS.md

---

### P1c: Vault UI support, browser proof, CSP hardening

**Status:** ✅ In progress (Part 1 complete — 2026-11-20)

| Task                                                                           | Status  |
| ------------------------------------------------------------------------------ | ------- |
| Fix verify/CI scripts (--if-present on build, no ; true)                       | ✅ Done |
| Valibot override to >=1.4.2 (fixes GHSA-vqpr-j7v3-hqw9, GHSA-5qjj-4xww-7phc)   | ✅ Done |
| Node engine requirements set to >=22.22.2 (matching jsdom)                     | ✅ Done |
| .nvmrc, CI, .gitattributes for cross-platform line endings                     | ✅ Done |
| Add `wasm-unsafe-eval` to CSP for hash-wasm WebAssembly (Argon2id)             | ✅ Done |
| Document CSP rationale in SECURITY_HEADERS.md                                  | ✅ Done |
| Vault format v2: store encrypted mnemonic for phrase re-display                | ✅ Done |
| V1 → v2 migration support + tests                                              | ✅ Done |
| Researched Telegram BiometricManager docs (authenticate always prompts)        | ✅ Done |
| Corrected biometric model in VAULT_DESIGN.md (dual-factor, accurate storage)   | ✅ Done |
| Added "What we do NOT protect against" to VAULT_DESIGN.md                      | ✅ Done |
| Playwright E2E vault browser test (Chrome, prod CSP, Argon2id)                 | ✅ Done |
| Bundle secret scan test (dist JS/HTML for mnemonics, keys, tokens)             | ✅ Done |
| Updated UNVERIFIED.md with 3 new items (frame-ancestors, OWASP, SecureStorage) | ✅ Done |

**Remaining for P1c Part 2:**

| Task                                                  | Status     |
| ----------------------------------------------------- | ---------- |
| Real address test vectors for all chains              | Pending    |
| TON interoperability tests (testnet)                  | Pending    |
| Verify GRAM rename impact (fetch TON Center response) | UNVERIFIED |
| Test with WebKit in Playwright (CI matrix expansion)  | Pending    |

---

### P1b: UI — Onboarding, Unlock, Backup Screens

**Status:** Not started

---

### P2: TON — Receive, Balances, History, Prices, Send

**Status:** Not started

| Task                                                     | Notes                          |
| -------------------------------------------------------- | ------------------------------ |
| TON ChainAdapter implementation                          |                                |
| TON Center API data provider                             |                                |
| Verify GRAM rename impact on TON Center/TonAPI responses | UNVERIFIED — see UNVERIFIED.md |
| GRAM + USDT jetton balance display                       |                                |
| TON address validation (bounceable/non-bounceable)       |                                |
| TON V5R1 wallet deployment                               |                                |
| Build + estimate GRAM transfer                           |                                |
| Build + estimate USDT jetton transfer                    |                                |
| Send confirmation screen                                 |                                |
| Fiat price integration                                   |                                |
| Portfolio/history UI                                     |                                |

---

### P3: TON Swap + GRAM Staking

**Status:** Not started

| Task                                                                                                                                                                                                                                | Notes          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| STON.fi swap provider integration (direct DEX v2 SDK)                                                                                                                                                                               |                |
| Swap quote UI (price, impact, route)                                                                                                                                                                                                |                |
| **0.35% fee enforcement via referralValue: 35 (bps)**                                                                                                                                                                               |                |
| **Required fee tests:** (a) Build real swap payload, assert encoded fee = 0.35% of amount. (b) Assert 1% client-side cap rejects larger values, including a mistaken pips value (3500 pips passed as bps must be clamped/rejected). | Planned for P3 |
| Slippage settings (default 1%, warn >5%)                                                                                                                                                                                            |                |
| Tonstakers staking integration                                                                                                                                                                                                      |                |
| Staking dashboard (APY, balance, rewards)                                                                                                                                                                                           |                |
| Stake/unstake flow                                                                                                                                                                                                                  |                |
| Liquid staking vs pool staking explainer                                                                                                                                                                                            |                |

---

### P4: TRON — Receive, Send, Energy Handling

**Status:** Not started

| Task                                                                                                  | Notes                          |
| ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| TRON ChainAdapter implementation                                                                      |                                |
| TronGrid data provider                                                                                |                                |
| Verify Circle USDC on TRON status                                                                     | UNVERIFIED — see UNVERIFIED.md |
| TRX balance + TRC-20 USDT                                                                             |                                |
| TRON address validation + resource display (energy/bandwidth)                                         |                                |
| Energy/bandwidth estimation + display                                                                 |                                |
| Build + estimate TRX transfer                                                                         |                                |
| Build + estimate USDT TRC-20 transfer                                                                 |                                |
| **TRON swap is DEFERRED from v1** — no provider with a verified atomic integrator-fee mechanism found |                                |

---

### P5: Ethereum/EVM — Receive, Send, Swap

**Status:** Not started

| Task                                                         | Notes                          |
| ------------------------------------------------------------ | ------------------------------ |
| EVM ChainAdapter implementation                              |                                |
| Alchemy (Infura fallback) data provider                      |                                |
| Check: does 0x add its own fee on top of our integrator fee? | UNVERIFIED — see UNVERIFIED.md |
| Review 0x commercial terms before production                 | See LEGAL_TODO.md              |
| ETH + ERC-20 USDT/USDC                                       |                                |
| EIP-55 checksum validation                                   |                                |
| EIP-1559 fee estimation                                      |                                |
| Build + estimate ETH transfer                                |                                |
| Build + estimate ERC-20 transfer                             |                                |
| 0x Swap API integration                                      |                                |
| Exact-amount ERC-20 approvals (or Permit2)                   |                                |
| Approval step in swap flow                                   |                                |

---

### P6: Hardening — Accessibility — i18n — Launch

**Status:** Not started

| Task                                     | Notes |
| ---------------------------------------- | ----- |
| WCAG AA audit and fixes                  |       |
| i18n scaffold + English content          |       |
| Playwright E2E tests                     |       |
| Testnet integration tests (all chains)   |       |
| Security review                          |       |
| LAUNCH_CHECKLIST.md                      |       |
| LEGAL_TODO.md — review and close items   |       |
| Treasury admin scripts                   |       |
| Mainnet gate + launch checklist          |       |
| Incident-response runbook                |       |
| Kill switch + maintenance banner         |       |
| Recommend independent audit + bug bounty |       |

---

## Open Questions

1. TON derivation path: is `m/44'/607'/0'` (hardened only) still the standard? Some wallets use different patterns. (SLIP-44 confirms 607.)
2. Does 0x add its own protocol/network fee on top of our integrator fee? Check before P5.
3. SunSwap V4 docs — need to determine if there's an atomic swap integrator fee parameter for future TRON swap inclusion.
4. `@telegram-apps/sdk` vs `@tma.js/sdk` — **ANSWERED:** Same project, renamed. `@telegram-apps/sdk` is current (v3.11.8), MIT license. `@tma.js/sdk` is legacy (v3.3.0). Source: npm registry metadata (both share `telegram-mini-apps-dev` org, both MIT).
