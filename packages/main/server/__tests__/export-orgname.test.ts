import { describe, it, expect } from 'vitest';

// We import inferOrgName directly to test the inference algorithm
// This import will fail until we export it from export-service.ts
import { inferOrgName } from '../services/export-service.js';

describe('inferOrgName', () => {
  it('returns the single owner when all repos share one owner', () => {
    const result = inferOrgName(['acme/frontend', 'acme/backend']);
    expect(result).toBe('acme');
  });

  it('returns alphabetically-joined owners for multi-owner repos', () => {
    const result = inferOrgName(['acme/frontend', 'acme-research/tools']);
    expect(result).toBe('acme+acme-research');
  });

  it('returns null for empty repoNames', () => {
    const result = inferOrgName([]);
    expect(result).toBeNull();
  });

  it('returns null for malformed repoNames (no valid owners)', () => {
    const result = inferOrgName(['no-slash', '']);
    expect(result).toBeNull();
  });

  it('returns the owner for a single repo', () => {
    const result = inferOrgName(['acme/frontend']);
    expect(result).toBe('acme');
  });

  it('returns owners in alphabetical order regardless of input order', () => {
    const result = inferOrgName(['zebra/repo', 'alpha/repo']);
    expect(result).toBe('alpha+zebra');
  });
});
