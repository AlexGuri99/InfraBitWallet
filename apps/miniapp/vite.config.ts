import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CSP for Telegram Mini App embedding.
// frame-ancestors must allow https://web.telegram.org (Telegram Web) and https://t.me.
// Cannot use DENY — Telegram embeds the app in iframes.
// No unsafe-inline/unsafe-eval in script-src.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https:",
  "font-src 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://t.me",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    headers: {
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  },
});
