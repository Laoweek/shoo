import { describe, expect, it } from 'vitest';
import { RULE_KINDS, SUPPORTED_SURFACES, SURFACE_IDS } from './types';

describe('domain constants', () => {
  it('lists every Surface and the three supported in v1', () => {
    expect(SURFACE_IDS).toHaveLength(6);
    expect(SUPPORTED_SURFACES).toEqual(['home', 'watchSidebar', 'shortsShelf']);
    expect(RULE_KINDS).toContain('membersOnly');
  });
});
