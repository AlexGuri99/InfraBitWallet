// API service entry — stateless, keyless Vercel API.
// Re-exports the server-only modules consumed by the TON read handlers.

export const API_VERSION = '0.0.1' as const;

export * from './config.js';
export * from './api-guard.js';
export * from './rate-limit.js';
export * from './telegram/auth.js';
export * from './ton/http.js';
export * from './ton/validation.js';
export * from './ton/service.js';
export * from './ton/write.js';
export * from './ton/swap.js';
export * from './ton/staking.js';
