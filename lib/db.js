'use strict';
// Malzeme Takip — SQLite storage: users, sessions, materials, movements (documents with lines), alerts, activity.
// Uses Node's built-in node:sqlite (Node 22.13+ / 24+), so there is nothing native to compile.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) {
  console.error('\nBu uygulama Node.js 22.13 veya üstünü gerektirir (yerleşik SQLite). Sürümünüz: ' + process.version + '.\nhttps://nodejs.org adresinden güncel LTS sürümünü kurup yeniden deneyin.\n');
  process.exit(1);
}

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'malzeme.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass_hash TEXT,
      role TEXT NOT NULL DEFAULT 'member', color TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
      invite_token TEXT, invite_expires INTEGER, created_at INTEGER NOT NULL, last_seen INTEGER,
      inbox_seen INTEGER NOT NULL DEFAULT 0, alert_mail INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT
    );
    CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at INTEGER NOT NULL, last_ok INTEGER
    );
    CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
    CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'adet',
      category TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', min_stock REAL NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, created_by TEXT, updated_at INTEGER NOT NULL, updated_by TEXT,
      deleted_at INTEGER, deleted_by TEXT
    );
    CREATE INDEX IF NOT EXISTS materials_name ON materials(name);
    CREATE TABLE IF NOT EXISTS movements (
      id TEXT PRIMARY KEY, doc_no TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, doc_date TEXT NOT NULL,
      ordered_by TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
      vehicle TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0, cancelled_at INTEGER, cancelled_by TEXT, cancel_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS movements_date ON movements(doc_date, created_at);
    CREATE TABLE IF NOT EXISTS movement_lines (
      id TEXT PRIMARY KEY, movement_id TEXT NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL REFERENCES materials(id), pos INTEGER NOT NULL, qty REAL NOT NULL,
      stock_before REAL NOT NULL, stock_after REAL NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS lines_material ON movement_lines(material_id);
    CREATE INDEX IF NOT EXISTS lines_movement ON movement_lines(movement_id);
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
      opened_at INTEGER NOT NULL, stock_at_open REAL NOT NULL, min_at_open REAL NOT NULL, movement_id TEXT,
      resolved_at INTEGER, stock_at_resolve REAL, acked_by TEXT, acked_at INTEGER, notified TEXT
    );
    CREATE INDEX IF NOT EXISTS alerts_open ON alerts(material_id, resolved_at);
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, user_id TEXT, title TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', ref TEXT
    );
    CREATE INDEX IF NOT EXISTS activity_ts ON activity(ts);
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, created_by TEXT,
      archived INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, last_msg_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '', att TEXT, ts INTEGER NOT NULL, edited_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, ts);
    CREATE TABLE IF NOT EXISTS channel_reads ( user_id TEXT NOT NULL, channel_id TEXT NOT NULL, last_read INTEGER NOT NULL, PRIMARY KEY (user_id, channel_id) );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, ext TEXT NOT NULL,
      uploader TEXT NOT NULL, created_at INTEGER NOT NULL, w INTEGER, h INTEGER, message_id TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, order_no TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL DEFAULT '', expected_date TEXT,
      ordered_by TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL, created_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
      closed_at INTEGER, closed_by TEXT, cancel_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status, expected_date);
    CREATE TABLE IF NOT EXISTS order_lines (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL REFERENCES materials(id), pos INTEGER NOT NULL, qty REAL NOT NULL,
      received REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS order_lines_order ON order_lines(order_id);
  `);
  migrateMaterials(db);
  const mcols = db.prepare('PRAGMA table_info(movements)').all().map(c => c.name);
  if (!mcols.includes('order_id')) db.exec('ALTER TABLE movements ADD COLUMN order_id TEXT');
  return db;
}

// Eski veritabanlarında malzeme kodu tablo düzeyinde UNIQUE idi; silinen bir kartın kodunun yeniden kullanılabilmesi için
// kısıt yalnızca silinmemiş kartları kapsayan kısmi bir indekse taşınır. Tablo bir kez yeniden kurulur; veriler aynen korunur.
function migrateMaterials(db) {
  const cols = db.prepare('PRAGMA table_info(materials)').all().map(c => c.name);
  for (const [c, t] of [['deleted_at', 'INTEGER'], ['deleted_by', 'TEXT']]) if (!cols.includes(c)) db.exec(`ALTER TABLE materials ADD COLUMN ${c} ${t}`);
  const hasInlineUnique = db.prepare('PRAGMA index_list(materials)').all().some(i => i.origin === 'u');
  if (hasInlineUnique) {
    console.log('Veritabanı: malzeme tablosu yeni düzene taşınıyor (silinen kartların kodu yeniden kullanılabilsin diye).');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`BEGIN;
      CREATE TABLE materials_new (
        id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'adet',
        category TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', min_stock REAL NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL, created_by TEXT, updated_at INTEGER NOT NULL, updated_by TEXT,
        deleted_at INTEGER, deleted_by TEXT
      );
      INSERT INTO materials_new (id, code, name, unit, category, location, min_stock, description, active, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
        SELECT id, code, name, unit, category, location, min_stock, description, active, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by FROM materials;
      DROP TABLE materials;
      ALTER TABLE materials_new RENAME TO materials;
      CREATE INDEX IF NOT EXISTS materials_name ON materials(name);
      COMMIT;`);
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS materials_code_live ON materials(code COLLATE NOCASE) WHERE deleted_at IS NULL');
}

// ---------- passwords & tokens ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const newId = (prefix) => prefix + crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');

const PALETTE = ['#b4531b', '#2f5da6', '#1d7676', '#7a3e9d', '#2c7a4b', '#a86d14', '#b1342c', '#4a5d8a', '#8a5a2c', '#3c7c9e'];
function colorFor(seed) { let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }

const KIND_PREFIX = { in: 'GRS', out: 'SVK', adj: 'DZL', ret: 'GDN' };
const STOCK_SQL = `COALESCE((SELECT SUM(CASE mv.kind WHEN 'in' THEN l.qty WHEN 'out' THEN -l.qty ELSE l.qty END)
  FROM movement_lines l JOIN movements mv ON mv.id = l.movement_id WHERE l.material_id = m.id AND mv.cancelled = 0), 0)`;

// ---------- repository ----------
class Repo {
  constructor(db) { this.db = db; }
  // Reentrant: an inner tx() call joins the outer transaction instead of opening a nested one.
  tx(fn) {
    if (this._txDepth) return fn();
    this._txDepth = 1; this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch (e2) {} throw e; } finally { this._txDepth = 0; }
  }

  // ----- users -----
  userCount() { return this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n; }
  userByEmail(email) { return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()); }
  userById(id) { return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
  userByInvite(tok) { return this.db.prepare('SELECT * FROM users WHERE invite_token = ? AND invite_expires > ?').get(tok, Date.now()); }
  listUsers() { return this.db.prepare('SELECT id, email, name, role, color, active, invite_expires, created_at, last_seen, alert_mail, (pass_hash IS NOT NULL) AS has_password FROM users ORDER BY created_at').all(); }
  activeUsers() { return this.db.prepare('SELECT id, email, name, role, color, alert_mail FROM users WHERE active = 1 ORDER BY name').all(); }
  createUser({ email, name, role, password, active }) {
    const id = newId('u_');
    const e = email.trim().toLowerCase();
    this.db.prepare('INSERT INTO users (id, email, name, pass_hash, role, color, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, e, name.trim(), password ? hashPassword(password) : null, role || 'member', colorFor(e), active ? 1 : 0, Date.now());
    return this.userById(id);
  }
  setInvite(id, days) { const t = token(24); this.db.prepare('UPDATE users SET invite_token = ?, invite_expires = ? WHERE id = ?').run(t, Date.now() + days * 86400000, id); return t; }
  acceptInvite(id, name, password) {
    this.db.prepare('UPDATE users SET name = CASE WHEN ? <> \'\' THEN ? ELSE name END, pass_hash = ?, active = 1, invite_token = NULL, invite_expires = NULL WHERE id = ?')
      .run(name ? name.trim() : '', name ? name.trim() : '', hashPassword(password), id);
  }
  updateUser(id, f) {
    const sets = [], vals = [];
    for (const k of ['role', 'active', 'name', 'alert_mail']) if (f[k] !== undefined) { sets.push(k + ' = ?'); vals.push(typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : f[k]); }
    if (!sets.length) return;
    vals.push(id); this.db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  }
  setPassword(id, pw) { this.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(pw), id); }
  touchUser(id) { this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), id); }
  setInboxSeen(id, ts) { this.db.prepare('UPDATE users SET inbox_seen = ? WHERE id = ?').run(ts, id); }

  // ----- sessions -----
  createSession(userId, ua) { const t = token(32); this.db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ua) VALUES (?, ?, ?, ?, ?)').run(t, userId, Date.now(), Date.now() + 30 * 86400000, (ua || '').slice(0, 200)); return t; }
  userBySession(tok) { if (!tok) return null; return this.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.active = 1').get(tok, Date.now()) || null; }
  deleteSession(tok) { this.db.prepare('DELETE FROM sessions WHERE token = ?').run(tok); }
  deleteUserSessions(userId) { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
  purgeSessions() { this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }

  // ----- push subscriptions -----
  savePushSub(userId, sub, ua) { this.db.prepare('INSERT INTO push_subs (endpoint, user_id, p256dh, auth, ua, created_at, last_ok) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, last_ok = excluded.last_ok').run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, (ua || '').slice(0, 200), Date.now(), Date.now()); }
  deletePushSub(endpoint) { this.db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint); }
  touchPushSub(endpoint) { this.db.prepare('UPDATE push_subs SET last_ok = ? WHERE endpoint = ?').run(Date.now(), endpoint); }
  pushSubs(userIds) { if (!userIds) return this.db.prepare('SELECT * FROM push_subs').all(); if (!userIds.length) return []; return this.db.prepare('SELECT * FROM push_subs WHERE user_id IN (' + userIds.map(() => '?').join(',') + ')').all(...userIds); }
  pushSubsOf(userId) { return this.db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId); }

  // ----- settings -----
  getSetting(key, dflt) { const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key); if (!r) return dflt; try { return JSON.parse(r.value); } catch (e) { return dflt; } }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); }
  nextDocNo(kind, year) {
    const key = 'seq:' + KIND_PREFIX[kind] + ':' + year;
    const n = (this.getSetting(key, 0) || 0) + 1; this.setSetting(key, n);
    return KIND_PREFIX[kind] + '-' + year + '-' + String(n).padStart(5, '0');
  }

  // ----- materials -----
  materialRow(id) { return this.db.prepare(`SELECT m.*, ${STOCK_SQL} AS stock FROM materials m WHERE m.id = ?`).get(id) || null; }
  materialByCode(code) { return this.db.prepare('SELECT * FROM materials WHERE code = ? COLLATE NOCASE AND deleted_at IS NULL').get(code.trim()); }
  listMaterials(includeInactive) {
    return this.db.prepare(`SELECT m.*, ${STOCK_SQL} AS stock,
      (SELECT id FROM alerts a WHERE a.material_id = m.id AND a.resolved_at IS NULL ORDER BY opened_at DESC LIMIT 1) AS open_alert,
      (SELECT MAX(mv.created_at) FROM movement_lines l JOIN movements mv ON mv.id = l.movement_id WHERE l.material_id = m.id AND mv.cancelled = 0) AS last_move
      FROM materials m WHERE m.deleted_at IS NULL ${includeInactive ? '' : 'AND m.active = 1'} ORDER BY m.name COLLATE NOCASE`).all();
  }
  listDeletedMaterials() {
    return this.db.prepare(`SELECT m.*, ${STOCK_SQL} AS stock, u.name AS deleted_by_name,
      (SELECT COUNT(*) FROM movement_lines l WHERE l.material_id = m.id) AS line_count
      FROM materials m LEFT JOIN users u ON u.id = m.deleted_by WHERE m.deleted_at IS NOT NULL ORDER BY m.deleted_at DESC`).all();
  }
  createMaterial(f, by) {
    const id = newId('m_'); const now = Date.now();
    this.db.prepare('INSERT INTO materials (id, code, name, unit, category, location, min_stock, description, active, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)')
      .run(id, f.code, f.name, f.unit, f.category, f.location, f.min_stock, f.description, now, by, now, by);
    return this.materialRow(id);
  }
  updateMaterial(id, f, by) {
    const sets = [], vals = [];
    for (const k of ['code', 'name', 'unit', 'category', 'location', 'min_stock', 'description', 'active']) if (f[k] !== undefined) { sets.push(k + ' = ?'); vals.push(typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : f[k]); }
    if (!sets.length) return this.materialRow(id);
    sets.push('updated_at = ?', 'updated_by = ?'); vals.push(Date.now(), by, id);
    this.db.prepare('UPDATE materials SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return this.materialRow(id);
  }
  materialHasMovements(id) { return !!this.db.prepare('SELECT 1 FROM movement_lines WHERE material_id = ? LIMIT 1').get(id); }
  // Hareketi olmayan kart kalıcı olarak silinir; hareketi olan kart "silinmiş" işaretlenir (belgeler ve PDF'ler bozulmaz) ve geri alınabilir.
  deleteMaterial(id, by) {
    return this.tx(() => {
      const now = Date.now(); const stock = this.stockOf(id);
      this.db.prepare('UPDATE alerts SET resolved_at = ?, stock_at_resolve = ? WHERE material_id = ? AND resolved_at IS NULL').run(now, stock, id);
      if (this.materialHasMovements(id)) { this.db.prepare('UPDATE materials SET deleted_at = ?, deleted_by = ?, active = 0, updated_at = ?, updated_by = ? WHERE id = ?').run(now, by, now, by, id); return 'soft'; }
      this.db.prepare('DELETE FROM alerts WHERE material_id = ?').run(id);
      this.db.prepare('DELETE FROM materials WHERE id = ?').run(id);
      return 'hard';
    });
  }
  restoreMaterial(id, by) { this.db.prepare('UPDATE materials SET deleted_at = NULL, deleted_by = NULL, active = 1, updated_at = ?, updated_by = ? WHERE id = ?').run(Date.now(), by, id); return this.materialRow(id); }
  categories() { return this.db.prepare("SELECT DISTINCT category FROM materials WHERE category <> '' AND deleted_at IS NULL ORDER BY category COLLATE NOCASE").all().map(r => r.category); }
  locations() { return this.db.prepare("SELECT DISTINCT location FROM materials WHERE location <> '' AND deleted_at IS NULL ORDER BY location COLLATE NOCASE").all().map(r => r.location); }
  units() { return this.db.prepare('SELECT DISTINCT unit FROM materials WHERE deleted_at IS NULL ORDER BY unit COLLATE NOCASE').all().map(r => r.unit); }
  stockOf(materialId) { return this.db.prepare(`SELECT ${STOCK_SQL} AS stock FROM materials m WHERE m.id = ?`).get(materialId)?.stock || 0; }

  // ----- movements -----
  movementRow(id) {
    const mv = this.db.prepare('SELECT mv.*, u.name AS created_by_name, cu.name AS cancelled_by_name, o.order_no AS order_no, o.supplier AS order_supplier FROM movements mv LEFT JOIN users u ON u.id = mv.created_by LEFT JOIN users cu ON cu.id = mv.cancelled_by LEFT JOIN orders o ON o.id = mv.order_id WHERE mv.id = ?').get(id);
    if (!mv) return null;
    mv.lines = this.db.prepare('SELECT l.*, m.code AS material_code, m.name AS material_name, m.unit AS unit FROM movement_lines l JOIN materials m ON m.id = l.material_id WHERE l.movement_id = ? ORDER BY l.pos').all(id);
    mv.cancelled = !!mv.cancelled;
    return mv;
  }
  movementByDocNo(no) { const r = this.db.prepare('SELECT id FROM movements WHERE doc_no = ?').get(no); return r ? this.movementRow(r.id) : null; }
  listMovements({ kind, from, to, materialId, q, limit, offset, includeCancelled }) {
    const where = [], vals = [];
    if (kind) { where.push('mv.kind = ?'); vals.push(kind); }
    if (from) { where.push('mv.doc_date >= ?'); vals.push(from); }
    if (to) { where.push('mv.doc_date <= ?'); vals.push(to); }
    if (!includeCancelled) where.push('mv.cancelled = 0');
    if (materialId) { where.push('EXISTS (SELECT 1 FROM movement_lines l WHERE l.movement_id = mv.id AND l.material_id = ?)'); vals.push(materialId); }
    if (q) { const like = '%' + q + '%'; where.push('(mv.doc_no LIKE ? OR mv.ordered_by LIKE ? OR mv.counterparty LIKE ? OR mv.reference LIKE ? OR mv.vehicle LIKE ? OR mv.notes LIKE ? OR EXISTS (SELECT 1 FROM movement_lines l JOIN materials m ON m.id = l.material_id WHERE l.movement_id = mv.id AND (m.name LIKE ? OR m.code LIKE ?)))'); vals.push(like, like, like, like, like, like, like, like); }
    const sql = `SELECT mv.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM movement_lines l WHERE l.movement_id = mv.id) AS line_count,
        (SELECT group_concat(m.name, ' · ') FROM (SELECT m2.name FROM movement_lines l2 JOIN materials m2 ON m2.id = l2.material_id WHERE l2.movement_id = mv.id ORDER BY l2.pos LIMIT 3) m) AS summary,
        (SELECT SUM(l.qty) FROM movement_lines l WHERE l.movement_id = mv.id) AS total_qty
      FROM movements mv LEFT JOIN users u ON u.id = mv.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY mv.doc_date DESC, mv.created_at DESC LIMIT ? OFFSET ?`;
    vals.push(limit, offset);
    const rows = this.db.prepare(sql).all(...vals).map(r => ({ ...r, cancelled: !!r.cancelled }));
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM movements mv ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...vals.slice(0, -2)).n;
    return { rows, total };
  }
  movementCountsSince(dateIso) {
    return this.db.prepare(`SELECT kind, COUNT(*) AS n, SUM((SELECT SUM(qty) FROM movement_lines l WHERE l.movement_id = mv.id)) AS qty FROM movements mv WHERE mv.cancelled = 0 AND mv.doc_date >= ? GROUP BY kind`).all(dateIso);
  }
  // History of one material with the running balance, oldest first (for the stock card and the chart).
  materialHistory(materialId, limit) {
    return this.db.prepare(`SELECT l.id AS line_id, l.qty, l.stock_before, l.stock_after, l.note, mv.id AS movement_id, mv.doc_no, mv.kind, mv.doc_date, mv.created_at, mv.ordered_by, mv.counterparty, mv.reference, mv.cancelled, u.name AS created_by_name
      FROM movement_lines l JOIN movements mv ON mv.id = l.movement_id LEFT JOIN users u ON u.id = mv.created_by
      WHERE l.material_id = ? ORDER BY mv.created_at DESC LIMIT ?`).all(materialId, limit).map(r => ({ ...r, cancelled: !!r.cancelled })).reverse();
  }
  orderedByNames() { return this.db.prepare("SELECT ordered_by AS v, COUNT(*) AS n FROM movements WHERE ordered_by <> '' GROUP BY ordered_by ORDER BY n DESC, v LIMIT 60").all().map(r => r.v); }
  counterparties(kind) { return this.db.prepare("SELECT counterparty AS v, COUNT(*) AS n FROM movements WHERE counterparty <> '' AND kind = ? GROUP BY counterparty ORDER BY n DESC, v LIMIT 60").all(kind).map(r => r.v); }

  // Creates the document and its lines atomically; stock snapshots are taken inside the transaction.
  createMovement(h, lines, by, allowNegative) {
    return this.tx(() => {
      const id = newId('mv_'); const now = Date.now();
      const year = String(h.doc_date).slice(0, 4);
      const docNo = this.nextDocNo(h.kind, year);
      this.db.prepare('INSERT INTO movements (id, doc_no, kind, doc_date, ordered_by, counterparty, reference, vehicle, notes, created_at, created_by, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, docNo, h.kind, h.doc_date, h.ordered_by, h.counterparty, h.reference, h.vehicle, h.notes, now, by, h.order_id || null);
      const ins = this.db.prepare('INSERT INTO movement_lines (id, movement_id, material_id, pos, qty, stock_before, stock_after, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const running = new Map();
      lines.forEach((l, i) => {
        const before = running.has(l.material_id) ? running.get(l.material_id) : this.stockOf(l.material_id);
        const delta = h.kind === 'in' ? l.qty : h.kind === 'out' ? -l.qty : l.qty;
        const after = Math.round((before + delta) * 1e6) / 1e6;
        if (after < 0 && !allowNegative) { const m = this.materialRow(l.material_id); const err = new Error(`"${m ? m.name : l.material_id}" için stok yetersiz: mevcut ${fmtNum(before)} ${m ? m.unit : ''}, istenen ${fmtNum(Math.abs(delta))} ${m ? m.unit : ''}.`); err.code = 'insufficient_stock'; throw err; }
        running.set(l.material_id, after);
        ins.run(newId('l_'), id, l.material_id, i + 1, l.qty, before, after, l.note || '');
      });
      return this.movementRow(id);
    });
  }
  updateMovementHeader(id, f) {
    const sets = [], vals = [];
    for (const k of ['ordered_by', 'counterparty', 'reference', 'vehicle', 'notes', 'doc_date']) if (f[k] !== undefined) { sets.push(k + ' = ?'); vals.push(f[k]); }
    if (!sets.length) return this.movementRow(id);
    vals.push(id); this.db.prepare('UPDATE movements SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    return this.movementRow(id);
  }
  cancelMovement(id, by, reason) {
    return this.tx(() => {
      const cur = this.movementRow(id); if (!cur || cur.cancelled) return cur;
      this.db.prepare('UPDATE movements SET cancelled = 1, cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ? AND cancelled = 0').run(Date.now(), by, reason || '', id);
      if (cur.order_id) { for (const l of cur.lines) this.db.prepare('UPDATE order_lines SET received = MAX(0, received - ?) WHERE order_id = ? AND material_id = ?').run(l.qty, cur.order_id, l.material_id); this.refreshOrderStatus(cur.order_id); }
      return this.movementRow(id);
    });
  }

  // ----- gelmekte olan siparişler -----
  orderRow(id) {
    const o = this.db.prepare('SELECT o.*, u.name AS created_by_name, cu.name AS closed_by_name FROM orders o LEFT JOIN users u ON u.id = o.created_by LEFT JOIN users cu ON cu.id = o.closed_by WHERE o.id = ?').get(id);
    if (!o) return null;
    o.lines = this.db.prepare('SELECT l.*, m.code AS material_code, m.name AS material_name, m.unit AS unit, m.deleted_at AS material_deleted FROM order_lines l JOIN materials m ON m.id = l.material_id WHERE l.order_id = ? ORDER BY l.pos').all(id);
    o.receipts = this.db.prepare('SELECT mv.id, mv.doc_no, mv.doc_date, mv.created_at, mv.reference, mv.vehicle, mv.cancelled, u.name AS created_by_name, (SELECT SUM(qty) FROM movement_lines x WHERE x.movement_id = mv.id) AS total_qty FROM movements mv LEFT JOIN users u ON u.id = mv.created_by WHERE mv.order_id = ? ORDER BY mv.created_at').all(id).map(r => ({ ...r, cancelled: !!r.cancelled }));
    return o;
  }
  listOrders({ status, q, limit, offset }) {
    const where = [], vals = [];
    if (status === 'active') where.push("o.status IN ('open','partial')"); else if (status) { where.push('o.status = ?'); vals.push(status); }
    if (q) { const like = '%' + q + '%'; where.push('(o.order_no LIKE ? OR o.supplier LIKE ? OR o.ordered_by LIKE ? OR o.notes LIKE ? OR EXISTS (SELECT 1 FROM order_lines l JOIN materials m ON m.id = l.material_id WHERE l.order_id = o.id AND (m.name LIKE ? OR m.code LIKE ?)))'); vals.push(like, like, like, like, like, like); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT o.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS line_count,
        (SELECT SUM(l.qty) FROM order_lines l WHERE l.order_id = o.id) AS total_qty,
        (SELECT SUM(l.received) FROM order_lines l WHERE l.order_id = o.id) AS total_received,
        (SELECT group_concat(m.name, ' · ') FROM (SELECT m2.name FROM order_lines l2 JOIN materials m2 ON m2.id = l2.material_id WHERE l2.order_id = o.id ORDER BY l2.pos LIMIT 3) m) AS summary
      FROM orders o LEFT JOIN users u ON u.id = o.created_by ${w}
      ORDER BY CASE o.status WHEN 'open' THEN 0 WHEN 'partial' THEN 0 WHEN 'done' THEN 1 ELSE 2 END, COALESCE(o.expected_date, '9999') , o.created_at DESC LIMIT ? OFFSET ?`).all(...vals, limit, offset);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM orders o ${w}`).get(...vals).n;
    return { rows, total };
  }
  createOrder(h, lines, by) {
    return this.tx(() => {
      const id = newId('o_'); const now = Date.now();
      this.db.prepare('INSERT INTO orders (id, order_no, supplier, expected_date, ordered_by, notes, status, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, h.order_no, h.supplier, h.expected_date || null, h.ordered_by, h.notes, 'open', now, by, now);
      const ins = this.db.prepare('INSERT INTO order_lines (id, order_id, material_id, pos, qty, note) VALUES (?, ?, ?, ?, ?, ?)');
      lines.forEach((l, i) => ins.run(newId('ol_'), id, l.material_id, i + 1, l.qty, l.note || ''));
      return this.orderRow(id);
    });
  }
  updateOrder(id, h, lines) {
    return this.tx(() => {
      const sets = [], vals = [];
      for (const k of ['order_no', 'supplier', 'expected_date', 'ordered_by', 'notes']) if (h[k] !== undefined) { sets.push(k + ' = ?'); vals.push(h[k] === '' && k === 'expected_date' ? null : h[k]); }
      sets.push('updated_at = ?'); vals.push(Date.now(), id);
      this.db.prepare('UPDATE orders SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
      if (lines) {
        // keep received quantities of lines that still exist (matched by line id), replace the rest
        const old = new Map(this.db.prepare('SELECT id, received FROM order_lines WHERE order_id = ?').all(id).map(r => [r.id, r.received]));
        this.db.prepare('DELETE FROM order_lines WHERE order_id = ?').run(id);
        const ins = this.db.prepare('INSERT INTO order_lines (id, order_id, material_id, pos, qty, received, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
        lines.forEach((l, i) => ins.run(l.id && old.has(l.id) ? l.id : newId('ol_'), id, l.material_id, i + 1, l.qty, l.id && old.has(l.id) ? Math.min(old.get(l.id), l.qty) : 0, l.note || ''));
        this.refreshOrderStatus(id);
      }
      return this.orderRow(id);
    });
  }
  // Receives part or all of an order: creates the GRS document and raises the received quantities.
  receiveOrder(orderId, h, lines, by) {
    return this.tx(() => {
      const mv = this.createMovement({ ...h, kind: 'in', order_id: orderId }, lines.map(l => ({ material_id: l.material_id, qty: l.qty, note: l.note })), by, true);
      for (const l of lines) if (l.line_id) this.db.prepare('UPDATE order_lines SET received = received + ? WHERE id = ? AND order_id = ?').run(l.qty, l.line_id, orderId);
      this.refreshOrderStatus(orderId, by);
      return mv;
    });
  }
  refreshOrderStatus(orderId, by) {
    const o = this.db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId); if (!o || o.status === 'cancelled') return;
    const agg = this.db.prepare('SELECT SUM(qty) AS q, SUM(MIN(received, qty)) AS r, SUM(CASE WHEN received >= qty THEN 1 ELSE 0 END) AS full, COUNT(*) AS n FROM order_lines WHERE order_id = ?').get(orderId);
    const status = agg.n && agg.full === agg.n ? 'done' : (agg.r > 0 ? 'partial' : 'open');
    this.db.prepare('UPDATE orders SET status = ?, closed_at = CASE WHEN ? = \'done\' THEN COALESCE(closed_at, ?) ELSE NULL END, closed_by = CASE WHEN ? = \'done\' THEN COALESCE(closed_by, ?) ELSE NULL END, updated_at = ? WHERE id = ?').run(status, status, Date.now(), status, by || null, Date.now(), orderId);
  }
  cancelOrder(id, by, reason) { this.db.prepare("UPDATE orders SET status = 'cancelled', closed_at = ?, closed_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND status <> 'cancelled'").run(Date.now(), by, reason || '', Date.now(), id); return this.orderRow(id); }
  reopenOrder(id) { this.db.prepare("UPDATE orders SET status = 'open', closed_at = NULL, closed_by = NULL, cancel_reason = NULL, updated_at = ? WHERE id = ?").run(Date.now(), id); this.refreshOrderStatus(id); return this.orderRow(id); }
  orderStats(today) {
    return {
      active: this.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('open','partial')").get().n,
      overdue: this.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('open','partial') AND expected_date IS NOT NULL AND expected_date < ?").get(today).n,
      next: this.db.prepare(`SELECT o.id, o.order_no, o.supplier, o.expected_date, o.status,
          (SELECT group_concat(m.name, ' · ') FROM (SELECT m2.name FROM order_lines l2 JOIN materials m2 ON m2.id = l2.material_id WHERE l2.order_id = o.id ORDER BY l2.pos LIMIT 2) m) AS summary,
          (SELECT SUM(l.qty) FROM order_lines l WHERE l.order_id = o.id) AS total_qty, (SELECT SUM(l.received) FROM order_lines l WHERE l.order_id = o.id) AS total_received
        FROM orders o WHERE o.status IN ('open','partial') ORDER BY COALESCE(o.expected_date, '9999'), o.created_at LIMIT 6`).all(),
    };
  }
  suppliers() { return this.db.prepare("SELECT supplier AS v, COUNT(*) AS n FROM orders WHERE supplier <> '' GROUP BY supplier ORDER BY n DESC, v LIMIT 60").all().map(r => r.v); }

  // ----- alerts -----
  openAlert(materialId) { return this.db.prepare('SELECT * FROM alerts WHERE material_id = ? AND resolved_at IS NULL ORDER BY opened_at DESC LIMIT 1').get(materialId) || null; }
  createAlert(materialId, stock, min, movementId) {
    const id = newId('al_');
    this.db.prepare('INSERT INTO alerts (id, material_id, opened_at, stock_at_open, min_at_open, movement_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, materialId, Date.now(), stock, min, movementId || null);
    return this.alertRow(id);
  }
  resolveAlert(id, stock) { this.db.prepare('UPDATE alerts SET resolved_at = ?, stock_at_resolve = ? WHERE id = ? AND resolved_at IS NULL').run(Date.now(), stock, id); return this.alertRow(id); }
  ackAlert(id, by) { this.db.prepare('UPDATE alerts SET acked_by = ?, acked_at = ? WHERE id = ?').run(by, Date.now(), id); return this.alertRow(id); }
  setAlertNotified(id, info) { this.db.prepare('UPDATE alerts SET notified = ? WHERE id = ?').run(JSON.stringify(info), id); }
  alertRow(id) {
    const r = this.db.prepare(`SELECT a.*, m.code AS material_code, m.name AS material_name, m.unit AS unit, m.min_stock AS min_stock, ${STOCK_SQL} AS stock, u.name AS acked_by_name
      FROM alerts a JOIN materials m ON m.id = a.material_id LEFT JOIN users u ON u.id = a.acked_by WHERE a.id = ?`).get(id);
    return r || null;
  }
  listAlerts({ open, limit }) {
    return this.db.prepare(`SELECT a.*, m.code AS material_code, m.name AS material_name, m.unit AS unit, m.min_stock AS min_stock, ${STOCK_SQL} AS stock, u.name AS acked_by_name
      FROM alerts a JOIN materials m ON m.id = a.material_id LEFT JOIN users u ON u.id = a.acked_by
      ${open ? 'WHERE a.resolved_at IS NULL' : 'WHERE a.resolved_at IS NOT NULL'} ORDER BY a.opened_at DESC LIMIT ?`).all(limit);
  }

  // ----- activity (the bell) -----
  addActivity({ kind, userId, title, text, ref }) {
    const id = newId('a_'); const ts = Date.now();
    this.db.prepare('INSERT INTO activity (id, ts, kind, user_id, title, text, ref) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ts, kind, userId || null, title, text || '', ref ? JSON.stringify(ref) : null);
    this.db.prepare('DELETE FROM activity WHERE id IN (SELECT id FROM activity ORDER BY ts DESC LIMIT -1 OFFSET 500)').run();
    return this.activityRow(id);
  }
  activityRow(id) { const r = this.db.prepare('SELECT a.*, u.name AS user_name, u.color AS user_color FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?').get(id); if (r && r.ref) { try { r.ref = JSON.parse(r.ref); } catch (e) { r.ref = null; } } return r; }
  listActivity(limit) { return this.db.prepare('SELECT a.*, u.name AS user_name, u.color AS user_color FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY ts DESC LIMIT ?').all(limit).map(r => { if (r.ref) { try { r.ref = JSON.parse(r.ref); } catch (e) { r.ref = null; } } return r; }); }
  unreadCount(userId, seen) { return this.db.prepare(`SELECT COUNT(*) AS n FROM activity WHERE ts > ? AND (user_id IS NULL OR user_id <> ?) AND (ref IS NULL OR ref NOT LIKE '%"forUser"%' OR ref LIKE '%"forUser":"' || ? || '"%')`).get(seen || 0, userId, userId).n; }

  // ----- sohbet -----
  ensureGeneralChannel(by) {
    if (this.db.prepare('SELECT COUNT(*) AS n FROM channels').get().n) return;
    this.db.prepare('INSERT INTO channels (id, name, topic, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(newId('c_'), 'genel', 'Depo ekibinin ortak sohbeti: duyurular, sorular, günlük işler', Date.now(), by || null);
  }
  channelRow(id) { return this.db.prepare('SELECT c.*, u.name AS created_by_name FROM channels c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?').get(id) || null; }
  channelByName(name) { return this.db.prepare('SELECT * FROM channels WHERE name = ? COLLATE NOCASE').get(name) || null; }
  listChannels(userId) {
    return this.db.prepare(`SELECT c.*, u.name AS created_by_name,
        (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.user_id <> ? AND m.ts > COALESCE((SELECT last_read FROM channel_reads r WHERE r.user_id = ? AND r.channel_id = c.id), (SELECT created_at FROM users WHERE id = ?), 0)) AS unread,
        (SELECT m.text FROM messages m WHERE m.channel_id = c.id ORDER BY m.ts DESC LIMIT 1) AS last_text,
        (SELECT mu.name FROM messages m JOIN users mu ON mu.id = m.user_id WHERE m.channel_id = c.id ORDER BY m.ts DESC LIMIT 1) AS last_by
      FROM channels c LEFT JOIN users u ON u.id = c.created_by ORDER BY c.archived, c.created_at`).all(userId, userId, userId).map(c => ({ ...c, archived: !!c.archived }));
  }
  createChannel(name, topic, by) { const id = newId('c_'); this.db.prepare('INSERT INTO channels (id, name, topic, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(id, name, topic, Date.now(), by); return this.channelRow(id); }
  updateChannel(id, f) {
    const sets = [], vals = [];
    if (f.name !== undefined) { sets.push('name = ?'); vals.push(f.name); }
    if (f.topic !== undefined) { sets.push('topic = ?'); vals.push(f.topic); }
    if (f.archived !== undefined) { sets.push('archived = ?', 'archived_at = ?'); vals.push(f.archived ? 1 : 0, f.archived ? Date.now() : null); }
    if (!sets.length) return this.channelRow(id);
    vals.push(id); this.db.prepare('UPDATE channels SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals); return this.channelRow(id);
  }
  messageRow(id) { const m = this.db.prepare('SELECT m.*, u.name AS user_name, u.color AS user_color FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?').get(id); return m ? parseMsg(m) : null; }
  listMessages(channelId, before, limit) {
    const rows = before
      ? this.db.prepare('SELECT m.*, u.name AS user_name, u.color AS user_color FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND m.ts < ? ORDER BY m.ts DESC LIMIT ?').all(channelId, before, limit + 1)
      : this.db.prepare('SELECT m.*, u.name AS user_name, u.color AS user_color FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY m.ts DESC LIMIT ?').all(channelId, limit + 1);
    const hasMore = rows.length > limit; if (hasMore) rows.pop();
    return { messages: rows.reverse().map(parseMsg), hasMore };
  }
  createMessage(channelId, userId, text, att) {
    const id = newId('msg_'); const ts = Date.now();
    this.db.prepare('INSERT INTO messages (id, channel_id, user_id, text, att, ts) VALUES (?, ?, ?, ?, ?, ?)').run(id, channelId, userId, text, att && att.length ? JSON.stringify(att) : null, ts);
    this.db.prepare('UPDATE channels SET last_msg_at = ? WHERE id = ?').run(ts, channelId);
    for (const a of att || []) this.db.prepare('UPDATE files SET message_id = ? WHERE id = ?').run(id, a.id);
    this.markRead(userId, channelId, ts);
    return this.messageRow(id);
  }
  editMessage(id, text) { this.db.prepare('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?').run(text, Date.now(), id); return this.messageRow(id); }
  deleteMessage(id) { this.db.prepare('DELETE FROM messages WHERE id = ?').run(id); }
  markRead(userId, channelId, ts) { this.db.prepare('INSERT INTO channel_reads (user_id, channel_id, last_read) VALUES (?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read = MAX(last_read, excluded.last_read)').run(userId, channelId, ts); }
  unreadChat(userId) { return this.db.prepare('SELECT COUNT(*) AS n FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.archived = 0 AND m.user_id <> ? AND m.ts > COALESCE((SELECT last_read FROM channel_reads r WHERE r.user_id = ? AND r.channel_id = m.channel_id), (SELECT created_at FROM users WHERE id = ?), 0)').get(userId, userId, userId).n; }
  channelMessagesForExport(channelId) { return this.db.prepare('SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY m.ts').all(channelId).map(parseMsg); }

  // ----- dosyalar (sohbet ekleri) -----
  fileAdd(f) { this.db.prepare('INSERT INTO files (id, name, mime, size, ext, uploader, created_at, w, h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(f.id, f.name, f.mime, f.size, f.ext, f.uploader, Date.now(), f.w, f.h); }
  fileGet(id) { return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) || null; }
  fileDelete(id) { this.db.prepare('DELETE FROM files WHERE id = ?').run(id); }
  filesOfMessage(mid) { return this.db.prepare('SELECT * FROM files WHERE message_id = ?').all(mid); }

  stats() {
    return {
      materials: this.db.prepare('SELECT COUNT(*) AS n FROM materials WHERE active = 1 AND deleted_at IS NULL').get().n,
      movements: this.db.prepare('SELECT COUNT(*) AS n FROM movements').get().n,
      alerts: this.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL').get().n,
      orders: this.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('open','partial')").get().n,
    };
  }
}

function fmtNum(n) { return Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 3 }); }
function parseMsg(m) { let att = []; if (m.att) { try { att = JSON.parse(m.att); } catch (e) { att = []; } } return { ...m, att }; }

module.exports = { open, Repo, verifyPassword, hashPassword, token, newId, KIND_PREFIX, fmtNum };
