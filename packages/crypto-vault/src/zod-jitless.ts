/**
 * Configure zod for a strict CSP before any @ton module that may use it is evaluated.
 *
 * zod's validator JIT calls `Function("")` as a capability probe; under a CSP without
 * 'unsafe-eval' Chromium reports that as a script-src violation. `jitless` makes zod take the
 * non-JIT path. This module must be imported BEFORE @ton/ton (which depends on zod) so the
 * global config is set before zod's lazy `allowsEval` probe runs.
 *
 * Source: zod v4 global config (`z.config({ jitless })`).
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
