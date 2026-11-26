# InfraBitWallet — Architecture

## 1. Monorepo Layout

```
onezerowallet/
├── apps/
│   └── miniapp/               # Telegram Mini App (React, Vite, Tailwind)
│       ├── src/
│       │   ├── components/    # UI components (mobile-first, Telegram-themed)
│       │   ├── hooks/         # React hooks
│       │   ├── pages/         # Route pages (onboarding, wallet, send, swap, stake)
│       │   ├── store/         # Zustand stores
│       │   ├── i18n/          # i18n scaffold (English first)
│       │   └── main.tsx       # Entry point
│       └── index.html
├── packages/
│   ├── core/                  # Shared types, constants, config, amount math
│   ├── crypto-vault/          # Wallet creation, derivation, encryption, biometrics
│   ├── chain-ton/             # TON ChainAdapter implementation
│   ├── chain-tron/            # TRON ChainAdapter implementation
│   ├── chain-evm/             # Generic EVM ChainAdapter implementation
│   ├── swap-ton/              # TON swap provider (STON.fi)
│   ├── swap-tron/             # TRON swap provider
│   ├── swap-evm/              # EVM swap aggregator (0x Swap API)
│   └── staking-ton/           # TON GRAM staking (Tonstakers)
├── services/
│   └── api/                   # Thin, keyless, stateless API (Vercel)
│       ├── src/
│       │   ├── routes/        # Telegram initData validation, price cache, RPC proxy
│       │   └── lib/
│       │       └── schemas/   # Zod schemas for all external responses
│       └── api/
├── docs/                      # Architecture, threat model, fees, decisions, progress
├── scripts/                   # Admin scripts (build unsigned treasury withdrawal txns)
└── config/                    # Deploy, CI, environment config
```

## 2. Core Interfaces

### ChainAdapter (per-chain implementation)

```typescript
interface ChainAdapter {
  deriveAccount(mnemonic: string, index: number): Promise<Account>;
  getBalances(address: string): Promise<AssetBalance[]>;
  buildTransfer(params: TransferParams): Promise<TransactionPayload>;
  estimateFee(params: TransferParams): Promise<FeeEstimate>;
  signAndSend(tx: TransactionPayload, keyPair: KeyPair): Promise<TxHash>;
  getHistory(address: string, cursor?: string): Promise<TransactionHistory>;
  buildSwap(params: SwapParams): Promise<TransactionPayload>; // optional
  buildStake(params: StakeParams): Promise<TransactionPayload>; // optional
  validateAddress(address: string): ValidationResult;
}
```

Build order: **TON → TRON → EVM**. Each chain package exports a single class implementing this interface.

### SwapProvider

```typescript
interface SwapProvider {
  getQuote(params: QuoteRequest): Promise<Quote>;
  buildSwapTx(quote: Quote, userAddress: string): Promise<SwapTransaction>;
  getAllowance(token: Address, owner: Address, spender: Address): Promise<bigint>;
  buildApprovalTx(token: Address, spender: Address, amount: bigint): Promise<TransactionPayload>;
}
```

Providers: STON.fi (TON), 0x Swap API (EVM), SunSwap V4 (TRON).

- ERC-20 approvals: **never unlimited by default**. Exact amount or verified Permit2 flow. Approval shown as its own step.
- Show quote, price impact, minimum received, slippage (default 1%, warn >5%), route, itemized fee breakdown.

### StakingProvider

```typescript
interface StakingProvider {
  getApy(): Promise<number>;
  getBalance(address: string): Promise<StakedBalance>;
  buildStakeTx(amount: bigint): Promise<TransactionPayload>;
  buildUnstakeTx(amount: bigint, mode: UnstakeMode): Promise<TransactionPayload>;
  getUnstakeDelay(): Promise<Duration>;
  getRewards(address: string): Promise<Rewards>;
}

type UnstakeMode = 'instant' | 'best_rate' | 'regular';
```

v1: GRAM on TON only via Tonstakers. Implement `StakingFeePolicy` (enum: `none` | `provider_revenue_share` | `explicit_fee`, default `none`) so fee model can change later without refactoring.

## 3. Vault and Unlock Design

### Vault Overview

```
User Passcode (6+ digits)
       │
       ▼
┌──────────────────────────────┐
│  Key Derivation (Argon2id)   │  ← WASM preferred; fallback: scrypt/PBKDF2 high cost
│  salt: random 16 bytes       │
└──────────────┬───────────────┘
               │ passcode-derived key
               ▼
┌──────────────────────────────┐
│  Vault Key Wrapping (AES)    │  ← Also wrap with biometric secret if available
│  Vault Key = random 256-bit   │
└──────────────┬───────────────┘
               │ wrapped vault key
               ▼
┌──────────────────────────────┐
│  SecureStorage (Telegram)    │  ← Up to 10 items per bot per user, Keychain/Keystore
│  Key: "vault_key_wrapped"    │  ← Also store biometric secret if enrolled
└──────────────────────────────┘

24-word Seed Phrase
       │
       ▼
┌──────────────────────────────┐
│  AES-256-GCM (WebCrypto)     │  ← ciphertext stored in IndexedDB
│  Key: vault key (unwrapped)  │
└──────────────┬───────────────┘
               │ ciphertext
               ▼
┌──────────────────────────────┐
│  IndexedDB / DeviceStorage   │  ← persistent, may be cleared by OS/Telegram
│  Collection: "vault"         │  ← stores ONLY passcode-wrapped ciphertext,
│                              │    never a plain vault key
└──────────────────────────────┘
```

### What Telegram APIs guarantee (and don't)

| Feature                          | Guarantees                                                                                                                                                            | Limitations                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SecureStorage**                | OS-native encryption (iOS Keychain, Android Keystore). Up to 10 items per bot per user. Data survives app reinstall if Telegram backs it up via device keychain sync. | Not available on Desktop/Web (no Keychain/Keystore). 10-item limit. Data may be cleared if Telegram app data is wiped. Only accessible within the same bot's mini app. **Do not assume availability** — feature-detect first. |
| **BiometricManager**             | Secure biometric authentication (fingerprint/face). Can store an encrypted biometric token for re-authentication.                                                     | Desktop/Web clients may lack biometric hardware entirely. Biometric token storage may require SecureStorage. Biometric alone never replaces passcode or seed phrase. **Do not assume availability** — feature-detect first.   |
| **DeviceStorage** (Bot API 9.0+) | Persistent local storage, ~5 MB per user. Conceptually like `localStorage`.                                                                                           | Not encrypted. Do not store secrets. May be cleared by Telegram or OS.                                                                                                                                                        |
| **CloudStorage** (Bot API 6.9+)  | Persistent across devices, up to 1024 items.                                                                                                                          | **Never use for secrets.** Data is accessible to Telegram's infrastructure.                                                                                                                                                   |

**Key rule:** Passcode is always the fallback. Desktop/Web clients may lack `SecureStorage` and biometrics. The app must gracefully degrade to IndexedDB and passcode-only unlock on platforms where these APIs are unavailable.

### Unlock Flow

1. App initializes → feature-detect `SecureStorage`, `BiometricManager`, and `DeviceStorage` via `isVersionAtLeast` and/or object-existence checks. Do not assume any Bot API version.
2. If biometrics available and enrolled: show biometric prompt. On success, unwrap vault key using biometric secret (from `SecureStorage` if available, otherwise degrade gracefully).
3. If biometrics unavailable or fail: show passcode input.
4. Passcode → Argon2id → decrypt wrapped vault key from `SecureStorage` or IndexedDB → decrypt seed from IndexedDB vault → derive chain accounts.
5. Auto-lock on: inactivity timer + app background. Clear derived keys from memory (zero-fill `Uint8Array`).
6. Exponential backoff on failed passcode attempts. Optional wipe after configurable N failures.

**Seed backup:** Always require a forced backup-verification step (confirm N random words from the 24-word phrase). Notify that local data can be cleared and seeds are irrecoverable.

## 4. Derivation Paths

All chains derive from one BIP-39 24-word mnemonic. Verified against SLIP-44 and current chain docs:

| Chain        | Path                | Notes                                                                              |
| ------------ | ------------------- | ---------------------------------------------------------------------------------- |
| **TON**      | `m/44'/607'/0'`     | Index is account index (hardened). Addresses derived per TON wallet V5R1 contract. |
| **TRON**     | `m/44'/195'/0'/0/0` | Standard BIP44: account 0, change 0, address_index 0 for first address.            |
| **Ethereum** | `m/44'/60'/0'/0/0`  | Standard BIP44: account 0, change 0, address_index 0 for first address.            |

Also support importing a legacy TON-native 24-word phrase as a TON-only account.

**Note:** TON derivation uses only hardened path components (no change/address_index chain), differing from TRON/Ethereum. This is by design in the TON ecosystem.

## 5. Data Flows

### Send Flow

```
User enters recipient, amount, memo (optional)
       │
       ▼
┌──────────────────────┐
│  validateAddress()    │  ← chain adapter
│  lookalike warning    │  ← check first/last N chars, clipboard swap
│  first-time warning  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  estimateFee()        │  ← chain adapter (simulate/gas estimate)
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Confirmation Screen  │  ← human-readable preview from actual payload
│  Amount               │
│  Recipient (truncated)│
│  Fee (line item)      │
│  Total                │
│  Token verification   │  ← verified-token registry check
└──────────┬───────────┘
           ▼  User confirms
┌──────────────────────┐
│  signAndSend()        │  ← chain adapter (unlock vault → derive key → sign → broadcast)
└──────────────────────┘
```

### Swap Flow

```
User selects token pair, enters amount
       │
       ▼
┌──────────────────────┐
│  SwapProvider.getQuote  │  ← fetches from provider API
│  - Price, impact, route│
│  - Min. received       │
│  - Slippage (default 1)│
│  - Fee breakdown       │
└──────────┬───────────┘
           ▼  Show quote
┌──────────────────────┐
│  Need approval?       │
│  (ERC-20 / TRC-20)    │
└──────┬───────────┬────┘
       │ No        │ Yes
       ▼           ▼
  ┌─────────┐ ┌───────────────┐
  │         │ │ buildApproval  │ ← exact amount (not unlimited)
  │         │ │ Show approval  │ ← as its own clear step
  │         │ │ User signs     │
  └─────────┘ └───────┬───────┘
                      ▼
              (continue to swap)
                      │
                      ▼
┌──────────────────────────────┐
│  buildSwapTx(quote, address)  │
│  Verify target contract +     │ ← fail closed on mismatch
│  calldata against allowlist  │
└──────────────┬───────────────┘
               ▼
┌──────────────────────┐
│  Confirmation Screen  │
│  - Exact amounts      │
│  - Fee (0.35% swap)   │
│  - Min. received      │
│  - Contract verified  │
└──────────────────────┘
```

### Stake Flow (v1: GRAM on TON only)

```
User views staking dashboard
       │
       ▼
┌──────────────────────────┐
│  StakingProvider.getApy() │
│  → Show APY with source   │
│  → Show current balance   │
│  → Show rewards           │
│  → Show unstake delay     │
│  → Explain liquid vs pool │
└──────────────┬───────────┘
               ▼
┌──────────────────────┐
│  User enters amount   │
│  No staking fee (v1)  │
│  (StakingFeePolicy =  │
│   "none")             │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  buildStakeTx(amount) │
│  Verify target        │ ← fail closed
│  contract allowlist  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Confirmation Screen  │
│  - Amount             │
│  - Fee (0% in v1)    │
│  - Risks disclaimer   │
│  - Unstake info       │
└──────────────────────┘
```

## 6. Infrastructure

- **Frontend:** Deployed on Vercel (paid plan). Statically built React app, no server-side rendering. Built with pnpm.
- **API:** Thin, stateless Vercel Edge/Functions. Validates Telegram `initData`, proxies RPC/API keys, rate-limits, caches. Never receives keys or mnemonics.
- **Portable to:** Cloudflare Pages/Workers (architecture is provider-agnostic). No Railway for v1.
- **Providers:** Pluggable with fallbacks. All external responses schema-validated (zod).

## 7. Out of Scope (v1)

Fiat on/off-ramp, NFTs, dApp browser / TON Connect / WalletConnect, hardware wallets, AI agent, gasless transfers, cross-chain bridging, TRX staking, ETH staking.
