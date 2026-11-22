# @onezerowallet/api

Stateless API service for OneZeroWallet. Not deployed yet; the P2 TON read proxy lands here.

## Environment variables (server-only)

Copy the names below into `services/api/.env.local` (gitignored) or set them as Vercel
Environment Variables for the API project. Never put them in the Mini App, in any `VITE_*`
variable, in a URL, in docs, in tests or in chat.

| Variable                    | Meaning                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `TON_NETWORK`               | `testnet` (default) or `mainnet`. Mainnet requires the owner's explicit approval. |
| `TON_DATA_PROVIDER`         | `toncenter` (default) or `tonapi`.                                                |
| `TONCENTER_TESTNET_API_KEY` | TON Center testnet key, sent as `X-API-Key` to `https://testnet.toncenter.com`.   |
| `TONCENTER_API_KEY`         | TON Center mainnet key; only used when `TON_NETWORK=mainnet`.                     |
| `TONAPI_API_KEY`            | TonAPI key, sent as `Authorization: Bearer …`.                                    |

Empty/whitespace values mean "not configured" and the public endpoints are used with lower
rate limits. Configuration loading and header construction live in `src/config.ts`
(`loadServerConfig`, `providerRequestHeaders`, `providerBaseUrl`).

Local runs do not load `.env.local` automatically yet: pass it explicitly, e.g.
`node --env-file=.env.local …`, or export the variables in your shell. Vercel injects them.
