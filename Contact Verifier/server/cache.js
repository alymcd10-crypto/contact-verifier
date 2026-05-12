// server/cache.js — SQLite-backed verification cache.
// Keyed by normalized (name, company) so we never re-query a contact we just looked up.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'cache.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS verifications (
    cache_key TEXT PRIMARY KEY,
    result    TEXT NOT NULL,
    created   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_created ON verifications(created);
`);

const TTL_MS = (parseInt(process.env.CACHE_TTL_DAYS || '30', 10)) * 24 * 60 * 60 * 1000;

export function cacheKey(contact) {
  const n = String(contact.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = String(contact.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${n}|${c}`;
}

export function getCached(contact) {
  const row = db.prepare('SELECT result, created FROM verifications WHERE cache_key = ?').get(cacheKey(contact));
  if (!row) return null;
  if (Date.now() - row.created > TTL_MS) return null;
  try { return JSON.parse(row.result); } catch { return null; }
}

export function setCached(contact, result) {
  db.prepare('INSERT OR REPLACE INTO verifications (cache_key, result, created) VALUES (?, ?, ?)')
    .run(cacheKey(contact), JSON.stringify(result), Date.now());
}

export function clearExpired() {
  const cutoff = Date.now() - TTL_MS;
  const r = db.prepare('DELETE FROM verifications WHERE created < ?').run(cutoff);
  return r.changes;
}

export function stats() {
  const total = db.prepare('SELECT COUNT(*) as c FROM verifications').get().c;
  return { total };
}
