import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from '../db/schema.js';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test.db');

describe('Database (INFR-01)', () => {
  let sqlite: Database.Database;

  beforeAll(() => {
    // Clean up any previous test DB
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    const dbDir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    sqlite = new Database(TEST_DB_PATH);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    sqlite.close();
    for (const f of [TEST_DB_PATH, TEST_DB_PATH + '-wal', TEST_DB_PATH + '-shm']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('creates the database file', () => {
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });

  it('enables WAL journal mode', () => {
    const result = sqlite.pragma('journal_mode');
    expect(result).toEqual([{ journal_mode: 'wal' }]);
  });

  it('enables foreign keys', () => {
    const result = sqlite.pragma('foreign_keys');
    expect(result).toEqual([{ foreign_keys: 1 }]);
  });

  it('runs migrations without error', () => {
    const db = drizzle(sqlite, { schema });
    expect(() => {
      migrate(db, { migrationsFolder: path.join(import.meta.dirname, '..', '..', 'drizzle', 'migrations') });
    }).not.toThrow();
  });

  it('app_config table exists after migration', () => {
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='app_config'"
    ).all();
    expect(tables).toHaveLength(1);
    expect((tables[0] as any).name).toBe('app_config');
  });

  it('full schema tables exist after migration', () => {
    const expectedTables = ['app_config', 'repositories', 'commits', 'pull_requests', 'authors', 'collection_state'];
    for (const tableName of expectedTables) {
      const tables = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).all(tableName);
      expect(tables, `Expected table ${tableName} to exist`).toHaveLength(1);
    }
  });
});
