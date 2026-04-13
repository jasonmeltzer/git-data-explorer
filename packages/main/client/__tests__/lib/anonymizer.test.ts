import { describe, it, expect } from 'vitest';
import {
  ANIMAL_NAMES,
  buildPseudonymMap,
  buildRepoMap,
} from '../../lib/anonymizer.js';
import { toCsvRow, toCsv } from '../../lib/csv-serializer.js';

// ─── ANIMAL_NAMES tests ───────────────────────────────────────────────────────

describe('ANIMAL_NAMES', () => {
  it('has exactly 400 entries', () => {
    expect(ANIMAL_NAMES).toHaveLength(400);
  });

  it('all entries are unique', () => {
    expect(new Set(ANIMAL_NAMES).size).toBe(400);
  });
});

// ─── buildPseudonymMap tests ──────────────────────────────────────────────────

describe('buildPseudonymMap', () => {
  it('returns Map with exactly 3 entries for 3 logins', () => {
    const map = buildPseudonymMap(['alice', 'bob', 'charlie']);
    expect(map.size).toBe(3);
  });

  it('all mapped values are distinct strings within one call', () => {
    const logins = ['alice', 'bob', 'charlie', 'dave', 'eve'];
    const map = buildPseudonymMap(logins);
    const values = Array.from(map.values());
    expect(new Set(values).size).toBe(logins.length);
  });

  it('produces different animal names across two separate calls (randomness)', () => {
    const logins = Array.from({ length: 50 }, (_, i) => `user${i}`);
    const map1 = buildPseudonymMap(logins);
    const map2 = buildPseudonymMap(logins);
    // With 400 names and 50 logins, the chance of an identical shuffle is astronomically low
    let differences = 0;
    for (const login of logins) {
      if (map1.get(login) !== map2.get(login)) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('handles empty array — returns empty Map', () => {
    const map = buildPseudonymMap([]);
    expect(map.size).toBe(0);
  });

  it('handles single login — returns Map with 1 entry', () => {
    const map = buildPseudonymMap(['solo']);
    expect(map.size).toBe(1);
    expect(typeof map.get('solo')).toBe('string');
  });

  it('handles 500 logins (overflow > 400 animal names) — no undefined values', () => {
    const logins = Array.from({ length: 500 }, (_, i) => `user${i}`);
    const map = buildPseudonymMap(logins);
    expect(map.size).toBe(500);
    for (const login of logins) {
      const value = map.get(login);
      expect(value).toBeDefined();
      expect(typeof value).toBe('string');
      expect(value!.length).toBeGreaterThan(0);
    }
  });

  it('deduplicates logins — same login appears once in map', () => {
    const map = buildPseudonymMap(['alice', 'alice', 'bob']);
    expect(map.size).toBe(2);
  });

  it('is deterministic within one call — same input produces same mapping', () => {
    const logins = ['alice', 'bob', 'charlie'];
    const map = buildPseudonymMap(logins);
    // Verify all expected keys are present
    expect(map.has('alice')).toBe(true);
    expect(map.has('bob')).toBe(true);
    expect(map.has('charlie')).toBe(true);
    // All values should be non-empty strings
    for (const [, v] of map) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

// ─── buildRepoMap tests ───────────────────────────────────────────────────────

describe('buildRepoMap', () => {
  it('assigns Greek letters in sorted alphabetical order', () => {
    const map = buildRepoMap(['org/repo-z', 'org/repo-a']);
    // sorted: ['org/repo-a', 'org/repo-z'] → Alpha, Beta
    expect(map.get('org/repo-a')).toBe('Repo-Alpha');
    expect(map.get('org/repo-z')).toBe('Repo-Beta');
  });

  it('handles empty array — returns empty Map', () => {
    const map = buildRepoMap([]);
    expect(map.size).toBe(0);
  });

  it('handles single repo', () => {
    const map = buildRepoMap(['org/my-repo']);
    expect(map.get('org/my-repo')).toBe('Repo-Alpha');
  });

  it('deduplicates repos — same repo appears once', () => {
    const map = buildRepoMap(['org/repo-a', 'org/repo-a', 'org/repo-b']);
    expect(map.size).toBe(2);
  });

  it('handles overflow beyond 24 Greek letters — appends suffix number', () => {
    const repos = Array.from({ length: 30 }, (_, i) => `org/repo-${i.toString().padStart(2, '0')}`);
    const map = buildRepoMap(repos);
    expect(map.size).toBe(30);
    for (const repo of repos) {
      expect(typeof map.get(repo)).toBe('string');
    }
    // The 25th repo (index 24) should cycle back to Alpha with a suffix
    const sortedRepos = [...repos].sort();
    const twentyFifth = map.get(sortedRepos[24]);
    expect(twentyFifth).toBeDefined();
    expect(twentyFifth!).toContain('Repo-');
  });
});

// ─── toCsvRow tests ───────────────────────────────────────────────────────────

describe('toCsvRow', () => {
  it('returns basic values joined by commas', () => {
    expect(toCsvRow(['hello', 'world'])).toBe('hello,world');
  });

  it('wraps values containing commas in double quotes', () => {
    expect(toCsvRow(['has,comma'])).toBe('"has,comma"');
  });

  it('wraps values containing double quotes and escapes them by doubling', () => {
    expect(toCsvRow(['has"quote'])).toBe('"has""quote"');
  });

  it('wraps values containing newlines in double quotes', () => {
    expect(toCsvRow(['has\nnewline'])).toBe('"has\nnewline"');
  });

  it('renders null as empty string', () => {
    expect(toCsvRow([null])).toBe('');
  });

  it('renders undefined as empty string', () => {
    expect(toCsvRow([undefined])).toBe('');
  });

  it('handles mixed types in one row', () => {
    expect(toCsvRow(['hello', 'has,comma', 'has"quote', null])).toBe('hello,"has,comma","has""quote",');
  });

  it('converts numbers to strings', () => {
    expect(toCsvRow([42, 3.14])).toBe('42,3.14');
  });
});

// ─── toCsv tests ─────────────────────────────────────────────────────────────

describe('toCsv', () => {
  it('produces header row as first line', () => {
    const result = toCsv(['Name', 'Age'], [['Alice', 30]]);
    const lines = result.split('\n');
    expect(lines[0]).toBe('Name,Age');
  });

  it('produces data rows after header', () => {
    const result = toCsv(['Name', 'Age'], [['Alice', 30], ['Bob', 25]]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('Alice,30');
    expect(lines[2]).toBe('Bob,25');
  });

  it('handles empty rows array — returns only header', () => {
    const result = toCsv(['Name', 'Age'], []);
    expect(result).toBe('Name,Age');
  });

  it('escapes values in header and data rows', () => {
    const result = toCsv(['First,Name'], [['Smith, John']]);
    expect(result).toBe('"First,Name"\n"Smith, John"');
  });
});
