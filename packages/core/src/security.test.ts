import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface VercelHeader {
  key: string;
  value: string;
}

interface VercelHeaderRule {
  source: string;
  headers: VercelHeader[];
}

function getCsp(): string {
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const vercelPath = resolve(selfDir, '..', '..', '..', 'vercel.json');
  const raw: string = readFileSync(vercelPath, 'utf-8');
  const cfg: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>;
  const rawHeaders = cfg['headers'];
  const headers: VercelHeaderRule[] = Array.isArray(rawHeaders)
    ? (rawHeaders as VercelHeaderRule[])
    : [];
  const cspEntry = headers.find((h) => h.source === '/(.*)');
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const cspHeader = cspEntry?.headers?.find(
    (h) => h.key.toLowerCase() === 'content-security-policy',
  );
  return cspHeader?.value ?? '';
}

describe('Vercel CSP headers', () => {
  const csp = getCsp();

  it('should contain Content-Security-Policy header', () => {
    expect(csp).toBeTruthy();
  });

  it('should not allow unsafe-inline in script-src', () => {
    const scriptSrc = csp.split(';').find((p) => p.trim().startsWith('script-src'));
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc?.toLowerCase()).not.toContain("'unsafe-inline'");
  });

  it('should not allow unsafe-eval (but wasm-unsafe-eval is allowed)', () => {
    // 'wasm-unsafe-eval' IS allowed (needed for hash-wasm's WebAssembly Argon2id).
    // But plain 'unsafe-eval' is still forbidden.
    const tokens = csp.split(/['"]?\s+['"]?/);
    for (const token of tokens) {
      const t = token.trim().toLowerCase();
      if (t === "'unsafe-eval'" || t === "unsafe-eval") {
        expect(true).toBe(false);
      }
    }
  });

  it('should have frame-ancestors directive', () => {
    expect(csp).toContain('frame-ancestors');
  });

  it('should not set frame-ancestors to none', () => {
    const fa = csp.split(';').find((p) => p.trim().startsWith('frame-ancestors'));
    expect(fa).toBeTruthy();
    expect(fa?.toLowerCase()).not.toContain("'none'");
    expect(fa?.toLowerCase()).not.toContain('none');
  });

  it('should allow Telegram origins in frame-ancestors', () => {
    const fa = csp.split(';').find((p) => p.trim().startsWith('frame-ancestors'));
    expect(fa).toBeTruthy();
    expect(fa?.toLowerCase()).toContain('web.telegram.org');
    expect(fa?.toLowerCase()).toContain('t.me');
  });

  it('should have base-uri set to self', () => {
    expect(csp).toContain("base-uri 'self'");
  });

  it('should have form-action set to self', () => {
    expect(csp).toContain("form-action 'self'");
  });
});
