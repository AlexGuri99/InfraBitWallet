/**
 * Device-preference storage: the pre-rename `ozw.*` keys migrate to `infrabit.*` on first read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_LOCK_KEY, readPreference } from '../ui/preferences';

const ALL_KEYS = [
  'ozw.theme',
  'ozw.privacy',
  'ozw.autoLockMs',
  'infrabit.theme',
  'infrabit.privacy',
  'infrabit.autoLockMs',
];

afterEach(() => {
  for (const key of ALL_KEYS) localStorage.removeItem(key);
});

describe('preference storage', () => {
  it('migrates a legacy ozw.* value to infrabit.* and removes the old key', () => {
    localStorage.setItem('ozw.theme', 'dark');
    expect(readPreference('infrabit.theme')).toBe('dark');
    expect(localStorage.getItem('infrabit.theme')).toBe('dark');
    expect(localStorage.getItem('ozw.theme')).toBeNull();
  });

  it('migrates the auto-lock key used by App and Settings', () => {
    expect(AUTO_LOCK_KEY).toBe('infrabit.autoLockMs');
    localStorage.setItem('ozw.autoLockMs', '60000');
    expect(readPreference(AUTO_LOCK_KEY)).toBe('60000');
    expect(localStorage.getItem('ozw.autoLockMs')).toBeNull();
  });

  it('prefers the new key and leaves the legacy key alone when both exist', () => {
    localStorage.setItem('infrabit.privacy', '0');
    localStorage.setItem('ozw.privacy', '1');
    expect(readPreference('infrabit.privacy')).toBe('0');
    expect(localStorage.getItem('ozw.privacy')).toBe('1');
  });

  it('returns null when neither key exists', () => {
    expect(readPreference('infrabit.theme')).toBeNull();
  });
});
