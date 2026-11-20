# OneZeroWallet — Security Headers

## Content-Security-Policy (CSP)

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' https:;
font-src 'self';
frame-ancestors 'self' https://web.telegram.org https://t.me;
base-uri 'self';
form-action 'self';
```

### Directive Rationale

| Directive         | Value                                          | Rationale                                                                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                       | Fallback for all resource types not explicitly listed. Only same-origin resources allowed by default.                                                                                                                                                                                       |
| `script-src`      | `'self'`                                       | Only scripts from our own origin. No `unsafe-inline` (blocks `<script>` tags with inline code) and no `unsafe-eval` (blocks `eval()`, `setTimeout(string)`, etc.). This is the key XSS mitigation as it prevents injection of arbitrary scripts.                                            |
| `style-src`       | `'self' 'unsafe-inline'`                       | Allows loading stylesheets from our own origin plus inline styles. `unsafe-inline` is required because Tailwind generates inline styles and Telegram theme parameters are applied via inline style attributes. This is an accepted risk — style injection cannot leak secrets.              |
| `img-src`         | `'self' data: https:`                          | Allows images from our origin, inline data URIs (for QR codes, icons), and HTTPS sources (for token logos, user avatars).                                                                                                                                                                   |
| `connect-src`     | `'self' https:`                                | Allows fetch/WebSocket to our origin and any HTTPS endpoint. Required for RPC calls to external providers (TON Center, TronGrid, Alchemy, etc.).                                                                                                                                            |
| `font-src`        | `'self'`                                       | Only fonts served from our origin. No Google Fonts or external font services.                                                                                                                                                                                                               |
| `frame-ancestors` | `'self' https://web.telegram.org https://t.me` | **Crucial for Telegram Mini Apps.** We must allow Telegram to embed the app in iframes. `web.telegram.org` is the Telegram Web client. `t.me` hosts Telegram instant-view pages and some Telegram WebK content. **Cannot use `DENY`** or `'none'` — that would break the Mini App entirely. |
| `base-uri`        | `'self'`                                       | Prevents injection of `<base>` tags that could hijack relative URLs.                                                                                                                                                                                                                        |
| `form-action`     | `'self'`                                       | Restricts form submissions to our own origin. Prevents phishing forms from submitting to attacker servers.                                                                                                                                                                                  |

### Source References

- Telegram Mini Apps embedding origin: `https://web.telegram.org` — confirmed in Telegram Mini Apps docs (core.telegram.org/bots/webapps, accessed 2026-11-20). See "DownloadFileParams" section which requires `Access-Control-Allow-Origin: https://web.telegram.org`.
- `https://t.me` is a known Telegram domain used for deep links and instant-view embeddings. Marked as UNVERIFIED for explicit iframe embedding — further testing needed.

## Other Headers

| Header                   | Value                                      | Rationale                                                                                                                              |
| ------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options` | `nosniff`                                  | Prevents MIME-type sniffing, reducing risk of drive-by download attacks.                                                               |
| `Referrer-Policy`        | `strict-origin-when-cross-origin`          | Only send full referrer to same-origin destinations; for cross-origin, send only origin. Mitigates referrer leakage of URL parameters. |
| `Permissions-Policy`     | `camera=(), microphone=(), geolocation=()` | Disables camera, microphone, and geolocation APIs. A wallet has no need for these, and disabling them reduces the attack surface.      |

## Vercel Implementation

See `vercel.json` — headers block applies these to all routes. CSP is also set in Vite dev server config (`vite.config.ts`) for local development consistency.

## Testing

A Vitest test in `packages/core/src/security.test.ts` parses `vercel.json` and asserts:

- No `unsafe-inline` in `script-src`
- No `unsafe-eval` anywhere in CSP
- `frame-ancestors` is present and not set to `'none'`
- `base-uri` is `'self'`
- `form-action` is `'self'`
