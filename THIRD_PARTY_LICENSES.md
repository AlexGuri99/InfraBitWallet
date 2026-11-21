# Third-party licenses

Enforced by `pnpm license-check` (`scripts/license-check.mjs`), which runs in `pnpm verify` and in
CI. It allows MIT, ISC, Apache-2.0, BSD-2-Clause and BSD-3-Clause only; anything else fails the
build until it is reviewed and added here deliberately.

Last verified: 2026-11-21 — `license-check: 92 package entries, all allow-listed`
(MIT 85, ISC 4, Apache-2.0 2, BSD-3-Clause 1).

## Direct dependencies

| Package              | License    | Use                                     |
| -------------------- | ---------- | --------------------------------------- |
| `@noble/curves`      | MIT        | Ed25519 / secp256k1                     |
| `@noble/hashes`      | MIT        | SHA-2/512, HMAC, HKDF, keccak           |
| `@scure/bip32`       | MIT        | BIP-32 derivation                       |
| `@scure/bip39`       | MIT        | BIP-39 mnemonic                         |
| `hash-wasm`          | MIT        | Argon2id (WebAssembly)                  |
| `zod`                | MIT        | Seal / config schema validation         |
| `viem`               | MIT        | EVM encoding + test cross-checks        |
| `ethers`             | MIT        | EVM cross-check (dev)                   |
| `tronweb`            | MIT        | TRON cross-check (dev)                  |
| `fake-indexeddb`     | Apache-2.0 | IndexedDB adapter tests (dev)           |
| `fast-check`         | MIT        | Property tests                          |
| `vitest`             | MIT        | Unit tests                              |
| `@playwright/test`   | MIT        | E2E tests                               |
| `@telegram-apps/sdk` | MIT        | Telegram Mini Apps SDK                  |
| `react`, `react-dom` | MIT        | UI framework                            |
| `zustand`            | MIT        | State (no secrets)                      |
| `tailwindcss`        | MIT        | Styling                                 |
| `valibot` (override) | MIT        | Transitive pin `>=1.4.2` for advisories |

## Notes

- `zod` is pinned through `pnpm-workspace.yaml` overrides to `>=4.6.6` to satisfy
  GHSA-mrhx-c7xc-m3w5 (memory-exhaustion in constrained collections). `abitype`'s zod peer is
  optional and accepts `^4.0.0`.
- No copyleft (GPL/AGPL/LGPL/MPL) dependency is present.
- MyTonWallet and any derived code remain prohibited; nothing here comes from that repository.
