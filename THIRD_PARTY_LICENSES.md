# Third-party licenses

Enforced by `pnpm license-check` (`scripts/license-check.mjs`), which runs in `pnpm verify` and in
CI. It allows MIT, the dual `MIT OR CC0-1.0` (type-fest, a `@ston-fi/api` transitive), ISC,
Apache-2.0, BSD-2-Clause, BSD-3-Clause, OFL-1.1 (self-hosted fonts) and Unlicense (tweetnacl);
anything else fails the build until it is reviewed and added here deliberately.

Last verified: 2026-11-25 (P3a) — `license-check: 145 package entries, all allow-listed`
(MIT 132, OFL-1.1 2, ISC 4, Apache-2.0 2, BSD-3-Clause 3, Unlicense 1, MIT OR CC0-1.0 1).

## Direct dependencies

| Package                                              | License    | Use                                         |
| ---------------------------------------------------- | ---------- | ------------------------------------------- |
| `@noble/curves`                                      | MIT        | Ed25519 / secp256k1                         |
| `@noble/hashes`                                      | MIT        | SHA-2/512, HMAC, HKDF, keccak               |
| `@scure/bip32`                                       | MIT        | BIP-32 derivation                           |
| `@scure/bip39`                                       | MIT        | BIP-39 mnemonic                             |
| `hash-wasm`                                          | MIT        | Argon2id (WebAssembly)                      |
| `zod`                                                | MIT        | Seal / config schema validation             |
| `@ton/core`                                          | MIT        | TON cells, Address, StateInit hashing       |
| `@ton/ton`                                           | MIT        | Wallet V5R1 contract + address              |
| `@ton/crypto`                                        | MIT        | TON-native mnemonic validation/seed         |
| `@scure/base`                                        | MIT        | Base58check for TRON addresses              |
| `buffer`                                             | MIT        | Browser Buffer polyfill for @ton/*          |
| `viem`                                               | MIT        | EVM encoding + test cross-checks            |
| `ethers`                                             | MIT        | EVM cross-check (dev)                       |
| `tronweb`                                            | MIT        | TRON cross-check (dev)                      |
| `fake-indexeddb`                                     | Apache-2.0 | IndexedDB adapter tests (dev)               |
| `fast-check`                                         | MIT        | Property tests                              |
| `vitest`                                             | MIT        | Unit tests                                  |
| `@testing-library/react` / `user-event` / `jest-dom` | MIT        | Component tests                             |
| `@playwright/test`                                   | MIT        | E2E tests                                   |
| `@telegram-apps/sdk`                                 | MIT        | Telegram Mini Apps SDK                      |
| `react`, `react-dom`                                 | MIT        | UI framework                                |
| `zustand`                                            | MIT        | State (no secrets)                          |
| `tailwindcss`                                        | MIT        | Styling                                     |
| `qrcode-generator`                                   | MIT        | Inline SVG receive QR codes                 |
| `@fontsource-variable/plus-jakarta-sans`             | OFL-1.1    | Self-hosted UI sans (bundled .woff2)        |
| `@fontsource-variable/jetbrains-mono`                | OFL-1.1    | Self-hosted mono (addresses / amounts)      |
| `react-web3-icons`                                   | MIT        | Inline branded coin SVGs (TON/USDT/TRX/ETH) |
| `@ston-fi/sdk`                                       | MIT        | STON.fi DEX v2 swap payload builder         |
| `@ston-fi/api`                                       | MIT        | Peer of @ston-fi/sdk (REST typings)         |
| `valibot` (override)                                 | MIT        | Transitive pin `>=1.4.2` for advisories     |

## Notes

- `zod` is pinned through `pnpm-workspace.yaml` overrides to `>=4.6.6` to satisfy
  GHSA-mrhx-c7xc-m3w5 (memory-exhaustion in constrained collections). `abitype`'s zod peer is
  optional and accepts `^4.0.0`.
- No copyleft (GPL/AGPL/LGPL/MPL) dependency is present.
- MyTonWallet and any derived code remain prohibited; nothing here comes from that repository.
