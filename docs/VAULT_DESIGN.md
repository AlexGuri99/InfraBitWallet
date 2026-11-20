# OneZeroWallet — Vault Design

## Threat Model for the Vault

### Assets Protected
- **BIP-39 24-word seed phrase** — controls all funds on all chains
- **Derived private keys** — per-chain keys derived from the seed
- **Vault key** — random 256-bit key that encrypts the seed

### Adversary Goals
1. **Extract the seed** from device storage, network traffic, or memory dumps
2. **Brute-force the passcode** offline using stolen wrapped vault key + ciphertext
3. **Bypass passcode** via biometric spoofing or SecureStorage extraction
4. **Extract secrets from memory** during an active session
5. **Social-engineer** the user into revealing their seed phrase

### Attack Vectors and Mitigations

| Attack Vector | Severity | Mitigation |
|---|---|---|
| IndexedDB dump → stolen ciphertext | High | Ciphertext is AES-256-GCM encrypted; attacker also needs vault key |
| IndexedDB dump + SecureStorage dump → wrapped key + ciphertext | Critical (without device secret) | Device secret wrap combines passcode-derived key with a device-specific secret; attacker needs BOTH |
| Offline passcode brute-force from stolen wrapped key + ciphertext | High | Argon2id (timeCost=3, mem=64MiB, par=1) makes each guess ~1 second on mid-range phone |
| Clipboard/injection exfiltration of seed | Critical | Seed never leaves vault module; exposed as derived keys only |
| Memory dump during active session | Medium | Best-effort zero-fill after use; JS memory wiping is not guaranteed |
| Biometric bypass | Low | Biometrics never replace passcode; always dual-factor (passcode + biometric) |

### What Telegram Storage Guarantees

| Feature | Guarantees | Limitations |
|---|---|---|
| **SecureStorage** (Bot API 9.0+) | OS-native encryption (iOS Keychain, Android Keystore). Data survives app reinstall. | Not available on Desktop/Web. 10-item limit. Data may be cleared by Telegram/OS. Same-bot access only. |
| **BiometricManager** (Bot API 7.2+) | Secure biometric authentication (fingerprint/face). Can store encrypted token. | Desktop/Web may lack biometrics entirely. Biometric token needs SecureStorage. |
| **DeviceStorage** (Bot API 9.0+) | Persistent local storage, ~5 MB. | **Not encrypted.** Do not store secrets. |
| **CloudStorage** (Bot API 6.9+) | Persistent across devices. | **Never use for secrets.** Accessible to Telegram's infrastructure. |

**Key rule:** Feature-detect everything. Don't assume any Bot API version. Passcode is always the fallback.

## Exact Algorithms and Parameters

### Mnemonic Generation
- **Algorithm:** BIP-39 (English wordlist)
- **Library:** `@scure/bip39` v1.6.0 (MIT, audited)
- **Entropy:** `crypto.getRandomValues()` — 256 bits for 24 words, 128 bits for 12 words
- **Normalization:** NFKD + lowercase + whitespace collapse
- **Seed derivation:** `mnemonicToSeedSync` (PBKDF2-SHA512, 2048 rounds)

### Key Derivation

| Chain | Path | Curve | Algorithm |
|---|---|---|---|
| TON | `m/44'/607'/0'` | Ed25519 | SLIP-10 (HMAC-SHA512) |
| TRON | `m/44'/195'/0'/0/0` | secp256k1 | BIP-32 |
| Ethereum | `m/44'/60'/0'/0/0` | secp256k1 | BIP-32 |

Sources:
- SLIP-44: https://github.com/satoshilabs/slips/blob/master/slip-0044.md (fetched 2026-11-20)
- TON V5R1: https://docs.ton.org/contracts/standard/wallets/v5 (fetched 2026-11-20)

### Vault Encryption
- **Cipher:** AES-256-GCM (NIST SP 800-38D)
- **Implementation:** Web Crypto API (`crypto.subtle`)
- **IV:** 96-bit (12 bytes), fresh `crypto.getRandomValues()` per encryption
- **Key:** 256-bit (32 bytes), random via `crypto.getRandomValues()`
- **Tag:** 128-bit (16 bytes), appended by GCM mode
- **Format:** IV (12 bytes) || ciphertext || GCM tag (16 bytes)

### Passcode Key Derivation
- **Algorithm:** Argon2id (RFC 9106)
- **Library:** `hash-wasm` v4.13.0 (MIT, WebAssembly)
- **Parameters (default):**

| Parameter | Value | Rationale |
|---|---|---|
| Time cost (iterations) | 3 | OWASP minimum 2026; ~1s on Pixel 6 |
| Memory cost | 64 MiB (65536 KiB) | OWASP minimum 2026; 64 MiB |
| Parallelism | 1 | Single-threaded mobile; parallel gains are minimal on phone CPUs |
| Hash length | 32 bytes (256 bits) | Matches AES-256 key size |
| Salt | 16 bytes random | Per-seal unique |

- **Fallback (if WASM unavailable):** scrypt via `@noble/hashes/scrypt` with N=2^17, r=8, p=1. Documented but not implemented in v1.

### Device Secret Wrap (Optional)
- **Secret:** 256-bit random, stored in SecureStorage
- **Combination:** Encrypted vault key is further encrypted with device secret. Both the passcode-derived key AND the device secret are required to unwrap.

### Biometric Wrap (Optional)
- **Mechanism:** BiometricManager.authenticate releases a biometric token stored in SecureStorage
- **Token:** AES-256-GCM encrypts vault key with biometric token
- **Constraint:** Biometrics never replace passcode

## Known Limits of JavaScript Memory Wiping

JavaScript has no guaranteed way to zero-fill memory:

1. **Garbage collector:** The `Uint8Array` may be cloned, aliased, or interned by the runtime.
2. **Optimizer:** V8's optimizing compiler may eliminate "dead stores" (including `fill(0)`) if it can prove the buffer is never read again.
3. **Closures:** A closure capturing the seed keeps it alive indefinitely.
4. **Stack traces:** Exception stack traces may capture buffer contents.

**Mitigations employed:**
- `Uint8Array.fill(0)` on sensitive buffers immediately after last use
- Seed and keys never stored in React state, DOM, or any global scope
- All derived keys cleared on session lock
- No persistent references to seed or keys outside vault module

**Known limitations (accepted):**
- Runtime may keep copies in registers or on the stack
- V8 may optimize out `fill(0)` in production (configurable with `--allow-natives-syntax` but not in production)
- A memory dump at the exact moment after unlock but before zero-fill captures the seed

## Recovery Behavior When Local Data Is Cleared

### Scenario: User's IndexedDB and SecureStorage are cleared (e.g., Telegram reinstall)

**User has backed up their 24-word seed phrase:**
1. User imports 24-word phrase
2. New vault key generated
3. New passcode set
4. New device secret stored in SecureStorage
5. All funds accessible

**User has NOT backed up:**
- **Funds are unrecoverable.** No server-side recovery is possible.
- The app must clearly warn during onboarding that local data may be cleared and the seed phrase is the only backup.

### Design for Recovery
- Forced backup verification during onboarding (confirm N random words from the phrase)
- Clear warnings that Telegram/OS may clear local data
- No server-side key storage or seed escrow
- User is encouraged to write down the seed phrase on paper

## Storage Adapter Interface

```typescript
interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

Implementations:
- `SecureStorageAdapter` — wraps Telegram `SecureStorage` (Bot API 9.0+)
- `IndexedDBAdapter` — uses IndexedDB for ciphertext (passcode-wrapped only)
- `InMemoryStorage` — test-only implementation

## Session Lifecycle

```
START
  │
  ▼
[Locked] ───────────────────────┐
  │                             │
  │  User enters passcode       │  Auto-lock: inactivity timeout
  │  ↓                          │  or visibilitychange (background)
  ▼                             │
[Unlocking]                     │
  │                             │
  │  Argon2id(salt, passcode)   │
  │  ↓                          │
  │  Unwrap vault key           │
  │  ↓                          │
  │  Decrypt seed               │
  │  ↓                          │
  │  Derive all chain keys      │
  │  ↓                          │
  │  Zero-fill seed             │
  ▼                             │
[Active session] ───────────────┘
  │
  │  User triggers sign or
  │  send operation
  ▼
[Sign] → uses derived key → zero-fill after
```

## Configuration Parameters (VaultSeal JSON)

```typescript
{
  version: 1,                        // format version for migration
  passcodeWrappedKey: string,         // iv(12) + ciphertext(48), hex
  deviceWrappedKey?: string,          // optional: device secret wrap
  biometricWrappedKey?: string,       // optional: biometric wrap
  encryptedSeed: string,              // iv(12) + ciphertext(80), hex
  iv: string,                         // IV for seed encryption (hex)
  passcodeSalt: string,               // salt for Argon2id (hex)
  argon2TimeCost: number,             // iterations
  argon2MemoryCost: number,           // KiB
  argon2Parallelism: number           // threads
}
```

The `version` field allows future parameter upgrades (e.g., stronger Argon2id, different cipher). When the vault is opened with an older version, automatic re-sealing with current parameters is performed.