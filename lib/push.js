'use strict';
// Telefonlara ve bilgisayarlara anlık bildirim (Web Push / VAPID). Tarayıcının push servisi, uygulama kapalıyken bile iletir.
// VAPID_PUBLIC_KEY ve VAPID_PRIVATE_KEY gerekir (bir kez üretin: node -e "console.log(require('web-push').generateVAPIDKeys())").
// Anahtarlar yoksa özellik kapalıdır; uygulama aynen çalışır.

const PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
let webpush = null;

function configured() { return !!(PUBLIC_KEY && PRIVATE_KEY); }

function init(subject) {
  if (!configured()) return false;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(subject, PUBLIC_KEY, PRIVATE_KEY);
    return true;
  } catch (e) { console.error('push: could not initialise —', e.message); webpush = null; return false; }
}

// Send one payload to a list of subscription rows (from repo.pushSubs). Dead subscriptions (device gone, permission revoked) are removed.
async function sendTo(repo, subs, payload) {
  if (!webpush || !subs.length) return { sent: 0, removed: 0 };
  const body = JSON.stringify({ ...payload, ts: payload.ts || Date.now() });
  let sent = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    if (!s || !s.endpoint || !s.p256dh || !s.auth) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600, urgency: payload.urgency || 'normal' });
      sent++; try { repo.touchPushSub(s.endpoint); } catch (e) {}
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410 || code === 403) { try { repo.deletePushSub(s.endpoint); removed++; } catch (e2) {} }
      else console.warn('push: send failed', code || '', (e && e.body) ? String(e.body).slice(0, 120) : (e && e.message) || '');
    }
  }));
  return { sent, removed };
}

module.exports = { configured, init, sendTo, publicKey: () => PUBLIC_KEY };
