// SQLite data layer (WAL mode for concurrent reads + fast serialized writes).
// The whole app talks to the DB only through this module, so swapping to
// Postgres later means reimplementing this one file.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');      // concurrent readers, fast writes
db.pragma('synchronous = NORMAL');    // good durability/speed balance
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');     // wait instead of throwing under write bursts

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prize TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'campaign',
      prize_count INTEGER NOT NULL DEFAULT 1,
      draw_date TEXT,
      exclude_prev INTEGER NOT NULL DEFAULT 1,
      store_name TEXT NOT NULL DEFAULT 'مخيم الحاشي',
      store_initial TEXT NOT NULL DEFAULT 'ح',
      store_handle TEXT NOT NULL DEFAULT '@mokhayam.alhashi',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'public',   -- public | kiosk | admin
      reel1 TEXT,
      reel2 TEXT,
      reel3 TEXT,
      excluded INTEGER NOT NULL DEFAULT 0,
      won_before INTEGER NOT NULL DEFAULT 0,
      agreed INTEGER NOT NULL DEFAULT 1,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_participants_campaign ON participants(campaign_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(campaign_id, phone);

    CREATE TABLE IF NOT EXISTS winners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      participant_id INTEGER REFERENCES participants(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      prize TEXT NOT NULL,
      rank INTEGER NOT NULL DEFAULT 1,
      received INTEGER NOT NULL DEFAULT 0,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_winners_campaign ON winners(campaign_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ── Additive migrations (safe on existing databases) ──
  const campaignCols = db.prepare('PRAGMA table_info(campaigns)').all().map(c => c.name);
  if (!campaignCols.includes('type')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN type TEXT NOT NULL DEFAULT 'visitor'");
  }
  const partCols = db.prepare('PRAGMA table_info(participants)').all().map(c => c.name);
  for (const col of ['reel1', 'reel2', 'reel3']) {
    if (!partCols.includes(col)) db.exec(`ALTER TABLE participants ADD COLUMN ${col} TEXT`);
  }

  // Photographers may enter up to 3 times with the same number, so the old
  // table-level UNIQUE(campaign_id, phone) has to go. SQLite can't drop a
  // constraint, so existing databases get a one-time table rebuild; the
  // per-segment entry limits are enforced in the register endpoints instead.
  const hasUnique = db.prepare('PRAGMA index_list(participants)').all().some(i => i.origin === 'u');
  if (hasUnique) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        CREATE TABLE participants_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'public',
          reel1 TEXT,
          reel2 TEXT,
          reel3 TEXT,
          excluded INTEGER NOT NULL DEFAULT 0,
          won_before INTEGER NOT NULL DEFAULT 0,
          agreed INTEGER NOT NULL DEFAULT 1,
          notified INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO participants_new (id, campaign_id, name, phone, source, reel1, reel2, reel3, excluded, won_before, agreed, notified, created_at)
          SELECT id, campaign_id, name, phone, source, reel1, reel2, reel3, excluded, won_before, agreed, notified, created_at FROM participants;
        DROP TABLE participants;
        ALTER TABLE participants_new RENAME TO participants;
        CREATE INDEX IF NOT EXISTS idx_participants_campaign ON participants(campaign_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_participants_phone ON participants(campaign_id, phone);
      `);
    })();
    db.pragma('foreign_keys = ON');
  }
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}
