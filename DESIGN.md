# DESIGN.md — OneZeroWallet (Botanical Citron & Forest Crypto Wallet)

## 1. Design Philosophy & Aesthetic Direction

**OneZeroWallet** combines a **soft botanical fintech palette** with the **high-density, list-driven information architecture** of modern mobile crypto wallets.

- **Dual-Theme Polarity**:
  - **Mint Light Mode (Default)**: Soft sage-mint canvas (`#DFF2E6`), pure white elevated cards (`#FFFFFF`), high-contrast canary-yellow hero balance surfaces (`#FFF34C`), and deep obsidian ink (`#111814`).
  - **Forest & Citron Dark Mode**: Deep organic forest-black canvas (`#0A0F0D`), dark moss elevated cards (`#141D19`), luminous electric-citron accents (`#E6F04A`), and crisp off-white ink (`#F2F7F4`).
- **Clarity & Privacy First**: Financial metrics use strict `tabular-nums` alignment so digits never jitter during live scrubbing, currency switching, or privacy masking.
- **Tactile Mobile Ergonomics**: Built inside a mobile-first viewport (`max-width: 430px`) with generous corner radii (`20px–28px`), pill controls (`9999px`), subtle spring-like press feedback (`scale(0.97)`), and a floating translucent navigation dock.

---

## 2. Color System & Design Tokens

All colors are defined as semantic CSS custom properties so components transition smoothly between Light and Dark modes without per-element overrides.

### 2.1 Surface & Background Tokens

| Token                    | Mint Light Mode             | Forest Dark Mode         | Usage                                                          |
| :----------------------- | :-------------------------- | :----------------------- | :------------------------------------------------------------- |
| `--bg-canvas`            | `#DFF2E6`                   | `#0A0F0D`                | Primary viewport background                                    |
| `--bg-surface`           | `#FFFFFF`                   | `#141D19`                | Grouped list cards, action docks, input wells                  |
| `--bg-surface-secondary` | `#F3F9F5`                   | `#1B2722`                | Nested rows, segmented control tracks, chart containers        |
| `--bg-surface-elevated`  | `#EBF6EF`                   | `#22312A`                | Date pill headers, hover states, secondary buttons             |
| `--bg-glass`             | `rgba(255, 255, 255, 0.84)` | `rgba(20, 29, 25, 0.84)` | Floating bottom navigation bar (`backdrop-filter: blur(18px)`) |

### 2.2 Brand & Accent Tokens

| Token                  | Mint Light Mode                   | Forest Dark Mode                  | Usage                                                             |
| :--------------------- | :-------------------------------- | :-------------------------------- | :---------------------------------------------------------------- |
| `--hero-bg`            | `#FFF34C` (gradient to `#F7E831`) | `#E6F04A` (gradient to `#CFE030`) | Hero wallet balance card                                          |
| `--hero-ink`           | `#111814`                         | `#0A0F0D`                         | Text & icons inside the canary/citron hero card                   |
| `--hero-pill-bg`       | `rgba(17, 24, 20, 0.08)`          | `rgba(10, 15, 13, 0.12)`          | Currency badge and 24h gain pill inside hero card                 |
| `--accent-primary`     | `#111814`                         | `#E6F04A`                         | Primary CTA buttons, active tab indicators                        |
| `--accent-primary-ink` | `#FFFFFF`                         | `#0A0F0D`                         | Text on primary CTA buttons                                       |
| `--accent-link`        | `#0F766E`                         | `#5EEAD4`                         | Inline interactive links (`Max`, `Details >`, `Why this is safe`) |

### 2.3 Text & Semantic Status Tokens

| Token                  | Mint Light Mode           | Forest Dark Mode            | Usage                                                     |
| :--------------------- | :------------------------ | :-------------------------- | :-------------------------------------------------------- |
| `--text-primary`       | `#111814`                 | `#F2F7F4`                   | Headings, balances, primary labels                        |
| `--text-secondary`     | `#52665B`                 | `#94A89E`                   | Subtitles, timestamps, truncated addresses                |
| `--text-muted`         | `#83998D`                 | `#5E7368`                   | Placeholders, dimmed middle characters of hashes          |
| `--status-positive`    | `#15803D`                 | `#34D399`                   | Incoming funds (`Received`), positive 24h `%`, APY badges |
| `--status-positive-bg` | `rgba(21, 128, 61, 0.12)` | `rgba(52, 211, 153, 0.15)`  | Received icon badge & transaction detail pill             |
| `--status-negative`    | `#DC2626`                 | `#F87171`                   | Negative 24h price change                                 |
| `--status-swap`        | `#0284C7`                 | `#38BDF8`                   | Swapped transaction badge & flip button                   |
| `--border-subtle`      | `rgba(17, 24, 20, 0.07)`  | `rgba(242, 247, 244, 0.08)` | Card hairlines & list dividers                            |

---

## 3. Typography & Hierarchy

- **Font Stack**: Self-hosted `@fontsource-variable/plus-jakarta-sans` paired with `@fontsource-variable/jetbrains-mono` (OF-licensed `.woff2` bundled locally via Vite; strict CSP `font-src 'self'` enforced with zero Google Fonts/CDN external links).
  - **Sans**: `'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`
  - **Mono**: `'JetBrains Mono Variable', 'JetBrains Mono', monospace`
- **Numeric Discipline**: All monetary balances, token amounts, percentages, and chart prices enforce `font-variant-numeric: tabular-nums`.

| Role                      | Size                 | Weight            | Tracking   | Example                       |
| :------------------------ | :------------------- | :---------------- | :--------- | :---------------------------- |
| **Hero Balance**          | `38px` (`2.375rem`)  | `800` (ExtraBold) | `-0.03em`  | `$26,887.09`                  |
| **Coin / Tx Detail Hero** | `34px` (`2.125rem`)  | `800` (ExtraBold) | `-0.025em` | `−235` `.91 USDT`             |
| **Screen Title**          | `17px` (`1.0625rem`) | `700` (Bold)      | `-0.01em`  | `Fund`, `Trade`, `Tron`       |
| **Section Header**        | `14px` (`0.875rem`)  | `700` (Bold)      | `0.01em`   | `Available Funds`, `Activity` |
| **List Row Primary**      | `15px` (`0.9375rem`) | `600` (SemiBold)  | `-0.01em`  | `Tron`, `62 TRX`, `Sent`      |
| **List Row Secondary**    | `12.5px` (`0.78rem`) | `500` (Medium)    | `0`        | `$0.31 · ↑ 0.67%`             |
| **Pill / Micro Label**    | `11.5px` (`0.72rem`) | `600` (SemiBold)  | `0.02em`   | `November 21`, `13.62%`       |

---

## 4. Layout Architecture & Spatial Grid

- **Viewport Frame**: Centered mobile container (`max-width: 430px`, `min-height: 100dvh`), `16px` horizontal outer padding, `96px` bottom scroll clearance so content never hides behind the floating dock.
- **Card Geometry**:
  - **Connected Hero + Action Dock**: Top hero card (`border-radius: 26px 26px 0 0`) sits flush above the 4-column action dock (`border-radius: 0 0 26px 26px`) with a `1px` subtle seam, visually unifying balance and immediate actions.
  - **Grouped List Containers**: `border-radius: 24px`, `padding: 6px 0`, with `14px 16px` row padding and hairline dividers inset `64px` from the left (aligning with text, not icons).
- **Floating Bottom Navigation Bar**:
  - Positioned `fixed` at `bottom: 16px`, centered pill (`border-radius: 9999px`), height `64px`, `padding: 6px`.
  - Houses 4 equal tabs: **Wallet**, **Market**, **Assistant**, and **Settings**. Active tab receives a solid pill highlight (`--accent-primary` in Dark mode or soft mint-tinted capsule `#E3F5EA` in Light mode).

---

## 5. Screen-by-Screen Specifications

### 5.1 Top Bar (Persistent on Wallet Home)

- **Left**: Wallet Selector Pill (`OneZeroWallet ⌄`) opening a bottom-sheet switcher (`OneZeroWallet`, `Vault Savings [Shell]`, `+ Add / Import Wallet [Shell]`). Shows an inline `Testnet` badge in Testnet mode.
- **Right Utility Cluster**: Three `36px × 36px` circular icon buttons:
  1. **Privacy Eye Toggle**: Masks/unmasks all balances and amounts across every screen with `••••`.
  2. **Theme Switcher**: Toggles between Mint Light Mode and Forest Dark Mode (`data-theme`).
  3. **Quick QR Button**: Opens the Receive / QR sheet directly.

### 5.2 Wallet Home Screen

1. **Hero Balance Card**: Canary-yellow surface displaying a top currency pill (`USD ⌄` cycling display), oversized tabular balance from `/api/ton/portfolio`, and bottom 24h PnL pill (`↑ $421.03 (+1.59%)`). Truncated copyable `0Q...` address pill at bottom right.
2. **4-Column Action Dock**: Connected directly beneath the hero card with four equal tap targets: **Deposit** (Receive), **Send** (P2b Live Send), **Trade** (P3 Swap Shell), and **Earn** (P3 Staking Shell).
3. **Available Funds List**: Single rounded card containing vertical token rows (`TON` + live Jettons). Multichain mode includes static `TRX` / `ETH` rows; `ton-native-only` filters strictly to TON assets. Tapping any row opens the **Coin Detail Screen**.
4. **Activity / Transactions List**: Single rounded card with centered date pill dividers (`November 21`), circular directional status badges (`↗` Sent, `↙` Received, `⇄` Swapped, `Bounced`, `Pending`), counterparty address & timestamp (`to TB53…wKxS · 01:25`), and signed token + fiat amounts. Tapping any row opens the **Transaction Detail Screen**.

### 5.3 Action Sub-Screens (`< Back` Header Pattern)

All secondary screens share a standardized top bar: `< Back` pill button on the left, centered bold screen title, and an optional overflow (`•••`) pill on the right.

- **Deposit (`Fund`) Screen**:
  - Horizontal network selector pills (`TON` active with live `0Q...` address + `200×200` inline-SVG QR card + copy toast; `TRON`/`EVM` active in multichain mode; extra network pills like `Solana`/`BNB`/`Base` marked as `"Coming soon"` shells).
  - 3-row grouped action card: **Buy with Card**, **Buy with Crypto**, **Create Deposit Link** (rendered as clean non-functional `"Coming soon"` triggers).
- **Send / Sell Screen**:
  - Centered segmented pill toggle switching between **Send** and **Sell** modes.
  - **Send Mode (Live P2b)**: Live address validation, `Max` balance helper, token selector, comment field, and pre-sign Emulation Review screen (`First send — deploys Wallet V5R1`, simulated fee & balance deltas, fail-closed warnings) launching broadcast.
  - **Sell Mode (UI Shell)**: Designed payout UI shell with a `"Coming soon"` disabled CTA.
- **Trade Screen (UI Shell — P3 Placeholder)**:
  - **You Sell** card with `Max` balance helper, numeric input, and token picker.
  - Overlapping `40px` circular blue/accent **Flip (`↑↓`)** button centered between cards.
  - **You Buy** card with output calculation line and target token picker.
  - Expandable `Details >` accordion showing placeholder exchange rate, slippage tolerance (`0.5%`), route, and network fee, above a `"Coming in P3"` disabled CTA.
- **Earn (`Add Stake`) Screen (UI Shell — P3 Placeholder)**:
  - **Amount** input well with `Max` fill, fiat conversion line, and fee estimate (`Fee ~ 0.02`).
  - **Staking Details** grouped card with `Current APY` green pill badge (`13.62%`), live `Est. Yearly Earnings`, `Total Staked`, `Total Stakers`, and an expandable `Why this is safe` explainer above a `"Coming in P3"` disabled CTA.

### 5.4 Coin Detail Screen

- **Header & Identity**: `< Back` button, centered coin name (`Toncoin`), `56px` circular token icon, large token balance, and fiat value + 24h change.
- **4-Button Action Grid**: `Buy` (shell), `Sell` (shell), `Fund` (opens Deposit), `Send` (pre-fills Send screen for this token).
- **Interactive Price Chart Card (Preview Shell)**:
  - Historical start price on left, current price on right.
  - Smooth SVG area spline with timeframe selector pills (`All`, `Y`, `3M`, `M`, `W`, `D`) clearly tagged as static preview data.
- **Info & Tokenomics Card**: Project description, social link pills (`𝕏 X`, `Telegram`, `Website`), and key-value rows (`Market Cap`, `Circulating Supply`).
- **Filtered Coin Activity**: Real date-grouped transaction history filtered exclusively to the selected token.

### 5.5 Transaction Detail Screen (Live)

- **Header**: `< Back` button, status title (`Sent`, `Received`, `Swapped`, `Bounced`), and timestamp subtitle.
- **Hero Amount Pill**: Rounded container (`border-radius: 22px`) tinted neutral for outgoing/swapped and soft emerald (`--status-positive-bg`) for incoming, rendering integer digits at `36px` and decimal + ticker at `18px` (`+64.958387 TON`), paired with a smaller fiat value pill below.
- **Address & Hash Cards**:
  - **Recipient / Sender**: Full address displaying first 6 and last 6 characters in `--text-primary` and middle characters dimmed in `--text-muted`, plus one-tap copy.
  - **Transaction ID**: Full 64-character hex hash with tap-to-copy feedback and `testnet.tonviewer.com` link.
- **Bottom Action**: Centered `Repeat` pill button (pre-fills Send screen with recipient and token) or `Share Receipt` for incoming transfers.

### 5.6 Settings & Supporting Tabs

- **Settings Screen**: Centered `64px` circular wallet monogram badge (`OZ`), wallet name + live balance (`OneZeroWallet · $26,887.09`), copyable address, `+ Add / Import Wallet` card shell, `Portfolio` analytics shell, and grouped settings list:
  - **Working Items**: **Appearance** (Light/Dark toggle), **Security** (Change PIN, Biometrics toggle, Auto-Lock timer, Reveal Recovery Phrase, Test Backup, Wipe Wallet).
  - **UI Shell Items**: **Assets & Activity**, **Subwallets**, **Sounds**, **Language** (marked as `"Coming soon"` shells).
- **Market Tab (UI Shell)**: Live search bar, category filter chips (`All`, `Top Gainers`, `Layer 1`, `DeFi`), and static preview coin rows clearly tagged `"Preview — live market data coming soon"` (tapping opens Coin Detail shell).
- **Assistant Tab (UI Shell)**: Conversational AI chat layout with quick-prompt chips (_"Analyze my portfolio"_, _"Best staking yield"_, _"Explain TON fees"_) and a clean `"Coming soon"` banner with disabled input field (no fake AI responses pretending to access private wallet keys).

### 5.7 Onboarding, Create Wallet & Import Wallet Flows

- **Onboarding Screen**: Circular canary-citron `10` monogram emblem (inline SVG with subtle sparkles), **OneZeroWallet** title, _"More about OneZeroWallet ›"_ self-custody info modal (containing non-custodial risk disclosure & _"We will never ask for your recovery phrase."_), **Create New Wallet** primary pill CTA, and **Import Existing Wallet** bottom sheet trigger.
- **Create Wallet Flow (2 Steps — Security Precedence)**:
  1. **Recovery Phrase (Step 1 of 2)**: 24-word recovery phrase displayed in a 2-column numbered grid (`1–12` | `13–24`) with tap-to-reveal protection, auto-hide on window blur, **no copy-to-clipboard**, and required _"I've stored the seed phrase in a secure place."_ checkbox. No mandatory 3-word verification during creation (kept inside Settings → **Test backup**).
  2. **4-Digit PIN (Step 2 of 2)**: 4-digit numeric PIN setup + confirmation sealing the crypto-vault via uncontrolled inputs.
- **Import Wallet Flow (2 Steps — Security Precedence)**:
  1. **Import Method & Word Grid (Step 1 of 2)**: Import method bottom sheet (**Secret Words** active; **View Any Address** UI shell marked coming soon), leading to the 12/24 secret word input grid with smart paste, wordlist validation, and auto-detection (`bip39-multichain` vs `ton-native-only`).
  2. **4-Digit PIN (Step 2 of 2)**: 4-digit numeric PIN setup + confirmation sealing the vault.

---

## 6. Motion & Micro-Interactions

- **Screen Transitions**: Smooth horizontal slide/fade (`220ms cubic-bezier(0.22, 1, 0.36, 1)`) when drilling into Coin Detail, Transaction Detail, or Action flows.
- **Tactile Press Feedback**: All interactive cards, list rows, and buttons apply `transform: scale(0.98)` on `:active` (`120ms ease-out`).
- **Toast Notifications**: Floating top/bottom pill toast (`Copied to clipboard`, `Transaction submitted`) with automatic `2.2s` dismissal.
