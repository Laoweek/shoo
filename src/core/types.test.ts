import { describe, expect, it } from 'vitest';
import { RULE_KINDS, SUPPORTED_SURFACES, SURFACE_IDS } from './types';

describe('domain constants', () => {
  it("lists every Surface, YouTube's three supported in v1 and Bilibili's Home", () => {
    expect(SURFACE_IDS).toHaveLength(8);
    expect(SUPPORTED_SURFACES).toEqual(['home', 'watchSidebar', 'shortsShelf', 'bilibiliHome']);
    expect(RULE_KINDS).toContain('membersOnly');
  });
});
