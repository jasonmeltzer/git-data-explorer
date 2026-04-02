import { describe, it, expect } from 'vitest';
import { pctDelta, formatNum } from '../../lib/deltaFormat.js';

describe('pctDelta', () => {
  it('returns +50% positive for a 50% increase', () => {
    const result = pctDelta(100, 150);
    expect(result).toEqual({ str: '+50%', positive: true });
  });

  it('returns -50% negative for a 50% decrease', () => {
    const result = pctDelta(100, 50);
    expect(result).toEqual({ str: '-50%', positive: false });
  });

  it('returns N/A positive when before is zero (zero-divide guard)', () => {
    const result = pctDelta(0, 50);
    expect(result).toEqual({ str: 'N/A', positive: true });
  });

  it('returns -20% positive when lowerIsBetter and value decreases', () => {
    const result = pctDelta(100, 80, true);
    expect(result).toEqual({ str: '-20%', positive: true });
  });

  it('returns +20% negative when lowerIsBetter and value increases', () => {
    const result = pctDelta(100, 120, true);
    expect(result).toEqual({ str: '+20%', positive: false });
  });

  it('returns +0% positive for no change', () => {
    const result = pctDelta(100, 100);
    expect(result).toEqual({ str: '+0%', positive: true });
  });

  it('returns +0% positive for no change when lowerIsBetter (0% equals zero so pct <= 0 is true)', () => {
    const result = pctDelta(100, 100, true);
    expect(result).toEqual({ str: '+0%', positive: true });
  });
});

describe('formatNum', () => {
  it('returns 2 decimal places for small non-zero values (< 1)', () => {
    expect(formatNum(0.5)).toBe('0.50');
  });

  it('returns 1 decimal place for values < 100', () => {
    expect(formatNum(42.3)).toBe('42.3');
  });

  it('returns locale-formatted integer for large values', () => {
    expect(formatNum(1500)).toBe('1,500');
  });

  it('returns "0.0" for zero', () => {
    expect(formatNum(0)).toBe('0.0');
  });

  it('returns 2 decimal places for very small negative value', () => {
    expect(formatNum(-0.75)).toBe('-0.75');
  });
});
