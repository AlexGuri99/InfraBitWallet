import { describe, it, expect } from 'vitest';
import vercelConfig from '../../vercel.json' with { type: 'json' };

describe('Vercel CSP headers', () => {
  const cspEntry = vercelConfig.headers?.find((h: { source: string }) => h.source === '/(.*)');
  const cspHeader = cspEntry?.headers?.find(
    (h: { key: string }) => h.key.toLowerCase() === 'content-security-policy',
  );
  const csp = cspHeader?.value ?? '';

  it('should contain Content-Security-Policy header', () => {
    expect(csp).toBeTruthy();
  });

  it('should not allow unsafe-inline in script-src', () => {
    const scriptSrc = csp.split(';').find((p: string) => p.trim().startsWith('script-src'));
    expect(scriptSrc).toBeTruthy();
    expect(scriptSrc!.toLowerCase()).not.toContain("'unsafe-inline'");
  });

  it('should not allow unsafe-eval anywhere', () => {
    expect(csp.toLowerCase()).not.toContain("'unsafe-eval'");
  });

  it('should have frame-ancestors directive', () => {
    expect(csp).toContain('frame-ancestors');
  });

  it('should not set frame-ancestors to none', () => {
    const fa = csp.split(';').find((p: string) => p.trim().startsWith('frame-ancestors'));
    expect(fa).toBeTruthy();
    expect(fa!.toLowerCase()).not.toContain("'none'");
    expect(fa!.toLowerCase()).not.toContain('none');
  });

  it('should allow Telegram origins in frame-ancestors', () => {
    const fa = csp.split(';').find((p: string) => p.trim().startsWith('frame-ancestors'));
    expect(fa).toBeTruthy();
    expect(fa!.toLowerCase()).toContain('web.telegram.org');
    expect(fa!.toLowerCase()).toContain('t.me');
  });

  it('should have base-uri set to self', () => {
    expect(csp).toContain("base-uri 'self'");
  });

  it('should have form-action set to self', () => {
    expect(csp).toContain("form-action 'self'");
  });
});