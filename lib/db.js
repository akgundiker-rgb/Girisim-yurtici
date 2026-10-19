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
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'adet',
      category TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', min_stock REAL NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, created_by TEXT, updated_at INTEGER NOT NULL, updated_by TEXT
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
  `);
  return db;
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

const KIND_PREFIX = { in: 'GRS', out: 'SVK', adj: 'DZL' };
const STOCK_SQL = `COALESCE((SELECT SUM(CASE mv.kind WHEN 'in' THEN l.qty WHEN 'out' THEN -l.qty ELSE l.qty END)
  FROM movement_lines l JOIN movements mv ON mv.id = l.movement_id WHERE l.material_id = m.id AND mv.cancelled = 0), 0)`;

// ---------- repository ----------
class Repo {
  constructor(db) { this.db = db; }
  tx(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { try { this.db.exec('ROLLBACK'); } catch (e2) {} throw e; } }

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
  materialByCode(code) { return this.db.prepare('SELECT * FROM materials WHERE lower(code) = lower(?)').get(code.trim()); }
  listMaterials(includeInactive) {
    return this.db.prepare(`SELECT m.*, ${STOCK_SQL} AS stock,
      (SELECT id FROM alerts a WHERE a.material_id = m.id AND a.resolved_at IS NULL ORDER BY opened_at DESC LIMIT 1) AS open_alert,
      (SELECT MAX(mv.created_at) FROM movement_lines l JOIN movements mv ON mv.id = l.movement_id WHERE l.material_id = m.id AND mv.cancelled = 0) AS last_move
      FROM materials m ${includeInactive ? '' : 'WHERE m.active = 1'} ORDER BY m.name COLLATE NOCASE`).all();
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
  deleteMaterial(id) { this.db.prepare('DELETE FROM alerts WHERE material_id = ?').run(id); this.db.prepare('DELETE FROM materials WHERE id = ?').run(id); }
  categories() { return this.db.prepare("SELECT DISTINCT category FROM materials WHERE category <> '' ORDER BY category COLLATE NOCASE").all().map(r => r.category); }
  locations() { return this.db.prepare("SELECT DISTINCT location FROM materials WHERE location <> '' ORDER BY location COLLATE NOCASE").all().map(r => r.location); }
  units() { return this.db.prepare('SELECT DISTINCT unit FROM materials ORDER BY unit COLLATE NOCASE').all().map(r => r.unit); }
  stockOf(materialId) { return this.db.prepare(`SELECT ${STOCK_SQL} AS stock FROM materials m WHERE m.id = ?`).get(materialId)?.stock || 0; }

  // ----- movements -----
  movementRow(id) {
    const mv = this.db.prepare('SELECT mv.*, u.name AS created_by_name, cu.name AS cancelled_by_name FROM movements mv LEFT JOIN users u ON u.id = mv.created_by LEFT JOIN users cu ON cu.id = mv.cancelled_by WHERE mv.id = ?').get(id);
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
      this.db.prepare('INSERT INTO movements (id, doc_no, kind, doc_date, ordered_by, counterparty, reference, vehicle, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, docNo, h.kind, h.doc_date, h.ordered_by, h.counterparty, h.reference, h.vehicle, h.notes, now, by);
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
    this.db.prepare('UPDATE movements SET cancelled = 1, cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ? AND cancelled = 0').run(Date.now(), by, reason || '', id);
    return this.movementRow(id);
  }

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
  unreadCount(userId, seen) { return this.db.prepare('SELECT COUNT(*) AS n FROM activity WHERE ts > ? AND (user_id IS NULL OR user_id <> ?)').get(seen || 0, userId).n; }

  stats() {
    return {
      materials: this.db.prepare('SELECT COUNT(*) AS n FROM materials WHERE active = 1').get().n,
      movements: this.db.prepare('SELECT COUNT(*) AS n FROM movements').get().n,
      alerts: this.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL').get().n,
    };
  }
}

function fmtNum(n) { return Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 3 }); }

module.exports = { open, Repo, verifyPassword, hashPassword, token, newId, KIND_PREFIX, fmtNum };
