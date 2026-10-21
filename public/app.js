/* Malzeme Takip — arayüz. Tek sayfa, bağımlılık yok. Sunucuyla HTTP API ve WebSocket üzerinden konuşur;
   her değişiklik (hareket, malzeme, alarm) açık olan bütün ekranlara anında yansır. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = 'Europe/Istanbul';
  const fmtNum = (n, d) => Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: d === undefined ? 3 : d });
  const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}.${m}.${y}`; };
  const fmtDT = (ts) => ts ? new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '';
  const fmtTime = (ts) => ts ? new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '';
  const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dayOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
  function ago(ts) { const s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'az önce'; if (s < 3600) return Math.floor(s / 60) + ' dk önce'; if (s < 86400) return Math.floor(s / 3600) + ' sa önce'; if (s < 7 * 86400) return Math.floor(s / 86400) + ' gün önce'; return fmtDT(ts); }
  const KIND = { in: 'Giriş', out: 'Sevkiyat', adj: 'Düzeltme' };
  const KIND_LONG = { in: 'Malzeme giriş fişi', out: 'Malzeme sevk fişi', adj: 'Stok düzeltme fişi' };
  const ROLE = { admin: 'Yönetici', member: 'Kullanıcı', viewer: 'Görüntüleyici' };
  const ICON = {
    in: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
    out: '<svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    adj: '<svg class="i" viewBox="0 0 24 24"><path d="M4 12h16M12 4v16"/><circle cx="12" cy="12" r="9"/></svg>',
    cancel: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/></svg>',
    alert: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3l9 16H3zM12 10v4M12 17.5v.5"/></svg>',
    ok: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
    box: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10"/></svg>',
    pdf: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6zM14 3v5h5M9 13h6M9 17h6"/></svg>',
    edit: '<svg class="i" viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4"/></svg>',
    x: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg class="i" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0"/></svg>',
    team: '<svg class="i" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-5-6.3"/></svg>',
    gear: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    download: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M4 19h16"/></svg>',
    search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    chart: '<svg class="i" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-7"/></svg>',
    logout: '<svg class="i" viewBox="0 0 24 24"><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/></svg>',
    key: '<svg class="i" viewBox="0 0 24 24"><circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M16 6l3 3M13 9l3 3"/></svg>',
    chat: '<svg class="i" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    hash: '<svg class="i" viewBox="0 0 24 24"><path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/></svg>',
    paperclip: '<svg class="i" viewBox="0 0 24 24"><path d="M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.3 3.3 0 014.7 4.7L9.5 17a1.7 1.7 0 01-2.4-2.4L15 6.7"/></svg>',
    send: '<svg class="i" viewBox="0 0 24 24"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
    trash: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
    archive: '<svg class="i" viewBox="0 0 24 24"><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/></svg>',
    file: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6zM14 3v5h5"/></svg>',
    restore: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v5h5"/></svg>',
    left: '<svg class="i" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg class="i" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  };

  // ---------- durum ----------
  const S = {
    me: {}, team: [], settings: {}, pushOn: false, mailOn: false, warning: '',
    materials: [], matById: new Map(), catList: [], locList: [], unitList: [],
    peers: [], live: false,
    view: 'dashboard', matId: null, chip: 'all', q: '', showInactive: false, matSort: { k: 'name', d: 1 },
    dash: null, matDetail: null, alerts: { open: [], resolved: [] },
    mv: { kind: '', from: '', to: '', q: '', cancelled: false, offset: 0, limit: 50, rows: [], total: 0 },
    activity: [], inboxSeen: 0, unread: 0, inboxOpen: false,
    railOpen: false,
    chat: { channels: [], cid: null, msgs: [], hasMore: false, loaded: false, typing: {}, pending: [], filter: '', unread: 0, drafts: {}, mention: null },
    lb: null,
  };
  const canWrite = () => S.me.role === 'admin' || S.me.role === 'member';
  const isAdmin = () => S.me.role === 'admin';

  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); throw { code: 'unauthenticated', message: 'Yeniden giriş yapın.' }; }
    if (!r.ok) throw (j && j.error) || { code: 'error', message: 'İstek başarısız (' + r.status + ')' };
    return j;
  }

  // ---------- malzeme durumu ----------
  function stateOf(m) { if (!m) return 'none'; if (!m.active) return 'off'; if (m.min_stock > 0 && m.stock < m.min_stock) return 'low'; if (m.min_stock > 0 && m.stock < m.min_stock * 1.2) return 'near'; if (m.min_stock > 0) return 'ok'; return 'none'; }
  const STATE_LABEL = { ok: 'Normal', near: 'Limite yakın', low: 'Limitin altında', none: 'Limit tanımsız', off: 'Pasif' };
  function statePill(m) { const s = stateOf(m); return `<span class="pill ${s}">${STATE_LABEL[s]}</span>`; }
  function meter(m, w) { const s = stateOf(m); if (!(m.min_stock > 0)) return ''; const max = Math.max(m.min_stock * 1.5, m.stock, 0.0001); const pct = Math.max(0, Math.min(100, m.stock / max * 100)); const lim = Math.min(100, m.min_stock / max * 100); return `<div class="meter g-${s}" ${w ? 'style="width:' + w + '"' : ''} title="Stok ${fmtNum(m.stock)} / limit ${fmtNum(m.min_stock)} ${esc(m.unit)}"><i style="width:${pct.toFixed(1)}%"></i><b style="left:${lim.toFixed(1)}%"></b></div>`; }
  function setMaterial(m) { const i = S.materials.findIndex(x => x.id === m.id); if (i >= 0) S.materials[i] = m; else S.materials.push(m); S.matById.set(m.id, m); S.materials.sort((a, b) => a.name.localeCompare(b.name, 'tr')); }
  function userById(id) { return S.team.find(u => u.id === id) || (S.me.id === id ? S.me : null); }
  function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase(); }
  const avatarHtml = (u, cls) => u ? `<span class="av ${cls || ''}" style="background:${esc(u.color || '#4a5d8a')}" title="${esc(u.name)}">${esc(initials(u.name))}</span>` : '';

  // ---------- yükleme ----------
  async function boot() {
    const me = await api('GET', '/api/me');
    S.me = me.me; S.team = me.team; S.settings = me.settings; S.pushOn = me.push; S.mailOn = me.mail; S.warning = me.warning || ''; S.inboxSeen = me.inboxSeen || 0; S.unread = me.unread || 0; S.chat.unread = me.chatUnread || 0;
    if (S.warning) { $('banner').textContent = S.warning; $('banner').hidden = false; }
    await loadMaterials();
    const al = await api('GET', '/api/alerts'); S.alerts = al;
    renderMe(); renderChips(); renderRail(); renderAlarmBar(); renderInboxCount(); renderChatCount();
    route(); connect();
    loadChannels().catch(() => {});
    try { const a = await api('GET', '/api/activity?limit=150'); S.activity = a.items; renderInboxCount(); } catch (e) {}
  }
  async function loadMaterials() {
    const r = await api('GET', '/api/materials?all=1');
    S.materials = r.materials.sort((a, b) => a.name.localeCompare(b.name, 'tr')); S.matById = new Map(S.materials.map(m => [m.id, m]));
    S.catList = r.categories; S.locList = r.locations; S.unitList = r.units;
  }

  // ---------- yönlendirme ----------
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [p, id] = h.split('/');
    closeRail();
    if (p === 'malzeme' && id) { S.view = 'material'; S.matId = id; loadMaterial(id); }
    else if (p === 'malzemeler') { S.view = 'materials'; }
    else if (p === 'hareketler') { S.view = 'movements'; const u = new URLSearchParams(h.split('?')[1] || ''); if (u.get('kind')) S.mv.kind = u.get('kind'); loadMovements(); }
    else if (p === 'alarmlar') { S.view = 'alerts'; refreshAlerts(); }
    else if (p === 'belge' && id) { openMovement(id); return; }
    else if (p === 'sohbet') { S.view = 'chat'; if (id) S.chat.cid = id; openChat(); }
    else { S.view = 'dashboard'; loadDashboard(); }
    $('pane').classList.toggle('chat-pane', S.view === 'chat');
    if (S.view !== 'chat') stopTypingTicker();
    renderRail(); renderPaneHead(); renderPaneBody();
  }
  window.addEventListener('hashchange', route);
  async function loadDashboard() { try { S.dash = await api('GET', '/api/dashboard'); if (S.view === 'dashboard') renderPaneBody(); } catch (e) { toast(e.message); } }
  async function loadMaterial(id) { S.matDetail = null; try { const r = await api('GET', '/api/materials/' + id); S.matDetail = r; if (!r.material.deleted_at) setMaterial({ ...r.material, open_alert: r.material.open_alert }); if (S.view === 'material' && S.matId === id) { renderRail(); renderPaneHead(); renderPaneBody(); } } catch (e) { toast(e.message); go('#/malzemeler'); } }
  const curMaterial = () => S.matById.get(S.matId) || (S.matDetail && S.matDetail.material && S.matDetail.material.id === S.matId ? S.matDetail.material : null);
  async function loadMovements() {
    const q = new URLSearchParams(); if (S.mv.kind) q.set('kind', S.mv.kind); if (S.mv.from) q.set('from', S.mv.from); if (S.mv.to) q.set('to', S.mv.to); if (S.mv.q) q.set('q', S.mv.q); if (S.mv.cancelled) q.set('cancelled', '1'); q.set('limit', S.mv.limit); q.set('offset', S.mv.offset);
    try { const r = await api('GET', '/api/movements?' + q); S.mv.rows = r.movements; S.mv.total = r.total; if (S.view === 'movements') renderPaneBody(); } catch (e) { toast(e.message); }
  }
  async function refreshAlerts() { try { S.alerts = await api('GET', '/api/alerts'); renderAlarmBar(); if (S.view === 'alerts') renderPaneBody(); } catch (e) {} }

  // ---------- canlı bağlantı ----------
  let ws = null, backoff = 800;
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => { S.live = true; backoff = 800; renderLive(); };
    ws.onclose = (ev) => { S.live = false; renderLive(); if (ev.code === 4401) { location.href = '/login'; return; } setTimeout(connect, backoff); backoff = Math.min(15000, backoff * 1.6); };
    ws.onerror = () => {};
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onEvent(m); };
  }
  function onEvent(m) {
    if (m.t === 'hello' || m.t === 'peers') { S.peers = m.peers || []; renderPresence(); if (S.view === 'dashboard') renderPaneBody(); return; }
    if (m.t === 'material') {
      if (m.removed) { S.materials = S.materials.filter(x => x.id !== m.material.id); S.matById.delete(m.material.id); if (S.view === 'material' && S.matId === m.material.id) go('#/malzemeler'); }
      else { setMaterial(m.material); if (S.view === 'material' && S.matId === m.material.id) loadMaterial(m.material.id); }
      renderRail(); renderChips(); if (S.view === 'materials') renderPaneBody(); if (S.view === 'dashboard') loadDashboard();
      const open = document.querySelector('[data-line-material]'); if (open) refreshLinePreview();
    } else if (m.t === 'movement') {
      if (S.view === 'movements') loadMovements(); if (S.view === 'dashboard') loadDashboard();
      if (S.view === 'material' && m.movement.lines.some(l => l.material_id === S.matId)) loadMaterial(S.matId);
      const dlg = document.querySelector('[data-doc-id="' + m.movement.id + '"]'); if (dlg) showMovement(m.movement);
    } else if (m.t === 'alert') {
      if (m.opened) { ntoast('Stok alarmı', `${m.alert.material_name}: stok ${fmtNum(m.alert.stock)} ${m.alert.unit}, limit ${fmtNum(m.alert.min_stock)} ${m.alert.unit}`, '#/malzeme/' + m.alert.material_id); }
      refreshAlerts(); if (S.view === 'dashboard') loadDashboard();
    } else if (m.t === 'activity') {
      S.activity.unshift(m.item); if (S.activity.length > 300) S.activity.length = 300;
      if (m.item.user_id !== S.me.id && m.item.ts > S.inboxSeen) { S.unread++; const b = $('inboxBtn'); b.classList.add('has-new'); setTimeout(() => b.classList.remove('has-new'), 1200); }
      renderInboxCount(); if (S.inboxOpen) renderInbox();
    } else if (m.t === 'team') { api('GET', '/api/me').then(r => { S.team = r.team; S.me = r.me; renderMe(); }).catch(() => {}); }
    else if (m.t === 'settings') { S.settings = { ...S.settings, ...m.settings }; }
    else if (m.t === 'chat') onChatMessage(m.message);
    else if (m.t === 'chat-edit') { const i = S.chat.msgs.findIndex(x => x.id === m.message.id); if (i >= 0) { S.chat.msgs[i] = m.message; renderMessages(); } }
    else if (m.t === 'chat-del') { const n = S.chat.msgs.length; S.chat.msgs = S.chat.msgs.filter(x => x.id !== m.id); if (S.chat.msgs.length !== n) renderMessages(); }
    else if (m.t === 'channel') { const i = S.chat.channels.findIndex(c => c.id === m.channel.id); const prev = i >= 0 ? S.chat.channels[i] : { unread: 0 }; const ch = { ...m.channel, unread: prev.unread || 0, last_text: prev.last_text, last_by: prev.last_by }; if (i >= 0) S.chat.channels[i] = ch; else S.chat.channels.push(ch); if (S.view === 'chat') { renderChannels(); renderChanHead(); renderComposer(); } }
    else if (m.t === 'typing') { if (!m.by || m.by.id === S.me.id) return; const t = S.chat.typing[m.cid] || (S.chat.typing[m.cid] = {}); t[m.by.id] = { name: m.by.name, until: Date.now() + 4000 }; renderTyping(); }
  }
  function onChatMessage(msg) {
    const ch = S.chat.channels.find(c => c.id === msg.channel_id);
    if (ch) { ch.last_text = msg.text; ch.last_by = msg.user_name; ch.last_msg_at = msg.ts; }
    const viewing = S.view === 'chat' && S.chat.cid === msg.channel_id;
    if (viewing) {
      if (!S.chat.msgs.some(x => x.id === msg.id)) S.chat.msgs.push(msg);
      if (S.chat.typing[msg.channel_id]) delete S.chat.typing[msg.channel_id][msg.user_id];
      renderMessages(); renderTyping(); renderChannels();
      if (msg.user_id !== S.me.id) { if (document.hasFocus()) markChannelRead(msg.channel_id, msg.ts); else { S.chat.unread++; if (ch) ch.unread = (ch.unread || 0) + 1; renderChatCount(); } }
    } else if (msg.user_id !== S.me.id) {
      S.chat.unread++; if (ch) ch.unread = (ch.unread || 0) + 1; renderChatCount(); if (S.view === 'chat') renderChannels();
      if (mentionsMe(msg.text)) ntoast(`#${ch ? ch.name : 'sohbet'} · ${msg.user_name}`, msg.text, '#/sohbet/' + msg.channel_id);
    }
  }
  function renderLive() { const l = $('live'); l.classList.toggle('live-on', S.live); l.classList.toggle('live-off', !S.live); $('liveText').textContent = S.live ? 'Canlı' : 'Bağlantı yok'; }
  function renderPresence() { const p = $('presence'); const list = S.peers.slice(0, 5); p.innerHTML = list.map(u => avatarHtml(u)).join('') + (S.peers.length ? `<span class="count">${S.peers.length} kişi bağlı</span>` : ''); }

  // ---------- üst çubuk ----------
  function renderMe() {
    const m = S.me;
    $('meBox').innerHTML = `<button data-action="me-menu" aria-haspopup="true">${avatarHtml(m)}<span>${esc(m.name)}</span></button><div class="menu" id="meMenu" hidden>
      <div style="padding:8px 10px 6px"><div style="font-weight:600">${esc(m.name)}</div><div class="muted small">${esc(m.email)} · ${ROLE[m.role] || m.role}</div></div><div class="sep"></div>
      <button data-action="settings">${ICON.gear} Ayarlar ve bildirimler</button>
      ${isAdmin() ? `<button data-action="team">${ICON.team} Ekip ve davetler</button>` : ''}
      <button data-action="password">${ICON.key} Şifremi değiştir</button><div class="sep"></div>
      <button data-action="logout">${ICON.logout} Çıkış yap</button></div>`;
  }
  function renderAlarmBar() {
    const bar = $('alarmBar'); const n = S.alerts.open.length;
    if (!n) { bar.hidden = true; return; }
    const names = S.alerts.open.slice(0, 3).map(a => a.material_name).join(', ');
    bar.innerHTML = `${ICON.alert}<span class="ab-text"><strong>${n} malzeme minimum stok limitinin altında:</strong> ${esc(names)}${n > 3 ? ' ve ' + (n - 3) + ' malzeme daha' : ''}</span><button class="btn sm">Alarmları aç</button>`;
    bar.hidden = false;
  }
  function renderChatCount() { const c = $('chatCount'); const n = S.chat.unread; c.textContent = n > 99 ? '99+' : n; c.hidden = !n; const b = $('railList').querySelector('.nbadge.chat'); if ((b && !n) || (!b && n)) renderRail(); else if (b) b.textContent = n; }
  function renderInboxCount() { const c = $('inboxCount'); const n = S.activity.filter(a => a.ts > S.inboxSeen && a.user_id !== S.me.id).length || S.unread; c.textContent = n > 99 ? '99+' : n; c.hidden = !n; }

  // ---------- sol şerit ----------
  function renderChips() {
    const counts = { all: 0, low: 0, near: 0, ok: 0, none: 0 };
    for (const m of S.materials) { if (!m.active) continue; counts.all++; counts[stateOf(m)]++; }
    const chips = [['all', 'Tümü'], ['low', 'Limitin altında'], ['near', 'Yakın'], ['ok', 'Normal'], ['none', 'Limitsiz']];
    $('stateChips').innerHTML = chips.map(([k, l]) => `<button class="chip g-${k === 'all' ? 'none' : k} ${S.chip === k ? 'on' : ''}" data-action="chip" data-chip="${k}">${k !== 'all' ? '<span class="gdot"></span>' : ''}${l} <span class="mono">${counts[k]}</span></button>`).join('');
  }
  function filteredMaterials() {
    const q = S.q.trim().toLocaleLowerCase('tr');
    return S.materials.filter(m => {
      if (!S.showInactive && !m.active) return false;
      if (S.chip !== 'all' && stateOf(m) !== S.chip && !(S.chip === 'low' && stateOf(m) === 'low')) return false;
      if (q && !(m.name.toLocaleLowerCase('tr').includes(q) || m.code.toLocaleLowerCase('tr').includes(q) || (m.category || '').toLocaleLowerCase('tr').includes(q) || (m.location || '').toLocaleLowerCase('tr').includes(q))) return false;
      return true;
    });
  }
  function renderRail() {
    const nav = [['dashboard', '#/', 'Genel bakış', '<svg class="i" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/></svg>'], ['materials', '#/malzemeler', 'Malzemeler ve stok', ICON.box], ['movements', '#/hareketler', 'Hareketler', '<svg class="i" viewBox="0 0 24 24"><path d="M4 9h12l-3-3M20 15H8l3 3"/></svg>'], ['alerts', '#/alarmlar', 'Alarmlar', ICON.alert], ['chat', '#/sohbet', 'Sohbet', ICON.chat]];
    const list = filteredMaterials();
    let h = `<div class="home-row nav-row">${nav.map(([v, href, l, ic]) => `<button class="prow ${S.view === v ? 'on' : ''}" data-action="go" data-href="${href}"><span class="pname">${ic}${l}${v === 'alerts' && S.alerts.open.length ? `<span class="nbadge">${S.alerts.open.length}</span>` : ''}${v === 'chat' && S.chat.unread ? `<span class="nbadge chat">${S.chat.unread}</span>` : ''}</span></button>`).join('')}</div>`;
    h += `<div class="rail-section"><span>Malzemeler</span><span class="mono">${list.length}</span></div>`;
    if (!list.length) h += `<p class="muted small" style="padding:6px 10px">${S.materials.length ? 'Bu filtreye uyan malzeme yok.' : 'Henüz malzeme kartı yok.'}</p>`;
    else h += `<div class="plist">${list.map(m => { const s = stateOf(m); return `<button class="prow ${S.view === 'material' && S.matId === m.id ? 'on' : ''} ${!m.active ? 'off' : ''}" data-action="go" data-href="#/malzeme/${m.id}"><span class="pbar g-${s}" style="background:var(--g)"></span><span class="pname"><span class="ptext">${esc(m.name)}</span></span><span class="pmeta">${esc(m.code)}${m.category ? ' · ' + esc(m.category) : ''}</span><span class="pstock ${s}">${fmtNum(m.stock)} ${esc(m.unit)}</span></button>`; }).join('')}</div>`;
    if (canWrite()) h += `<div style="padding:10px 4px"><button class="btn ghost sm" data-action="new-material" style="width:100%;justify-content:center;color:var(--chrome-fg-2)">${ICON.plus} Yeni malzeme kartı</button></div>`;
    $('railList').innerHTML = h;
    $('matCount').textContent = S.materials.filter(m => m.active).length + ' aktif';
  }
  function closeRail() { S.railOpen = false; $('rail').classList.remove('open'); $('backdrop').classList.remove('on'); }
  function toggleRail() { S.railOpen = !S.railOpen; $('rail').classList.toggle('open', S.railOpen); $('backdrop').classList.toggle('on', S.railOpen); }

  // ---------- sayfa başlığı ----------
  function renderPaneHead() {
    const H = $('paneHead');
    const btns = (extra) => `<div class="ph-actions">${canWrite() ? `<button class="btn primary sm" data-action="new-movement" data-kind="in">${ICON.in} Giriş fişi</button><button class="btn sm" data-action="new-movement" data-kind="out">${ICON.out} Sevkiyat fişi</button>` : ''}${extra || ''}</div>`;
    if (S.view === 'dashboard') H.innerHTML = `<div class="ph-row"><div class="ph-title"><h1>Genel bakış</h1><div class="ph-sub"><span class="date">${fmtDate(todayIso())}</span><span>Fabrika depo stoğu, bugünkü hareketler ve aktif alarmlar</span></div></div>${btns()}</div><div style="height:16px"></div>`;
    else if (S.view === 'materials') H.innerHTML = `<div class="ph-row"><div class="ph-title"><h1>Malzemeler ve stok</h1><div class="ph-sub"><span>${S.materials.filter(m => m.active).length} aktif malzeme</span><span>Minimum limiti her malzemenin kartından ayarlayın</span></div></div>${btns(canWrite() ? `<button class="btn sm" data-action="new-material">${ICON.plus} Malzeme kartı</button>` : '')}</div><div style="height:16px"></div>`;
    else if (S.view === 'movements') H.innerHTML = `<div class="ph-row"><div class="ph-title"><h1>Hareketler</h1><div class="ph-sub"><span>Giriş, sevkiyat ve düzeltme belgeleri</span><span>Her belge için PDF fişi hazırdır</span></div></div>${btns(canWrite() ? `<button class="btn sm" data-action="new-movement" data-kind="adj">${ICON.adj} Düzeltme</button>` : '')}</div><div style="height:16px"></div>`;
    else if (S.view === 'alerts') H.innerHTML = `<div class="ph-row"><div class="ph-title"><h1>Alarmlar</h1><div class="ph-sub"><span>${S.alerts.open.length ? S.alerts.open.length + ' aktif alarm' : 'Aktif alarm yok'}</span><span>Stok, kartında belirlenen minimum limitin altına düşünce alarm açılır; limitin üstüne çıkınca kendiliğinden kapanır</span></div></div>${btns()}</div><div style="height:16px"></div>`;
    else if (S.view === 'chat') H.innerHTML = `<div class="ph-row"><div class="ph-title"><h1>Sohbet</h1><div class="ph-sub"><span>Depo ekibinin ortak kanalları</span><span>Mesajlar saklanır; @ad ile birine seslenebilirsiniz</span></div></div><div class="ph-actions">${canWrite() ? `<button class="btn sm" data-action="new-channel">${ICON.plus} Yeni kanal</button>` : ''}</div></div>`;
    else if (S.view === 'material') {
      const m = curMaterial();
      if (!m) { H.innerHTML = '<div class="ph-row"><div class="ph-title"><h1>Yükleniyor…</h1></div></div><div style="height:16px"></div>'; return; }
      const del = !!m.deleted_at;
      H.innerHTML = `<div class="ph-row"><div class="ph-title"><h1>${esc(m.name)} ${del ? '<span class="pill cancel">Silindi</span>' : statePill(m)}</h1><div class="ph-sub"><span class="mono">${esc(m.code)}</span>${m.category ? `<span>${esc(m.category)}</span>` : ''}${m.location ? `<span>${esc(m.location)}</span>` : ''}<span>birim: ${esc(m.unit)}</span></div></div>
        <div class="ph-actions">${canWrite() && m.active && !del ? `<button class="btn primary sm" data-action="new-movement" data-kind="in" data-material="${m.id}">${ICON.in} Giriş</button><button class="btn sm" data-action="new-movement" data-kind="out" data-material="${m.id}">${ICON.out} Sevkiyat</button><button class="btn sm" data-action="new-movement" data-kind="adj" data-material="${m.id}">${ICON.adj} Düzeltme</button>` : ''}${canWrite() && !del ? `<button class="btn sm" data-action="set-limit" data-id="${m.id}">${ICON.alert} Limit</button><button class="btn sm" data-action="edit-material" data-id="${m.id}">${ICON.edit} Düzenle</button>` : ''}${isAdmin() && !del ? `<button class="btn sm danger" data-action="delete-material" data-id="${m.id}" title="Kartı sil">${ICON.trash}</button>` : ''}${isAdmin() && del ? `<button class="btn primary sm" data-action="restore-material" data-id="${m.id}">${ICON.restore} Geri al</button>` : ''}</div></div><div style="height:16px"></div>`;
    }
  }

  // ---------- sayfa gövdesi ----------
  function renderPaneBody() {
    const B = $('paneBody');
    if (S.view === 'dashboard') B.innerHTML = `<div class="scroll">${dashboardHtml()}</div>`;
    else if (S.view === 'materials') B.innerHTML = `<div class="scroll">${materialsHtml()}</div>`;
    else if (S.view === 'movements') B.innerHTML = `<div class="scroll">${movementsHtml()}</div>`;
    else if (S.view === 'alerts') B.innerHTML = `<div class="scroll">${alertsHtml()}</div>`;
    else if (S.view === 'material') B.innerHTML = `<div class="scroll">${materialHtml()}</div>`;
    else if (S.view === 'chat') { B.innerHTML = `<div class="chat"><aside class="channels" id="channels"></aside><section class="chat-main" id="chatMain"><div class="chan-head" id="chanHead"></div><div class="msgs" id="msgs"></div><div class="typing" id="typing"></div><div class="composer-wrap" id="composerWrap"></div></section></div>`; renderChannels(); renderChanHead(); renderMessages(); renderComposer(); renderTyping(); }
  }
  const mvRow = (r) => { const k = r.cancelled ? 'cancel' : r.kind; return `<button class="mvrow ${r.cancelled ? 'cancelled' : ''}" data-action="open-doc" data-id="${r.id}"><span class="kico ${k}">${ICON[k]}</span><span class="mt">${esc(r.doc_no)} · ${esc(r.summary || '')}${r.line_count > 3 ? ' …' : ''}</span><span class="ms">${esc(r.ordered_by)}${r.counterparty ? ' · ' + esc(r.counterparty) : ''} · ${esc(r.created_by_name || '')}</span><span class="mq ${r.kind}">${r.line_count} kalem</span><span class="md">${fmtDate(r.doc_date)} ${fmtTime(r.created_at)}</span></button>`; };
  function dashboardHtml() {
    const d = S.dash; if (!d) return '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    const tiles = `<div class="tiles">
      <button class="tile all" data-action="go" data-href="#/malzemeler"><span class="v">${d.materials}</span><span class="l">Aktif malzeme</span></button>
      <button class="tile low" data-action="go" data-href="#/alarmlar"><span class="v">${d.low}</span><span class="l">Limitin altında</span></button>
      <button class="tile near" data-action="chip-go" data-chip="near"><span class="v">${d.near}</span><span class="l">Limite yaklaşan</span></button>
      <button class="tile in" data-action="go" data-href="#/hareketler?kind=in"><span class="v">${d.todayIn}</span><span class="l">Bugün giriş <span class="muted">· hafta ${d.weekIn}</span></span></button>
      <button class="tile out" data-action="go" data-href="#/hareketler?kind=out"><span class="v">${d.todayOut}</span><span class="l">Bugün sevkiyat <span class="muted">· hafta ${d.weekOut}</span></span></button>
    </div>`;
    const recent = `<div class="card"><h3>${ICON.chart} Son hareketler <button class="btn ghost sm" data-action="go" data-href="#/hareketler">Tümü</button></h3>${d.recent.length ? `<div class="list">${d.recent.map(mvRow).join('')}</div>` : emptyHtml('Henüz hareket yok', canWrite() ? 'İlk giriş fişini oluşturarak başlayın.' : 'Kayıt girildiğinde burada görünür.')}</div>`;
    const alerts = `<div class="card t-rose"><h3>${ICON.alert} Aktif alarmlar <button class="btn ghost sm" data-action="go" data-href="#/alarmlar">Tümü</button></h3>${d.alerts.length ? d.alerts.slice(0, 8).map(alertCard).join('') : `<p class="muted" style="margin:0">Limitin altında malzeme yok. ${d.noLimit ? d.noLimit + ' malzemenin minimum limiti tanımlı değil.' : ''}</p>`}</div>`;
    const near = d.nearList.length ? `<div class="card t-sand"><h3>${ICON.box} Limite yaklaşanlar</h3><div class="list">${d.nearList.map(m => `<button class="linkrow" data-action="go" data-href="#/malzeme/${m.id}"><span class="row"><span class="grow"><span class="t">${esc(m.name)}</span><span class="s">${esc(m.code)} · limit ${fmtNum(m.min_stock)} ${esc(m.unit)}</span></span>${meter(m, '90px')}<span class="d" style="color:var(--warn)">${fmtNum(m.stock)} ${esc(m.unit)}</span></span></button>`).join('')}</div></div>` : '';
    const online = `<div class="card"><h3>${ICON.team} Şu an bağlı</h3><div class="tagrow">${S.peers.length ? S.peers.map(u => `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px">${avatarHtml(u, 'sm')} ${esc(u.name)}</span>`).join('') : '<span class="muted small">Yalnızca siz</span>'}</div></div>`;
    return tiles + `<div class="grid2"><div>${recent}</div><div>${alerts}${near}${online}</div></div>`;
  }
  function alertCard(a) {
    const resolved = !!a.resolved_at;
    return `<div class="alert-card ${resolved ? 'resolved' : ''}"><span class="aico">${resolved ? ICON.ok : ICON.alert}</span>
      <span class="at"><a href="#/malzeme/${a.material_id}">${esc(a.material_name)}</a> <span class="muted small mono">${esc(a.material_code)}</span></span>
      <span class="as">${resolved ? `Açıldı ${fmtDT(a.opened_at)} · kapandı ${fmtDT(a.resolved_at)} (stok ${fmtNum(a.stock_at_resolve)} ${esc(a.unit)})` : `Stok <span class="an">${fmtNum(a.stock)} ${esc(a.unit)}</span> · limit ${fmtNum(a.min_stock)} ${esc(a.unit)} · ${ago(a.opened_at)}${a.acked_by_name ? ' · gördü: ' + esc(a.acked_by_name) : ''}`}</span>
      <span class="aa">${!resolved && canWrite() ? `${!a.acked_at ? `<button class="btn sm" data-action="ack-alert" data-id="${a.id}">Gördüm</button>` : ''}<button class="btn primary sm" data-action="new-movement" data-kind="in" data-material="${a.material_id}">${ICON.in} Giriş</button>` : ''}</span></div>`;
  }
  function emptyHtml(title, text, icon) { return `<div class="empty">${icon || ICON.box}<h2>${esc(title)}</h2><p>${esc(text)}</p></div>`; }

  function materialsHtml() {
    const list = filteredMaterials(); const k = S.matSort.k, d = S.matSort.d;
    list.sort((a, b) => { let r; if (k === 'stock' || k === 'min_stock') r = (a[k] || 0) - (b[k] || 0); else if (k === 'state') { const o = { low: 0, near: 1, ok: 2, none: 3, off: 4 }; r = o[stateOf(a)] - o[stateOf(b)]; } else r = String(a[k] || '').localeCompare(String(b[k] || ''), 'tr'); return r * d; });
    const th = (key, label, cls) => `<th class="sortable ${cls || ''}" data-action="sort" data-key="${key}">${label}${k === key ? `<span class="arrow">${d > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    const cats = S.catList;
    const toolbar = `<div class="toolbar"><span class="count">${list.length} malzeme${S.chip !== 'all' ? ' (filtreli)' : ''}</span>${cats.length ? `<select id="catFilter" data-action="cat-filter" style="width:auto"><option value="">Tüm kategoriler</option>${cats.map(c => `<option ${S.q === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}<span class="spacer"></span><a class="btn sm" href="/api/export/stock.csv" download>${ICON.download} Stok listesi (Excel/CSV)</a></div>`;
    if (!list.length) return toolbar + (S.materials.length ? emptyHtml('Bu filtreye uyan malzeme yok', 'Sol şeritteki filtreyi veya aramayı değiştirin.') : emptyHtml('Henüz malzeme kartı yok', 'Her malzeme için bir kart açın: kod, ad, birim, konum ve minimum stok limiti. Giriş ve sevkiyat fişleri bu kartlara işlenir.'));
    return toolbar + `<div class="table-card"><div class="tablewrap"><table class="stock"><thead><tr>${th('code', 'Kod')}${th('name', 'Malzeme')}${th('category', 'Kategori / Konum')}${th('stock', 'Stok', 'r')}<th>Seviye</th>${th('min_stock', 'Min. limit', 'r')}${th('state', 'Durum')}<th></th></tr></thead><tbody>
      ${list.map(m => { const s = stateOf(m); return `<tr class="rowlink ${s}" data-action="go" data-href="#/malzeme/${m.id}"><td class="mono">${esc(m.code)}</td><td><div class="t">${esc(m.name)}</div>${m.description ? `<div class="s">${esc(m.description.slice(0, 80))}</div>` : ''}</td><td><div>${esc(m.category || '—')}</div><div class="s">${esc(m.location || '')}</div></td><td class="num ${s}">${fmtNum(m.stock)} <span class="muted" style="font-weight:400">${esc(m.unit)}</span></td><td>${meter(m)}</td><td class="r">${m.min_stock > 0 ? fmtNum(m.min_stock) + ' ' + esc(m.unit) : '<span class="muted">—</span>'}</td><td>${statePill(m)}</td><td class="acts">${canWrite() ? `<button class="icon-btn" title="Giriş fişi" data-action="new-movement" data-kind="in" data-material="${m.id}">${ICON.in}</button><button class="icon-btn" title="Sevkiyat fişi" data-action="new-movement" data-kind="out" data-material="${m.id}">${ICON.out}</button><button class="icon-btn" title="Düzenle" data-action="edit-material" data-id="${m.id}">${ICON.edit}</button>${isAdmin() ? `<button class="icon-btn" title="Kartı sil" data-action="delete-material" data-id="${m.id}">${ICON.trash}</button>` : ''}` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }

  function movementsHtml() {
    const M = S.mv;
    const seg = `<div class="seg">${[['', 'Tümü'], ['in', 'Giriş'], ['out', 'Sevkiyat'], ['adj', 'Düzeltme']].map(([k, l]) => `<button class="${M.kind === k ? 'on k' + k : ''}" data-action="mv-kind" data-kind="${k}">${k ? ICON[k] : ''}${l}</button>`).join('')}</div>`;
    const toolbar = `<div class="toolbar">${seg}<input type="search" id="mvQ" placeholder="Belge no, malzeme, talimat veren, plaka…" value="${esc(M.q)}" data-action="mv-q"><input type="date" id="mvFrom" value="${M.from}" data-action="mv-date" data-k="from" title="Başlangıç"><input type="date" id="mvTo" value="${M.to}" data-action="mv-date" data-k="to" title="Bitiş"><label class="small muted" style="display:flex;gap:6px;align-items:center;white-space:nowrap"><input type="checkbox" ${M.cancelled ? 'checked' : ''} data-action="mv-cancelled"> İptalleri göster</label><span class="spacer"></span><a class="btn sm" href="/api/export/movements.csv?${new URLSearchParams({ kind: M.kind, from: M.from, to: M.to, q: M.q, cancelled: M.cancelled ? '1' : '' })}" download>${ICON.download} Excel/CSV</a></div>`;
    if (!M.rows.length) return toolbar + emptyHtml('Belge bulunamadı', M.q || M.kind || M.from ? 'Filtreleri gevşetip yeniden deneyin.' : 'Henüz giriş veya sevkiyat belgesi oluşturulmadı.');
    const rows = M.rows.map(r => `<tr class="rowlink ${r.cancelled ? 'cancelled' : ''}" data-action="open-doc" data-id="${r.id}"><td class="mono"><span class="t">${esc(r.doc_no)}</span></td><td><span class="pill ${r.cancelled ? 'cancel' : r.kind}">${r.cancelled ? 'İptal' : KIND[r.kind]}</span></td><td class="date">${fmtDate(r.doc_date)}<div class="s muted">${fmtTime(r.created_at)}</div></td><td><div class="t">${esc(r.summary || '')}${r.line_count > 3 ? ' …' : ''}</div><div class="s">${r.line_count} kalem</div></td><td>${esc(r.ordered_by)}</td><td>${esc(r.counterparty || '—')}${r.vehicle ? `<div class="s mono">${esc(r.vehicle)}</div>` : ''}</td><td>${esc(r.created_by_name || '')}</td><td class="acts"><a class="icon-btn" title="PDF fişi" href="/api/movements/${r.id}/pdf" target="_blank" rel="noopener" data-stop="1">${ICON.pdf}</a></td></tr>`).join('');
    const pager = `<div class="pager"><span>${M.offset + 1}–${Math.min(M.offset + M.limit, M.total)} / ${M.total}</span><button class="btn sm" data-action="mv-page" data-d="-1" ${M.offset === 0 ? 'disabled' : ''}>Önceki</button><button class="btn sm" data-action="mv-page" data-d="1" ${M.offset + M.limit >= M.total ? 'disabled' : ''}>Sonraki</button></div>`;
    return toolbar + `<div class="table-card"><div class="tablewrap"><table class="stock"><thead><tr><th>Belge</th><th>Tür</th><th>Tarih</th><th>Kalemler</th><th>Talimatı veren</th><th>Karşı taraf</th><th>Kaydeden</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${pager}</div>`;
  }

  function alertsHtml() {
    const A = S.alerts;
    const open = A.open.length ? A.open.map(alertCard).join('') : `<p class="muted" style="margin:0">Aktif alarm yok. ${S.materials.filter(m => m.active && !(m.min_stock > 0)).length ? 'Limiti tanımsız malzemeler için alarm üretilmez; limiti malzeme kartından girin.' : ''}</p>`;
    const res = A.resolved.length ? A.resolved.map(alertCard).join('') : '<p class="muted" style="margin:0">Henüz kapanmış alarm yok.</p>';
    return `<div class="card t-rose"><h3>${ICON.alert} Aktif alarmlar <span class="mono">${A.open.length}</span></h3>${open}</div><div class="card"><h3>${ICON.ok} Kapanan alarmlar</h3>${res}</div>`;
  }

  function materialHtml() {
    const m = curMaterial(); const D = S.matDetail;
    if (!m || !D || D.material.id !== m.id) return '<div class="skeleton"></div><div class="skeleton"></div>';
    const s = stateOf(m);
    const delNote = m.deleted_at ? `<div class="err" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${ICON.trash}<span><b>Bu kart silinmiş.</b> ${fmtDT(m.deleted_at)} · Listelerde, aramalarda ve alarmlarda görünmez; geçmiş belgeleri ve PDF fişleri değişmeden saklanır.</span>${isAdmin() ? `<button class="btn sm" data-action="restore-material" data-id="${m.id}">${ICON.restore} Geri al</button>` : ''}</div>` : '';
    const hero = `<div class="card ${s === 'low' ? 't-rose' : s === 'near' ? 't-sand' : 't-sky'}"><h3>Mevcut stok ${statePill(m)}</h3><div class="stock-hero"><div class="big ${s}">${fmtNum(m.stock)}<small>${esc(m.unit)}</small></div><div class="lim">${m.min_stock > 0 ? `${meter(m)}<div class="l"><span>Minimum limit: <b>${fmtNum(m.min_stock)} ${esc(m.unit)}</b></span><span>${m.stock >= m.min_stock ? 'Limitin ' + fmtNum(m.stock - m.min_stock) + ' ' + esc(m.unit) + ' üstünde' : '<b style="color:var(--bad)">Limitin ' + fmtNum(m.min_stock - m.stock) + ' ' + esc(m.unit) + ' altında</b>'}</span></div>` : `<div class="l"><span>Minimum stok limiti tanımlı değil; bu malzeme için alarm üretilmez.</span>${canWrite() ? `<button class="btn sm" data-action="set-limit" data-id="${m.id}">Limit belirle</button>` : ''}</div>`}${m.last_move ? `<div class="l"><span>Son hareket: ${fmtDT(m.last_move)}</span></div>` : ''}</div></div></div>`;
    const details = `<div class="card"><h3>Kart bilgileri</h3><dl class="details"><dt>Kod</dt><dd class="mono">${esc(m.code)}</dd><dt>Birim</dt><dd>${esc(m.unit)}</dd><dt>Kategori</dt><dd>${esc(m.category || '—')}</dd><dt>Konum</dt><dd>${esc(m.location || '—')}</dd><dt>Açıklama</dt><dd>${esc(m.description || '—')}</dd><dt>Durum</dt><dd>${m.active ? 'Aktif' : 'Pasif — hareket girilemez'}</dd><dt>Oluşturma</dt><dd>${fmtDT(m.created_at)}${m.created_by && userById(m.created_by) ? ' · ' + esc(userById(m.created_by).name) : ''}</dd></dl>${isAdmin() && !m.deleted_at ? `<div style="margin-top:12px"><button class="btn danger sm" data-action="delete-material" data-id="${m.id}">${ICON.trash} Kartı sil</button></div>` : ''}</div>`;
    const chart = `<div class="card"><h3>${ICON.chart} Stok seyri</h3>${sparkHtml(D.history.filter(h => !h.cancelled), m)}</div>`;
    const hist = D.history.slice().reverse();
    const table = `<div class="card flush"><h3>Hareket geçmişi <span class="mono">${hist.length}</span></h3>${hist.length ? `<div class="tablewrap"><table class="stock"><thead><tr><th>Tarih</th><th>Belge</th><th>Tür</th><th class="r">Miktar</th><th class="r">Kalan</th><th>Talimatı veren</th><th>Karşı taraf</th><th>Kaydeden</th><th></th></tr></thead><tbody>${hist.map(h => `<tr class="rowlink ${h.cancelled ? 'cancelled' : ''}" data-action="open-doc" data-id="${h.movement_id}"><td class="date">${fmtDate(h.doc_date)}<div class="s muted">${fmtTime(h.created_at)}</div></td><td class="mono"><span class="t">${esc(h.doc_no)}</span></td><td><span class="pill ${h.cancelled ? 'cancel' : h.kind}">${h.cancelled ? 'İptal' : KIND[h.kind]}</span></td><td class="num" style="color:var(--${h.kind === 'in' ? 'ok' : h.kind === 'out' ? 'info' : 'violet'})">${h.kind === 'in' ? '+' : h.kind === 'out' ? '−' : (h.qty > 0 ? '+' : '')}${fmtNum(Math.abs(h.qty))}</td><td class="num">${fmtNum(h.stock_after)}</td><td>${esc(h.ordered_by)}</td><td>${esc(h.counterparty || '—')}</td><td>${esc(h.created_by_name || '')}</td><td class="acts"><a class="icon-btn" title="PDF fişi" href="/api/movements/${h.movement_id}/pdf" target="_blank" rel="noopener" data-stop="1">${ICON.pdf}</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="padding:10px 20px 18px;margin:0">Bu malzeme için henüz hareket yok.</p>'}</div>`;
    const al = D.alerts.length ? `<div class="card"><h3>${ICON.alert} Alarm geçmişi</h3><div class="list">${D.alerts.map(a => `<div class="row"><span class="grow"><span class="t">${a.resolved_at ? 'Kapandı' : 'Aktif'} · açılış stoğu ${fmtNum(a.stock_at_open)} / limit ${fmtNum(a.min_at_open)} ${esc(m.unit)}</span><span class="s">${fmtDT(a.opened_at)}${a.resolved_at ? ' → ' + fmtDT(a.resolved_at) : ''}</span></span><span class="pill ${a.resolved_at ? 'ok' : 'low'}">${a.resolved_at ? 'Kapandı' : 'Aktif'}</span></div>`).join('')}</div></div>` : '';
    return delNote + `<div class="grid2"><div>${hero}${chart}</div><div>${details}${al}</div></div><div style="height:20px"></div>${table}`;
  }
  // Stok seyri: her hareketten sonraki kalan stok, zaman ekseninde. Limit kesikli kırmızı çizgi.
  function sparkHtml(hist, m) {
    const pts = hist.map(h => ({ t: h.created_at, v: h.stock_after }));
    if (pts.length < 2) return '<p class="muted small" style="margin:0">Grafik için en az iki hareket gerekir.</p>';
    pts.push({ t: Date.now(), v: pts[pts.length - 1].v });
    const W = 520, H = 150, pl = 42, pr = 10, pt = 10, pb = 22;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const vmax = Math.max(...pts.map(p => p.v), m.min_stock || 0, 1) * 1.1; const vmin = Math.min(0, ...pts.map(p => p.v));
    const X = (t) => pl + (t - t0) / Math.max(1, t1 - t0) * (W - pl - pr); const Y = (v) => pt + (1 - (v - vmin) / (vmax - vmin)) * (H - pt - pb);
    let d = `M${X(pts[0].t).toFixed(1)},${Y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].t).toFixed(1)} V${Y(pts[i].v).toFixed(1)}`;
    const area = d + ` V${Y(vmin).toFixed(1)} H${X(pts[0].t).toFixed(1)} Z`;
    const ticks = [vmin, (vmin + vmax) / 2, vmax / 1.1].map(v => `<text x="${pl - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmtNum(v, 0)}</text><line class="ax" x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`).join('');
    const lim = m.min_stock > 0 ? `<line class="lim" x1="${pl}" x2="${W - pr}" y1="${Y(m.min_stock).toFixed(1)}" y2="${Y(m.min_stock).toFixed(1)}"/><text x="${W - pr}" y="${(Y(m.min_stock) - 4).toFixed(1)}" text-anchor="end" fill="var(--bad)">limit ${fmtNum(m.min_stock)}</text>` : '';
    const dots = pts.slice(0, -1).map(p => `<circle class="pt" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.5"><title>${fmtDT(p.t)}: ${fmtNum(p.v)} ${esc(m.unit)}</title></circle>`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Stok seyri">${ticks}<path class="ar" d="${area}"/><path class="ln" d="${d}"/>${lim}${dots}<text x="${pl}" y="${H - 6}">${fmtDate(dayOf(t0))}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">bugün</text></svg>`;
  }

  // ---------- bildirimler (zil) ----------
  function renderInbox() {
    const box = $('inbox'); if (!S.inboxOpen) { box.hidden = true; return; }
    const items = S.activity; let last = '';
    const icon = (a) => a.kind === 'alert' ? ICON.alert : a.kind === 'movement' ? ICON.chart : a.kind === 'material' ? ICON.box : a.kind === 'chat' ? ICON.chat : ICON.team;
    const body = items.length ? items.map(a => { const day = dayOf(a.ts); let h = ''; if (day !== last) { last = day; h += `<div class="ib-day">${day === todayIso() ? 'Bugün' : fmtDate(day)}</div>`; } const unread = a.ts > S.inboxSeen && a.user_id !== S.me.id; const u = a.user_id ? userById(a.user_id) || { name: a.user_name, color: a.user_color } : null; return h + `<button class="ib-item ${unread ? 'is-unread' : ''}" data-action="inbox-go" data-ref='${esc(JSON.stringify(a.ref || {}))}'>${u ? avatarHtml(u) : `<span class="av" style="background:var(--bad)">${a.kind === 'alert' ? '!' : '•'}</span>`}<span class="ib-body"><span class="ib-text"><b>${esc(a.title)}</b></span>${a.text ? `<span class="ib-prev">${esc(a.text)}</span>` : ''}<span class="ib-meta">${icon(a)} ${fmtTime(a.ts)}${u ? ' · ' + esc(u.name) : ''}</span></span><span class="ib-dot"></span></button>`; }).join('') : `<div class="ib-empty">${ICON.bell}<p>Henüz kayıt yok. Hareketler, alarmlar ve ekip değişiklikleri burada listelenir.</p></div>`;
    box.innerHTML = `<div class="ib-head"><h2>${ICON.bell} Bildirimler</h2><div class="ib-tools"><button class="btn ghost sm" data-action="inbox-read-all">Tümünü okundu say</button><button class="icon-btn" data-action="close-inbox" aria-label="Kapat">${ICON.x}</button></div></div><div class="ib-list">${body}</div>`;
    box.hidden = false;
  }
  async function markInboxSeen() { const ts = Date.now(); S.inboxSeen = ts; S.unread = 0; renderInboxCount(); try { await api('POST', '/api/activity/seen', { ts }); } catch (e) {} }

  // ---------- modallar ----------
  function modal(html, cls) { const r = $('modalRoot'); r.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`; r.hidden = false; const f = r.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30); return r.querySelector('.modal'); }
  function closeModal() { $('modalRoot').hidden = true; $('modalRoot').innerHTML = ''; }
  const modalHead = (title, sub) => `<div class="modal-head"><h2>${title}</h2>${sub ? `<span class="muted small">${sub}</span>` : ''}<button class="icon-btn" data-action="close-modal" aria-label="Kapat">${ICON.x}</button></div>`;
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms || 2600); }
  function ntoast(who, text, href) { const n = $('ntoast'); n.innerHTML = `${ICON.alert}<div class="nt-body"><span class="nt-who">${esc(who)}</span><span class="nt-text">${esc(text)}</span></div>`; n.dataset.href = href || ''; n.hidden = false; n.classList.add('show'); clearTimeout(n._t); n._t = setTimeout(() => { n.hidden = true; n.classList.remove('show'); }, 7000); }
  const datalist = (id, arr) => `<datalist id="${id}">${(arr || []).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;

  // --- malzeme kartı formu ---
  function materialForm(m) {
    const edit = !!m; m = m || { code: '', name: '', unit: 'adet', category: '', location: '', min_stock: '', description: '', active: true };
    modal(modalHead(edit ? 'Malzeme kartını düzenle' : 'Yeni malzeme kartı', edit ? esc(m.code) : '') + `<form id="matForm"><div id="err" class="err" hidden></div><div class="form-grid">
      <label class="f">Malzeme kodu<input type="text" name="code" value="${esc(m.code)}" required autofocus placeholder="KBL-NYY-4x16" ${edit && S.matDetail && S.matDetail.history && S.matDetail.history.length ? 'title="Hareketleri olan bir malzemenin kodu değiştirilebilir; eski belgelerde yeni kod görünür."' : ''}></label>
      <label class="f">Birim<input type="text" name="unit" value="${esc(m.unit)}" list="dlUnits" required placeholder="adet, m, kg, paket"></label>
      <label class="f span2">Malzeme adı<input type="text" name="name" value="${esc(m.name)}" required placeholder="NYY Kablo 4x16 mm²"></label>
      <label class="f">Kategori<input type="text" name="category" value="${esc(m.category)}" list="dlCats" placeholder="Kablo, Trafo, Pano…"></label>
      <label class="f">Konum (depo / raf)<input type="text" name="location" value="${esc(m.location)}" list="dlLocs" placeholder="Depo A / Raf 3"></label>
      <label class="f">Minimum stok limiti <span class="muted" style="font-weight:400">(altına düşünce alarm)</span><input type="number" name="min_stock" step="any" min="0" value="${m.min_stock === 0 ? '' : esc(m.min_stock)}" placeholder="0 = limit yok"></label>
      ${edit ? `<label class="f">Durum<select name="active"><option value="1" ${m.active ? 'selected' : ''}>Aktif</option><option value="0" ${!m.active ? 'selected' : ''}>Pasif (hareket girilemez)</option></select></label>` : '<span></span>'}
      <label class="f span2">Açıklama<textarea name="description" rows="2" placeholder="Teknik özellik, tedarikçi, not…">${esc(m.description)}</textarea></label>
    </div>${datalist('dlUnits', [...new Set(['adet', 'm', 'kg', 'ton', 'paket', 'rulo', 'koli', 'litre', 'set', ...S.unitList])])}${datalist('dlCats', S.catList)}${datalist('dlLocs', S.locList)}
    <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="close-modal">Vazgeç</button><button class="btn primary" type="submit">${edit ? 'Kaydet' : 'Kartı oluştur'}</button></div></div></form>`);
    $('matForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const b = Object.fromEntries(fd.entries()); if (edit) b.active = b.active === '1'; b.min_stock = b.min_stock === '' ? 0 : b.min_stock;
      try { const r = edit ? await api('PATCH', '/api/materials/' + m.id, b) : await api('POST', '/api/materials', b); setMaterial(r.material); closeModal(); toast(edit ? 'Malzeme kartı güncellendi.' : 'Malzeme kartı oluşturuldu.'); if (!edit) go('#/malzeme/' + r.material.id); else { renderRail(); renderChips(); if (S.view === 'material') loadMaterial(m.id); else renderPaneBody(); } loadMaterials().then(() => renderChips()); } catch (err) { const el = $('err'); el.textContent = err.message; el.hidden = false; }
    });
  }
  function limitForm(m) {
    modal(modalHead('Minimum stok limiti', esc(m.name)) + `<form id="limForm"><div id="err" class="err" hidden></div><p class="muted small" style="margin:0 0 12px">Stok bu değerin altına düştüğünde alarm açılır; uygulamadaki herkese bildirim gider ve e-posta/anlık bildirim yapılandırılmışsa onlar da gönderilir. Mevcut stok: <b>${fmtNum(m.stock)} ${esc(m.unit)}</b>.</p>
      <label class="f">Limit (${esc(m.unit)})<input type="number" name="min_stock" step="any" min="0" value="${m.min_stock || ''}" autofocus placeholder="0 = limit yok"></label>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="close-modal">Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div></form>`, 'narrow');
    $('limForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const v = e.target.min_stock.value; const r = await api('PATCH', '/api/materials/' + m.id, { min_stock: v === '' ? 0 : v }); setMaterial(r.material); closeModal(); toast('Limit kaydedildi.'); renderRail(); renderChips(); if (S.view === 'material') loadMaterial(m.id); else renderPaneBody(); } catch (err) { const el = $('err'); el.textContent = err.message; el.hidden = false; } });
  }

  // --- belge (hareket) formu ---
  let F = null; // açık formun durumu
  async function movementForm(kind, materialId) {
    if (!S.materials.some(m => m.active)) { toast('Önce bir malzeme kartı oluşturun.'); return materialForm(); }
    let sug = { orderedBy: [], suppliers: [], destinations: [], team: [] }; try { sug = await api('GET', '/api/movements/suggest'); } catch (e) {}
    F = { kind: kind || 'in', lines: [{ material_id: materialId || '', qty: '', note: '' }], sug };
    modal(modalHead('Yeni belge', '') + `<div class="kind-seg">${[['in', 'Giriş fişi', 'Depoya malzeme girişi'], ['out', 'Sevkiyat fişi', 'Depodan çıkış / sevk'], ['adj', 'Düzeltme', 'Sayım farkı, fire (± miktar)']].map(([k, t, s]) => `<button type="button" class="k${k} ${F.kind === k ? 'on' : ''}" data-action="form-kind" data-kind="${k}"><strong>${ICON[k]} ${t}</strong><small>${s}</small></button>`).join('')}</div>
      <form id="mvForm"><div id="err" class="err" hidden></div><div class="form-grid">
        <label class="f">Belge tarihi<input type="date" name="doc_date" value="${todayIso()}" required></label>
        <label class="f">Talimatı / siparişi veren *<input type="text" name="ordered_by" list="dlOrdered" required placeholder="Ad Soyad" ${materialId ? '' : 'autofocus'}></label>
        <label class="f span2" id="cpLabel"></label>
        <label class="f">İrsaliye / referans no<input type="text" name="reference" placeholder="İRS-2026-…"></label>
        <label class="f">Araç plakası<input type="text" name="vehicle" placeholder="06 ABC 123" style="text-transform:uppercase"></label>
      </div>
      <div style="margin-top:18px"><div class="eyebrow" style="margin-bottom:8px">Malzeme satırları</div><div class="line-head"><span>Malzeme</span><span style="text-align:right">Miktar</span><span>Birim</span><span></span></div><div class="lines" id="lines"></div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center"><button type="button" class="btn sm" data-action="add-line">${ICON.plus} Satır ekle</button><span class="hint-row">Miktar alanında <span class="kbd">Enter</span> yeni satır açar.</span></div><div id="preview"></div></div>
      <label class="f" style="margin-top:14px">Açıklama<textarea name="notes" rows="2" placeholder="Belgeye yazılacak not (isteğe bağlı)"></textarea></label>
      ${datalist('dlOrdered', [...new Set([...sug.orderedBy, ...sug.team])])}${datalist('dlSup', sug.suppliers)}${datalist('dlDest', sug.destinations)}
      <div class="form-actions"><span class="muted small" id="docHint"></span><div class="right"><button type="button" class="btn" data-action="close-modal">Vazgeç</button><button class="btn primary" type="submit" id="mvSubmit">Kaydet ve fişi oluştur</button></div></div></form>`);
    renderFormKind(); renderLines();
    $('mvForm').addEventListener('submit', submitMovement);
    $('mvForm').addEventListener('input', (e) => { if (e.target.closest('.line')) { const row = e.target.closest('.line'); const i = Number(row.dataset.i); if (e.target.name === 'qty') F.lines[i].qty = e.target.value; if (e.target.name === 'note') F.lines[i].note = e.target.value; if (e.target.name === 'msearch') { showPicker(row, e.target.value); } refreshLinePreview(); } });
    $('mvForm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.name === 'qty') { e.preventDefault(); addLine(); } if (e.key === 'Enter' && e.target.name === 'msearch') { e.preventDefault(); const first = e.target.closest('.picker').querySelector('.picker-menu button'); if (first) first.click(); } if (e.key === 'Escape' && e.target.name === 'msearch') { hidePickers(); } });
    $('mvForm').addEventListener('focusin', (e) => { if (e.target.name === 'msearch') showPicker(e.target.closest('.line'), e.target.value); });
  }
  function renderFormKind() {
    const k = F.kind; document.querySelectorAll('.kind-seg button').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
    const lbl = { in: ['Tedarikçi / teslim eden', 'Firma veya kişi', 'dlSup'], out: ['Teslimat yeri / alıcı', 'Şantiye, proje, firma veya kişi', 'dlDest'], adj: ['Düzeltme nedeni / dayanak', 'Ekim sayımı, hasar, fire…', ''] }[k];
    const cur = document.querySelector('[name=counterparty]'); const val = cur ? cur.value : '';
    $('cpLabel').innerHTML = `${lbl[0]}<input type="text" name="counterparty" placeholder="${lbl[1]}" ${lbl[2] ? 'list="' + lbl[2] + '"' : ''} value="${esc(val)}">`;
    $('docHint').textContent = { in: 'Belge numarası GRS-YYYY-NNNNN olarak verilir.', out: 'Belge numarası SVK-YYYY-NNNNN olarak verilir.', adj: 'Düzeltmede miktar artı (fazla) veya eksi (eksik) girilir; DZL-YYYY-NNNNN.' }[k];
    document.querySelector('.modal-head h2').textContent = KIND_LONG[k];
    refreshLinePreview();
  }
  function renderLines() {
    $('lines').innerHTML = F.lines.map((l, i) => { const m = S.matById.get(l.material_id); return `<div class="line" data-i="${i}" ${m ? 'data-line-material="' + m.id + '"' : ''}><div class="picker">${m ? `<div class="chosen" data-action="pick-change" data-i="${i}"><span class="mono small muted">${esc(m.code)}</span><span>${esc(m.name)}</span>${ICON.edit}</div>` : `<input type="text" name="msearch" placeholder="Malzeme adı veya kodu yazın…" autocomplete="off" ${i === F.lines.length - 1 ? 'autofocus' : ''}>`}</div><input type="number" name="qty" step="any" ${F.kind === 'adj' ? '' : 'min="0"'} value="${esc(l.qty)}" placeholder="0" ${m ? '' : 'disabled'}><span class="lstock ${m ? stateOf(m) : ''}">${m ? `${esc(m.unit)}<br><b>${fmtNum(m.stock)}</b> mevcut` : ''}</span><button type="button" class="icon-btn" title="Satırı kaldır" data-action="remove-line" data-i="${i}" ${F.lines.length === 1 ? 'disabled' : ''}>${ICON.x}</button>${m ? `<div class="line-note"><input type="text" name="note" value="${esc(l.note)}" placeholder="Satır notu (isteğe bağlı: seri no, parti, rapor…)"></div>` : ''}</div>`; }).join('');
    refreshLinePreview();
  }
  function addLine() { F.lines.push({ material_id: '', qty: '', note: '' }); renderLines(); const inp = $('lines').querySelector('.line:last-child input[name=msearch]'); if (inp) inp.focus(); }
  function showPicker(row, q) {
    hidePickers(); const p = row.querySelector('.picker'); if (!p) return;
    const qq = (q || '').trim().toLocaleLowerCase('tr');
    const list = S.materials.filter(m => m.active && (!qq || m.name.toLocaleLowerCase('tr').includes(qq) || m.code.toLocaleLowerCase('tr').includes(qq))).slice(0, 12);
    const menu = document.createElement('div'); menu.className = 'picker-menu';
    menu.innerHTML = list.length ? list.map(m => `<button type="button" data-action="pick" data-i="${row.dataset.i}" data-id="${m.id}"><span class="pm-code">${esc(m.code)}</span><span class="pm-name">${esc(m.name)}</span><span class="pm-stock ${stateOf(m) === 'low' ? 'low' : ''}">${fmtNum(m.stock)} ${esc(m.unit)}</span></button>`).join('') : `<div class="muted small" style="padding:8px 10px">Eşleşen malzeme yok.${canWrite() ? ' Önce kartını oluşturun.' : ''}</div>`;
    p.appendChild(menu);
  }
  function hidePickers() { document.querySelectorAll('.picker-menu').forEach(m => m.remove()); }
  function refreshLinePreview() {
    if (!F || !$('preview')) return;
    const running = new Map(); const warns = []; let bad = false;
    for (const l of F.lines) { const m = S.matById.get(l.material_id); if (!m) continue; const q = parseFloat(String(l.qty).replace(',', '.')); if (!Number.isFinite(q) || q === 0) continue; const before = running.has(m.id) ? running.get(m.id) : m.stock; const after = before + (F.kind === 'in' ? q : F.kind === 'out' ? -q : q); running.set(m.id, after);
      if (after < 0) { bad = true; warns.push(`<div class="preview-warn bad">${ICON.alert}<span><b>${esc(m.name)}</b>: stok yetersiz — mevcut ${fmtNum(before)} ${esc(m.unit)}, sonuç ${fmtNum(after)} ${esc(m.unit)}.${S.settings.allowNegative ? ' Eksi stok ayarlarda açık olduğundan kaydedilebilir.' : ' Bu belge kaydedilemez.'}</span></div>`); }
      else if (m.min_stock > 0 && after < m.min_stock) warns.push(`<div class="preview-warn">${ICON.alert}<span><b>${esc(m.name)}</b>: bu belgeden sonra stok ${fmtNum(after)} ${esc(m.unit)} olacak ve limitin (${fmtNum(m.min_stock)} ${esc(m.unit)}) altına düşecek — <b>alarm açılır</b>.</span></div>`);
      else if (m.min_stock > 0 && before < m.min_stock && after >= m.min_stock) warns.push(`<div class="preview-warn" style="background:var(--ok-soft);color:var(--ok)">${ICON.ok}<span><b>${esc(m.name)}</b>: stok ${fmtNum(after)} ${esc(m.unit)} olacak; aktif alarm kapanır.</span></div>`); }
    $('preview').innerHTML = warns.join('');
    const btn = $('mvSubmit'); if (btn) btn.disabled = bad && !S.settings.allowNegative;
  }
  async function submitMovement(e) {
    e.preventDefault(); const f = e.target; const err = $('err'); err.hidden = true;
    const lines = F.lines.filter(l => l.material_id).map(l => ({ material_id: l.material_id, qty: String(l.qty).replace(',', '.'), note: l.note }));
    if (!lines.length) { err.textContent = 'En az bir malzeme seçin.'; err.hidden = false; return; }
    const b = { kind: F.kind, doc_date: f.doc_date.value, ordered_by: f.ordered_by.value, counterparty: f.counterparty ? f.counterparty.value : '', reference: f.reference.value, vehicle: f.vehicle.value, notes: f.notes.value, lines };
    const btn = $('mvSubmit'); btn.disabled = true;
    try { const r = await api('POST', '/api/movements', b); F = null; toast(`${r.movement.doc_no} kaydedildi.`); showMovement(r.movement, true); loadMaterials().then(() => { renderRail(); renderChips(); if (S.view === 'materials') renderPaneBody(); }); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  }

  // --- belge görünümü ---
  async function openMovement(id) { try { const r = await api('GET', '/api/movements/' + id); showMovement(r.movement); } catch (e) { toast(e.message); } }
  function showMovement(mv, justCreated) {
    const k = mv.kind; const party = { in: 'Tedarikçi / teslim eden', out: 'Teslimat yeri / alıcı', adj: 'Düzeltme nedeni' }[k];
    const total = mv.lines.reduce((s, l) => s + Number(l.qty), 0); const units = new Set(mv.lines.map(l => l.unit));
    modal(`<div data-doc-id="${mv.id}">${modalHead(`${esc(mv.doc_no)} <span class="pill ${mv.cancelled ? 'cancel' : k}">${mv.cancelled ? 'İptal edildi' : KIND[k]}</span>`, KIND_LONG[k])}
      ${justCreated ? `<div class="ok-note" style="margin:0 0 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${ICON.ok} Belge kaydedildi ve stok güncellendi. <a class="btn primary sm" href="/api/movements/${mv.id}/pdf" target="_blank" rel="noopener">${ICON.pdf} PDF fişini aç</a></div>` : ''}
      ${mv.cancelled ? `<div class="err" style="margin-bottom:14px"><span class="doc-stamp">İPTAL</span> &nbsp; ${fmtDT(mv.cancelled_at)} · ${esc(mv.cancelled_by_name || '')}${mv.cancel_reason ? ' · ' + esc(mv.cancel_reason) : ''} — stok etkisi geri alındı.</div>` : ''}
      <div class="doc-head"><div class="f">Belge tarihi<span>${fmtDate(mv.doc_date)}</span></div><div class="f">Talimatı / siparişi veren<span>${esc(mv.ordered_by)}</span></div><div class="f">${party}<span>${esc(mv.counterparty || '—')}</span></div><div class="f">İrsaliye / referans<span>${esc(mv.reference || '—')}</span></div><div class="f">Araç plakası<span class="mono">${esc(mv.vehicle || '—')}</span></div><div class="f">Kaydı yapan<span>${esc(mv.created_by_name || '')} <span class="muted small">${fmtDT(mv.created_at)}</span></span></div></div>
      ${mv.notes ? `<div class="f" style="margin-bottom:12px">Açıklama<span style="color:var(--fg);font-weight:400">${esc(mv.notes)}</span></div>` : ''}
      <div class="table-card doc-lines"><table class="stock"><thead><tr><th>#</th><th>Kod</th><th>Malzeme</th><th>Birim</th><th class="r">Miktar</th><th class="r">Önceki</th><th class="r">Kalan</th></tr></thead><tbody>${mv.lines.map(l => `<tr class="rowlink" data-action="go-close" data-href="#/malzeme/${l.material_id}"><td class="muted">${l.pos}</td><td class="mono">${esc(l.material_code)}</td><td><div class="t">${esc(l.material_name)}</div>${l.note ? `<div class="s">${esc(l.note)}</div>` : ''}</td><td>${esc(l.unit)}</td><td class="num">${k === 'adj' && l.qty > 0 ? '+' : ''}${fmtNum(l.qty)}</td><td class="r muted">${fmtNum(l.stock_before)}</td><td class="num">${fmtNum(l.stock_after)}</td></tr>`).join('')}</tbody></table>${units.size === 1 ? `<div class="pager" style="justify-content:space-between"><span>${mv.lines.length} kalem</span><span>Toplam <b>${fmtNum(total)} ${esc([...units][0])}</b></span></div>` : ''}</div>
      <div class="form-actions"><div style="display:flex;gap:6px;flex-wrap:wrap">${isAdmin() && !mv.cancelled ? `<button class="btn danger sm" data-action="cancel-doc" data-id="${mv.id}">İptal et</button>` : ''}${canWrite() && !mv.cancelled && (mv.created_by === S.me.id || isAdmin()) ? `<button class="btn sm" data-action="edit-doc" data-id="${mv.id}">${ICON.edit} Bilgileri düzenle</button>` : ''}</div><div class="right"><a class="btn sm" href="/api/movements/${mv.id}/pdf?dl" download>${ICON.download} İndir</a><a class="btn ${justCreated ? '' : 'primary'} sm" href="/api/movements/${mv.id}/pdf" target="_blank" rel="noopener">${ICON.pdf} PDF fişi</a><button class="btn sm" data-action="close-modal">Kapat</button></div></div></div>`);
    $('modalRoot')._mv = mv;
  }
  function editDocForm(mv) {
    modal(modalHead('Belge bilgilerini düzenle', esc(mv.doc_no)) + `<form id="edForm"><div id="err" class="err" hidden></div><p class="muted small" style="margin:0 0 12px">Satırlar ve miktarlar değiştirilemez; hatalı bir belge iptal edilip yeniden oluşturulmalıdır.</p><div class="form-grid">
      <label class="f">Belge tarihi<input type="date" name="doc_date" value="${mv.doc_date}" required></label><label class="f">Talimatı / siparişi veren<input type="text" name="ordered_by" value="${esc(mv.ordered_by)}" required></label>
      <label class="f span2">Karşı taraf<input type="text" name="counterparty" value="${esc(mv.counterparty)}"></label>
      <label class="f">İrsaliye / referans no<input type="text" name="reference" value="${esc(mv.reference)}"></label><label class="f">Araç plakası<input type="text" name="vehicle" value="${esc(mv.vehicle)}"></label>
      <label class="f span2">Açıklama<textarea name="notes" rows="2">${esc(mv.notes)}</textarea></label></div>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="open-doc" data-id="${mv.id}">Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div></form>`);
    $('edForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const b = Object.fromEntries(new FormData(e.target).entries()); const r = await api('PATCH', '/api/movements/' + mv.id, b); toast('Belge güncellendi.'); showMovement(r.movement); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }
  function cancelDocForm(mv) {
    modal(modalHead('Belgeyi iptal et', esc(mv.doc_no)) + `<form id="cnForm"><div id="err" class="err" hidden></div><p style="margin:0 0 12px">Bu belgenin stok etkisi geri alınır (${mv.lines.length} kalem). Belge kaydı ve PDF'i "İPTAL" damgasıyla saklanır; bu işlem geri alınamaz.</p><label class="f">İptal nedeni<input type="text" name="reason" placeholder="Hatalı miktar, mükerrer kayıt…" autofocus></label>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="open-doc" data-id="${mv.id}">Vazgeç</button><button class="btn danger" type="submit">Belgeyi iptal et</button></div></div></form>`, 'narrow');
    $('cnForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api('POST', '/api/movements/' + mv.id + '/cancel', { reason: e.target.reason.value }); toast('Belge iptal edildi; stok geri alındı.'); showMovement(r.movement); loadMaterials().then(() => { renderRail(); renderChips(); if (S.view !== 'material') renderPaneBody(); }); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }

  // --- ayarlar ---
  async function settingsModal() {
    let pushState = 'unsupported'; try { pushState = window.deskPush ? await window.deskPush.status() : 'unsupported'; } catch (e) {}
    let adm = null, deleted = []; if (isAdmin()) { try { adm = (await api('GET', '/api/admin/settings')).settings; deleted = (await api('GET', '/api/materials/deleted')).materials; } catch (e) {} }
    const theme = localStorage.getItem('depo:theme') || 'system';
    const pushTxt = { on: ['ok', 'Açık', 'Bu cihaz stok alarmlarında ve yeni belgelerde bildirim alır.'], off: ['warn', 'Kapalı', 'Bu cihazda bildirim kapalı. Açtığınızda alarmlar uygulama kapalıyken bile ulaşır.'], blocked: ['bad', 'Engelli', 'Tarayıcı bu site için bildirimleri engellemiş; site ayarlarından izin verin.'], install: ['warn', 'Kurulum gerekli', 'iPhone/iPad\'de bildirim için uygulamayı önce Ana Ekrana ekleyin (Paylaş → Ana Ekrana Ekle).'], unsupported: ['warn', 'Desteklenmiyor', S.pushOn ? 'Bu tarayıcı anlık bildirimi desteklemiyor.' : 'Sunucuda anlık bildirim yapılandırılmamış (VAPID anahtarları). Alarmlar uygulama içinde ve e-posta ile iletilir.'] }[pushState];
    modal(modalHead('Ayarlar ve bildirimler', '') + `<div class="settings">
      <div class="set-section"><h3>${ICON.team} Hesap</h3><div class="set-account">${avatarHtml(S.me, 'lg')}<span><strong>${esc(S.me.name)}</strong><small>${esc(S.me.email)} · ${ROLE[S.me.role]}</small></span></div><div class="set-actions"><button class="btn sm" data-action="rename">Adımı değiştir</button><button class="btn sm" data-action="password">${ICON.key} Şifremi değiştir</button></div></div>
      <div class="set-section"><h3>${ICON.bell} Bu cihazda anlık bildirim</h3><div class="set-status ${pushTxt[0]}"><span class="set-badge">${pushTxt[1]}</span><span>${pushTxt[2]}</span></div><div class="set-actions">${pushState === 'off' ? '<button class="btn primary sm" data-action="push-on">Bildirimleri aç</button>' : ''}${pushState === 'on' ? '<button class="btn sm" data-action="push-test">Deneme bildirimi gönder</button><button class="btn sm" data-action="push-off">Bu cihazda kapat</button>' : ''}</div></div>
      <div class="set-section"><h3>${ICON.alert} Alarm e-postası</h3><label class="set-check"><input type="checkbox" data-action="alert-mail" ${S.me.alert_mail ? 'checked' : ''}><span>Stok limitin altına düştüğünde bana e-posta gönder<small>${S.mailOn ? 'E-posta gönderimi bu sunucuda yapılandırılmış.' : 'Sunucuda e-posta (SMTP) henüz yapılandırılmamış; bu tercih yapılandırıldığında geçerli olur.'}</small></span></label></div>
      ${adm ? `<div class="set-section"><h3>${ICON.gear} Yönetici ayarları</h3><form id="admForm"><div id="err" class="err" hidden></div>
        <label class="f">Ek alarm e-posta alıcıları <span class="muted" style="font-weight:400">(virgülle ayırın; ekip üyelerine ek olarak)</span><input type="text" name="alertEmails" value="${esc(adm.alertEmails || '')}" placeholder="depo@firma.com, satinalma@firma.com"></label>
        <label class="set-check" style="margin-top:8px"><input type="checkbox" name="alertPushAll" ${adm.alertPushAll ? 'checked' : ''}><span>Alarm anlık bildirimi herkese gitsin<small>Kapalıysa yalnızca yöneticilere gönderilir.</small></span></label>
        <label class="set-check"><input type="checkbox" name="allowNegative" ${adm.allowNegative ? 'checked' : ''}><span>Eksi stoğa izin ver<small>Açıksa sevkiyat, mevcut stoktan fazla olsa bile kaydedilir (kayıtlar fiziksel hareketin gerisinde kalıyorsa). Kapalıysa yetersiz stokta belge reddedilir.</small></span></label>
        <div class="eyebrow" style="margin:14px 0 8px">PDF fişi başlığı</div><div class="form-grid"><label class="f span2">Şirket adı<input type="text" name="cname" value="${esc(adm.company.name)}"></label><label class="f span2">Adres<input type="text" name="caddress" value="${esc(adm.company.address)}"></label><label class="f span2">İkinci satır<input type="text" name="cline2" value="${esc(adm.company.line2)}"></label></div>
        <div class="set-actions"><button class="btn primary sm" type="submit">Yönetici ayarlarını kaydet</button><button type="button" class="btn sm" data-action="team">${ICON.team} Ekip ve davetler</button><a class="btn sm" href="/api/admin/backup" download>${ICON.download} Veritabanı yedeği</a></div></form></div>` : ''}
      ${isAdmin() ? `<div class="set-section"><h3>${ICON.trash} Silinen malzeme kartları <span class="muted" style="font-weight:400">(${deleted.length})</span></h3>${deleted.length ? `<div>${deleted.map(m => `<div class="del-card"><span class="grow"><div><b>${esc(m.name)}</b> <span class="mono small muted">${esc(m.code)}</span></div><div class="small muted">${fmtDT(m.deleted_at)}${m.deleted_by_name ? ' · ' + esc(m.deleted_by_name) : ''} · ${m.line_count} hareket satırı · son stok ${fmtNum(m.stock)} ${esc(m.unit)}</div></span><button class="btn sm" data-action="restore-material" data-id="${m.id}" data-from="settings">${ICON.restore} Geri al</button></div>`).join('')}</div>` : '<p class="muted small" style="margin:0">Hareketi olan bir kart silindiğinde burada listelenir ve geri alınabilir. Hareketi olmayan kartlar kalıcı olarak silinir.</p>'}</div>` : ''}
      <div class="set-section"><h3>Görünüm</h3><div class="seg">${[['system', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']].map(([k, l]) => `<button type="button" class="${theme === k ? 'on' : ''}" data-action="theme" data-theme="${k}">${l}</button>`).join('')}</div></div>
      <div class="set-section"><h3>Uygulama</h3><p class="muted small" style="margin:0">Malzeme Takip · Peak PV Solar · Telefonda tek dokunuşla açmak için tarayıcı menüsünden "Ana Ekrana Ekle".</p></div>
    </div>`);
    const af = $('admForm'); if (af) af.addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await api('POST', '/api/admin/settings', { alertEmails: f.alertEmails.value, alertPushAll: f.alertPushAll.checked, allowNegative: f.allowNegative.checked, company: { name: f.cname.value, address: f.caddress.value, line2: f.cline2.value } }); S.settings.allowNegative = f.allowNegative.checked; toast('Yönetici ayarları kaydedildi.'); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }
  function applyTheme() { const t = localStorage.getItem('depo:theme') || 'system'; if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
  function passwordForm() {
    modal(modalHead('Şifremi değiştir', '') + `<form id="pwForm"><div id="err" class="err" hidden></div><label class="f">Mevcut şifre<input type="password" name="current" autocomplete="current-password" required autofocus></label><label class="f">Yeni şifre (en az 8 karakter)<input type="password" name="password" autocomplete="new-password" minlength="8" required></label><label class="f">Yeni şifre (tekrar)<input type="password" name="p2" autocomplete="new-password" required></label><div class="form-actions"><div class="right"><button type="button" class="btn" data-action="close-modal">Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div></form>`, 'narrow');
    $('pwForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; if (f.password.value !== f.p2.value) { $('err').textContent = 'İki şifre birbirini tutmuyor.'; $('err').hidden = false; return; } try { await api('POST', '/api/me/password', { current: f.current.value, password: f.password.value }); closeModal(); toast('Şifreniz değiştirildi.'); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }
  function renameForm() {
    modal(modalHead('Adımı değiştir', '') + `<form id="rnForm"><div id="err" class="err" hidden></div><label class="f">Ad Soyad<input type="text" name="name" value="${esc(S.me.name)}" required autofocus></label><div class="form-actions"><div class="right"><button type="button" class="btn" data-action="settings">Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div></form>`, 'narrow');
    $('rnForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api('POST', '/api/me', { name: e.target.name.value }); S.me = r.me; renderMe(); settingsModal(); toast('Adınız güncellendi.'); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }

  // --- ekip (yönetici) ---
  async function teamModal(note) {
    let r; try { r = await api('GET', '/api/admin/users'); } catch (e) { toast(e.message); return; }
    const rows = r.users.map(u => `<tr><td>${avatarHtml(u, 'sm')} <b>${esc(u.name)}</b><div class="s muted">${esc(u.email)}</div></td><td><select data-action="user-role" data-id="${u.id}" style="width:auto" ${u.id === S.me.id ? 'disabled' : ''}>${['admin', 'member', 'viewer'].map(k => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${ROLE[k]}</option>`).join('')}</select></td><td>${u.active ? (u.last_seen ? '<span class="pill ok">Aktif</span><div class="s muted">son giriş ' + ago(u.last_seen) + '</div>' : '<span class="pill ok">Aktif</span>') : u.invitePending ? '<span class="pill near">Davet bekliyor</span>' : '<span class="pill off">Pasif</span>'}</td><td><input type="checkbox" data-action="user-alert-mail" data-id="${u.id}" ${u.alert_mail ? 'checked' : ''} title="Alarm e-postası alsın"></td><td class="acts"><button class="btn sm" data-action="user-reset" data-id="${u.id}">${u.has_password ? 'Sıfırlama bağlantısı' : 'Yeni davet bağlantısı'}</button> ${u.id !== S.me.id ? `<button class="btn sm ${u.active ? 'danger' : ''}" data-action="user-active" data-id="${u.id}" data-active="${u.active ? '0' : '1'}">${u.active ? 'Pasife al' : 'Aktif et'}</button>` : ''}</td></tr>`).join('');
    modal(modalHead('Ekip ve davetler', `${r.users.length} kişi`) + `${note || ''}<form id="invForm" class="form-grid" style="margin-bottom:16px"><div id="err" class="err span2" hidden></div><label class="f">Ad Soyad<input type="text" name="name" required placeholder="Yeni kullanıcı"></label><label class="f">E-posta<input type="email" name="email" required placeholder="ad.soyad@firma.com.tr"></label><label class="f">Rol<select name="role"><option value="member">Kullanıcı — belge girer, kart açar</option><option value="admin">Yönetici — ekip, ayarlar, iptal</option><option value="viewer">Görüntüleyici — yalnızca izler</option></select></label><div class="f" style="justify-content:flex-end"><button class="btn primary" type="submit">${ICON.plus} Davet et</button></div></form>
      <div class="tablewrap"><table class="team"><thead><tr><th>Kişi</th><th>Rol</th><th>Durum</th><th title="Alarm e-postası">E-posta</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small" style="margin:14px 0 0">${r.mail ? 'Davet ve sıfırlama bağlantıları e-posta ile gönderilir.' : 'Bu sunucuda e-posta gönderimi yapılandırılmamış: davet bağlantısı burada gösterilir, siz kopyalayıp iletirsiniz.'} · Veritabanı: ${esc(r.storage.dir)}${r.storage.volume ? ' (kalıcı disk)' : ''} · ${r.storage.materials} malzeme, ${r.storage.movements} belge.</p>`);
    $('invForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { const x = await api('POST', '/api/admin/invite', { name: f.name.value, email: f.email.value, role: f.role.value }); teamModal(linkNote(x.user.name, x.inviteUrl, x.emailed)); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }
  const linkNote = (name, url, emailed) => `<div class="ok-note" style="margin:0 0 14px">${emailed ? `${esc(name)} için davet e-postası gönderildi.` : `${esc(name)} için bağlantı hazır — kopyalayıp iletin (7 gün geçerli):`}<div class="copybox"><input type="text" readonly value="${esc(url)}" onclick="this.select()"><button type="button" class="btn sm" data-action="copy" data-text="${esc(url)}">Kopyala</button></div></div>`;


  // ---------- malzeme kartı silme (yönetici) ----------
  async function deleteMaterialForm(id) {
    const m = S.matById.get(id) || curMaterial(); if (!m) return;
    let lines = 0; try { const r = await api('GET', '/api/materials/' + id); lines = r.history.length; } catch (e) {}
    const soft = lines > 0;
    modal(modalHead('Malzeme kartını sil', esc(m.name)) + `<form id="delForm"><div id="err" class="err" hidden></div>
      <p style="margin:0 0 10px"><b>${esc(m.name)}</b> <span class="mono muted small">${esc(m.code)}</span> · mevcut stok <b>${fmtNum(m.stock)} ${esc(m.unit)}</b></p>
      ${soft ? `<div class="preview-warn">${ICON.alert}<span>Bu kartın <b>${lines} hareket satırı</b> var. Kart listelerden, aramalardan, belge satır seçiminden ve alarmlardan kaldırılır; <b>geçmiş belgeler ve PDF fişleri değişmeden saklanır</b>. Gerekirse Ayarlar → <i>Silinen malzeme kartları</i> bölümünden geri alınabilir.</span></div>`
             : `<div class="preview-warn bad">${ICON.alert}<span>Bu kartın hiç hareketi yok; <b>kalıcı olarak silinir</b> ve geri alınamaz.</span></div>`}
      <label class="f" style="margin-top:14px">Onaylamak için kartın kodunu yazın<input type="text" name="confirm" autocomplete="off" placeholder="${esc(m.code)}" autofocus></label>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="close-modal">Vazgeç</button><button class="btn danger" type="submit">Kartı sil</button></div></div></form>`, 'narrow');
    $('delForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const v = e.target.confirm.value.trim().toLocaleLowerCase('tr');
      if (v !== m.code.toLocaleLowerCase('tr')) { $('err').textContent = 'Kod eşleşmedi. Silmek için kartın kodunu aynen yazın.'; $('err').hidden = false; return; }
      try { const r = await api('DELETE', '/api/materials/' + id, {}); closeModal(); toast(r.mode === 'soft' ? 'Kart silindi; hareket geçmişi saklandı.' : 'Kart kalıcı olarak silindi.'); S.materials = S.materials.filter(x => x.id !== id); S.matById.delete(id); renderRail(); renderChips(); if (S.view === 'material' && S.matId === id) go('#/malzemeler'); else if (S.view === 'materials') renderPaneBody(); else if (S.view === 'dashboard') loadDashboard(); }
      catch (err) { $('err').textContent = err.message; $('err').hidden = false; }
    });
  }

  // ---------- sohbet ----------
  const C = S.chat;
  const curChannel = () => C.channels.find(c => c.id === C.cid) || null;
  const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const isImg = (mime) => /^image\/(jpeg|png|gif|webp)$/.test(mime || '');
  const fileUrl = (a, dl) => '/files/' + a.id + '/' + encodeURIComponent(a.name || 'dosya') + (dl ? '?dl' : '');
  function fmtDay(ts) { const d = dayOf(ts); const t = todayIso(); if (d === t) return 'Bugün'; const y = dayOf(Date.now() - 86400000); if (d === y) return 'Dün'; return new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ts)); }
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function mentionNames() { return [...S.team].sort((a, b) => b.name.length - a.name.length); }
  function inline(text) {
    let h = esc(text);
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const u of mentionNames()) { const full = esc(u.name); const first = full.split(/\s+/)[0]; h = h.replace(new RegExp('@(' + reEsc(full) + '|' + reEsc(first) + ')(?![\\p{L}\\p{N}_])', 'giu'), '<span class="mn">@$1</span>'); }
    return h;
  }
  function mentionsMe(text) { if (!text || !text.includes('@')) return false; const t = text.toLocaleLowerCase('tr'); const full = S.me.name.toLocaleLowerCase('tr'); const first = full.split(/\s+/)[0]; return t.includes('@' + full) || new RegExp('@' + reEsc(first) + '(?![\\p{L}\\p{N}_])', 'u').test(t); }

  async function loadChannels() { const r = await api('GET', '/api/chat/channels'); C.channels = r.channels; C.unread = r.unread; renderChatCount(); if (S.view === 'chat') { renderChannels(); renderChanHead(); renderComposer(); } }
  async function openChat() {
    if (!C.channels.length) { try { await loadChannels(); } catch (e) {} }
    if (!C.cid || !curChannel()) { const first = C.channels.find(c => !c.archived) || C.channels[0]; if (first) { C.cid = first.id; if (location.hash !== '#/sohbet/' + first.id) history.replaceState(null, '', '#/sohbet/' + first.id); } }
    C.msgs = []; C.loaded = false; C.hasMore = false; C.filter = '';
    renderPaneBody();
    if (C.cid) await loadMessages(false);
    startTypingTicker();
  }
  async function loadMessages(older) {
    const cid = C.cid; if (!cid) return;
    const before = older && C.msgs.length ? C.msgs[0].ts : 0;
    try {
      const r = await api('GET', `/api/chat/channels/${cid}/messages?limit=60${before ? '&before=' + before : ''}`);
      if (C.cid !== cid) return;
      const el = $('msgs'); const prevH = el ? el.scrollHeight : 0;
      C.msgs = older ? [...r.messages, ...C.msgs] : r.messages; C.hasMore = r.hasMore; C.loaded = true;
      renderMessages(older);
      if (older && el) el.scrollTop = el.scrollHeight - prevH;
      if (!older && C.msgs.length && document.hasFocus()) markChannelRead(cid, C.msgs[C.msgs.length - 1].ts);
    } catch (e) { toast(e.message); }
  }
  let readTimer = null;
  function markChannelRead(cid, ts) {
    const ch = C.channels.find(c => c.id === cid); if (ch && ch.unread) { C.unread = Math.max(0, C.unread - ch.unread); ch.unread = 0; renderChatCount(); renderChannels(); }
    clearTimeout(readTimer); readTimer = setTimeout(() => { api('POST', `/api/chat/channels/${cid}/read`, { ts }).then(r => { C.unread = r.unread; renderChatCount(); }).catch(() => {}); }, 300);
  }
  function renderChannels() {
    const el = $('channels'); if (!el) return;
    const act = C.channels.filter(c => !c.archived), arch = C.channels.filter(c => c.archived);
    const row = (c) => `<button class="chrow ${c.id === C.cid ? 'on' : ''} ${c.archived ? 'arch' : ''}" data-action="select-channel" data-id="${c.id}">${c.archived ? ICON.archive : ICON.hash}<span class="nm">${esc(c.name)}</span>${c.unread ? `<span class="cnt">${c.unread}</span>` : ''}</button>`;
    el.innerHTML = `<div class="rail-section"><span>Kanallar</span>${canWrite() ? `<button class="icon-btn" data-action="new-channel" title="Yeni kanal" aria-label="Yeni kanal">${ICON.plus}</button>` : ''}</div>
      <div class="chlist">${act.map(row).join('') || '<div class="muted small" style="padding:6px 8px">Henüz kanal yok.</div>'}${arch.length ? `<div class="rail-section" style="padding-top:14px"><span>Arşiv</span><span class="mono">${arch.length}</span></div>${arch.map(row).join('')}` : ''}</div>`;
  }
  function renderChanHead() {
    const el = $('chanHead'); if (!el) return; const c = curChannel();
    if (!c) { el.innerHTML = '<span class="muted small">Bir kanal seçin veya oluşturun.</span>'; return; }
    el.innerHTML = `<span class="cn">${ICON.hash}${esc(c.name)}</span><span class="ct" title="${esc(c.topic || '')}">${esc(c.topic || '')}</span>
      <span class="cs"><input type="search" id="msgSearch" placeholder="Kanalda ara" value="${esc(C.filter)}" aria-label="Kanalda ara">
        <a class="btn sm ghost" href="/api/chat/channels/${c.id}/export" download title="Sohbeti Markdown olarak indir">${ICON.download}</a>
        ${canWrite() ? `<button class="btn sm ghost" data-action="edit-channel" title="Adı veya konuyu değiştir">${ICON.edit}</button>` : ''}
        ${isAdmin() ? `<button class="btn sm ghost" data-action="${c.archived ? 'unarchive-channel' : 'archive-channel'}" title="${c.archived ? 'Arşivden çıkar' : 'Kanalı arşivle'}">${ICON.archive}</button>` : ''}
      </span>`;
  }
  function attachmentsHtml(m) {
    const att = m.att || []; if (!att.length) return '';
    const imgs = att.filter(a => isImg(a.mime)), files = att.filter(a => !isImg(a.mime)); let h = '';
    if (imgs.length) h += `<div class="msg-photos n${Math.min(imgs.length, 4)}">${imgs.map(a => `<button type="button" class="photo" data-action="view-photo" data-id="${a.id}" title="${esc(a.name)}" ${a.w && a.h ? `style="aspect-ratio:${a.w}/${a.h}"` : ''}><img src="${fileUrl(a)}" alt="${esc(a.name)}" loading="lazy" ${a.w ? `width="${a.w}" height="${a.h}"` : ''}></button>`).join('')}</div>`;
    if (files.length) h += `<div class="msg-files">${files.map(a => `<div class="file-chip"><a class="fc-main" href="${fileUrl(a)}" target="_blank" rel="noopener" title="${esc(a.name)}">${ICON.file}<span class="fc-meta"><span class="fc-name">${esc(a.name)}</span><span class="fc-sub">${esc((a.name.match(/\.(\w+)$/) || ['', 'dosya'])[1].toUpperCase())} · ${fmtBytes(a.size)}</span></span></a><a class="icon-btn fc-dl" href="${fileUrl(a, true)}" download="${esc(a.name)}" title="İndir">${ICON.download}</a></div>`).join('')}</div>`;
    return h;
  }
  function renderMessages(keepScroll) {
    const el = $('msgs'); if (!el) return; const c = curChannel();
    if ($('editTa') && !keepScroll) return;
    const wasBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80 || !el.dataset.rendered;
    if (!c) { el.innerHTML = `<div class="empty" style="margin:auto">${ICON.chat}<h2>Henüz kanal yok</h2><p>${canWrite() ? 'Sağ üstten ilk kanalı oluşturun.' : 'Bir yönetici kanal oluşturduğunda burada görünür.'}</p></div>`; return; }
    if (!C.loaded) { el.innerHTML = '<div class="skeleton" style="width:50%"></div><div class="skeleton" style="width:70%"></div>'; return; }
    const q = C.filter.trim().toLocaleLowerCase('tr');
    const msgs = q ? C.msgs.filter(m => ((m.text || '') + ' ' + (m.att || []).map(a => a.name).join(' ')).toLocaleLowerCase('tr').includes(q)) : C.msgs;
    let h = C.hasMore && !q ? `<button class="btn sm ghost older" data-action="older">Daha eski mesajları yükle</button>` : '';
    if (!msgs.length) { el.innerHTML = h + `<div class="empty" style="margin:auto">${ICON.hash}<h2>${q ? 'Eşleşen mesaj yok' : '#' + esc(c.name) + ' kanalının başlangıcı'}</h2><p>${q ? 'Başka bir arama deneyin.' : (c.topic ? esc(c.topic) : 'Burada yazılan her şey saklanır; ekip aynı anda görür.')}</p></div>`; el.dataset.rendered = '1'; return; }
    let lastDay = '', lastAuthor = null, lastT = 0, open = false;
    for (const m of msgs) {
      const day = dayOf(m.ts);
      if (day !== lastDay) { if (open) { h += '</div></div>'; open = false; } h += `<div class="daysep">${fmtDay(m.ts)}</div>`; lastDay = day; lastAuthor = null; }
      if (m.user_id !== lastAuthor || m.ts - lastT > 5 * 60000) { if (open) h += '</div></div>'; const u = userById(m.user_id) || { name: m.user_name || '—', color: m.user_color }; h += `<div class="mgroup">${avatarHtml(u, 'lg')}<div><div class="mhead"><span class="who">${esc(u.name)}</span><span class="when">${fmtTime(m.ts)}</span></div>`; open = true; }
      const mine = m.user_id === S.me.id && canWrite(); const hasText = !!(m.text || '').trim();
      h += `<div class="msg ${mentionsMe(m.text) ? 'mention' : ''}" data-mid="${m.id}" title="${fmtDT(m.ts)}">${hasText ? `<div class="msg-text">${inline(m.text)}${m.edited_at ? '<span class="ed">(düzenlendi)</span>' : ''}</div>` : ''}${attachmentsHtml(m)}${mine || isAdmin() ? `<div class="acts">${mine && hasText ? `<button class="icon-btn" data-action="edit-msg" data-id="${m.id}" title="Düzenle">${ICON.edit}</button>` : ''}<button class="icon-btn" data-action="delete-msg" data-id="${m.id}" title="Sil">${ICON.trash}</button></div>` : ''}</div>`;
      lastAuthor = m.user_id; lastT = m.ts;
    }
    if (open) h += '</div></div>';
    el.innerHTML = h; el.dataset.rendered = '1';
    if (wasBottom && !keepScroll) el.scrollTop = el.scrollHeight;
  }
  function startEdit(mid) {
    const m = C.msgs.find(x => x.id === mid); const box = document.querySelector(`.msg[data-mid="${mid}"]`); if (!m || !box) return;
    box.innerHTML = `<div class="edit"><textarea id="editTa" rows="2">${esc(m.text)}</textarea><div class="r"><button class="btn primary sm" data-action="save-edit" data-id="${mid}">Kaydet</button><button class="btn sm" data-action="cancel-edit">Vazgeç</button><span class="muted">Enter kaydeder · Esc vazgeçer</span></div></div>`;
    const ta = $('editTa'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(mid); } if (e.key === 'Escape') { e.stopPropagation(); renderMessages(true); } });
  }
  async function saveEdit(mid) { const ta = $('editTa'); if (!ta) return; try { await api('PATCH', '/api/chat/messages/' + mid, { text: ta.value.trim() }); } catch (e) { toast(e.message); } renderMessages(true); }
  function renderComposer() {
    const wrap = $('composerWrap'); if (!wrap) return; const c = curChannel();
    if (!c) { wrap.innerHTML = ''; return; }
    if (c.archived) { wrap.innerHTML = `<div class="archived-note">${ICON.archive} Bu kanal arşivlenmiş; yalnızca okunabilir.${isAdmin() ? ` <button class="btn sm" data-action="unarchive-channel">Arşivden çıkar</button>` : ''}</div>`; return; }
    if (!canWrite()) { wrap.innerHTML = `<div class="archived-note">Bu kanalı okuyabilirsiniz ancak yazamazsınız. Yazmak için yöneticiden rolünüzü "Kullanıcı" yapmasını isteyin.</div>`; return; }
    C.pending = [];
    wrap.innerHTML = `<div class="att-strip" id="attStrip" hidden></div><div class="mention-menu" id="mentionMenu" hidden></div>
      <div class="composer"><button type="button" class="attach-btn" data-action="attach" title="Fotoğraf veya dosya ekle" aria-label="Fotoğraf veya dosya ekle">${ICON.paperclip}</button><input type="file" id="fileInput" hidden multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.dwg">
      <textarea id="composer" rows="1" placeholder="#${esc(c.name)} kanalına yaz" aria-label="Mesaj">${esc(C.drafts[c.id] || '')}</textarea><button class="btn primary" id="sendBtn" data-action="send" aria-label="Gönder">${ICON.send}</button></div>
      <div class="hint">Enter gönderir · Shift+Enter yeni satır · @ad ile birine seslenin · fotoğraf yapıştırabilir veya sürükleyebilirsiniz · **kalın**, \`kod\` ve bağlantılar desteklenir</div>`;
    const ta = $('composer'); autoGrow(ta);
    ta.addEventListener('input', () => { autoGrow(ta); emitTyping(); C.drafts[c.id] = ta.value; updateMention(ta); });
    ta.addEventListener('keydown', (e) => {
      if (C.mention) { const items = C.mention.items; if (e.key === 'ArrowDown') { e.preventDefault(); C.mention.i = (C.mention.i + 1) % items.length; renderMentionMenu(); return; } if (e.key === 'ArrowUp') { e.preventDefault(); C.mention.i = (C.mention.i - 1 + items.length) % items.length; renderMentionMenu(); return; } if ((e.key === 'Enter' || e.key === 'Tab') && items.length) { e.preventDefault(); insertMention(items[C.mention.i].name); return; } }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromComposer(); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (!document.activeElement || !document.activeElement.closest('#mentionMenu')) { C.mention = null; renderMentionMenu(); } }, 150));
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; }
  let typingLast = 0;
  function emitTyping() { if (!ws || ws.readyState !== 1 || !C.cid) return; const now = Date.now(); if (now - typingLast < 2000) return; typingLast = now; ws.send(JSON.stringify({ t: 'typing', cid: C.cid })); }
  let typingTicker = null;
  function startTypingTicker() { if (typingTicker) return; typingTicker = setInterval(renderTyping, 1000); }
  function stopTypingTicker() { if (typingTicker) { clearInterval(typingTicker); typingTicker = null; } }
  function renderTyping() { const el = $('typing'); if (!el) return; const t = C.typing[C.cid] || {}; const now = Date.now(); const who = Object.keys(t).filter(k => t[k].until > now).map(k => t[k].name); for (const k in t) if (t[k].until <= now) delete t[k]; el.textContent = who.length ? who.join(', ') + ' yazıyor…' : ''; }
  // @bahsetme menüsü
  function updateMention(ta) {
    const upto = ta.value.slice(0, ta.selectionStart); const m = upto.match(/(^|\s)@([^\s@]*)$/u);
    if (!m) { if (C.mention) { C.mention = null; renderMentionMenu(); } return; }
    const q = m[2].toLocaleLowerCase('tr'); const items = S.team.filter(u => u.id !== S.me.id && u.name.toLocaleLowerCase('tr').includes(q)).slice(0, 6);
    C.mention = { start: ta.selectionStart - m[2].length - 1, end: ta.selectionStart, items, i: 0 }; renderMentionMenu();
  }
  function renderMentionMenu() { const el = $('mentionMenu'); if (!el) return; if (!C.mention || !C.mention.items.length) { el.hidden = true; return; } el.innerHTML = C.mention.items.map((u, i) => `<button type="button" class="${i === C.mention.i ? 'on' : ''}" data-action="pick-mention" data-name="${esc(u.name)}">${avatarHtml(u, 'sm')} ${esc(u.name)} <span class="muted small">${ROLE[u.role] || ''}</span></button>`).join(''); el.hidden = false; }
  function insertMention(name) { const ta = $('composer'); if (!ta || !C.mention) return; const v = ta.value; ta.value = v.slice(0, C.mention.start) + '@' + name + ' ' + v.slice(C.mention.end); const pos = C.mention.start + name.length + 2; C.mention = null; renderMentionMenu(); ta.focus(); ta.setSelectionRange(pos, pos); autoGrow(ta); C.drafts[C.cid] = ta.value; }
  // ekler
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, w: null, h: null };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const max = 1600; const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && file.size < 1.5 * 1048576) return { blob: file, w: img.naturalWidth, h: img.naturalHeight };
      const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(res => cv.toBlob(res, type, 0.86));
      return { blob: blob || file, w: cv.width, h: cv.height, type };
    } catch (e) { return { blob: file, w: null, h: null }; } finally { URL.revokeObjectURL(url); }
  }
  function addFiles(files) {
    if (!$('composer')) return;
    for (const f of files) {
      if (f.size > 25 * 1048576) { toast(`${f.name}: 25 MB sınırını aşıyor.`); continue; }
      const it = { id: 'p' + Math.random().toString(36).slice(2), file: f, name: f.name, status: 'uploading', preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null, up: null };
      C.pending.push(it); it.done = uploadPending(it);
    }
    renderAttStrip();
  }
  async function uploadPending(it) {
    try {
      const { blob, w, h, type } = await shrinkImage(it.file);
      const mime = type || it.file.type || 'application/octet-stream';
      const q = new URLSearchParams({ name: it.name, type: mime }); if (w) { q.set('w', w); q.set('h', h); }
      const r = await fetch('/api/upload?' + q, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': mime }, body: blob });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw (j && j.error) || { message: 'Yükleme başarısız (' + r.status + ')' };
      it.up = j; it.status = 'done';
    } catch (e) { it.status = 'error'; it.err = e.message || 'Yüklenemedi'; }
    renderAttStrip();
  }
  function removePending(id) { const it = C.pending.find(x => x.id === id); if (it && it.preview) URL.revokeObjectURL(it.preview); C.pending = C.pending.filter(x => x.id !== id); renderAttStrip(); }
  function renderAttStrip() {
    const el = $('attStrip'); if (!el) return; if (!C.pending.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = C.pending.map(it => `<div class="att-item ${it.status}">${it.preview ? `<img src="${it.preview}" alt="">` : `<span class="att-ico">${ICON.file}</span>`}<span class="att-meta"><span class="att-name">${esc(it.name)}</span><span class="att-sub">${it.status === 'error' ? esc(it.err) : it.status === 'done' ? fmtBytes(it.up.size) + ' · hazır' : 'yükleniyor…'}</span><span class="att-bar"><i></i></span></span><button type="button" class="att-x" data-action="remove-att" data-id="${it.id}" aria-label="Kaldır">${ICON.x}</button></div>`).join('');
    el.hidden = false;
  }
  let sending = false;
  async function sendFromComposer() {
    const ta = $('composer'); if (!ta || sending || !C.cid) return; const text = ta.value.trim();
    const pending = C.pending.slice(); if (!text && !pending.length) return;
    if (pending.some(it => it.status === 'error')) { toast('Bir dosya yüklenemedi. Kaldırıp yeniden deneyin.'); return; }
    const btn = $('sendBtn'); sending = true; if (btn) btn.classList.add('busy');
    try {
      await Promise.all(pending.map(it => it.done));
      if (pending.some(it => it.status === 'error')) { toast('Bir dosya yüklenemedi. Kaldırıp yeniden deneyin.'); return; }
      const att = pending.filter(it => it.up).map(it => ({ id: it.up.id }));
      const cid = C.cid;
      await api('POST', `/api/chat/channels/${cid}/messages`, { text, att });
      ta.value = ''; autoGrow(ta); delete C.drafts[cid]; for (const it of C.pending) if (it.preview) URL.revokeObjectURL(it.preview); C.pending = []; renderAttStrip(); C.mention = null; renderMentionMenu();
    } catch (e) { toast(e.message); } finally { sending = false; const b = $('sendBtn'); if (b) b.classList.remove('busy'); if ($('composer')) $('composer').focus(); }
  }
  function channelForm(c) {
    const edit = !!c;
    modal(modalHead(edit ? 'Kanalı düzenle' : 'Yeni kanal', edit ? '#' + esc(c.name) : '') + `<form id="chForm"><div id="err" class="err" hidden></div>
      <label class="f">Kanal adı<input type="text" name="name" value="${edit ? esc(c.name) : ''}" required autofocus placeholder="sevkiyat, sayim, duyurular" pattern="[a-z0-9çğıöşü][a-z0-9çğıöşü_\\-]{0,31}" title="Küçük harf, rakam, tire ve alt çizgi"></label>
      <label class="f">Konu <span class="muted" style="font-weight:400">(isteğe bağlı)</span><input type="text" name="topic" value="${edit ? esc(c.topic || '') : ''}" placeholder="Bu kanal ne için?"></label>
      <div class="form-actions"><div class="right"><button type="button" class="btn" data-action="close-modal">Vazgeç</button><button class="btn primary" type="submit">${edit ? 'Kaydet' : 'Kanalı oluştur'}</button></div></div></form>`, 'narrow');
    $('chForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { const r = edit ? await api('PATCH', '/api/chat/channels/' + c.id, { name: f.name.value, topic: f.topic.value }) : await api('POST', '/api/chat/channels', { name: f.name.value, topic: f.topic.value }); closeModal(); if (!edit) go('#/sohbet/' + r.channel.id); } catch (err) { $('err').textContent = err.message; $('err').hidden = false; } });
  }
  // fotoğraf görüntüleyici
  function openLightbox(id) {
    const photos = []; for (const m of C.msgs) for (const a of m.att || []) if (isImg(a.mime)) photos.push({ ...a, by: m.user_name, ts: m.ts });
    const i = photos.findIndex(p => p.id === id); if (i < 0) return; S.lb = { photos, i }; renderLightbox(); document.body.classList.add('lb-open');
  }
  function renderLightbox() {
    const el = $('lightbox'); if (!S.lb) { el.hidden = true; el.innerHTML = ''; return; } const p = S.lb.photos[S.lb.i]; const n = S.lb.photos.length;
    el.innerHTML = `<div class="lb-top"><div class="lb-title"><strong>${esc(p.name)}</strong><span class="muted">${esc(p.by || '')} · ${fmtDT(p.ts)} · ${fmtBytes(p.size)}</span></div><div class="lb-actions"><a class="icon-btn" href="${fileUrl(p, true)}" download="${esc(p.name)}" title="İndir">${ICON.download}</a><button class="icon-btn" data-action="lb-close" title="Kapat">${ICON.x}</button></div></div>
      <div class="lb-stage" data-action="lb-close"><img src="${fileUrl(p)}" alt="${esc(p.name)}" data-stop="1"></div>
      ${n > 1 ? `<button class="lb-nav prev" data-action="lb-prev" ${S.lb.i === 0 ? 'disabled' : ''}>${ICON.left}</button><button class="lb-nav next" data-action="lb-next" ${S.lb.i === n - 1 ? 'disabled' : ''}>${ICON.right}</button><span class="lb-count">${S.lb.i + 1} / ${n}</span>` : ''}`;
    el.hidden = false;
  }
  function closeLightbox() { S.lb = null; renderLightbox(); document.body.classList.remove('lb-open'); }
  function stepLightbox(d) { if (!S.lb) return; const j = S.lb.i + d; if (j < 0 || j >= S.lb.photos.length) return; S.lb.i = j; renderLightbox(); }

  // ---------- olaylar ----------
  document.addEventListener('click', async (e) => {
    const stop = e.target.closest('[data-stop]'); if (stop) { e.stopPropagation(); return; }
    const el = e.target.closest('[data-action]');
    if (!e.target.closest('.menu') && !e.target.closest('[data-action="me-menu"]') && !e.target.closest('[data-action="toggle-rail"]')) { document.querySelectorAll('.menu').forEach(m => { m.hidden = true; }); }
    if (!e.target.closest('.picker')) hidePickers();
    if (!el) { if (e.target === $('modalRoot')) closeModal(); if (S.inboxOpen && !e.target.closest('#inbox') && !e.target.closest('#inboxWrap')) { S.inboxOpen = false; renderInbox(); } return; }
    const a = el.dataset.action; const d = el.dataset;
    if (e.target.closest('a[href]') && !['go', 'go-close'].includes(a)) return;
    switch (a) {
      case 'go': e.preventDefault(); go(d.href); break;
      case 'go-close': e.preventDefault(); closeModal(); go(d.href); break;
      case 'nav': go({ dashboard: '#/', materials: '#/malzemeler', movements: '#/hareketler', alerts: '#/alarmlar' }[d.view]); break;
      case 'chip': S.chip = d.chip; renderChips(); renderRail(); if (S.view === 'materials') renderPaneBody(); break;
      case 'chip-go': S.chip = d.chip; renderChips(); go('#/malzemeler'); break;
      case 'toggle-rail': toggleRail(); if (e.target.closest('#menuBtn') && window.innerWidth > 900) { closeRail(); $('navMenu').hidden = !$('navMenu').hidden; } break;
      case 'me-menu': $('meMenu').hidden = !$('meMenu').hidden; break;
      case 'logout': await api('POST', '/api/logout', {}); location.href = '/login'; break;
      case 'settings': settingsModal(); break;
      case 'team': teamModal(); break;
      case 'password': passwordForm(); break;
      case 'rename': renameForm(); break;
      case 'theme': localStorage.setItem('depo:theme', d.theme); applyTheme(); settingsModal(); break;
      case 'push-on': try { await window.deskPush.enable(); toast('Bildirimler açıldı.'); } catch (err) { toast(err.message || 'Bildirim açılamadı.'); } settingsModal(); break;
      case 'push-off': try { await window.deskPush.disable(); } catch (err) {} settingsModal(); break;
      case 'push-test': try { const r = await window.deskPush.test(); toast(r.sent ? 'Deneme bildirimi gönderildi.' : 'Bu cihaz için abonelik bulunamadı.'); } catch (err) { toast(err.message); } break;
      case 'alert-mail': try { const r = await api('POST', '/api/me', { alert_mail: el.checked }); S.me = r.me; } catch (err) { toast(err.message); } break;
      case 'new-material': if (!canWrite()) return toast('Hesabınız yalnızca görüntüleme yetkisine sahip.'); materialForm(); break;
      case 'edit-material': if (S.view === 'material' && S.matId === d.id) materialForm(S.matById.get(d.id)); else { S.matDetail = null; materialForm(S.matById.get(d.id)); } break;
      case 'set-limit': limitForm(S.matById.get(d.id)); break;
      case 'delete-material': deleteMaterialForm(d.id); break;
      case 'restore-material': try { const r = await api('POST', '/api/materials/' + d.id + '/restore', {}); setMaterial(r.material); toast('Kart geri alındı.'); loadMaterials().then(() => { renderRail(); renderChips(); }); if (d.from === 'settings') settingsModal(); else go('#/malzeme/' + d.id); } catch (err) { toast(err.message); } break;
      case 'new-channel': channelForm(); break;
      case 'edit-channel': channelForm(curChannel()); break;
      case 'archive-channel': case 'unarchive-channel': try { await api('PATCH', '/api/chat/channels/' + S.chat.cid, { archived: a === 'archive-channel' }); } catch (err) { toast(err.message); } break;
      case 'select-channel': go('#/sohbet/' + d.id); break;
      case 'older': loadMessages(true); break;
      case 'send': sendFromComposer(); break;
      case 'attach': { const fi = $('fileInput'); if (fi) fi.click(); } break;
      case 'remove-att': removePending(d.id); break;
      case 'edit-msg': startEdit(d.id); break;
      case 'save-edit': saveEdit(d.id); break;
      case 'cancel-edit': renderMessages(true); break;
      case 'delete-msg': if (!confirm('Bu mesaj silinsin mi?')) return; try { await api('DELETE', '/api/chat/messages/' + d.id, {}); } catch (err) { toast(err.message); } break;
      case 'view-photo': openLightbox(d.id); break;
      case 'lb-close': closeLightbox(); break;
      case 'lb-prev': stepLightbox(-1); break;
      case 'lb-next': stepLightbox(1); break;
      case 'pick-mention': insertMention(d.name); break;
      case 'new-movement': if (!canWrite()) return toast('Hesabınız yalnızca görüntüleme yetkisine sahip.'); movementForm(d.kind, d.material); break;
      case 'form-kind': F.kind = d.kind; renderFormKind(); renderLines(); break;
      case 'add-line': addLine(); break;
      case 'remove-line': F.lines.splice(Number(d.i), 1); renderLines(); break;
      case 'pick': F.lines[Number(d.i)].material_id = d.id; hidePickers(); renderLines(); { const row = $('lines').querySelector(`.line[data-i="${d.i}"] input[name=qty]`); if (row) row.focus(); } break;
      case 'pick-change': F.lines[Number(d.i)].material_id = ''; renderLines(); { const inp = $('lines').querySelector(`.line[data-i="${d.i}"] input[name=msearch]`); if (inp) inp.focus(); } break;
      case 'open-doc': openMovement(d.id); break;
      case 'edit-doc': editDocForm($('modalRoot')._mv); break;
      case 'cancel-doc': cancelDocForm($('modalRoot')._mv); break;
      case 'ack-alert': try { await api('POST', '/api/alerts/' + d.id + '/ack', {}); } catch (err) { toast(err.message); } break;
      case 'sort': S.matSort = S.matSort.k === d.key ? { k: d.key, d: -S.matSort.d } : { k: d.key, d: 1 }; renderPaneBody(); break;
      case 'mv-kind': S.mv.kind = d.kind; S.mv.offset = 0; loadMovements(); renderPaneBody(); break;
      case 'mv-page': S.mv.offset = Math.max(0, S.mv.offset + Number(d.d) * S.mv.limit); loadMovements(); break;
      case 'mv-cancelled': S.mv.cancelled = el.checked; S.mv.offset = 0; loadMovements(); break;
      case 'open-inbox': S.inboxOpen = !S.inboxOpen; renderInbox(); if (S.inboxOpen) markInboxSeen(); break;
      case 'close-inbox': S.inboxOpen = false; renderInbox(); break;
      case 'inbox-read-all': markInboxSeen(); renderInbox(); break;
      case 'inbox-go': { let ref = {}; try { ref = JSON.parse(d.ref); } catch (err) {} S.inboxOpen = false; renderInbox(); if (ref.channelId) go('#/sohbet/' + ref.channelId); else if (ref.movementId) openMovement(ref.movementId); else if (ref.materialId) go('#/malzeme/' + ref.materialId); else if (ref.alertId) go('#/alarmlar'); } break;
      case 'close-modal': closeModal(); F = null; break;
      case 'copy': try { await navigator.clipboard.writeText(d.text); toast('Kopyalandı.'); } catch (err) { toast('Kopyalanamadı; bağlantıyı seçip kopyalayın.'); } break;
      case 'user-reset': try { const r = await api('POST', '/api/admin/users/' + d.id + '/reset', {}); teamModal(linkNote('Kullanıcı', r.inviteUrl, r.emailed)); } catch (err) { toast(err.message); } break;
      case 'user-active': try { await api('POST', '/api/admin/users/' + d.id, { active: d.active === '1' }); teamModal(); } catch (err) { toast(err.message); } break;
      case 'cat-filter': break;
    }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target; const a = el.dataset.action;
    if (a === 'user-role') { try { await api('POST', '/api/admin/users/' + el.dataset.id, { role: el.value }); toast('Rol güncellendi.'); } catch (err) { toast(err.message); teamModal(); } }
    else if (a === 'user-alert-mail') { try { await api('POST', '/api/admin/users/' + el.dataset.id, { alert_mail: el.checked }); } catch (err) { toast(err.message); } }
    else if (a === 'mv-date') { S.mv[el.dataset.k] = el.value; S.mv.offset = 0; loadMovements(); }
    else if (a === 'cat-filter') { S.q = el.value; $('search').value = el.value; renderRail(); renderPaneBody(); }
  });
  let qTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target.id === 'search') { S.q = e.target.value; renderRail(); if (S.view === 'materials') renderPaneBody(); }
    else if (e.target.dataset.action === 'mv-q') { clearTimeout(qTimer); qTimer = setTimeout(() => { S.mv.q = e.target.value; S.mv.offset = 0; loadMovements(); }, 250); }
    else if (e.target.id === 'msgSearch') { S.chat.filter = e.target.value; renderMessages(true); }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'fileInput') { addFiles([...e.target.files]); e.target.value = ''; } });
  document.addEventListener('paste', (e) => { if (!$('composer') || !e.clipboardData) return; const files = [...e.clipboardData.files || []]; if (files.length) { e.preventDefault(); addFiles(files); } });
  document.addEventListener('dragover', (e) => { const cm = $('chatMain'); if (cm && canWrite()) { e.preventDefault(); cm.classList.add('drop-on'); } });
  document.addEventListener('dragleave', (e) => { const cm = $('chatMain'); if (cm && !e.relatedTarget) cm.classList.remove('drop-on'); });
  document.addEventListener('drop', (e) => { const cm = $('chatMain'); if (!cm) return; e.preventDefault(); cm.classList.remove('drop-on'); if (canWrite() && e.dataTransfer) addFiles([...e.dataTransfer.files || []]); });
  window.addEventListener('focus', () => { if (S.view === 'chat' && S.chat.cid && S.chat.msgs.length) markChannelRead(S.chat.cid, S.chat.msgs[S.chat.msgs.length - 1].ts); });
  $('showInactive').addEventListener('change', (e) => { S.showInactive = e.target.checked; renderRail(); if (S.view === 'materials') renderPaneBody(); });
  $('ntoast').addEventListener('click', () => { const n = $('ntoast'); n.hidden = true; n.classList.remove('show'); if (n.dataset.href) go(n.dataset.href); });
  document.addEventListener('keydown', (e) => { if (S.lb) { if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); } else if (e.key === 'ArrowLeft') stepLightbox(-1); else if (e.key === 'ArrowRight') stepLightbox(1); return; } if (e.key === 'Escape') { if (S.chat.mention) { S.chat.mention = null; renderMentionMenu(); return; } if (!$('modalRoot').hidden) { closeModal(); F = null; } else if (S.inboxOpen) { S.inboxOpen = false; renderInbox(); } } if (e.key === '/' && !e.target.closest('input,textarea,select') && $('modalRoot').hidden) { e.preventDefault(); $('search').focus(); } });
  window.addEventListener('desk:settings', () => settingsModal());
  window.addEventListener('desk:open', (e) => { const url = e.detail && e.detail.url; if (url && url.startsWith('/#')) go(url.slice(1)); });
  // inbox entries that point to a channel
  const _inboxGo = (ref) => { if (ref.channelId) { go('#/sohbet/' + ref.channelId); return true; } return false; };
  window.addEventListener('focus', () => { if (S.view === 'dashboard') loadDashboard(); });

  applyTheme();
  boot().catch((e) => { console.error(e); if (e.code !== 'unauthenticated') { $('paneBody').innerHTML = `<div class="scroll"><div class="err">Uygulama yüklenemedi: ${esc(e.message)}</div></div>`; } });
})();
