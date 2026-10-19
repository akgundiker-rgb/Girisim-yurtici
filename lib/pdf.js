'use strict';
// PDF fişi: her giriş, sevkiyat ve düzeltme belgesi için A4 çıktısı. Inter yazı tipi gömülür (Türkçe karakterler için).
// Düzen: üstte Peak PV Solar logosu ve şirket bilgisi, sağda belge başlığı ve numarası; sonra belge alanları, satır tablosu,
// imza kutuları ve alt bilgi. İptal edilmiş belgeler kırmızı "İPTAL" damgası taşır.

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const FONTS = {
  regular: path.join(__dirname, 'fonts', 'Inter-Regular.ttf'),
  medium: path.join(__dirname, 'fonts', 'Inter-Medium.ttf'),
  semibold: path.join(__dirname, 'fonts', 'Inter-SemiBold.ttf'),
  bold: path.join(__dirname, 'fonts', 'Inter-Bold.ttf'),
};
const LOGO = path.join(__dirname, '..', 'public', 'img', 'peakpv-logo-dark.png');

const NAVY = '#0d232e'; const TEAL = '#00719c'; const INK = '#1c1c19'; const MUTED = '#6c6c66'; const LINE = '#c0ced0'; const SOFT = '#e3f1f6'; const RED = '#c22820';
const KIND = {
  in: { title: 'MALZEME GİRİŞ FİŞİ', party: 'Tedarikçi / Teslim Eden', sign1: 'Teslim Eden', sign2: 'Teslim Alan', sign3: 'Onaylayan' },
  out: { title: 'MALZEME SEVK FİŞİ', party: 'Teslimat Yeri / Alıcı', sign1: 'Sevk Eden', sign2: 'Teslim Alan', sign3: 'Onaylayan' },
  adj: { title: 'STOK DÜZELTME FİŞİ', party: 'Düzeltme Nedeni / Dayanak', sign1: 'Sayımı Yapan', sign2: 'Kontrol Eden', sign3: 'Onaylayan' },
};

const n3 = (v) => Number(v || 0).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
function fmtDateTime(ts) { if (!ts) return ''; return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)); }

// Returns a Buffer with the finished PDF.
function render(mv, company) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${KIND[mv.kind].title} ${mv.doc_no}`, Author: company.name || 'Peak PV Solar', Creator: 'Malzeme Takip' } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    for (const [k, f] of Object.entries(FONTS)) doc.registerFont(k, f);
    const K = KIND[mv.kind] || KIND.in;
    const W = doc.page.width - 80; const L = 40;
    let y = 40;

    // ----- header -----
    if (fs.existsSync(LOGO)) { try { doc.image(LOGO, L, y, { height: 34 }); } catch (e) {} }
    doc.font('semibold').fontSize(11).fillColor(NAVY).text(company.name || 'Peak PV Solar', L, y + 42, { width: 300 });
    doc.font('regular').fontSize(8.5).fillColor(MUTED).text(company.address || '', L, doc.y + 1, { width: 300 });
    if (company.line2) doc.text(company.line2, L, doc.y + 1, { width: 300 });
    const leftEnd = doc.y;
    doc.font('bold').fontSize(15).fillColor(NAVY).text(K.title, L + 300, y, { width: W - 300, align: 'right' });
    doc.font('semibold').fontSize(11).fillColor(INK).text(mv.doc_no, L + 300, doc.y + 2, { width: W - 300, align: 'right' });
    doc.font('regular').fontSize(9).fillColor(MUTED).text('Belge tarihi: ' + fmtDate(mv.doc_date), L + 300, doc.y + 2, { width: W - 300, align: 'right' });
    doc.text('Kayıt: ' + fmtDateTime(mv.created_at), L + 300, doc.y + 1, { width: W - 300, align: 'right' });
    y = Math.max(leftEnd, doc.y) + 14;
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1.2).strokeColor(TEAL).stroke();
    y += 14;

    // ----- fields -----
    const fields = [
      [K.party, mv.counterparty || '—'],
      ['Talimatı / Siparişi Veren', mv.ordered_by || '—'],
      ['İrsaliye / Referans No', mv.reference || '—'],
      ['Araç Plakası', mv.vehicle || '—'],
      ['Kaydı Yapan', mv.created_by_name || '—'],
      ['Belge Türü', mv.kind === 'in' ? 'Depoya giriş' : mv.kind === 'out' ? 'Depodan sevkiyat / çıkış' : 'Stok düzeltme (sayım)'],
    ];
    const colW = W / 2; const rowH = 30;
    fields.forEach((f, i) => {
      const cx = L + (i % 2) * colW; const cy = y + Math.floor(i / 2) * rowH;
      doc.font('regular').fontSize(7.5).fillColor(MUTED).text(f[0].toUpperCase(), cx, cy, { width: colW - 12, characterSpacing: .4 });
      doc.font('medium').fontSize(10).fillColor(INK).text(f[1], cx, cy + 10, { width: colW - 12, height: 14, ellipsis: true, lineBreak: false });
    });
    y += Math.ceil(fields.length / 2) * rowH + 4;
    if (mv.notes) {
      doc.font('regular').fontSize(7.5).fillColor(MUTED).text('AÇIKLAMA', L, y, { characterSpacing: .4 });
      doc.font('regular').fontSize(9.5).fillColor(INK).text(mv.notes, L, y + 10, { width: W });
      y = doc.y + 8;
    }
    y += 6;

    // ----- lines table -----
    const cols = [
      { k: 'pos', t: '#', w: 22, align: 'right' },
      { k: 'code', t: 'Malzeme Kodu', w: 86 },
      { k: 'name', t: 'Malzeme Adı', w: W - 22 - 86 - 48 - 70 - 70 - 70 },
      { k: 'unit', t: 'Birim', w: 48 },
      { k: 'qty', t: 'Miktar', w: 70, align: 'right' },
      { k: 'before', t: 'Önceki Stok', w: 70, align: 'right' },
      { k: 'after', t: 'Kalan Stok', w: 70, align: 'right' },
    ];
    const drawHead = () => {
      doc.rect(L, y, W, 20).fillColor(SOFT).fill();
      let x = L; doc.font('semibold').fontSize(8).fillColor(NAVY);
      for (const c of cols) { doc.text(c.t, x + 5, y + 6, { width: c.w - 10, align: c.align || 'left', lineBreak: false }); x += c.w; }
      y += 20;
    };
    drawHead();
    doc.font('regular').fontSize(9).fillColor(INK);
    let totalQty = 0;
    for (const l of mv.lines) {
      const nameH = doc.heightOfString(l.material_name + (l.note ? '\n' + l.note : ''), { width: cols[2].w - 10 });
      const h = Math.max(20, nameH + 10);
      if (y + h > doc.page.height - 150) { doc.addPage(); y = 40; drawHead(); doc.font('regular').fontSize(9).fillColor(INK); }
      let x = L;
      const vals = { pos: String(l.pos), code: l.material_code, name: l.material_name, unit: l.unit, qty: (mv.kind === 'adj' && l.qty > 0 ? '+' : '') + n3(l.qty), before: n3(l.stock_before), after: n3(l.stock_after) };
      for (const c of cols) {
        if (c.k === 'name') {
          doc.font('medium').text(l.material_name, x + 5, y + 5, { width: c.w - 10 });
          if (l.note) doc.font('regular').fontSize(8).fillColor(MUTED).text(l.note, x + 5, doc.y, { width: c.w - 10 }), doc.fontSize(9).fillColor(INK);
        } else doc.font(c.k === 'qty' ? 'semibold' : 'regular').text(vals[c.k], x + 5, y + 5, { width: c.w - 10, align: c.align || 'left', lineBreak: false });
        x += c.w;
      }
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(.5).strokeColor(LINE).stroke();
      y += h; totalQty += Number(l.qty) || 0;
    }
    // total row (only meaningful when every line shares a unit)
    const units = new Set(mv.lines.map(l => l.unit));
    doc.font('semibold').fontSize(9).fillColor(INK).text(`${mv.lines.length} kalem`, L + 5, y + 6, { width: 200 });
    if (units.size === 1) doc.text('Toplam: ' + n3(totalQty) + ' ' + [...units][0], L, y + 6, { width: W - 5, align: 'right' });
    y += 24;

    // ----- signatures -----
    if (y > doc.page.height - 170) { doc.addPage(); y = 40; }
    y += 18;
    const sw = (W - 24) / 3;
    [K.sign1, K.sign2, K.sign3].forEach((t, i) => {
      const sx = L + i * (sw + 12);
      doc.rect(sx, y, sw, 78).lineWidth(.8).strokeColor(LINE).stroke();
      doc.font('semibold').fontSize(8.5).fillColor(NAVY).text(t.toUpperCase(), sx + 8, y + 7, { characterSpacing: .3 });
      doc.font('regular').fontSize(7.5).fillColor(MUTED).text('Ad Soyad / İmza / Tarih', sx + 8, y + 62);
      if (i === 0 && mv.kind === 'in' && mv.counterparty) doc.font('regular').fontSize(8.5).fillColor(INK).text(mv.counterparty, sx + 8, y + 22, { width: sw - 16, height: 24, ellipsis: true });
      if (i === 1 && mv.kind === 'in') doc.font('regular').fontSize(8.5).fillColor(INK).text(mv.created_by_name || '', sx + 8, y + 22, { width: sw - 16 });
      if (i === 0 && mv.kind !== 'in') doc.font('regular').fontSize(8.5).fillColor(INK).text(mv.created_by_name || '', sx + 8, y + 22, { width: sw - 16 });
      if (i === 1 && mv.kind === 'out' && mv.counterparty) doc.font('regular').fontSize(8.5).fillColor(INK).text(mv.counterparty, sx + 8, y + 22, { width: sw - 16, height: 24, ellipsis: true });
      if (i === 2 && mv.ordered_by) doc.font('regular').fontSize(8.5).fillColor(INK).text(mv.ordered_by, sx + 8, y + 22, { width: sw - 16 });
    });

    // ----- cancelled stamp -----
    if (mv.cancelled) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.save().rotate(-22, { origin: [doc.page.width / 2, doc.page.height / 2 - 40] });
        doc.font('bold').fontSize(64).fillColor(RED).opacity(.22).text('İPTAL', doc.page.width / 2 - 200, doc.page.height / 2 - 90, { width: 400, align: 'center' });
        doc.opacity(1).restore();
        doc.font('regular').fontSize(8).fillColor(RED).text('Bu belge iptal edilmiştir: ' + fmtDateTime(mv.cancelled_at) + (mv.cancelled_by_name ? ' — ' + mv.cancelled_by_name : '') + (mv.cancel_reason ? ' — ' + mv.cancel_reason : ''), L, doc.page.height - 62, { width: W });
      }
    }
    footer(doc, mv, company);
    doc.end();
  });
}

function footer(doc, mv, company) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0; // alt bilgi marjın içinde; pdfkit yeni sayfa açmasın
    const yy = doc.page.height - 44;
    doc.moveTo(40, yy).lineTo(doc.page.width - 40, yy).lineWidth(.5).strokeColor(LINE).stroke();
    doc.font('regular').fontSize(7.5).fillColor(MUTED)
      .text(`${mv.doc_no} · ${(company.name || 'Peak PV Solar')} · Malzeme Takip ile oluşturuldu ${fmtDateTime(Date.now())}`, 40, yy + 6, { width: doc.page.width - 160, lineBreak: false });
    doc.text(`Sayfa ${i - range.start + 1} / ${range.count}`, doc.page.width - 120, yy + 6, { width: 80, align: 'right', lineBreak: false });
    doc.page.margins.bottom = mb;
  }
}

module.exports = { render, KIND };
