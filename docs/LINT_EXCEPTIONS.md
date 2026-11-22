# Lint exceptions

Single-line exceptions, each with a written reason. Blanket disables are not allowed.

| File / rule                                                                                                         | Reason                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/chain-ton/src/wallet.ts` — `@typescript-eslint/no-unsafe-enum-assignment` on the V5R1 `sendMode` argument | `SendMode` is a bitmask enum; `PAY_GAS_SEPARATELY + IGNORE_ERRORS` is typed as `number`. The value is exactly the documented bitmask, and `WalletContractV5R1.createTransfer` accepts it at runtime. Typing the request as `number` keeps callers (Max = carry-all) able to pass any valid bitmask. |
