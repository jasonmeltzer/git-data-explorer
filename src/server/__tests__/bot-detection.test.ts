import { describe, it, expect } from 'vitest';
import { isBot, KNOWN_BOTS } from '../services/bot-detection.js';

describe('Bot Detection Service', () => {
  describe('isBot()', () => {
    it('detects bots by GitHub type field (signal 1)', () => {
      expect(isBot('dependabot[bot]', 'Bot')).toBe(true);
    });

    it('detects bots by [bot] suffix (signal 2)', () => {
      expect(isBot('renovate[bot]', 'User')).toBe(true);
    });

    it('detects bots by known-bots list (signal 3)', () => {
      expect(isBot('dependabot', undefined)).toBe(true);
    });

    it('detects bots with multiple signals (signal 2+3)', () => {
      expect(isBot('codecov[bot]', undefined)).toBe(true);
    });

    it('returns false for real developers', () => {
      expect(isBot('real-developer', 'User')).toBe(false);
    });

    it('returns false for real developers with mixed case', () => {
      expect(isBot('Real-Developer', 'User')).toBe(false);
    });

    it('detects bots with all three signals matching', () => {
      expect(isBot('github-actions[bot]', 'Bot')).toBe(true);
    });

    it('detects known bots without [bot] suffix', () => {
      expect(isBot('snyk-bot', undefined)).toBe(true);
    });

    it('is case insensitive on known list check', () => {
      expect(isBot('Dependabot', undefined)).toBe(true);
      expect(isBot('RENOVATE', undefined)).toBe(true);
    });

    it('does not false-positive on partial matches', () => {
      expect(isBot('my-dependabot-helper', 'User')).toBe(false);
    });

    it('handles null userType', () => {
      expect(isBot('dependabot[bot]', null)).toBe(true);
    });

    it('handles undefined userType for real users', () => {
      expect(isBot('alice', undefined)).toBe(false);
    });
  });

  describe('KNOWN_BOTS', () => {
    it('is a Set with expected bot entries', () => {
      expect(KNOWN_BOTS).toBeInstanceOf(Set);
      expect(KNOWN_BOTS.has('dependabot')).toBe(true);
      expect(KNOWN_BOTS.has('renovate')).toBe(true);
      expect(KNOWN_BOTS.has('github-actions')).toBe(true);
      expect(KNOWN_BOTS.has('snyk-bot')).toBe(true);
    });
  });
});
