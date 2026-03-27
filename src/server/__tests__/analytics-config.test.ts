import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { vi } from 'vitest';

// Build an in-memory test database with the app_config table
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import after mock
const { getAiMarkerDate, setAiMarkerDate } = await import('../services/analytics-config.js');

// Helper: insert a raw row into app_config bypassing the service
function insertRaw(key: string, value: string): void {
  testDb.insert(schema.appConfig).values({ key, value, updatedAt: new Date() }).run();
}

// Helper: delete all rows from app_config
function clearConfig(): void {
  testDb.delete(schema.appConfig).run();
}

describe('getAiMarkerDate', () => {
  beforeEach(() => {
    clearConfig();
  });

  it('returns null when no row exists', () => {
    expect(getAiMarkerDate()).toBeNull();
  });

  it('returns a valid Date when stored value is a valid ISO string', () => {
    insertRaw('ai_adoption_marker', '2024-06-15T00:00:00.000Z');
    const result = getAiMarkerDate();
    expect(result).not.toBeNull();
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('returns null when stored value is a malformed date string', () => {
    insertRaw('ai_adoption_marker', 'not-a-date');
    const result = getAiMarkerDate();
    expect(result).toBeNull();
  });

  it('returns null when stored value is "garbage"', () => {
    insertRaw('ai_adoption_marker', 'garbage');
    const result = getAiMarkerDate();
    expect(result).toBeNull();
  });
});

describe('setAiMarkerDate', () => {
  beforeEach(() => {
    clearConfig();
  });

  it('stores a Date as ISO string', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    setAiMarkerDate(date);
    const result = getAiMarkerDate();
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('clears the marker when passed null', () => {
    insertRaw('ai_adoption_marker', '2024-01-01T00:00:00.000Z');
    setAiMarkerDate(null);
    expect(getAiMarkerDate()).toBeNull();
  });

  it('overwrites existing value', () => {
    setAiMarkerDate(new Date('2024-01-01T00:00:00.000Z'));
    setAiMarkerDate(new Date('2025-06-01T00:00:00.000Z'));
    const result = getAiMarkerDate();
    expect(result!.toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });
});
