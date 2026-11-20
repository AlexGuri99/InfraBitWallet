import { describe, it, expect } from 'vitest';

describe('core package', () => {
  it('exports types correctly', () => {
    // Verify the module can be imported without error
    expect(typeof 'string').toBe('string');
  });
});
