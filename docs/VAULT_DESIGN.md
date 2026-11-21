# OneZeroWallet — Vault Design

Last rewritten: 2026-11-21 (Stage A). Every statement here describes code in
`packages/crypto-vault/src` as of that date; the named tests in `*.test.ts` prove the behaviours.
Anything that is not verified is listed in `docs/UNVERIFIED.md`.

## 1. Assets and adversaries

| Asset                         | Where it exists                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| BIP-39 phrase (master secret) | Never stored in plaintext. Encrypted in the seal; held briefly for reveal           |
| 64-byte BIP-39 seed           | Encrypted in the seal; in session memory only while unlocked                        |
| Per-chain private keys        | Derived per signing call, zero-filled immediately after                             |
| Random vault key              | Only inside `sealVault`/`unsealVault` and briefly in biometric enable               |
| Device secret                 | Secure adapter only (Telegram SecureStorage / Keychain / Keystore)                  |
| Biometric token               | Returned to the caller; stored by Telegram's BiometricManager, never by this module |

Adversary goals: extract the phrase or keys from storage/memory; brute-force the passcode offline
from a copied seal; bypass the passcode; capture secrets from a live session; phish the phrase.

## 2. Seal format (version 4)

`VaultSeal` (all binary fields are lowercase hex, `vault.ts`):

| Field                                                       | Meaning                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `version`                                                   | `4` (`VAULT_FORMAT_VERSION`)                                                             |
| `passcodeWrappedKey`                                        | `iv(12) ‖ ct(32) ‖ tag(16)` — vault key wrapped by the passcode (or passcode+device) key |
| `hasDeviceSecret`                                           | Whether the device secret is required                                                    |
| `biometricWrappedKey?`                                      | Optional `iv(12) ‖ ct(32) ‖ tag(16)` — vault key wrapped by a key derived from the token |
| `encryptedSeed`                                             | `ct(64) ‖ tag(16)` under the vault key                                                   |
| `iv`                                                        | IV for `encryptedSeed`                                                                   |
| `encryptedMnemonic`                                         | UTF-8 mnemonic `ct ‖ tag` under the vault key                                            |
| `mnemonicIv`                                                | IV for `encryptedMnemonic`                                                               |
| `passcodeSalt`                                              | 16-byte Argon2id salt                                                                    |
| `argon2TimeCost` / `argon2MemoryCost` / `argon2Parallelism` | KDF parameters (KiB for memory)                                                          |

There is deliberately **no stored `aad`**. Every ciphertext is authenticated with AAD that is
recomputed at open time from the format version, the Argon2id parameters, the device-secret flag
and a role label (`vault-key`, `seed`, `mnemonic`, `biometric-key`). A ciphertext moved between
roles, or opened under a different version or parameter set, fails GCM. Tests:
`vault.test.ts › A4: AAD binding and tamper detection` (each asserts the specific error),
`vault.test.ts › AAD binds the role`.

## 3. Cryptography

- **AES-256-GCM** (NIST SP 800-38D) via Web Crypto; fresh 96-bit IV per encryption; 128-bit tag.
- **Argon2id** (RFC 9106) via `hash-wasm`, hashLength 32.
- **HKDF-SHA256** (RFC 5869) via `@noble/hashes`.
- **BIP-39** via `@scure/bip39`; **SLIP-10 Ed25519** and **BIP-32 secp256k1** via `@noble/*`.

### Argon2id parameters

Defaults: `timeCost=3`, `memoryCost=65536` KiB (64 MiB), `parallelism=1`. These are **our choice**,
not a measured OWASP minimum and not benchmarked on a real mobile WebView
(`docs/UNVERIFIED.md`). Bounds (`KDF_BOUNDS`) are checked **before** Argon2id runs:

| Parameter      | Min   | Max    | Purpose                                 |
| -------------- | ----- | ------ | --------------------------------------- |
| timeCost       | 2     | 10     | reject downgrade / CPU-exhaustion seals |
| memoryCost KiB | 19456 | 262144 | 19 MiB floor, 256 MiB ceiling           |
| parallelism    | 1     | 4      | sane bounds                             |

Tests: `vault.test.ts › A4: KDF bounds are enforced BEFORE Argon2 runs` (asserts `argon2id` is
never called).

`measureKdf(config?, rounds?)` times one derivation so the setup screen can choose parameters
inside the bounds (`policy.test.ts › A7: measureKdf`). The timing is device-specific; do not treat
it as a constant.

### Key wrap with a device secret

Conventional HKDF (v4):

```
IKM  = len32(argon2Key) ‖ argon2Key ‖ len32(deviceSecret) ‖ deviceSecret
salt = "onezerowallet/vault/v4/hkdf-salt"      (fixed, not secret)
info = "vault-key-wrap"
OKM  = HKDF-SHA256(IKM, salt, info, 32)
```

Length prefixes prevent one input being shifted into the other. Without a device secret the
Argon2id output is the wrapping key directly.

## 4. Biometric wrap

Sources: <https://core.telegram.org/bots/webapps> (fetched 2026-11-21) — BiometricManager is
available since Bot API 7.2. `authenticate()` shows a native prompt and, on success, returns the
token previously stored with `updateBiometricToken()`; the token lives in device secure storage.

Implementation (`vault.ts`):

- `enableBiometric(seal, passcode, deviceSecret?)` unwraps the vault key with the passcode, makes a
  fresh random 32-byte token, derives `bioKey = HKDF-SHA256(token [, deviceSecret], salt,
"biometric-vault-key-wrap")`, wraps the vault key with AES-GCM (random IV stored in the blob,
  role-labelled AAD), and returns `{ seal, token }`. **The module never persists the token** — the
  caller must call `updateBiometricToken`.
- `unlockWithBiometric(seal, tokenHex, deviceSecret?)` validates the token (exactly 64 hex chars),
  requires the device secret when `hasDeviceSecret`, unwraps the vault key, then decrypts and
  verifies the payload exactly as passcode unlock does.
- `disableBiometric(seal)` drops the wrap.
- A passcode change rotates the vault key; any old biometric wrap is dropped and must be recreated
  (`vault-manager.ts` recreates it and returns a fresh token).

**Factor model (stated plainly):** biometric unlock is a **convenience path**. On a device where
Telegram is already unlocked, a successful biometric check releases the token, and the token (plus
the device secret when configured) opens the vault without typing the passcode. This is a
deliberate trade-off: it is not a second independent secret. The passcode is still required for
**revealing the phrase** (`revealMnemonic`), for **changing the passcode**, and for **disabling
biometrics**. Consequence: someone holding the unlocked device and passing the biometric check can
create transactions. See the threat table update in `docs/THREAT_MODEL.md`.

Tests: `biometric.test.ts` (round trip, wrong token, malformed token, tampered blob, unique IV,
passcode change invalidates, device secret still required).

## 5. Session API

`session.ts` keeps the seed in a closure. The returned `VaultSession` has functions only:

| Member                                    | Behaviour                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `getPublicInfo(accountIndex)`             | public keys / intermediate address forms per chain; a copy on every call                                     |
| `signDigest(chain, accountIndex, digest)` | Ed25519 (TON, 64 bytes) or recoverable secp256k1 (TRON/EVM, `r‖s‖recovery`); per-call key, zero-filled after |
| `reauthenticate(passcode)`                | fresh Argon2id check; opens the reveal window (default 60 s)                                                 |
| `revealMnemonic()`                        | returns the phrase once per successful re-auth, then clears the window                                       |
| `lock()`                                  | zero-fills the seed, clears the window, removes listeners                                                    |

**Blind-signing warning.** `signDigest` signs any 32 bytes. Chain adapters **must** build the
payload themselves, hash it, and show a human-readable preview generated from that payload before
signing. `SigningRequest` (with `payloadHex` and `summary`) is the TODO-backed interface that will
replace the bare digest when adapters exist.

**What we cannot guarantee.** `fill(0)` is best effort: the engine may copy buffers, and the
mnemonic is a JavaScript string that cannot be wiped. The phrase is kept out of any store and is
returned only on demand by `revealMnemonic`. Tests: `session.test.ts` (no secret property at any
depth, `JSON.stringify` clean, signatures verify with noble/viem, lock and reveal semantics),
`logging.test.ts` (whole flow logs nothing secret).

## 6. Unlock backoff and wipe

`backoff.ts`:

- A failed attempt computes the delay once and persists `nextAllowedAt` (absolute ms), so repeated
  reads do not re-roll jitter.
- **Only `wrong_passcode` counts.** `kdf_unavailable` and `device_secret_missing` do not.
- Rate limiting returns `{ success: false, error: 'rate_limited', retryAfterMs }` — never
  `wrong_passcode` — and **does not run Argon2id** (`backoff.test.ts › A8: rate limiting`).
- Storage is mandatory: helpers throw `STORAGE_REQUIRED`; `unlockSession` without storage returns
  `storage_required` (fail closed).
- The wipe threshold (`wipeAfterFailures`) is disabled by default. When reached, the stored seal
  and device secret are deleted and the result is `{ success: false, error: 'wiped' }`.
- This only defends the on-device UI. Clock changes can bypass the delay, and it does nothing
  against an offline attack on a copied seal.

Auto-lock: inactivity timer plus one `visibilitychange` listener registered once and removed on
lock (`backoff.test.ts › A8: visibility listener lifecycle`). Telegram's `activated`/`deactivated`
events are handled by the app adapter (`apps/miniapp/src/adapters/telegram-lifecycle.ts`), not by
this package.

## 7. Passcode policy

`evaluatePasscodeStrength(passcode, hasDeviceSecretWrap)` returns
`{ ok, error?, unprotectedByDeviceSecret, kind, minLength }`. Errors never echo the input.

| Factor available | Requirement                                                         |
| ---------------- | ------------------------------------------------------------------- |
| device secret    | 6+ digit PIN (repeated/sequential rejected) **or** 8+ characters    |
| none             | 12+ characters, not on a small embedded common-passphrase blocklist |

`unprotectedByDeviceSecret: true` means the seal can be attacked offline if copied; the UI must
show a warning. This corrects earlier wording: a PIN is protected only by the secrecy of the
device secret.

Tests: `policy.test.ts`.

## 8. Storage

`StorageAdapter = { get, set, delete, clear }`.

- `InMemoryStorage` — tests only.
- `IndexedDBAdapter` — seal ciphertext and backoff only; IDBFactory injectable.
- `SecureStorageAdapter` (app adapter, `apps/miniapp/src/adapters/secure-storage.ts`) — Telegram
  SecureStorage, feature-detected on the object and Bot API 9.0. Handles the callback API,
  `getItem` returning null, and the user-approved `restoreItem`. Budget: uses **1** of the
  **10** items Telegram allows per bot per user.
- `CompositeStorage` — routes `DEVICE_SECRET` to the secure adapter and everything else to the
  bulk adapter, so the device secret never lands in IndexedDB.

Zod runs in `jitless` mode (`z.config({ jitless: true })`) because its JIT compiles validators
with `new Function`, which strict CSP (no `unsafe-eval`) rejects. Proven by
`vault-browser.spec.ts › Argon2id vault create/unlock works under production CSP`.

Persisted keys: `vault_seal`, `device_secret` (secure only), `backoff_count`,
`backoff_next_allowed_at`.

## 9. VaultManager

`vault-manager.ts` wires the pieces:

`hasVault`, `createWallet(passcode, mnemonic?)`, `importWallet(mnemonic, passcode)`, `unlock`,
`unlockWithBiometric`, `lock`, `changePasscode`, `enableBiometric`, `disableBiometric`, `migrate`,
`wipe`, `evaluatePasscode`, `getSession`.

- Creating uses a device secret whenever a secure adapter is configured; otherwise the seal has no
  device factor and the stricter passphrase policy applies.
- `saveSeal` validates with zod before persisting, so a malformed envelope is never written and a
  malformed stored one is never trusted (`seal-store.ts`, `seal-store.test.ts`).

### Device-secret loss

If Telegram/the OS clears SecureStorage while the seal requires a device secret, the seal **cannot**
be opened with the passcode alone (`device_secret_missing`). The only recovery is to wipe the seal
and re-import the recovery phrase. Tested: `vault-manager.test.ts › cannot open the seal if the
device secret is lost; only re-import recovers`.

## 10. Format migration

`migrateLegacySeal` upgrades v1–v3 to v4:

- v1: stored `aad`, no stored mnemonic → caller must supply the phrase.
- v2: stored `aad` + stored mnemonic.
- v3: recomputed AAD, but the old HKDF combination → migrations use the old combination to open,
  then reseal with v4.

Nothing legacy is ever written back. `migrateStoredSeal` loads, migrates and saves.
Tests: `vault.test.ts › A4: migration of v1/v2 seals`, `› A10: migration of v3 seals`.

## 11. Recovery behaviour when local data is cleared

If the user has the phrase: import it, set a passcode, and (if a secure adapter exists) a fresh
device secret is created. If the user does not: funds are unrecoverable; there is no server-side
escrow. The UI must warn that Telegram/OS may clear local data.

## 12. Addresses and account types (Stage B)

### EVM

`getPublicInfo().evm` exposes `rawAddress` (lowercase) and `address` (EIP-55). Checked against the
official EIP-55 vectors, the published Hardhat first account and viem. `isValidEvmAddress` accepts
all-lower/all-upper input and requires a correct checksum for mixed case.

### TRON

`hexAddress` is the intermediate 0x41-prefixed form; `address` is base58check (`T…`, double
SHA-256 4-byte checksum). Cross-checked against TronWeb. `isValidTronAddress` decodes and requires
21 bytes starting with 0x41.

### TON

`tonAddressesFromPublicKey` produces Wallet **V5R1** forms from the Ed25519 public key (workchain
0, subwallet 0; mainnet global id -239, testnet -3):

| Form                   | Prefix | Flags       |
| ---------------------- | ------ | ----------- |
| raw                    | `0:`   | —           |
| mainnet bounceable     | `EQ`   | 0x11        |
| mainnet non-bounceable | `UQ`   | 0x51        |
| testnet bounceable     | `kQ`   | 0x11 + 0x80 |
| testnet non-bounceable | `0Q`   | 0x51 + 0x80 |

Flags per docs.ton.org address formats. `validateTonAddress` accepts raw and user-friendly forms
(CRC16 checked by @ton/core) and reports the testnet flag. The address is cross-checked against an
independent StateInit hash (`contractAddress`) in `address.test.ts`.

**Receive UX rule (first-time recipients):** show and prefer the **non-bounceable** mainnet
address (`UQ…`) for wallet contracts, so funds are credited even if the recipient wallet is not yet
initialized. The app must explain this in plain language and still show the bounceable form for
users who need it. Testnet addresses are clearly labelled and never shown without the testnet
warning.

### Account types

- `bip39-multichain` (default): BIP-39 phrase → TON `m/44'/607'/N'` (SLIP-10), TRON
  `m/44'/195'/N'/0/0`, EVM `m/44'/60'/N'/0/0`.
- `ton-native-only`: a TON-native 24-word phrase → Ed25519 key via @ton/crypto; TON only, account
  index 0. No TRON/EVM keys are derived or shown.

The type is stored in seal v5 and authenticated in the AAD. Migration from v1–v4 defaults to
`bip39-multichain`. Tests: `account-type.test.ts` (official @ton/crypto vector),
`vault.test.ts › B2: migration of v4 seals`.

Interop caveats (source-cited in `docs/DECISIONS.md`): Keeper's BIP-39 path matches our account 0;
Ledger defaults to a different path and Wallet V4, so its address differs; My Wallet was not
inspected by design.

## 13. Known gaps (Stage A/B)

- **No UI yet.** Stage C builds onboarding/unlock/backup screens on this API.
- **Argon2id timing is unmeasured** on a real mobile WebView; defaults are our choice.
- **Account-index convention is unresolved** for other wallets (see `docs/DECISIONS.md`).
- **TON interop for My Wallet is unknown** (not inspected; license constraint) and the wallet
  version Keeper defaults to is UNVERIFIED.
- **Send-path address input validation is not wired into a UI** yet (validators exist and are
  tested).
- **WebKit now runs locally**, but CI system dependencies for WebKit are unverified
  (see `docs/UNVERIFIED.md`).
- **Signing is blind at this layer** until adapters build `SigningRequest`s.
- **JavaScript cannot guarantee memory wiping**, as described above.

## 14. Manual checks required before any release

1. Open the deployed preview inside Telegram Desktop, Web, iOS and Android.
2. Confirm SecureStorage is present (Bot API 9.0+) and the item count stays within the budget.
3. Confirm BiometricManager flows: requestAccess, authenticate returning the stored token,
   updateBiometricToken on enable/change, and behaviour when biometrics are denied.
4. Confirm the auto-lock fires on Telegram `deactivated` (backgrounding) on each platform.
