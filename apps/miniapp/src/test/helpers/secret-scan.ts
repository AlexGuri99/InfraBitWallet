/**
 * Secret scanner for build output.
 *
 * Fails closed: a missing directory, a non-directory, or a directory with no
 * scannable files is an error (never a vacuous pass).
 *
 * The rules look for secret VALUES, not identifier names. Libraries such as
 * @scure/bip32 legitimately contain property names like `xpriv`, so a bare
 * substring match on names would be a false positive.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * SHA-256 of long hex literals that are known NOT to be secrets, keyed by the exact literal.
 * Hashing the match (rather than allowlisting a prefix) means any change to the literal fails
 * the scan and forces a review.
 *
 * - 4692…886a: the Wallet V5R1 contract code cell (BOC hex) embedded by @ton/ton (MIT). It is
 *   public contract code, not key material. Source: @ton/ton WalletContractV5R1 constructor.
 */
export const ALLOWED_HEX_LITERALS_SHA256 = new Set([
  '469237e482c1835b5eaf4e0c9dbaae1cc825f6f5e90f547d85b93ec94a12886a',
]);

export interface ScanRule {
  pattern: RegExp;
  reason: string;
}

export const SECRET_RULES: ScanRule[] = [
  // 11 x "abandon" + "about" = the 12-word BIP-39 test mnemonic. (The previous pattern needed
  // 12 x "abandon" and so could never match it; caught by secret-scan.test.ts.)
  { pattern: /abandon (?:abandon ){10}about/, reason: 'BIP-39 test mnemonic (12 words)' },
  {
    pattern: /test test test test test test test test test test test junk/,
    reason: 'Hardhat default test mnemonic',
  },
  { pattern: /[0-9a-f]{128,}/i, reason: '512+ bit hex string (possible seed or private key)' },
  {
    pattern: /\b[xyzt]prv[1-9A-HJ-NP-Za-km-z]{100,}/,
    reason: 'BIP-32 extended private key value',
  },
  {
    pattern: /-----BEGIN (?:EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    reason: 'PEM-encoded private key',
  },
  { pattern: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}/, reason: 'Stripe secret key' },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,}/,
    reason: 'GitHub token',
  },
  { pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, reason: 'Telegram bot token' },
];

export const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.html', '.css', '.map', '.json'];

/** Recursively collect files with one of the extensions. Throws if `dir` is not a directory. */
export function collectFiles(dir: string, exts: string[] = DEFAULT_EXTENSIONS): string[] {
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new Error(`Scan directory does not exist: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`Scan target is not a directory: ${dir}`);
  }
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scan every file under `dir`. Returns issue strings (file + reason; never the
 * matched text). Throws if the directory is missing or contains no scannable files.
 */
export function scanDirectory(dir: string, exts: string[] = DEFAULT_EXTENSIONS): string[] {
  const files = collectFiles(dir, exts);
  if (files.length === 0) {
    throw new Error(`Scan directory has no scannable files (${exts.join(', ')}): ${dir}`);
  }
  const issues: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    for (const rule of SECRET_RULES) {
      if (rule.reason.includes('hex string')) {
        // Long hex: allow only exact reviewed literals (hashed), so the rule still catches any
        // other 512+ bit hex value. Compare case-insensitively because hex constants vary.
        const re = new RegExp(rule.pattern.source, 'gi');
        for (const match of content.matchAll(re)) {
          const hash = createHash('sha256').update(match[0].toLowerCase()).digest('hex');
          if (!ALLOWED_HEX_LITERALS_SHA256.has(hash)) {
            issues.push(`${file}: ${rule.reason}`);
            break;
          }
        }
        continue;
      }
      if (rule.pattern.test(content)) {
        issues.push(`${file}: ${rule.reason}`);
      }
    }
  }
  return issues;
}
