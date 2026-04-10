/**
 * Anonymization utilities for the data export feature.
 *
 * - buildPseudonymMap: maps contributor logins to random animal names (unique per export)
 * - buildRepoMap: maps repo full names to Repo-Alpha, Repo-Beta, etc.
 * - anonymizeBundle: applies both maps to a deep-cloned ExportBundle
 */

import type { ExportBundle } from '../../shared/export-types.js';

// ─── Animal name components ───────────────────────────────────────────────────

const ADJECTIVES: string[] = [
  'Amber', 'Azure', 'Coral', 'Crimson', 'Crystal',
  'Dusk', 'Emerald', 'Frost', 'Golden', 'Ivory',
  'Jade', 'Lunar', 'Misty', 'Onyx', 'Pearl',
  'Rose', 'Ruby', 'Silver', 'Steel', 'Teal',
];

const ANIMALS: string[] = [
  'Bear', 'Crane', 'Dolphin', 'Eagle', 'Falcon',
  'Fox', 'Hawk', 'Heron', 'Jaguar', 'Lynx',
  'Otter', 'Owl', 'Panther', 'Puma', 'Raven',
  'Seal', 'Tiger', 'Viper', 'Wolf', 'Wren',
];

/**
 * 400 unique animal names produced by the full cross-product of ADJECTIVES × ANIMALS.
 * Exported for testing (verify count and uniqueness).
 */
export const ANIMAL_NAMES: string[] = ADJECTIVES.flatMap(a => ANIMALS.map(b => `${a} ${b}`));

// ─── Greek letters for repo pseudonyms ───────────────────────────────────────

const GREEK_LETTERS: string[] = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
  'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa',
  'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron',
  'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon',
  'Phi', 'Chi', 'Psi', 'Omega',
];

// ─── Fisher-Yates shuffle ─────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a pseudonym map for contributor logins.
 *
 * - Deduplicates and sorts logins alphabetically (stable ordering within one export).
 * - Shuffles ANIMAL_NAMES randomly so the same login gets a different name per export.
 * - Handles overflow beyond 400 names by appending " 2", " 3", etc.
 *
 * @param logins - Array of contributor login strings (may contain duplicates)
 * @returns Map from login → pseudonym string
 */
export function buildPseudonymMap(logins: string[]): Map<string, string> {
  const unique = Array.from(new Set(logins)).sort();
  if (unique.length === 0) return new Map();

  const shuffled = shuffleArray(ANIMAL_NAMES);
  const map = new Map<string, string>();

  for (let i = 0; i < unique.length; i++) {
    const base = shuffled[i % ANIMAL_NAMES.length];
    const cycle = Math.floor(i / ANIMAL_NAMES.length);
    const name = cycle === 0 ? base : `${base} ${cycle + 1}`;
    map.set(unique[i], name);
  }

  return map;
}

/**
 * Build a pseudonym map for repo full names.
 *
 * - Deduplicates and sorts repo names alphabetically.
 * - Maps to Repo-Alpha, Repo-Beta, ..., Repo-Omega, then Repo-Alpha 2, etc.
 *
 * @param repoFullNames - Array of repo full names (e.g. 'org/repo-name')
 * @returns Map from repoFullName → pseudonym string
 */
export function buildRepoMap(repoFullNames: string[]): Map<string, string> {
  const unique = Array.from(new Set(repoFullNames)).sort();
  if (unique.length === 0) return new Map();

  const map = new Map<string, string>();

  for (let i = 0; i < unique.length; i++) {
    const base = GREEK_LETTERS[i % GREEK_LETTERS.length];
    const cycle = Math.floor(i / GREEK_LETTERS.length);
    const name = cycle === 0 ? `Repo-${base}` : `Repo-${base} ${cycle + 1}`;
    map.set(unique[i], name);
  }

  return map;
}

/**
 * Apply pseudonym and repo maps to a deep-cloned ExportBundle.
 *
 * Replaces:
 * - authorLogin fields on ContributorBeforeAfterStats rows
 * - metadata.repoNames entries
 *
 * Does NOT mutate the original bundle.
 */
export function anonymizeBundle(
  bundle: ExportBundle,
  pseudonymMap: Map<string, string>,
  repoMap: Map<string, string>
): ExportBundle {
  // Deep clone via JSON round-trip (safe for the data types used in ExportBundle)
  const cloned: ExportBundle = JSON.parse(JSON.stringify(bundle));

  // Anonymize contributor logins
  for (const contrib of cloned.contributors) {
    if (contrib.authorLogin && pseudonymMap.has(contrib.authorLogin)) {
      contrib.authorLogin = pseudonymMap.get(contrib.authorLogin)!;
    }
    if (contrib.pre && pseudonymMap.has((contrib.pre as { authorLogin: string }).authorLogin)) {
      (contrib.pre as { authorLogin: string }).authorLogin =
        pseudonymMap.get((contrib.pre as { authorLogin: string }).authorLogin)!;
    }
    if (contrib.post && pseudonymMap.has((contrib.post as { authorLogin: string }).authorLogin)) {
      (contrib.post as { authorLogin: string }).authorLogin =
        pseudonymMap.get((contrib.post as { authorLogin: string }).authorLogin)!;
    }
  }

  // Anonymize repo names in metadata
  cloned.metadata.repoNames = cloned.metadata.repoNames.map(
    name => repoMap.get(name) ?? name
  );

  return cloned;
}
