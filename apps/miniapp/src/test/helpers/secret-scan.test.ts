import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirectory, collectFiles } from './secret-scan';

describe('secret scanner (negative tests: it must catch injected secrets)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scan-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws when the directory does not exist (no vacuous pass)', () => {
    expect(() => scanDirectory(join(dir, 'missing'))).toThrow(/does not exist/);
  });

  it('throws when the directory has no scannable files (no vacuous pass)', () => {
    writeFileSync(join(dir, 'notes.txt'), 'nothing to scan');
    expect(() => scanDirectory(dir)).toThrow(/no scannable files/);
  });

  it('passes on clean content', () => {
    writeFileSync(join(dir, 'a.js'), 'console.log("hello");');
    expect(scanDirectory(dir)).toEqual([]);
  });

  it('does NOT flag library identifier names such as xpriv (false-positive regression)', () => {
    writeFileSync(join(dir, 'a.js'), 'return HDKey.fromExtendedKey(json.xpriv);');
    expect(scanDirectory(dir)).toEqual([]);
  });

  it('catches an injected 12-word test mnemonic', () => {
    writeFileSync(join(dir, 'a.js'), `x="${'abandon '.repeat(11)}about"`);
    expect(scanDirectory(dir).join('\n')).toContain('BIP-39 test mnemonic');
  });

  it('catches an injected long hex string', () => {
    writeFileSync(join(dir, 'nested.js'), `x="${'ab'.repeat(64)}"`);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.js'), `x="${'cd'.repeat(64)}"`);
    const issues = scanDirectory(dir);
    expect(issues.some((i) => i.includes('nested.js') && i.includes('hex'))).toBe(true);
    expect(issues.some((i) => i.includes('b.js') && i.includes('hex'))).toBe(true);
  });

  it('catches an injected GitHub token and PEM key', () => {
    writeFileSync(join(dir, 'a.js'), `t="ghp_${'A'.repeat(36)}"`);
    writeFileSync(join(dir, 'b.html'), '-----BEGIN EC PRIVATE KEY-----');
    const issues = scanDirectory(dir).join('\n');
    expect(issues).toContain('GitHub token');
    expect(issues).toContain('PEM-encoded private key');
  });

  it('issue strings never contain the matched secret text', () => {
    const hex = 'ab'.repeat(64);
    writeFileSync(join(dir, 'a.js'), `x="${hex}"`);
    expect(scanDirectory(dir).join('\n')).not.toContain(hex);
  });

  it('collectFiles throws when the target is a file, not a directory', () => {
    const f = join(dir, 'a.js');
    writeFileSync(f, '1');
    expect(() => collectFiles(f)).toThrow(/not a directory/);
  });
});
