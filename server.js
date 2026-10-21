'use strict';
// Malzeme Takip — kendi sunucunuzda çalışan fabrika malzeme giriş / sevkiyat takibi.
// HTTP API + WebSocket canlı güncellemeler, SQLite veritabanı, e-posta/şifre ile giriş ve davet.

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { open, Repo, verifyPassword, token, fmtNum } = require('./lib/db');
const mail = require('./lib/mail');
const push = require('./lib/push');
const pdf = require('./lib/pdf');

// ---------- .env ----------
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

const APP_NAME = process.env.APP_NAME || 'Malzeme Takip';
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
// Veritabanının yeri. Barındırma platformunun kalıcı diski her zaman önceliklidir: Railway'de bir Volume bağlandığında
// RAILWAY_VOLUME_MOUNT_PATH değişkeni gelir. Volume yoksa veriler her dağıtımda silinir; bu yüzden açıkça uyarırız.
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const DATA_DIR = path.resolve(__dirname, VOLUME_PATH || process.env.DATA_DIR || './data');
const ON_PLATFORM = !!(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_SERVICE_ID);
const PERSIST_WARNING = ON_PLATFORM && !VOLUME_PATH ? 'Bu servise kalıcı bir disk (Volume) bağlı değil; girilen her şey bir sonraki dağıtımda kaybolur. Railway\'de servise bir Volume ekleyin (bağlama yolu /data), yeniden dağıtımı bekleyin ve hesapları ancak ondan sonra oluşturun.' : '';
const SECURE_COOKIE = BASE_URL.startsWith('https://');
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const TZ = process.env.APP_TZ || 'Europe/Istanbul';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me') console.warn('Uyarı: SESSION_SECRET tanımlı değil. .env.example dosyasını .env olarak kopyalayıp rastgele bir değer verin.');

const PUSH_ON = push.init(process.env.VAPID_SUBJECT || (BASE_URL.startsWith('https://') ? BASE_URL : 'mailto:depo@localhost'));

const db = open(DATA_DIR);
const repo = new Repo(db);
if (repo.userCount() > 0) repo.ensureGeneralChannel(null);
setInterval(() => repo.purgeSessions(), 6 * 3600000).unref();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ---------- yardımcılar ----------
const COOKIE = 'depo_sid';
function parseCookies(str) { const out = {}; (str || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return out; }
function setSessionCookie(res, tok) { res.setHeader('Set-Cookie', `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${SECURE_COOKIE ? '; Secure' : ''}`); }
function clearSessionCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_COOKIE ? '; Secure' : ''}`); }
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, color: u.color, alert_mail: !!u.alert_mail });
const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200;
function domainAllowed(email) { if (!ALLOWED_DOMAINS.length) return true; return ALLOWED_DOMAINS.includes(email.split('@')[1].toLowerCase()); }
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max || 200) : '');
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : NaN; };
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const canWrite = (u) => u.role === 'admin' || u.role === 'member';

// Giriş denemesi sınırı: IP+e-posta başına 15 dakikada 8.
const attempts = new Map();
function tooManyAttempts(key) { const now = Date.now(); const a = (attempts.get(key) || []).filter(t => now - t < 15 * 60000); attempts.set(key, a); return a.length >= 8; }
function noteAttempt(key) { const a = attempts.get(key) || []; a.push(Date.now()); attempts.set(key, a); }

function auth(req, res, next) {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]);
  if (!u) return fail(res, 401, 'unauthenticated', 'Devam etmek için giriş yapın.');
  req.user = u; next();
}
function admin(req, res, next) { if (req.user.role !== 'admin') return fail(res, 403, 'forbidden', 'Bu işlem yalnızca yöneticilere açıktır.'); next(); }
function writer(req, res, next) { if (!canWrite(req.user)) return fail(res, 403, 'forbidden', 'Hesabınız yalnızca görüntüleme yetkisine sahip.'); next(); }
// Değişiklik yapan JSON istekleri JSON gövdesi taşımalı — SameSite çerezleriyle birlikte basit bir CSRF önlemi.
function jsonOnly(req, res, next) { if (req.path === '/upload') return next(); if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) return fail(res, 415, 'bad_request', 'JSON gönderin.'); next(); }
app.use('/api', jsonOnly);

// ---------- ayarlar (şirket bilgisi, alarm davranışı) ----------
const DEFAULT_SETTINGS = {
  company: { name: 'Peak PV Solar', address: 'ASO 2 OSB Şubesi Alcı OSB Mah. 2033 Cad. No:16 Sincan / ANKARA', line2: 'Tel: 444 73 40 · info@peakpvsolar.com · www.peakpvsolar.com' },
  allowNegative: false,
  alertEmails: '',          // ek alıcılar (virgülle)
  alertPushAll: true,       // alarmı anlık bildirim olarak tüm kullanıcılara gönder
};
function settings() { return { ...DEFAULT_SETTINGS, ...(repo.getSetting('app', {}) || {}), company: { ...DEFAULT_SETTINGS.company, ...((repo.getSetting('app', {}) || {}).company || {}) } }; }

// ---------- kurulum ve giriş ----------
app.get('/api/status', (req, res) => {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]);
  res.json({ app: APP_NAME, needsSetup: repo.userCount() === 0, mail: mail.configured(), me: u ? publicUser(u) : null, warning: PERSIST_WARNING });
});

app.post('/api/setup', (req, res) => {
  if (repo.userCount() > 0) return fail(res, 409, 'already_setup', 'İlk yönetici zaten oluşturulmuş.');
  const { email, name, password } = req.body || {};
  if (!validEmail(email) || !name || !password || password.length < 8) return fail(res, 400, 'bad_request', 'Ad, geçerli bir e-posta ve en az 8 karakterlik bir şifre gerekir.');
  const u = repo.createUser({ email, name, role: 'admin', password, active: true });
  repo.addActivity({ kind: 'team', userId: u.id, title: `${u.name} çalışma alanını kurdu`, text: 'İlk yönetici hesabı oluşturuldu.' });
  repo.ensureGeneralChannel(u.id);
  setSessionCookie(res, repo.createSession(u.id, req.headers['user-agent']));
  res.json({ me: publicUser(u) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!validEmail(email) || typeof password !== 'string') return fail(res, 400, 'bad_request', 'E-posta ve şifre gerekir.');
  const key = req.ip + '|' + email.toLowerCase();
  if (tooManyAttempts(key)) return fail(res, 429, 'rate_limited', 'Çok fazla deneme yapıldı. 15 dakika bekleyip yeniden deneyin.');
  const u = repo.userByEmail(email);
  if (!u || !u.active || !verifyPassword(password, u.pass_hash)) { noteAttempt(key); return fail(res, 401, 'bad_credentials', 'E-posta veya şifre doğru değil.'); }
  repo.touchUser(u.id);
  setSessionCookie(res, repo.createSession(u.id, req.headers['user-agent']));
  res.json({ me: publicUser(u) });
});

app.post('/api/logout', (req, res) => { const t = parseCookies(req.headers.cookie)[COOKIE]; if (t) repo.deleteSession(t); clearSessionCookie(res); res.json({ ok: true }); });

app.get('/api/invite/:token', (req, res) => {
  const u = repo.userByInvite(req.params.token);
  if (!u) return fail(res, 404, 'not_found', 'Bu davet bağlantısı geçersiz veya süresi dolmuş. Yöneticiden yeni bir bağlantı isteyin.');
  res.json({ name: u.name, email: u.email, hasPassword: !!u.pass_hash });
});
app.post('/api/invite/accept', (req, res) => {
  const { token: t, name, password } = req.body || {};
  const u = repo.userByInvite(String(t || ''));
  if (!u) return fail(res, 404, 'not_found', 'Bu davet bağlantısı geçersiz veya süresi dolmuş.');
  if (!password || password.length < 8) return fail(res, 400, 'bad_request', 'Şifre en az 8 karakter olmalıdır.');
  repo.acceptInvite(u.id, name, password);
  repo.deleteUserSessions(u.id);
  setSessionCookie(res, repo.createSession(u.id, req.headers['user-agent']));
  res.json({ me: publicUser(repo.userById(u.id)) });
});
app.post('/api/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (!validEmail(email)) return fail(res, 400, 'bad_request', 'Geçerli bir e-posta adresi girin.');
  if (!mail.configured()) return fail(res, 400, 'mail_off', 'Bu sunucuda e-posta gönderimi yapılandırılmamış. Yöneticiden sıfırlama bağlantısı isteyin.');
  const u = repo.userByEmail(email);
  if (u && u.active) { const t = repo.setInvite(u.id, 1); try { await mail.send({ to: u.email, ...mail.resetMail({ name: u.name, link: `${BASE_URL}/invite/${t}`, appName: APP_NAME }) }); } catch (e) { console.error('mail', e.message); } }
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const s = settings();
  res.json({ me: publicUser(req.user), app: APP_NAME, push: PUSH_ON, mail: mail.configured(), tz: TZ, settings: { company: s.company, allowNegative: !!s.allowNegative, alertEmails: req.user.role === 'admin' ? s.alertEmails : undefined, alertPushAll: !!s.alertPushAll }, team: repo.activeUsers().map(u => ({ id: u.id, name: u.name, color: u.color, role: u.role })), warning: PERSIST_WARNING, inboxSeen: req.user.inbox_seen, unread: repo.unreadCount(req.user.id, req.user.inbox_seen), chatUnread: repo.unreadChat(req.user.id) });
});
app.post('/api/me', auth, (req, res) => {
  const f = {}; const { name, alert_mail } = req.body || {};
  if (name && typeof name === 'string' && name.trim()) f.name = name.trim().slice(0, 80);
  if (typeof alert_mail === 'boolean') f.alert_mail = alert_mail;
  repo.updateUser(req.user.id, f);
  const u = repo.userById(req.user.id); broadcast({ t: 'team' });
  res.json({ me: publicUser(u) });
});
app.post('/api/me/password', auth, (req, res) => {
  const { current, password } = req.body || {};
  if (!verifyPassword(String(current || ''), req.user.pass_hash)) return fail(res, 400, 'bad_request', 'Mevcut şifre doğru değil.');
  if (!password || password.length < 8) return fail(res, 400, 'bad_request', 'Yeni şifre en az 8 karakter olmalıdır.');
  repo.setPassword(req.user.id, password); res.json({ ok: true });
});

// ---------- ekip yönetimi ----------
app.get('/api/admin/users', auth, admin, (req, res) => res.json({ users: repo.listUsers().map(u => ({ ...u, active: !!u.active, has_password: !!u.has_password, alert_mail: !!u.alert_mail, invitePending: !!u.invite_expires && u.invite_expires > Date.now() })), mail: mail.configured(), storage: { dir: DATA_DIR, volume: VOLUME_PATH || null, platform: ON_PLATFORM, warning: PERSIST_WARNING, ...repo.stats() } }));
app.post('/api/admin/invite', auth, admin, async (req, res) => {
  const { email, name, role } = req.body || {};
  if (!validEmail(email) || !name) return fail(res, 400, 'bad_request', 'Ad ve geçerli bir e-posta gerekir.');
  if (!domainAllowed(email)) return fail(res, 400, 'bad_request', 'Yalnızca şirket e-posta adresleri davet edilebilir (' + ALLOWED_DOMAINS.join(', ') + ').');
  if (repo.userByEmail(email)) return fail(res, 409, 'exists', 'Bu e-posta ile bir kullanıcı zaten var. Onun satırındaki "Yeni davet bağlantısı" düğmesini kullanın.');
  const u = repo.createUser({ email, name, role: ['admin', 'member', 'viewer'].includes(role) ? role : 'member', active: false });
  const t = repo.setInvite(u.id, 7);
  const link = `${BASE_URL}/invite/${t}`;
  let emailed = false; try { emailed = await mail.send({ to: u.email, ...mail.inviteMail({ name: u.name, inviterName: req.user.name, link, appName: APP_NAME }) }); } catch (e) { console.error('mail', e.message); }
  activity({ kind: 'team', userId: req.user.id, title: `${u.name} ekibe davet edildi`, text: `${req.user.name} tarafından, rol: ${roleName(u.role)}.` });
  res.json({ user: publicUser(u), inviteUrl: link, emailed });
});
app.post('/api/admin/users/:id/reset', auth, admin, async (req, res) => {
  const u = repo.userById(req.params.id); if (!u) return fail(res, 404, 'not_found', 'Böyle bir kullanıcı yok.');
  const t = repo.setInvite(u.id, 7); const link = `${BASE_URL}/invite/${t}`;
  let emailed = false; try { emailed = await mail.send({ to: u.email, ...(u.pass_hash ? mail.resetMail({ name: u.name, link, appName: APP_NAME }) : mail.inviteMail({ name: u.name, inviterName: req.user.name, link, appName: APP_NAME })) }); } catch (e) { console.error('mail', e.message); }
  res.json({ inviteUrl: link, emailed });
});
app.post('/api/admin/users/:id', auth, admin, (req, res) => {
  const u = repo.userById(req.params.id); if (!u) return fail(res, 404, 'not_found', 'Böyle bir kullanıcı yok.');
  const f = {}; const { role, active, name, alert_mail } = req.body || {};
  if (role && ['admin', 'member', 'viewer'].includes(role)) f.role = role;
  if (typeof active === 'boolean') f.active = active;
  if (typeof alert_mail === 'boolean') f.alert_mail = alert_mail;
  if (name && typeof name === 'string') f.name = name.trim().slice(0, 80);
  if (u.id === req.user.id && (f.role === 'member' || f.role === 'viewer' || f.active === false)) return fail(res, 400, 'bad_request', 'Kendi yönetici yetkinizi kaldıramazsınız.');
  repo.updateUser(u.id, f);
  if (f.active === false) { repo.deleteUserSessions(u.id); dropUserSockets(u.id); }
  broadcast({ t: 'team' });
  res.json({ user: publicUser(repo.userById(u.id)) });
});
app.get('/api/admin/settings', auth, admin, (req, res) => res.json({ settings: settings() }));
app.post('/api/admin/settings', auth, admin, (req, res) => {
  const cur = settings(); const b = req.body || {};
  const next = { ...cur };
  if (b.company && typeof b.company === 'object') next.company = { name: str(b.company.name, 160) || cur.company.name, address: str(b.company.address, 240), line2: str(b.company.line2, 160) };
  if (typeof b.allowNegative === 'boolean') next.allowNegative = b.allowNegative;
  if (typeof b.alertPushAll === 'boolean') next.alertPushAll = b.alertPushAll;
  if (typeof b.alertEmails === 'string') next.alertEmails = b.alertEmails.split(/[,;\s]+/).map(s => s.trim()).filter(validEmail).join(', ');
  repo.setSetting('app', next);
  broadcast({ t: 'settings', settings: { company: next.company, allowNegative: next.allowNegative, alertPushAll: next.alertPushAll } });
  res.json({ settings: next });
});
// Tüm veritabanının tutarlı yedeği (yönetici). Geri yüklemek için uygulamayı durdurup data/malzeme.sqlite dosyasını değiştirin.
app.get('/api/admin/backup', auth, admin, (req, res) => {
  const tmp = path.join(DATA_DIR, 'backup-' + Date.now() + '.sqlite');
  try {
    db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'");
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="malzeme-takip-' + todayIso() + '.sqlite"');
    const stream = fs.createReadStream(tmp); stream.pipe(res); stream.on('close', () => fs.unlink(tmp, () => {}));
  } catch (e) { fs.unlink(tmp, () => {}); fail(res, 500, 'server_error', 'Yedek alınamadı: ' + e.message); }
});

// ---------- anlık bildirimler ----------
app.get('/api/push/key', auth, (req, res) => res.json({ enabled: PUSH_ON, publicKey: PUSH_ON ? push.publicKey() : null }));
app.post('/api/push/subscribe', auth, (req, res) => {
  const s = (req.body || {}).subscription;
  if (!PUSH_ON) return fail(res, 400, 'push_off', 'Bu sunucuda anlık bildirimler yapılandırılmamış.');
  if (!s || typeof s.endpoint !== 'string' || !s.keys || !s.keys.p256dh || !s.keys.auth) return fail(res, 400, 'bad_request', 'Geçersiz abonelik.');
  repo.savePushSub(req.user.id, s, req.headers['user-agent']); res.json({ ok: true });
});
app.post('/api/push/unsubscribe', auth, (req, res) => { const e = String((req.body || {}).endpoint || ''); if (e) repo.deletePushSub(e); res.json({ ok: true }); });
app.post('/api/push/test', auth, async (req, res) => {
  if (!PUSH_ON) return fail(res, 400, 'push_off', 'Anlık bildirimler kapalı.');
  const r = await push.sendTo(repo, repo.pushSubsOf(req.user.id), { kind: 'test', title: APP_NAME, body: 'Bildirimler bu cihazda çalışıyor.', tag: 'test', url: '/' });
  res.json(r);
});

// ---------- malzemeler ----------
function cleanMaterial(b, partial) {
  const f = {};
  if (!partial || b.code !== undefined) { f.code = str(b.code, 60); if (!f.code) return { error: 'Malzeme kodu gerekir.' }; }
  if (!partial || b.name !== undefined) { f.name = str(b.name, 160); if (!f.name) return { error: 'Malzeme adı gerekir.' }; }
  if (!partial || b.unit !== undefined) { f.unit = str(b.unit, 20) || 'adet'; }
  if (!partial || b.category !== undefined) f.category = str(b.category, 80);
  if (!partial || b.location !== undefined) f.location = str(b.location, 80);
  if (!partial || b.description !== undefined) f.description = str(b.description, 1000);
  if (!partial || b.min_stock !== undefined) { const n = b.min_stock === '' || b.min_stock === null || b.min_stock === undefined ? 0 : num(b.min_stock); if (Number.isNaN(n) || n < 0) return { error: 'Minimum stok limiti sıfır veya pozitif bir sayı olmalıdır.' }; f.min_stock = n; }
  if (partial && typeof b.active === 'boolean') f.active = b.active;
  return { f };
}
app.get('/api/materials', auth, (req, res) => res.json({ materials: repo.listMaterials(req.query.all === '1'), categories: repo.categories(), locations: repo.locations(), units: repo.units() }));
app.get('/api/materials/deleted', auth, admin, (req, res) => res.json({ materials: repo.listDeletedMaterials() }));
app.get('/api/materials/:id', auth, (req, res) => {
  const m = repo.materialRow(req.params.id); if (!m) return fail(res, 404, 'not_found', 'Malzeme bulunamadı.');
  res.json({ material: { ...m, open_alert: (repo.openAlert(m.id) || {}).id || null }, history: repo.materialHistory(m.id, 300), alerts: db.prepare('SELECT * FROM alerts WHERE material_id = ? ORDER BY opened_at DESC LIMIT 20').all(m.id) });
});
app.post('/api/materials', auth, writer, (req, res) => {
  const c = cleanMaterial(req.body || {}, false); if (c.error) return fail(res, 400, 'bad_request', c.error);
  if (repo.materialByCode(c.f.code)) return fail(res, 409, 'exists', 'Bu kodla bir malzeme zaten var: ' + c.f.code);
  const m = repo.createMaterial(c.f, req.user.id);
  activity({ kind: 'material', userId: req.user.id, title: `Yeni malzeme: ${m.name}`, text: `${m.code} · birim ${m.unit}${m.min_stock ? ' · min. ' + fmtNum(m.min_stock) : ''}`, ref: { materialId: m.id } });
  broadcast({ t: 'material', material: withAlert(m) });
  evaluateAlerts([m.id], null, req.user);
  res.json({ material: withAlert(repo.materialRow(m.id)) });
});
app.patch('/api/materials/:id', auth, writer, (req, res) => {
  const cur = repo.materialRow(req.params.id); if (!cur) return fail(res, 404, 'not_found', 'Malzeme bulunamadı.');
  const c = cleanMaterial(req.body || {}, true); if (c.error) return fail(res, 400, 'bad_request', c.error);
  if (c.f.code && c.f.code.toLowerCase() !== cur.code.toLowerCase() && repo.materialByCode(c.f.code)) return fail(res, 409, 'exists', 'Bu kodla başka bir malzeme var: ' + c.f.code);
  const m = repo.updateMaterial(cur.id, c.f, req.user.id);
  if (c.f.min_stock !== undefined && c.f.min_stock !== cur.min_stock) activity({ kind: 'material', userId: req.user.id, title: `${m.name}: minimum limit ${fmtNum(c.f.min_stock)} ${m.unit}`, text: `Önceki limit ${fmtNum(cur.min_stock)} ${cur.unit}.`, ref: { materialId: m.id } });
  else if (c.f.active === false) activity({ kind: 'material', userId: req.user.id, title: `${m.name} pasife alındı`, text: m.code, ref: { materialId: m.id } });
  else if (c.f.active === true) activity({ kind: 'material', userId: req.user.id, title: `${m.name} yeniden aktif`, text: m.code, ref: { materialId: m.id } });
  else activity({ kind: 'material', userId: req.user.id, title: `${m.name} güncellendi`, text: m.code, ref: { materialId: m.id } });
  broadcast({ t: 'material', material: withAlert(m) });
  evaluateAlerts([m.id], null, req.user);
  res.json({ material: withAlert(repo.materialRow(m.id)) });
});
// Yönetici bir kartı gerekli gördüğünde siler. Hareketi olmayan kart kalıcı olarak silinir; hareketi olan kart listelerden,
// aramalardan ve alarmlardan kaldırılır ama geçmiş belgeleri ve PDF fişleri değişmez (yönetici ayarlarından geri alınabilir).
app.delete('/api/materials/:id', auth, admin, (req, res) => {
  const m = repo.materialRow(req.params.id); if (!m || m.deleted_at) return res.json({ ok: true, mode: 'none' });
  const openAlert = repo.openAlert(m.id);
  const mode = repo.deleteMaterial(m.id, req.user.id);
  activity({ kind: 'material', userId: req.user.id, title: `${m.name} silindi`, text: mode === 'soft' ? `${m.code} · hareket geçmişi ve fişler saklandı` : `${m.code} · kalıcı olarak silindi`, ref: mode === 'soft' ? { materialId: m.id } : null });
  broadcast({ t: 'material', material: { id: m.id }, removed: true });
  if (openAlert) broadcast({ t: 'alert', alert: repo.alertRow(openAlert.id), resolved: true });
  res.json({ ok: true, mode });
});
app.post('/api/materials/:id/restore', auth, admin, (req, res) => {
  const m = repo.materialRow(req.params.id); if (!m || !m.deleted_at) return fail(res, 404, 'not_found', 'Silinmiş kart bulunamadı.');
  const clash = repo.materialByCode(m.code); if (clash) return fail(res, 409, 'exists', `"${m.code}" kodu artık başka bir kartta kullanılıyor (${clash.name}). Önce o kartın kodunu değiştirin.`);
  const r = repo.restoreMaterial(m.id, req.user.id);
  activity({ kind: 'material', userId: req.user.id, title: `${r.name} geri alındı`, text: r.code, ref: { materialId: r.id } });
  broadcast({ t: 'material', material: withAlert(r) });
  evaluateAlerts([r.id], null, req.user);
  res.json({ material: withAlert(repo.materialRow(r.id)) });
});
function withAlert(m) { if (!m) return m; return { ...m, open_alert: (repo.openAlert(m.id) || {}).id || null }; }

// ---------- hareketler (giriş / sevkiyat / düzeltme belgeleri) ----------
app.get('/api/movements', auth, (req, res) => {
  const q = req.query;
  const kind = ['in', 'out', 'adj'].includes(q.kind) ? q.kind : '';
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50)); const offset = Math.max(0, Number(q.offset) || 0);
  const r = repo.listMovements({ kind, from: validDate(q.from) ? q.from : '', to: validDate(q.to) ? q.to : '', materialId: str(q.material, 60), q: str(q.q, 80), limit, offset, includeCancelled: q.cancelled === '1' });
  res.json({ movements: r.rows, total: r.total, limit, offset });
});
app.get('/api/movements/suggest', auth, (req, res) => res.json({ orderedBy: repo.orderedByNames(), suppliers: repo.counterparties('in'), destinations: repo.counterparties('out'), team: repo.activeUsers().map(u => u.name) }));
app.get('/api/movements/:id', auth, (req, res) => { const mv = repo.movementRow(req.params.id); if (!mv) return fail(res, 404, 'not_found', 'Belge bulunamadı.'); res.json({ movement: mv }); });
app.post('/api/movements', auth, writer, (req, res) => {
  const b = req.body || {};
  const kind = ['in', 'out', 'adj'].includes(b.kind) ? b.kind : null; if (!kind) return fail(res, 400, 'bad_request', 'Belge türü giriş, sevkiyat veya düzeltme olmalıdır.');
  const doc_date = validDate(b.doc_date) ? b.doc_date : todayIso();
  const h = { kind, doc_date, ordered_by: str(b.ordered_by, 120), counterparty: str(b.counterparty, 160), reference: str(b.reference, 80), vehicle: str(b.vehicle, 40).toUpperCase(), notes: str(b.notes, 2000) };
  if (!h.ordered_by) return fail(res, 400, 'bad_request', 'Talimatı / siparişi veren kişi belirtilmelidir.');
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  if (!rawLines.length) return fail(res, 400, 'bad_request', 'En az bir malzeme satırı ekleyin.');
  if (rawLines.length > 200) return fail(res, 400, 'bad_request', 'Bir belgede en fazla 200 satır olabilir.');
  const lines = [];
  for (const l of rawLines) {
    const m = repo.materialRow(str(l && l.material_id, 60)); if (!m) return fail(res, 400, 'bad_request', 'Satırlardan birinde geçersiz malzeme var.');
    if (m.deleted_at) return fail(res, 400, 'bad_request', `"${m.name}" kartı silinmiş; hareket girilemez.`);
    if (!m.active) return fail(res, 400, 'bad_request', `"${m.name}" pasif durumda; hareket girilemez.`);
    const q = num(l.qty);
    if (Number.isNaN(q) || q === 0 || (kind !== 'adj' && q < 0)) return fail(res, 400, 'bad_request', `"${m.name}" için miktar ${kind === 'adj' ? 'sıfırdan farklı (artı veya eksi) ' : 'pozitif '}bir sayı olmalıdır.`);
    lines.push({ material_id: m.id, qty: q, note: str(l.note, 200) });
  }
  let mv;
  try { mv = repo.createMovement(h, lines, req.user.id, !!settings().allowNegative); }
  catch (e) { if (e.code === 'insufficient_stock') return fail(res, 409, 'insufficient_stock', e.message); console.error(e); return fail(res, 500, 'server_error', 'Belge kaydedilemedi: ' + e.message); }
  activity({ kind: 'movement', userId: req.user.id, title: `${kindName(kind)}: ${mv.doc_no}`, text: `${mv.lines.length} kalem · talimat: ${mv.ordered_by}${mv.counterparty ? ' · ' + mv.counterparty : ''}`, ref: { movementId: mv.id } });
  broadcast({ t: 'movement', movement: mv });
  for (const id of new Set(mv.lines.map(l => l.material_id))) broadcast({ t: 'material', material: withAlert(repo.materialRow(id)) });
  evaluateAlerts([...new Set(mv.lines.map(l => l.material_id))], mv, req.user);
  res.json({ movement: mv });
});
app.patch('/api/movements/:id', auth, writer, (req, res) => {
  const cur = repo.movementRow(req.params.id); if (!cur) return fail(res, 404, 'not_found', 'Belge bulunamadı.');
  if (cur.cancelled) return fail(res, 409, 'cancelled', 'İptal edilmiş bir belge düzenlenemez.');
  if (cur.created_by !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'forbidden', 'Belgeyi yalnızca kaydeden kişi veya bir yönetici düzenleyebilir.');
  const b = req.body || {}; const f = {};
  for (const k of ['ordered_by', 'counterparty', 'reference', 'vehicle', 'notes']) if (b[k] !== undefined) f[k] = str(b[k], k === 'notes' ? 2000 : 160);
  if (f.vehicle !== undefined) f.vehicle = f.vehicle.toUpperCase();
  if (f.ordered_by !== undefined && !f.ordered_by) return fail(res, 400, 'bad_request', 'Talimatı veren kişi boş bırakılamaz.');
  if (b.doc_date !== undefined) { if (!validDate(b.doc_date)) return fail(res, 400, 'bad_request', 'Geçersiz tarih.'); f.doc_date = b.doc_date; }
  const mv = repo.updateMovementHeader(cur.id, f);
  activity({ kind: 'movement', userId: req.user.id, title: `${mv.doc_no} düzenlendi`, text: 'Belge bilgileri güncellendi (satırlar değişmedi).', ref: { movementId: mv.id } });
  broadcast({ t: 'movement', movement: mv });
  res.json({ movement: mv });
});
app.post('/api/movements/:id/cancel', auth, admin, (req, res) => {
  const cur = repo.movementRow(req.params.id); if (!cur) return fail(res, 404, 'not_found', 'Belge bulunamadı.');
  if (cur.cancelled) return res.json({ movement: cur });
  const mv = repo.cancelMovement(cur.id, req.user.id, str((req.body || {}).reason, 300));
  activity({ kind: 'movement', userId: req.user.id, title: `${mv.doc_no} iptal edildi`, text: mv.cancel_reason || 'Stok etkisi geri alındı.', ref: { movementId: mv.id } });
  broadcast({ t: 'movement', movement: mv });
  for (const id of new Set(mv.lines.map(l => l.material_id))) broadcast({ t: 'material', material: withAlert(repo.materialRow(id)) });
  evaluateAlerts([...new Set(mv.lines.map(l => l.material_id))], mv, req.user);
  res.json({ movement: mv });
});
app.get('/api/movements/:id/pdf', (req, res) => {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]); if (!u) return res.status(401).type('text').send('Bu belgeyi açmak için giriş yapın.');
  const mv = repo.movementRow(req.params.id); if (!mv) return res.status(404).type('text').send('Belge bulunamadı.');
  pdf.render(mv, settings().company).then((buf) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', (req.query.dl !== undefined ? 'attachment' : 'inline') + '; filename*=UTF-8\'\'' + encodeURIComponent(mv.doc_no + '.pdf'));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }).catch((e) => { console.error('pdf', e); res.status(500).type('text').send('PDF oluşturulamadı: ' + e.message); });
});

// ---------- dışa aktarma (CSV, Excel'de açılır) ----------
const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvNum = (v) => String(v ?? '').replace('.', ',');
function sendCsv(res, name, header, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(name));
  res.send('﻿' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n'));
}
app.get('/api/export/stock.csv', (req, res) => {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]); if (!u) return res.status(401).type('text').send('Giriş yapın.');
  const rows = repo.listMaterials(true).map(m => [m.code, m.name, m.category, m.location, m.unit, csvNum(m.stock), csvNum(m.min_stock), m.min_stock > 0 && m.stock < m.min_stock ? 'LİMİTİN ALTINDA' : (m.active ? 'Normal' : 'Pasif'), m.description]);
  sendCsv(res, 'stok-' + todayIso() + '.csv', ['Kod', 'Malzeme', 'Kategori', 'Konum', 'Birim', 'Stok', 'Min. Limit', 'Durum', 'Açıklama'], rows);
});
app.get('/api/export/movements.csv', (req, res) => {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]); if (!u) return res.status(401).type('text').send('Giriş yapın.');
  const q = req.query; const kind = ['in', 'out', 'adj'].includes(q.kind) ? q.kind : '';
  const list = repo.listMovements({ kind, from: validDate(q.from) ? q.from : '', to: validDate(q.to) ? q.to : '', materialId: str(q.material, 60), q: str(q.q, 80), limit: 5000, offset: 0, includeCancelled: q.cancelled === '1' }).rows;
  const rows = [];
  for (const r of list) { const mv = repo.movementRow(r.id); for (const l of mv.lines) rows.push([mv.doc_no, kindName(mv.kind), mv.doc_date, l.material_code, l.material_name, l.unit, csvNum(l.qty), csvNum(l.stock_before), csvNum(l.stock_after), mv.ordered_by, mv.counterparty, mv.reference, mv.vehicle, mv.created_by_name, mv.cancelled ? 'İPTAL' : '', l.note || mv.notes]); }
  sendCsv(res, 'hareketler-' + todayIso() + '.csv', ['Belge No', 'Tür', 'Tarih', 'Kod', 'Malzeme', 'Birim', 'Miktar', 'Önceki Stok', 'Sonraki Stok', 'Talimatı Veren', 'Karşı Taraf', 'İrsaliye/Ref', 'Plaka', 'Kaydeden', 'Durum', 'Not'], rows);
});

// ---------- alarmlar ----------
app.get('/api/alerts', auth, (req, res) => res.json({ open: repo.listAlerts({ open: true, limit: 200 }), resolved: repo.listAlerts({ open: false, limit: Math.min(200, Number(req.query.limit) || 50) }) }));
app.post('/api/alerts/:id/ack', auth, writer, (req, res) => {
  const a = repo.alertRow(req.params.id); if (!a) return fail(res, 404, 'not_found', 'Alarm bulunamadı.');
  const r = repo.ackAlert(a.id, req.user.id);
  activity({ kind: 'alert', userId: req.user.id, title: `${a.material_name} alarmı görüldü`, text: `${req.user.name} alarmı onayladı.`, ref: { materialId: a.material_id, alertId: a.id } });
  broadcast({ t: 'alert', alert: r });
  res.json({ alert: r });
});

// Stok sınırının altına düşme kontrolü: her hareketten, iptalden ve limit değişikliğinden sonra çağrılır.
async function evaluateAlerts(materialIds, mv, user) {
  const s = settings();
  for (const id of materialIds) {
    const m = repo.materialRow(id); if (!m) continue;
    const open = repo.openAlert(id);
    const below = m.active && m.min_stock > 0 && m.stock < m.min_stock;
    if (below && !open) {
      const a = repo.createAlert(id, m.stock, m.min_stock, mv ? mv.id : null);
      activity({ kind: 'alert', userId: null, title: `STOK ALARMI: ${m.name}`, text: `Stok ${fmtNum(m.stock)} ${m.unit}, limit ${fmtNum(m.min_stock)} ${m.unit}${mv ? ' · ' + mv.doc_no : ''}`, ref: { materialId: id, alertId: a.id, movementId: mv ? mv.id : null } });
      broadcast({ t: 'alert', alert: a, opened: true });
      notifyAlert(a, m, mv, s).catch(e => console.error('alert notify', e.message));
    } else if (!below && open) {
      const a = repo.resolveAlert(open.id, m.stock);
      activity({ kind: 'alert', userId: null, title: `Alarm kapandı: ${m.name}`, text: `Stok ${fmtNum(m.stock)} ${m.unit}, limit ${fmtNum(m.min_stock)} ${m.unit}.`, ref: { materialId: id, alertId: a.id } });
      broadcast({ t: 'alert', alert: a, resolved: true });
    }
  }
}
async function notifyAlert(a, m, mv, s) {
  const info = { push: 0, mail: [] };
  const link = BASE_URL + '/#/malzeme/' + m.id;
  if (PUSH_ON) {
    const users = s.alertPushAll ? null : repo.activeUsers().filter(u => u.role === 'admin').map(u => u.id);
    const r = await push.sendTo(repo, repo.pushSubs(users), { kind: 'alert', title: 'Stok alarmı: ' + m.name, body: `Stok ${fmtNum(m.stock)} ${m.unit} — limit ${fmtNum(m.min_stock)} ${m.unit}${mv ? ' (' + mv.doc_no + ')' : ''}`, tag: 'alert-' + m.id, url: '/#/malzeme/' + m.id, urgency: 'high' });
    info.push = r.sent;
  }
  if (mail.configured()) {
    const to = new Set(repo.activeUsers().filter(u => u.alert_mail).map(u => u.email));
    for (const e of String(s.alertEmails || '').split(',').map(x => x.trim()).filter(Boolean)) to.add(e);
    if (to.size) { try { await mail.send({ to: [...to], ...mail.alertMail({ appName: APP_NAME, material: m, stock: m.stock, min: m.min_stock, unit: m.unit, docNo: mv ? mv.doc_no : '', orderedBy: mv ? mv.ordered_by : '', link }) }); info.mail = [...to]; } catch (e) { console.error('alert mail', e.message); info.mailError = e.message; } }
  }
  repo.setAlertNotified(a.id, info);
}

// ---------- sohbet ----------
const CH_NAME = /^[a-z0-9çğıöşü][a-z0-9çğıöşü_-]{0,31}$/;
const normChannel = (n) => String(n || '').trim().toLocaleLowerCase('tr').replace(/\s+/g, '-');
app.get('/api/chat/channels', auth, (req, res) => res.json({ channels: repo.listChannels(req.user.id), unread: repo.unreadChat(req.user.id) }));
app.post('/api/chat/channels', auth, writer, (req, res) => {
  const name = normChannel((req.body || {}).name); const topic = str((req.body || {}).topic, 200);
  if (!CH_NAME.test(name)) return fail(res, 400, 'bad_request', 'Kanal adı 1–32 karakter olmalı; küçük harf, rakam, tire ve alt çizgi kullanılabilir.');
  if (repo.channelByName(name)) return fail(res, 409, 'exists', 'Bu adda bir kanal zaten var.');
  const c = repo.createChannel(name, topic, req.user.id);
  activity({ kind: 'chat', userId: req.user.id, title: `Yeni kanal: #${c.name}`, text: topic, ref: { channelId: c.id } });
  broadcast({ t: 'channel', channel: { ...c, archived: !!c.archived } });
  res.json({ channel: c });
});
app.patch('/api/chat/channels/:id', auth, writer, (req, res) => {
  const c = repo.channelRow(req.params.id); if (!c) return fail(res, 404, 'not_found', 'Kanal bulunamadı.');
  const b = req.body || {}; const f = {};
  if (b.name !== undefined) { const n = normChannel(b.name); if (!CH_NAME.test(n)) return fail(res, 400, 'bad_request', 'Geçersiz kanal adı.'); const o = repo.channelByName(n); if (o && o.id !== c.id) return fail(res, 409, 'exists', 'Bu adda bir kanal zaten var.'); f.name = n; }
  if (b.topic !== undefined) f.topic = str(b.topic, 200);
  if (typeof b.archived === 'boolean') { if (req.user.role !== 'admin') return fail(res, 403, 'forbidden', 'Kanalları yalnızca yöneticiler arşivler.'); f.archived = b.archived; }
  const r = repo.updateChannel(c.id, f);
  if (f.archived !== undefined) activity({ kind: 'chat', userId: req.user.id, title: `#${r.name} ${f.archived ? 'arşivlendi' : 'arşivden çıkarıldı'}`, text: '', ref: { channelId: r.id } });
  broadcast({ t: 'channel', channel: { ...r, archived: !!r.archived } });
  res.json({ channel: r });
});
app.get('/api/chat/channels/:id/messages', auth, (req, res) => {
  const c = repo.channelRow(req.params.id); if (!c) return fail(res, 404, 'not_found', 'Kanal bulunamadı.');
  const before = Number(req.query.before) || 0; const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  res.json(repo.listMessages(c.id, before, limit));
});
app.get('/api/chat/channels/:id/export', (req, res) => {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]); if (!u) return res.status(401).type('text').send('Giriş yapın.');
  const c = repo.channelRow(req.params.id); if (!c) return res.status(404).type('text').send('Kanal bulunamadı.');
  const msgs = repo.channelMessagesForExport(c.id); const dt = (ts) => new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  let md = `# #${c.name}\n\n${c.topic ? c.topic + '\n\n' : ''}Dışa aktarım: ${dt(Date.now())} · ${u.name} · ${msgs.length} mesaj\n\n---\n\n`;
  for (const m of msgs) md += `**${m.user_name || '—'}** · ${dt(m.ts)}${m.edited_at ? ' (düzenlendi)' : ''}\n${m.text || ''}${m.att.length ? '\n' + m.att.map(a => `${/^image\//.test(a.mime) ? '!' : ''}[${a.name}](${BASE_URL}/files/${a.id}/${encodeURIComponent(a.name)})`).join('\n') : ''}\n\n`;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(`sohbet-${c.name}-${todayIso()}.md`)); res.send(md);
});
function mentionedUsers(text) {
  const t = String(text || '').toLocaleLowerCase('tr'); if (!t.includes('@')) return [];
  return repo.activeUsers().filter(u => { const full = u.name.toLocaleLowerCase('tr'); const first = full.split(/\s+/)[0]; return t.includes('@' + full) || new RegExp('@' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'u').test(t); });
}
app.post('/api/chat/channels/:id/messages', auth, writer, async (req, res) => {
  const c = repo.channelRow(req.params.id); if (!c) return fail(res, 404, 'not_found', 'Kanal bulunamadı.');
  if (c.archived) return fail(res, 409, 'archived', 'Bu kanal arşivlenmiş; yazılamaz.');
  const b = req.body || {}; const text = str(b.text, 4000);
  const att = (Array.isArray(b.att) ? b.att : []).slice(0, 10).map(a => repo.fileGet(str(a && a.id, 40))).filter(Boolean).map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, w: f.w, h: f.h }));
  if (!text && !att.length) return fail(res, 400, 'bad_request', 'Boş mesaj gönderilemez.');
  const m = repo.createMessage(c.id, req.user.id, text, att);
  broadcast({ t: 'chat', message: m, channelId: c.id });
  const mentioned = mentionedUsers(text).filter(u => u.id !== req.user.id);
  for (const u of mentioned) activity({ kind: 'chat', userId: req.user.id, title: `#${c.name}: ${req.user.name} sizden bahsetti`, text: text.slice(0, 140), ref: { channelId: c.id, messageId: m.id, forUser: u.id } });
  if (PUSH_ON) {
    const online = new Set([...clients].map(x => x.user.id));
    const targets = repo.activeUsers().filter(u => u.id !== req.user.id && (!online.has(u.id) || mentioned.some(x => x.id === u.id))).map(u => u.id);
    const preview = text ? text.slice(0, 120) : (att.length === 1 ? att[0].name : att.length + ' dosya');
    push.sendTo(repo, repo.pushSubs(targets), { kind: 'chat', title: `#${c.name} · ${req.user.name}`, body: preview, tag: 'chat-' + c.id, url: '/#/sohbet/' + c.id }).catch(() => {});
  }
  res.json({ message: m });
});
app.patch('/api/chat/messages/:id', auth, writer, (req, res) => {
  const m = repo.messageRow(req.params.id); if (!m) return fail(res, 404, 'not_found', 'Mesaj bulunamadı.');
  if (m.user_id !== req.user.id) return fail(res, 403, 'forbidden', 'Yalnızca kendi mesajınızı düzenleyebilirsiniz.');
  const text = str((req.body || {}).text, 4000); if (!text && !m.att.length) return fail(res, 400, 'bad_request', 'Mesaj boş olamaz.');
  const r = repo.editMessage(m.id, text); broadcast({ t: 'chat-edit', message: r, channelId: r.channel_id }); res.json({ message: r });
});
app.delete('/api/chat/messages/:id', auth, (req, res) => {
  const m = repo.messageRow(req.params.id); if (!m) return res.json({ ok: true });
  if (m.user_id !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'forbidden', 'Mesajı yalnızca yazan kişi veya bir yönetici silebilir.');
  for (const f of repo.filesOfMessage(m.id)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.id + '.' + f.ext)); } catch (e) {} repo.fileDelete(f.id); }
  repo.deleteMessage(m.id); broadcast({ t: 'chat-del', id: m.id, channelId: m.channel_id }); res.json({ ok: true });
});
app.post('/api/chat/channels/:id/read', auth, (req, res) => { const ts = Number((req.body || {}).ts) || Date.now(); repo.markRead(req.user.id, req.params.id, ts); res.json({ ok: true, unread: repo.unreadChat(req.user.id) }); });

// Sohbet ekleri: dosyalar veritabanının yanında (DATA_DIR/uploads) saklanır ve yalnızca giriş yapmış kullanıcılara verilir.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const UPLOAD_MAX = 25 * 1024 * 1024;
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'application/acad': 'dwg', 'image/vnd.dwg': 'dwg' };
const safeName = (n) => String(n || 'dosya').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'dosya';
app.post('/api/upload', auth, writer, express.raw({ type: '*/*', limit: UPLOAD_MAX }), (req, res) => {
  const mime = String(req.query.type || req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = UPLOAD_TYPES[mime]; if (!ext) return fail(res, 415, 'unsupported', 'Bu dosya türü desteklenmiyor. Fotoğraf (JPG, PNG, GIF, WebP), PDF, Office belgeleri, metin ve zip dosyaları kabul edilir.');
  const buf = req.body; if (!Buffer.isBuffer(buf) || !buf.length) return fail(res, 400, 'bad_request', 'Boş dosya.');
  const id = token(12); const name = safeName(req.query.name);
  try { fs.writeFileSync(path.join(UPLOAD_DIR, id + '.' + ext), buf); } catch (e) { return fail(res, 500, 'server_error', 'Dosya kaydedilemedi: ' + e.message); }
  const w = Number(req.query.w) || null, h = Number(req.query.h) || null;
  repo.fileAdd({ id, name, mime, size: buf.length, ext, uploader: req.user.id, w, h });
  res.json({ id, name, mime, size: buf.length, w, h, url: '/files/' + id + '/' + encodeURIComponent(name) });
});
app.get(['/files/:id', '/files/:id/:name'], (req, res) => {
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]); if (!u) return res.status(401).type('text').send('Bu dosyayı açmak için giriş yapın.');
  const f = repo.fileGet(String(req.params.id)); if (!f) return res.status(404).type('text').send('Dosya bulunamadı.');
  const file = path.join(UPLOAD_DIR, f.id + '.' + f.ext); if (!fs.existsSync(file)) return res.status(404).type('text').send('Dosya bulunamadı.');
  const inlineOk = /^image\//.test(f.mime) || f.mime === 'application/pdf' || f.mime === 'text/plain';
  res.setHeader('Content-Type', f.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', (inlineOk && req.query.dl === undefined ? 'inline' : 'attachment') + '; filename*=UTF-8\'\'' + encodeURIComponent(f.name));
  res.sendFile(file);
});

// ---------- genel bakış ----------
app.get('/api/dashboard', auth, (req, res) => {
  const today = todayIso();
  const weekAgo = new Date(Date.now() - 6 * 86400000); const weekIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(weekAgo);
  const todayCounts = repo.movementCountsSince(today); const weekCounts = repo.movementCountsSince(weekIso);
  const pick = (arr, k) => (arr.find(x => x.kind === k) || { n: 0, qty: 0 });
  const materials = repo.listMaterials(false);
  const low = materials.filter(m => m.min_stock > 0 && m.stock < m.min_stock);
  const near = materials.filter(m => m.min_stock > 0 && m.stock >= m.min_stock && m.stock < m.min_stock * 1.2);
  res.json({
    today, materials: materials.length, low: low.length, near: near.length, noLimit: materials.filter(m => !(m.min_stock > 0)).length,
    todayIn: pick(todayCounts, 'in').n, todayOut: pick(todayCounts, 'out').n, weekIn: pick(weekCounts, 'in').n, weekOut: pick(weekCounts, 'out').n,
    recent: repo.listMovements({ limit: 12, offset: 0 }).rows, alerts: repo.listAlerts({ open: true, limit: 50 }),
    lowList: low.sort((a, b) => (a.stock / a.min_stock) - (b.stock / b.min_stock)).slice(0, 20), nearList: near.slice(0, 10),
  });
});

// ---------- bildirimler (zil) ----------
app.get('/api/activity', auth, (req, res) => res.json({ items: repo.listActivity(Math.min(300, Number(req.query.limit) || 120)).filter(a => !(a.ref && a.ref.forUser) || a.ref.forUser === req.user.id), seen: repo.userById(req.user.id).inbox_seen }));
app.post('/api/activity/seen', auth, (req, res) => { const ts = Number((req.body || {}).ts) || Date.now(); repo.setInboxSeen(req.user.id, ts); res.json({ ok: true, seen: ts }); });
function activity(a) { const row = repo.addActivity(a); const to = a.ref && a.ref.forUser; const msg = JSON.stringify({ t: 'activity', item: row }); for (const c of clients) if ((!to || c.user.id === to) && c.ws.readyState === 1) c.ws.send(msg); return row; }

const kindName = (k) => k === 'in' ? 'Giriş' : k === 'out' ? 'Sevkiyat' : 'Düzeltme';
const roleName = (r) => r === 'admin' ? 'yönetici' : r === 'viewer' ? 'görüntüleyici' : 'kullanıcı';

// ---------- statik dosyalar ve sayfalar ----------
const PUB = path.join(__dirname, 'public');
const staticOpts = { maxAge: '7d', etag: true, index: false, setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } };
app.use('/fonts', express.static(path.join(PUB, 'fonts'), { maxAge: '365d', immutable: true }));
app.use('/img', express.static(path.join(PUB, 'img'), { maxAge: '7d', etag: true }));
app.get(['/styles.css', '/app.js', '/pwa.js', '/offline.html'], (req, res) => res.sendFile(path.join(PUB, req.path.slice(1)), { maxAge: '7d' }));
app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(PUB, 'manifest.webmanifest'), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' } }));
app.get('/sw.js', (req, res) => res.sendFile(path.join(PUB, 'sw.js'), { headers: { 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' } }));
app.get(['/login', '/setup', '/invite/:token'], (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.join(PUB, 'login.html')); });
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (repo.userCount() === 0) return res.redirect('/setup');
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]);
  if (!u) return res.redirect('/login');
  res.sendFile(path.join(PUB, 'index.html'));
});
app.use((req, res) => { if (req.path.startsWith('/api/')) return fail(res, 404, 'not_found', 'Böyle bir adres yok.'); res.redirect('/'); });
app.use((err, req, res, next) => { if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'bad_request', 'Geçersiz JSON.'); if (err && err.type === 'entity.too.large') return fail(res, 413, 'too_large', 'İstek çok büyük.'); console.error(err); fail(res, 500, 'server_error', 'Sunucu hatası.'); });

// ---------- WebSocket: canlı güncellemeler ve çevrimiçi kişiler ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();
let peerSeq = 0;
server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  const u = repo.userBySession(parseCookies(req.headers.cookie)[COOKIE]);
  if (!u) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, u));
});
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
function peersPayload() { const seen = new Map(); for (const c of clients) seen.set(c.user.id, { id: c.user.id, name: c.user.name, color: c.user.color }); return [...seen.values()]; }
let peersTimer = null;
function broadcastPeers() { if (peersTimer) return; peersTimer = setTimeout(() => { peersTimer = null; broadcast({ t: 'peers', peers: peersPayload() }); }, 80); }
function broadcast(msg) { const s = JSON.stringify(msg); for (const c of clients) if (c.ws.readyState === 1) c.ws.send(s); }
function dropUserSockets(userId) { for (const c of clients) if (c.user.id === userId) { try { c.ws.close(4401, 'deactivated'); } catch (e) {} } }
wss.on('connection', (ws, req, user) => {
  const c = { ws, user, peer: 'p' + (++peerSeq).toString(36) + token(6), alive: true };
  clients.add(c);
  send(ws, { t: 'hello', peer: c.peer, me: publicUser(user), peers: peersPayload() });
  broadcastPeers();
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; } if (!m) return;
    if (m.t === 'ping') send(ws, { t: 'pong' });
    else if (m.t === 'typing' && typeof m.cid === 'string' && canWrite(user)) { const out = JSON.stringify({ t: 'typing', cid: m.cid.slice(0, 40), by: { id: user.id, name: user.name } }); for (const o of clients) if (o !== c && o.ws.readyState === 1) o.ws.send(out); }
  });
  ws.on('close', () => { clients.delete(c); broadcastPeers(); });
  ws.on('error', () => {});
});
setInterval(() => { for (const c of clients) { if (!c.alive) { try { c.ws.terminate(); } catch (e) {} clients.delete(c); continue; } c.alive = false; try { c.ws.ping(); } catch (e) {} } }, 30000).unref();

server.listen(PORT, () => {
  console.log(`${APP_NAME} http://localhost:${PORT} adresinde dinliyor  (genel adres: ${BASE_URL})`);
  if (repo.userCount() === 0) console.log(`Henüz kullanıcı yok. İlk yöneticiyi oluşturmak için ${BASE_URL}/setup adresini açın.`);
  console.log(`Veri dizini: ${DATA_DIR}${VOLUME_PATH ? ' (kalıcı disk)' : ''}  ·  e-posta: ${mail.configured() ? 'yapılandırıldı' : 'yapılandırılmadı (davet bağlantıları Ekip panelinde gösterilir)'}  ·  anlık bildirim: ${PUSH_ON ? 'açık' : 'kapalı (VAPID anahtarları gerekir)'}`);
  if (PERSIST_WARNING) console.warn('\nUYARI: ' + PERSIST_WARNING + '\n');
});
