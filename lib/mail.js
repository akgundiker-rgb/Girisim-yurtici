'use strict';
// Giden e-posta (davetler, şifre sıfırlama, stok alarmları). .env içindeki SMTP_* ile yapılandırılır.
// SMTP yapılandırılmamışsa davet bağlantıları Ekip panelinde gösterilir ve yönetici elle iletir; alarmlar yalnızca
// uygulama içinde ve anlık bildirim olarak gider.

let transport = null;

function configured() { return !!process.env.SMTP_HOST; }

function getTransport() {
  if (transport) return transport;
  const nodemailer = require('nodemailer');
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

async function send({ to, subject, text, html }) {
  if (!configured() || !to || (Array.isArray(to) && !to.length)) return false;
  await getTransport().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
  return true;
}

function inviteMail({ name, inviterName, link, appName }) {
  return {
    subject: `${inviterName} sizi ${appName} uygulamasına davet etti`,
    text: `Sayın ${name},\n\n${inviterName} sizi fabrika malzeme giriş ve sevkiyat takibinin yapıldığı ${appName} uygulamasına davet etti.\n\nŞifrenizi belirleyip giriş yapmak için bu bağlantıyı açın:\n${link}\n\nBağlantı 7 gün geçerlidir. Bu daveti beklemiyorsanız e-postayı dikkate almayabilirsiniz.\n`,
  };
}

function resetMail({ name, link, appName }) {
  return {
    subject: `${appName}: şifrenizi sıfırlayın`,
    text: `Sayın ${name},\n\n${appName} için yeni bir şifre belirlemek üzere bu bağlantıyı kullanın:\n${link}\n\nBağlantı 24 saat geçerlidir. Bu talebi siz yapmadıysanız e-postayı dikkate almayabilirsiniz.\n`,
  };
}

// Stok alarmı: bir malzeme belirlenen minimum sınırın altına düştü.
function alertMail({ appName, material, stock, min, unit, docNo, orderedBy, link }) {
  const n = (v) => Number(v).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
  return {
    subject: `[STOK ALARMI] ${material.name} limitin altına düştü (${n(stock)} ${unit})`,
    text: `${appName} — Stok alarmı\n\nMalzeme: ${material.name} (${material.code})\nMevcut stok: ${n(stock)} ${unit}\nMinimum limit: ${n(min)} ${unit}\n${docNo ? 'Hareket: ' + docNo + (orderedBy ? ' — talimat: ' + orderedBy : '') + '\n' : ''}\nUygulamada görüntülemek için: ${link}\n\nBu e-posta, malzemenin stoğu belirlenen sınırın altına düştüğünde otomatik olarak gönderilir.\n`,
  };
}

module.exports = { configured, send, inviteMail, resetMail, alertMail };
