import { describe, it, expect } from 'vitest';
import { assertIntegerArray, sqlIntList } from '../sql-safety.js';

describe('assertIntegerArray', () => {
  it('test 1: passes through valid positive integers in order', () => {
    expect(assertIntegerArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('test 2: rejects strings and NaN while keeping valid integers', () => {
    expect(assertIntegerArray([1, 'abc', 2, NaN, 3])).toEqual([1, 2, 3]);
  });

  it('test 3: rejects negative integers and zero, keeps positive', () => {
    expect(assertIntegerArray([-1, 0, 1])).toEqual([1]);
  });

  it('test 4: rejects floats, keeps whole integers', () => {
    expect(assertIntegerArray([1.5, 2, 3.14])).toEqual([2]);
  });

  it('test 5: returns empty array for empty input', () => {
    expect(assertIntegerArray([])).toEqual([]);
  });

  it('test 6: rejects numeric-looking strings even if they parse to integers', () => {
    expect(assertIntegerArray(['1', '2', '3'])).toEqual([]);
  });

  it('test 7: rejects null, undefined, boolean, and object values', () => {
    expect(assertIntegerArray([null, undefined, true, false, {}])).toEqual([]);
  });

  it('test 8: accepts MAX_SAFE_INTEGER but rejects MAX_SAFE_INTEGER + 1', () => {
    expect(assertIntegerArray([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]))
      .toEqual([Number.MAX_SAFE_INTEGER]);
  });

  it('test 12 (injection): rejects SQL injection string', () => {
    expect(assertIntegerArray(["1) UNION SELECT 1; DROP TABLE orgs;--"])).toEqual([]);
  });

  it('test 13 (order preservation): preserves valid entries in original order', () => {
    expect(assertIntegerArray([3, 'x', 1, 2])).toEqual([3, 1, 2]);
  });
});

describe('sqlIntList', () => {
  it('test 9: formats valid integer array as comma-separated string', () => {
    expect(sqlIntList([1, 2, 3])).toBe('1,2,3');
  });

  it('test 10: returns empty string for empty array', () => {
    expect(sqlIntList([])).toBe('');
  });

  it('test 11: filters out non-integers and formats remaining', () => {
    expect(sqlIntList([1, 'abc' as any, 2])).toBe('1,2');
  });
});
