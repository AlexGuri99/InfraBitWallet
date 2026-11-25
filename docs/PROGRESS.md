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

### Stage A: Review fixes (2026-11-21)

Branch `stage-a-fixes`. A0–A5 were completed earlier in this branch; A6–A11 in this round.
(Older P1a/P1c bullets above overstated what was implemented — e.g. a working biometric wrap
and "dual-factor" model. `docs/VAULT_DESIGN.md` now matches the code.)

| ID  | Task                                                | Status | Evidence (file › test)                                                                                |
| --- | --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| A0  | E2E in a fresh clone; verify includes e2e + install | DONE   | `e2e-prepare.mjs`, `secret-scan.test.ts`, `playwright.config.ts`                                      |
| A1  | TON/TRON/EVM intermediate forms, no fake address    | DONE   | `derivation.ts`, `index.test.ts › A1:`                                                                |
| A2  | Session keeps keys in a closure                     | DONE   | `session.ts`, `session.test.ts`                                                                       |
| A3  | Remove seed export, allowlist public API            | DONE   | `index.ts`, `index.test.ts › A3:`                                                                     |
| A4  | Real AAD binding, KDF bounds, migration             | DONE   | `vault.ts`, `vault.test.ts › A4:`                                                                     |
| A5  | Real published vectors                              | DONE   | `vectors.test.ts`, `fixtures/`                                                                        |
| A6  | Biometrics (enable/unlock/disable)                  | DONE   | `vault.ts`, `biometric.test.ts`                                                                       |
| A7  | Passcode policy + measureKdf                        | DONE   | `vault.ts`, `policy.test.ts`                                                                          |
| A8  | Backoff rewrite, rate_limited, wipe, listeners      | DONE   | `backoff.ts`, `backoff.test.ts`, `session.ts`                                                         |
| A9  | Device secret, seal store, adapters, VaultManager   | DONE   | `device-secret.ts`, `seal-store.ts`, `indexeddb.ts`, `vault-manager.ts`, `apps/miniapp/src/adapters/` |
| A10 | Misc fixes (HKDF form, errors, logging, dead code)  | DONE   | `vault.ts` (v4), `mnemonic.ts`, `logging.test.ts`, `seal-store.test.ts`                               |
| A11 | Docs match code                                     | DONE   | `VAULT_DESIGN.md`, `THREAT_MODEL.md`, `DECISIONS.md`, `UNVERIFIED.md`                                 |

Open decisions: account-index convention (see DECISIONS.md) — recommendation pending owner
approval. Cadence: one commit per task.

---

### Stage B: Real addresses and TON interoperability (2026-11-21)

| ID  | Task                                                          | Status                   | Evidence                                                                  |
| --- | ------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| B1  | EVM EIP-55, TRON base58check, TON V5R1 addresses + validators | DONE                     | `address.ts`, `address.test.ts`, wired in `session.ts`                    |
| B1  | Receive UX rule (non-bounceable for uninitialized wallets)    | DONE                     | `docs/VAULT_DESIGN.md` §12                                                |
| B2  | TON interop research (Keeper/Ledger) + recommendation         | DONE — awaiting approval | `docs/DECISIONS.md` (Stage B decision)                                    |
| B2  | TON-native phrase import as a TON-only account; seal v5       | DONE                     | `account-type.ts`, `mnemonic.ts`, `derivation.ts`, `account-type.test.ts` |
| B3  | Live TON API native coin symbol                               | DONE                     | TonAPI returns `TON` (not GRAM) — recorded in UNVERIFIED.md               |
| B3  | WebKit in Playwright                                          | DONE locally             | `playwright.config.ts`; 16 e2e passed locally                             |
| B3  | @telegram-apps/sdk mock smoke test                            | DONE                     | `apps/miniapp/src/test/sdk-smoke.test.ts`                                 |

---

### Stage C: Onboarding, unlock and backup UI (2026-11-21)

| Area                                                                                                                                                                                                              | Status             | Evidence                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| Welcome + risk disclosure + anti-phishing notice                                                                                                                                                                  | DONE               | `ui/onboarding.tsx › WelcomeScreen`; `ui-onboarding.test.tsx`                                          |
| Create (BIP-39 / TON-native) with passcode policy                                                                                                                                                                 | DONE               | `PasscodeSetupScreen`, `App.createWallet`; policy test                                                 |
| Show recovery phrase (explicit tap, warnings, hide on background)                                                                                                                                                 | DONE               | `PhraseScreen`; E2E "phrase screen is empty until…"                                                    |
| Backup verification (3 random positions, retry)                                                                                                                                                                   | DONE               | `VerifyScreen`; component + E2E flows                                                                  |
| Import (phrase + passcode + account type)                                                                                                                                                                         | DONE               | `ImportScreen`; component + E2E "imports a wallet phrase"                                              |
| Unlock with backoff countdown and biometric button                                                                                                                                                                | DONE               | `ui/wallet.tsx › UnlockScreen`; `ui-wallet.test.tsx`, E2E                                              |
| Auto-lock: inactivity (vault) + Telegram deactivated (adapter)                                                                                                                                                    | DONE               | `App` polling + `installTelegramLifecycleHooks`                                                        |
| Settings: reveal (re-auth), change passcode, biometrics, auto-lock, wipe, test backup                                                                                                                             | DONE               | `SettingsScreen`; component + E2E reveal flow                                                          |
| No secrets in state/storage/DOM                                                                                                                                                                                   | DONE               | uncontrolled inputs + `secretHolder`; E2E IndexedDB dump test                                          |
| Component tests (Testing Library)                                                                                                                                                                                 | DONE               | 10 UI tests                                                                                            |
| Playwright flows (Chromium + WebKit)                                                                                                                                                                              | DONE               | 32 e2e total (16 per browser)                                                                          |
| Accessibility checks                                                                                                                                                                                              | DONE (without axe) | `a11y.spec.ts`; axe-core is MPL-2.0 and was not added (see UNVERIFIED)                                 |
| i18n scaffold                                                                                                                                                                                                     | DONE               | `src/i18n.ts`                                                                                          |
| Onboarding UX refactor (2026-11-22): Create = phrase -> verify -> passcode; Import = 12/24 numbered grid with smart paste -> auto-detected type -> passcode; shared passcode screen with explicit A7 requirements | DONE               | `ui/onboarding.tsx`, `ui/import.tsx`, `ui/passcode.tsx`, `vault/detect.ts`; 44 component tests, 32 e2e |
| PIN policy temporarily relaxed to a 4-digit numeric PIN (weak PINs rejected); documented as pre-mainnet debt                                                                                                      | DONE               | `vault.ts`, `policy.test.ts`, docs/DECISIONS.md, THREAT_MODEL.md, UNVERIFIED.md #21                    |
| Home redesign: monogram + pill tabs + Testnet, gradient hero with masked balance and copy-address pill, 4 action buttons, asset list with inline badges, Receive sheet, Activity empty state                      | DONE               | `ui/wallet.tsx`, `ui-home.test.tsx`, e2e                                                               |
| Create backup verification temporarily skipped (2-step Create: phrase -> PIN); Settings -> Test your backup retained                                                                                              | DONE               | `App.tsx`, `ui/onboarding.tsx`, DECISIONS.md, UNVERIFIED.md #22                                        |

---

### P1b: UI — Onboarding, Unlock, Backup Screens

**Status:** Not started

---

### P2a: TON Testnet read layer (2026-11-22)

### P2b: TON Testnet send (2026-11-22)

- V5R1 transfer builder/decoder with testnet wallet id invariant, TON + TEP-74 jetton, bounce rules, Max gas buffer: `packages/chain-ton/src/wallet.ts` (26 package tests).
- `/api/ton/wallet-state|emulate|broadcast` handlers + services with TON Center primary / TonAPI fallback, validation, no key leakage; esm-smoke compiles and invokes all five handlers.
- 3-step Send sheet: form validation (testnet prefixes only), review rendered from decoded signed BoC + emulation, Confirm & Send, Submitted link, optimistic Pending activity + polling refresh.

| Area                                                                                 | Status | Evidence                                               |
| ------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------ |
| TON types + BigInt formatting, testnet address selection, comment neutralization     | DONE   | `packages/chain-ton/src/*`, `index.test.ts` (16 tests) |
| Same-origin `/api/ton/portfolio` + `/api/ton/activity` proxies with keys server-side | DONE   | `apps/miniapp/api/ton/*`, `services/api/src/ton/*`     |
| TON Center v3 primary + TonAPI fallback, caching, validation, clean errors           | DONE   | `service.test.ts` (mocked upstream)                    |
| Home live balances/jettons/skeleton/offline retry, testnet 0Q address + inline QR    | DONE   | `ui/home.tsx`, `ui-home.test.tsx`, e2e                 |
| Activity list + sanitized detail modal + tonviewer link                              | DONE   | `ui/home.tsx`, component + e2e                         |

---

### P2c: Visual design system (2026-11-23)

Implemented `DESIGN.md` across `apps/miniapp` without changing vault security invariants or the
live P2a/P2b TON read/send behaviour.

| Area                                                                                       | Status | Evidence                                                       |
| ------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| Self-hosted Plus Jakarta Sans + JetBrains Mono (OFL-1.1), `font-src 'self'`                | DONE   | `main.tsx`, `index.css`, Vite `assetsInlineLimit: 0`           |
| Dual-theme semantic tokens + `data-theme` toggle persisted in non-secret prefs             | DONE   | `index.css`, `ui/preferences.tsx`, design e2e                  |
| Telegram chrome sync (`setBackgroundColor`, `setHeaderColor`)                              | DONE   | `ui/preferences.tsx`                                           |
| Wallet home: top bar, connected hero + 4-action dock, funds, grouped activity              | DONE   | `ui/home.tsx`, `ui-home.test.tsx`, e2e                         |
| Floating 4-tab nav (Wallet, Market, Assistant, Settings)                                   | DONE   | `ui/nav.tsx`, `ui/wallet-shell.tsx`, e2e                       |
| Deposit/Fund, live Send/Sell, Trade shell, Earn shell                                      | DONE   | `ui/deposit.tsx`, `ui/send.tsx`, `ui/trade.tsx`, `ui/earn.tsx` |
| Coin Detail (live balance + filtered activity, preview chart)                              | DONE   | `ui/coin-detail.tsx`, e2e                                      |
| Transaction Detail (hero amount, dimmed address middle, hash link, Repeat)                 | DONE   | `ui/tx-detail.tsx`, e2e                                        |
| Market + Assistant preview shells, labelled coming-soon rows                               | DONE   | `ui/market.tsx`, `ui/assistant.tsx`                            |
| Onboarding / create / import / PIN restyle, no phrase clipboard, no mandatory 3-word check | DONE   | `ui/onboarding.tsx`, `ui/import.tsx`, `ui/passcode.tsx`        |
| License allowlist gains OFL-1.1                                                            | DONE   | `scripts/license-check.mjs`, `THIRD_PARTY_LICENSES.md`         |

---

### P2d: Branded coin icons (2026-11-23)

| Area                                                                              | Status                                                | Evidence                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `react-web3-icons` (MIT, `sideEffects: false`) named imports for TON/USDT/TRX/ETH | DONE                                                  | `ui/coin-icons.tsx`, `package.json`                  |
| 40px circular coin avatars (56px on Coin Detail), crisp in both themes            | DONE                                                  | `ui/common.tsx` `TokenAvatar`, screen rows           |
| Unknown jetton monogram (deterministic tinted background + 2 letters, no fetch)   | DONE                                                  | `ui/coin-icons.tsx`, `coin-icons.test.tsx`           |
| Inline SVG only — no `<img>`, no remote logo host, no `data:` fonts               | DONE                                                  | design e2e (zero image requests, no external origin) |
| Bundle delta                                                                      | +3.94 kB raw / +1.86 kB gzip (1,566.99 → 1,570.93 kB) | build log                                            |

---

### P2e: Fullscreen toggle + Telegram safe areas (2026-11-23)

| Area                                                                            | Status | Evidence                                            |
| ------------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| Bot API 8.0+ detect (`requestFullscreen`/`exitFullscreen` + version guard)      | DONE   | `telegram/fullscreen.tsx`                           |
| `fullscreenChanged` / `fullscreenFailed` subscriptions with `offEvent` cleanup  | DONE   | `telegram/fullscreen.tsx`, `ui-fullscreen.test.tsx` |
| Browser Fullscreen API fallback; button hidden when neither is supported        | DONE   | `telegram/fullscreen.tsx`, unit test                |
| `safeAreaInset` + `contentSafeAreaInset` merged into `--app-safe-top/bottom`    | DONE   | `applySafeAreaVars`, `PhoneFrame`                   |
| 36×36 top-bar control beside Privacy Eye, expand/compress icons, `aria-pressed` | DONE   | `ui/home.tsx`, `ui/icons.tsx`                       |
| 4 utility buttons single-line at 360px; DESIGN §5.1 updated                     | DONE   | `DESIGN.md`, fullscreen E2E                         |
| Failure toast (`"Fullscreen isn't available on this device"`)                   | DONE   | `ui-toast`, unit test                               |

---

### P2f: First live testnet send — emulation parsing + review formatting (2026-11-25)

| Area                                                                                                      | Status | Evidence                                                             |
| --------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `/api/ton/emulate` parses the real TON Center shape (`transactions` hash map, `account_states`, `trace`)  | DONE   | `services/api/src/ton/write.ts`, `write.test.ts` (7 emulation cases) |
| TonAPI fallback parses `MessageConsequences` (`trace.transaction` + children), not a `result` wrapper     | DONE   | `write.test.ts` (TonAPI fixture)                                     |
| Fees accept JSON numbers (real schema) and decimal strings; balance deltas from state hashes or messages  | DONE   | `write.test.ts`                                                      |
| Empty/unparseable upstream still fails closed; shape-only `console.warn` (top-level keys, no BoC/address) | DONE   | `logEmptyEmulation`, unit test                                       |
| Review amount/fee formatted in token units; recipient shown as testnet `0Q…`/`kQ…`                        | DONE   | `ui/send.tsx`, `toTestnetDisplayAddress`, `ui-home.test.tsx`         |

---

### P2g: Non-bounceable send to `uninit` recipient — false-positive abort (2026-11-25)

| Area                                                                                                         | Status | Evidence                                  |
| ------------------------------------------------------------------------------------------------------------ | ------ | ----------------------------------------- |
| Harmless child abort (`compute_ph` skipped `no_state`, no bounce/exit/action code) no longer fails emulation | DONE   | `isHarmlessUninitCredit`, `write.test.ts` |
| Root sender abort, any non-zero `exit_code`/`action.result_code`, or a bounce phase stays fail-closed        | DONE   | `write.test.ts` (root abort, bounce case) |
| `bounce.type === "ok"` / TonAPI `bounce_phase` maps to `willBounce` + warning                                | DONE   | `readBouncePhase`, `write.test.ts`        |

---

### P2h: Transaction / Pending Detail polish (2026-11-25)

| Area                                                                                         | Status | Evidence                                    |
| -------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| Pending detail counterparty rendered in testnet `kQ…`/`0Q…` form (raw `0:…` no longer shown) | DONE   | `ui/tx-detail.tsx`, `ui-tx-detail.test.tsx` |
| Copy button copies the displayed friendly address; 6/6 highlight retained                    | DONE   | `ui/tx-detail.tsx`, component test          |
| Timestamp breathing room below the sticky header (`pt-3` on the detail content column)       | DONE   | `ui/tx-detail.tsx`                          |

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
