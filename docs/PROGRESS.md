# OneZeroWallet — Progress

Project start: 2026-11-20

## Phase Plan

### P0: Scaffold — CI — Telegram SDK — Theming — Vercel — Docs
**Status:** ✅ Complete (2026-11-20)

| Task | Status |
|---|---|
| Create pnpm monorepo structure (workspaces) | ✅ Done |
| Initialize `apps/miniapp` (React + Vite + Tailwind + TypeScript strict) | ✅ Done |
| Initialize all packages with tsconfig + vitest | ✅ Done |
| Verify `@telegram-apps/sdk` identity and license | ✅ Done — same project as `@tma.js/sdk`, renamed. MIT license. Source: npm registry (pnpm view) |
| Install and configure Telegram SDK | ✅ Done |
| Create mock Telegram environment for local dev | ✅ Done |
| Set up Telegram theming + safe areas | ✅ Done |
| Set up CI pipeline | ✅ Done |
| Set up ESLint + Prettier | ✅ Done |
| Set up Vitest + Playwright skeleton | ✅ Done |
| Vercel preview config with strict CSP | ✅ Done |
| Create docs skeleton | ✅ Done |
| Create THIRD_PARTY_LICENSES.md | ✅ Done |
| Create UNVERIFIED.md | ✅ Done |
| Create LEGAL_TODO.md | ✅ Done |
| Create SECURITY_HEADERS.md with CSP rationale | ✅ Done |
| Pin Node to LTS v22 (.nvmrc, engines, CI) | ✅ Done |
| Pin GitHub Actions to full commit SHAs | ✅ Done |
| Add Renovate config | ✅ Done |
| Fix pnpm install scripts (allow esbuild) | ✅ Done |
| Fix CSP for Telegram iframe embedding | ✅ Done |
| Add CSP security test | ✅ Done |
| Add section 13 (differentiators) to PROJECT_BRIEF.md | ✅ Done |
| Verify all CI checks pass (lint, type-check, test, format) | ✅ Done |

---

### P1a: Vault and Derivation (Library Only)
**Status:** In progress

| Task | Status |
|---|---|
| Implement BIP-39 24-word mnemonic generation + validation | Pending |
| Implement TON derivation (m/44'/607'/0') with V5R1 address format | Pending |
| Implement TRON derivation (m/44'/195'/0'/0/0) | Pending |
| Implement EVM derivation (m/44'/60'/0'/0/0) | Pending |
| Implement legacy TON-native 24-word phrase import | Pending |
| Implement vault: AES-256-GCM seed encryption (WebCrypto) | Pending |
| Implement passcode wrap (Argon2id via hash-wasm) | Pending |
| Implement device-secret wrap (SecureStorage combined with passcode) | Pending |
| Implement biometric wrap (optional, never replaces passcode) | Pending |
| Define StorageAdapter interface (SecureStorage, DeviceStorage, IndexedDB, in-memory) | Pending |
| Implement session handling (narrow sign API, zero-fill, auto-lock) | Pending |
| Implement exponential backoff + optional wipe | Pending |
| No secret leakage (tests for console stubbing, error messages) | Pending |
| Unit tests: BIP-39 vectors, address derivation vectors, vault round trips | Pending |
| Property tests (fast-check) for mnemonic normalization + vault round trips | Pending |
| Test: bundle scan for secrets | Pending |
| Create docs/VAULT_DESIGN.md | Pending |

---

### P1b: UI — Onboarding, Unlock, Backup Screens
**Status:** Not started

---

### P2: TON — Receive, Balances, History, Prices, Send
**Status:** Not started

| Task | Notes |
|---|---|
| TON ChainAdapter implementation | |
| TON Center API data provider | |
| Verify GRAM rename impact on TON Center/TonAPI responses | UNVERIFIED — see UNVERIFIED.md |
| GRAM + USDT jetton balance display | |
| TON address validation (bounceable/non-bounceable) | |
| TON V5R1 wallet deployment | |
| Build + estimate GRAM transfer | |
| Build + estimate USDT jetton transfer | |
| Send confirmation screen | |
| Fiat price integration | |
| Portfolio/history UI | |

---

### P3: TON Swap + GRAM Staking
**Status:** Not started

| Task | Notes |
|---|---|
| STON.fi swap provider integration (direct DEX v2 SDK) | |
| Swap quote UI (price, impact, route) | |
| **0.35% fee enforcement via referralValue: 35 (bps)** | |
| **Required fee tests:** (a) Build real swap payload, assert encoded fee = 0.35% of amount. (b) Assert 1% client-side cap rejects larger values, including a mistaken pips value (3500 pips passed as bps must be clamped/rejected). | Planned for P3 |
| Slippage settings (default 1%, warn >5%) | |
| Tonstakers staking integration | |
| Staking dashboard (APY, balance, rewards) | |
| Stake/unstake flow | |
| Liquid staking vs pool staking explainer | |

---

### P4: TRON — Receive, Send, Energy Handling
**Status:** Not started

| Task | Notes |
|---|---|
| TRON ChainAdapter implementation | |
| TronGrid data provider | |
| Verify Circle USDC on TRON status | UNVERIFIED — see UNVERIFIED.md |
| TRX balance + TRC-20 USDT | |
| TRON address validation + resource display (energy/bandwidth) | |
| Energy/bandwidth estimation + display | |
| Build + estimate TRX transfer | |
| Build + estimate USDT TRC-20 transfer | |
| **TRON swap is DEFERRED from v1** — no provider with a verified atomic integrator-fee mechanism found | |

---

### P5: Ethereum/EVM — Receive, Send, Swap
**Status:** Not started

| Task | Notes |
|---|---|
| EVM ChainAdapter implementation | |
| Alchemy (Infura fallback) data provider | |
| Check: does 0x add its own fee on top of our integrator fee? | UNVERIFIED — see UNVERIFIED.md |
| Review 0x commercial terms before production | See LEGAL_TODO.md |
| ETH + ERC-20 USDT/USDC | |
| EIP-55 checksum validation | |
| EIP-1559 fee estimation | |
| Build + estimate ETH transfer | |
| Build + estimate ERC-20 transfer | |
| 0x Swap API integration | |
| Exact-amount ERC-20 approvals (or Permit2) | |
| Approval step in swap flow | |

---

### P6: Hardening — Accessibility — i18n — Launch
**Status:** Not started

| Task | Notes |
|---|---|
| WCAG AA audit and fixes | |
| i18n scaffold + English content | |
| Playwright E2E tests | |
| Testnet integration tests (all chains) | |
| Security review | |
| LAUNCH_CHECKLIST.md | |
| LEGAL_TODO.md — review and close items | |
| Treasury admin scripts | |
| Mainnet gate + launch checklist | |
| Incident-response runbook | |
| Kill switch + maintenance banner | |
| Recommend independent audit + bug bounty | |

---

## Open Questions

1. TON derivation path: is `m/44'/607'/0'` (hardened only) still the standard? Some wallets use different patterns. (SLIP-44 confirms 607.)
2. Does 0x add its own protocol/network fee on top of our integrator fee? Check before P5.
3. SunSwap V4 docs — need to determine if there's an atomic swap integrator fee parameter for future TRON swap inclusion.
4. `@telegram-apps/sdk` vs `@tma.js/sdk` — **ANSWERED:** Same project, renamed. `@telegram-apps/sdk` is current (v3.11.8), MIT license. `@tma.js/sdk` is legacy (v3.3.0). Source: npm registry metadata (both share `telegram-mini-apps-dev` org, both MIT).