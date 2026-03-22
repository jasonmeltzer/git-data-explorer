import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// We test the token service functions directly
// Note: the module reads from process.cwd()/.env so we need to be careful
const ENV_PATH = path.join(process.cwd(), '.env');
const BACKUP_PATH = ENV_PATH + '.test-backup';

describe('Token Service (INFR-03)', () => {
  // Back up existing .env if present
  beforeEach(() => {
    if (fs.existsSync(ENV_PATH)) {
      fs.copyFileSync(ENV_PATH, BACKUP_PATH);
    }
  });

  afterAll(() => {
    // Restore original .env
    if (fs.existsSync(BACKUP_PATH)) {
      fs.copyFileSync(BACKUP_PATH, ENV_PATH);
      fs.unlinkSync(BACKUP_PATH);
    } else if (fs.existsSync(ENV_PATH)) {
      // If there was no backup, remove the test .env
      fs.unlinkSync(ENV_PATH);
    }
  });

  it('readToken returns null when .env does not exist', async () => {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
    const { readToken } = await import('../services/token.js');
    expect(readToken()).toBeNull();
  });

  it('readToken returns null when GITHUB_TOKEN is empty', async () => {
    fs.writeFileSync(ENV_PATH, 'GITHUB_TOKEN=\n', 'utf-8');
    const { readToken } = await import('../services/token.js');
    expect(readToken()).toBeNull();
  });

  it('readToken returns the token when set in .env', async () => {
    fs.writeFileSync(ENV_PATH, 'GITHUB_TOKEN=ghp_testtoken123\n', 'utf-8');
    const { readToken } = await import('../services/token.js');
    expect(readToken()).toBe('ghp_testtoken123');
  });

  it('maskToken masks correctly', async () => {
    const { maskToken } = await import('../services/token.js');
    expect(maskToken('ghp_abcdefghijklmnop1234')).toBe('ghp_****...1234');
  });

  it('maskToken handles short tokens', async () => {
    const { maskToken } = await import('../services/token.js');
    expect(maskToken('short')).toBe('****');
  });

  it('getTokenStatus returns configured false when no token', async () => {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
    const { getTokenStatus } = await import('../services/token.js');
    const status = getTokenStatus();
    expect(status.configured).toBe(false);
    expect(status.maskedToken).toBeNull();
  });

  it('getTokenStatus returns configured true with masked token', async () => {
    fs.writeFileSync(ENV_PATH, 'GITHUB_TOKEN=ghp_abcdefghijklmnop1234\n', 'utf-8');
    const { getTokenStatus } = await import('../services/token.js');
    const status = getTokenStatus();
    expect(status.configured).toBe(true);
    expect(status.maskedToken).toBe('ghp_****...1234');
  });
});
