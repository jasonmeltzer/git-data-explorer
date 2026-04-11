import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema.js';

const RESEARCH_DB_PATH = process.env.RESEARCH_DB_PATH ?? path.join(process.cwd(), 'data', 'research.db');

// Ensure the data directory exists
const dbDir = path.dirname(RESEARCH_DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const sqlite = new Database(RESEARCH_DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
export const db = drizzle(sqlite, { schema });
