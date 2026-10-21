/* Malzeme Takip — yüklenebilir uygulama desteği ve anlık bildirimler.
   Registers the service worker, offers installation (a native prompt on Android/desktop Chrome and Edge, a short
   "Add to Home Screen" hint on iPhone/iPad), and manages the device's push-notification subscription. Nothing here touches data. */
(function () {
  'use strict';
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) document.documentElement.classList.add('pwa-standalone');
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var isSafari = isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
  var inApp = !!document.getElementById('shell'); // the signed-in page (not the sign-in page)

  var swReady = null;
  if ('serviceWorker' in navigator) {
    swReady = new Promise(function (resolve) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(resolve).catch(function () { resolve(null); });
      });
    });
  }

  function remember(key) { try { localStorage.setItem(key, String(Date.now())); } catch (e) {} }
  function recently(key, days) { try { var t = Number(localStorage.getItem(key) || 0); return t && Date.now() - t < days * 86400000; } catch (e) { return false; } }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw (j && j.error) || { message: 'İstek başarısız (' + r.status + ')' }; return j; }); });
  }
  function b64ToBytes(s) { var pad = '='.repeat((4 - s.length % 4) % 4); var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); var out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }

  // ---------- push notifications (used by app.js through window.deskPush) ----------
  var push = {
    supported: function () { return !!(swReady && 'PushManager' in window && 'Notification' in window); },
    needsInstall: function () { return isIOS && !standalone; }, // iPhone/iPad only deliver push to apps added to the Home Screen
    permission: function () { return ('Notification' in window) ? Notification.permission : 'unsupported'; },
    current: function () { return swReady ? swReady.then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }) : Promise.resolve(null); },
    // 'on' | 'off' | 'blocked' | 'install' | 'unsupported'
    status: function () {
      if (!push.supported()) return Promise.resolve(push.needsInstall() ? 'install' : 'unsupported');
      if (Notification.permission === 'denied') return Promise.resolve('blocked');
      return push.current().then(function (sub) { return sub ? 'on' : 'off'; });
    },
    enable: function () {
      if (!push.supported()) return Promise.reject({ message: push.needsInstall() ? 'iPhone ve iPad\'de önce uygulamayı Ana Ekrana ekleyin (Paylaş → Ana Ekrana Ekle), sonra bildirimleri yüklenen uygulamadan açın.' : 'Bu tarayıcı bildirimleri desteklemiyor.' });
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw { message: perm === 'denied' ? 'Bu uygulama için bildirimler cihaz ayarlarınızda engellenmiş.' : 'Bildirim izni verilmedi.' };
        return api('GET', '/api/push/key');
      }).then(function (k) {
        if (!k.enabled) throw { message: 'Sunucuda bildirimler henüz yapılandırılmamış.' };
        return swReady.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.publicKey) }); });
        });
      }).then(function (sub) {
        return api('POST', '/api/push/subscribe', { subscription: sub.toJSON() }).then(function () { remember('depo:push-on'); fire('on'); return sub; });
      });
    },
    disable: function () {
      return push.current().then(function (sub) {
        var p = api('POST', '/api/push/unsubscribe', { endpoint: sub ? sub.endpoint : '' }).catch(function () {});
        return p.then(function () { return sub ? sub.unsubscribe() : true; });
      }).then(function () { try { localStorage.removeItem('depo:push-on'); } catch (e) {} fire('off'); });
    },
    test: function () { return api('POST', '/api/push/test', {}); }
  };
  function fire(state) { try { window.dispatchEvent(new CustomEvent('desk:push', { detail: { state: state } })); } catch (e) {} }
  window.deskPush = push;
  var installState = { deferred: null };
  window.deskInstall = {
    standalone: standalone, isIOS: isIOS, isSafari: isSafari,
    isAndroid: /android/i.test(navigator.userAgent),
    canPrompt: function () { return !!installState.deferred; },
    prompt: function () { if (!installState.deferred) return Promise.resolve(false); var d = installState.deferred; d.prompt(); return d.userChoice.then(function (r) { installState.deferred = null; return r && r.outcome === 'accepted'; }); }
  };

  // Keep the server's copy of this device's subscription fresh, and let the app know push is active.
  if (inApp && swReady) {
    swReady.then(function (reg) {
      if (!reg || !('PushManager' in window)) return;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && Notification.permission === 'granted') { fire('on'); api('POST', '/api/push/subscribe', { subscription: sub.toJSON() }).catch(function () {}); }
      });
    }).catch(function () {});
    // A tap on a notification arrives here when the app is already open.
    navigator.serviceWorker.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.t === 'open' && m.url) { try { window.dispatchEvent(new CustomEvent('desk:open', { detail: { url: m.url } })); } catch (err) {} }
    });
  }

  // ---------- banners ----------
  function banner(id, key, title, text, primaryLabel, onPrimary) {
    if (document.getElementById(id) || recently(key, 14)) return;
    var b = document.createElement('div');
    b.id = id; b.className = 'pwa-banner'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', title);
    b.innerHTML = '<img src="/img/peakpv-icon-192.png" alt="" width="40" height="40">' +
      '<div class="pwa-text"><strong>' + title + '</strong><span>' + text + '</span></div>' +
      '<div class="pwa-actions">' + (primaryLabel ? '<button class="btn primary sm" data-role="primary">' + primaryLabel + '</button>' : '') +
      '<button class="btn ghost sm" data-role="later">Şimdi değil</button></div>';
    document.body.appendChild(b);
    var close = function () { remember(key); b.remove(); };
    b.querySelector('[data-role=later]').addEventListener('click', close);
    var p = b.querySelector('[data-role=primary]'); if (p && onPrimary) p.addEventListener('click', function () { onPrimary(close, b); });
  }

  if (!standalone) {
    // Android / desktop: the browser tells us when the app can be installed.
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e; installState.deferred = e;
      banner('pwaBanner', 'depo:pwa-dismissed', 'Malzeme Takip\'i yükleyin', 'Tek dokunuşla erişim, tam ekran ve bildirimler için ana ekranınıza ekleyin.', 'Yükle', function (close) {
        if (!deferred) return close(); deferred.prompt();
        deferred.userChoice.then(function () { deferred = null; installState.deferred = null; close(); });
      });
    });
    window.addEventListener('appinstalled', function () { var b = document.getElementById('pwaBanner'); if (b) b.remove(); });
    // iPhone / iPad: Safari only — explain the two taps.
    if (isSafari) {
      window.addEventListener('load', function () {
        setTimeout(function () {
          banner('pwaBanner', 'depo:pwa-dismissed', 'Malzeme Takip\'i yükleyin', 'Safari\'de <b>Paylaş</b> <span class="pwa-share" aria-hidden="true"></span> ve ardından <b>Ana Ekrana Ekle</b>\'ye dokunun. Yüklenen uygulama size bildirim de gönderebilir.', null, null);
        }, 1500);
      });
    }
  }

  // Signed-in app, notifications possible but not yet decided: offer once.
  if (inApp) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (!push.supported() || push.needsInstall() || Notification.permission !== 'default' || document.getElementById('pwaBanner')) return;
        banner('pushBanner', 'depo:push-dismissed', 'Bildirimleri açın', 'Stok limitin altına düştüğünde ve yeni giriş / sevkiyat kaydedildiğinde, uygulama kapalıyken bile haberdar olun.', 'Ayarları aç', function (close) {
          close(); try { window.dispatchEvent(new CustomEvent('desk:settings')); } catch (e) {}
        });
      }, 4000);
    });
  }
})();
