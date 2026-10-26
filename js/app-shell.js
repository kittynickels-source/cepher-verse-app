/* app-shell.js — shared nav bar, settings, names, speech, bubble controller, key provider, reveal tracking.
 * Requires hebrew-reveal.js, hebrew-speech.js, learn.js, bible-data.js loaded first. */
(function (root) {
  'use strict';
  var PAGES = [
    { href: 'verse-of-the-day.html', label: 'Today', id: 'votd' },
    { href: 'reader.html', label: 'Reader', id: 'reader' },
    { href: 'learn.html', label: 'Learn', id: 'learn' },
    { href: 'settings.html', label: 'Settings', id: 'settings' }
  ];
  var K = { version: 'hebrewReveal.version', cepher: 'hebrewReveal.cepherNames' };

  /* Private key link: a key in the URL hash (#key=<base64url>) is read once, here, before any page code runs,
   * and the hash is stripped from the address bar at once. It lives only in this in-memory object for this
   * page visit: never written to localStorage/sessionStorage/cookies/IndexedDB, never sent anywhere (browsers
   * do not send the hash to the server). While a link key is active, internal links carry it on click. */
  var session = { key: null, source: null, verified: false, hashError: false };
  (function readHashKey() {
    var BD = root.BibleData, loc = root.location;
    if (!BD || !BD.parseHashKey || !loc) return;
    var p = BD.parseHashKey(loc.hash);
    if (!p.present) return;
    try { root.history.replaceState(root.history.state, '', loc.pathname + loc.search + (p.rest ? '#' + p.rest : '')); } catch (e) {}
    if (p.key) { session.key = p.key; session.source = 'link'; } else session.hashError = true;
  })();
  function carryingKey() { return !!(session.key && session.source === 'link'); }
  function appBase() { var l = root.location; return l.origin + l.pathname.replace(/[^\/]*$/, ''); }
  var MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';
  function privateLinkPreview() { return appBase() + 'verse-of-the-day.html#key=' + MASK; }
  /** Internal .html link -> same link with #key=… while a link key is active; else unchanged. */
  function linkFor(href) {
    if (!carryingKey()) return href;
    var u; try { u = new URL(href, root.location.href); } catch (e) { return href; }
    if (u.origin !== root.location.origin || u.pathname.indexOf(root.location.pathname.replace(/[^\/]*$/, '')) !== 0 || !/\.html$/.test(u.pathname)) return href;
    if (u.pathname === root.location.pathname && u.search === root.location.search) return href;  // same-page anchor
    return root.BibleData.withHashKey(u.pathname + u.search + u.hash, session.key);
  }
  function copyText(text, doc) {
    function fallback() {
      var t = doc.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      doc.body.appendChild(t); t.select(); var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {}
      t.value = ''; t.remove(); if (!ok) throw new Error('Copy is blocked in this browser');
    }
    var nav = root.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) return nav.clipboard.writeText(text).catch(fallback);
    return Promise.resolve().then(fallback);
  }

  function storageOrMemory() {
    try { var s = root.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }
  }

  function renderNav(doc, current) {
    var nav = doc.createElement('nav');
    nav.className = 'app-nav'; nav.setAttribute('aria-label', 'Main');
    PAGES.forEach(function (p) {
      var a = doc.createElement('a'); a.href = p.href; a.textContent = p.label;
      if (p.id === current) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    doc.body.insertBefore(nav, doc.body.firstChild);
  }

  /** Demo key prompt: paste base64 or pick the key file. Key stays in memory only (never stored). */
  function promptForKey(doc, copyLink) {
    return new Promise(function (resolve, reject) {
      var d = doc.createElement('dialog'); d.className = 'key-dialog';
      d.innerHTML = '<form method="dialog"><h2>Unlock Bible files</h2>' +
        (session.hashError ? '<p class="k-note" role="alert">The key in this private link did not work. Paste the key instead.</p>' : '') +
        '<p>The Bible files are encrypted. Paste the base64 key or choose the key file. It is kept in memory for this visit only and never saved.</p>' +
        '<label>Key <input type="password" class="k-text" autocomplete="off" spellcheck="false"></label>' +
        '<label>or file <input type="file" class="k-file"></label>' +
        '<div class="row"><button type="button" class="btn k-copy">Copy private link</button><button value="cancel" class="btn">Cancel</button><button value="ok" class="btn primary">Unlock</button></div>' +
        '<p class="note k-copy-status" aria-live="polite"></p></form>';
      doc.body.appendChild(d);
      var fileText = null;
      d.querySelector('.k-file').addEventListener('change', function (e) {
        var f = e.target.files[0]; if (!f) return;
        f.text().then(function (t) { fileText = t.trim(); });
      });
      d.querySelector('.k-copy').addEventListener('click', function () {
        var st = d.querySelector('.k-copy-status'); st.textContent = 'Checking key…';
        copyLink(fileText || d.querySelector('.k-text').value.trim()).then(function (preview) {
          st.textContent = 'Copied: ' + preview + ' — anyone with this link can read the Bible files; do not post it publicly.';
        }, function (e) { st.textContent = e.message; });
      });
      d.addEventListener('close', function () {
        var v = d.returnValue === 'ok' ? (fileText || d.querySelector('.k-text').value.trim()) : '';
        d.querySelector('.k-text').value = ''; d.remove();
        if (v) resolve(v); else reject(new Error('No key provided'));
      });
      d.showModal();
    });
  }

  function init(opts) {
    opts = opts || {};
    var doc = root.document, storage = storageOrMemory();
    var H = root.HebrewReveal, S = root.HebrewSpeech, Lrn = root.HebrewLearn, BD = root.BibleData;
    if (opts.nav !== false) renderNav(doc, opts.page);
    var speaker = S.createSpeaker({ storage: storage });
    var learn = Lrn.createStore(storage);
    var settings = {
      version: function () { var v = storage.getItem(K.version); return BD && BD.versionInfo(v) ? v : 'kjv'; },
      setVersion: function (v) { storage.setItem(K.version, v); },
      cepherNames: function () { return storage.getItem(K.cepher) !== '0'; },   // default on
      setCepherNames: function (on) { storage.setItem(K.cepher, on ? '1' : '0'); }
    };
    var rawFetch = BD ? BD.browserFetchBytes(opts.versionsBase || 'versions/') : null, pending = {};
    // A validation download is handed to the library's first load of the same file (no double download).
    function checkFetch(id) { return (pending[id] = rawFetch(id)); }
    function libFetch(id) { var p = pending[id]; if (p) { delete pending[id]; return p; } return rawFetch(id); }
    var linkKeyProvider = { getKey: function () {
      if (!carryingKey()) return Promise.reject(new Error('No private-link key'));
      return BD.validateKey(session.key, checkFetch, settings.version()).then(function () { session.verified = true; return session.key; },
        function (e) { session.key = null; session.source = null; session.hashError = true; throw e; });
    } };
    /** Build verse-of-the-day.html#key=… for the active key (or a pasted one), validate it, copy it; resolves the redacted preview. */
    function copyPrivateLink(raw) {
      var key = raw ? BD.normalizeKey(raw) : session.key;
      if (!key) return Promise.reject(new Error(raw ? 'That is not a 32-byte base64 key.' : 'Unlock the Bible files or paste the key first.'));
      var check = (!raw && session.verified) ? Promise.resolve() : BD.validateKey(key, checkFetch, settings.version());
      return check.then(function () {
        if (raw && !session.key) { session.key = key; session.source = 'paste'; }
        if (key === session.key) session.verified = true;
        return copyText(appBase() + 'verse-of-the-day.html#key=' + BD.toBase64Url(key), doc);
      }).then(function () { return privateLinkPreview(); });
    }
    var keyProvider = BD ? BD.ChainKeyProvider([].concat(
      root.NativeSecrets ? [BD.NativeKeyProvider(root.NativeSecrets)] : [],
      [linkKeyProvider],
      [BD.PasteKeyProvider(function () {
        return promptForKey(doc, copyPrivateLink).then(function (v) {
          var k = BD.normalizeKey(v); if (k) { session.key = k; session.source = 'paste'; session.verified = false; }
          return v;
        });
      })]
    )) : null;
    var library = BD ? BD.createLibrary({ keyProvider: keyProvider, fetchBytes: libFetch, onUnlock: function () { session.verified = !!session.key; } }) : null;
    if (BD) doc.addEventListener('click', function (ev) {
      if (!carryingKey() || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      var href = a.getAttribute('href'), dest = linkFor(href);
      if (dest === href) return;
      ev.preventDefault(); root.location.assign(dest);
    });

    return fetch(opts.namesUrl || 'hebrew-names.json').then(function (r) { return r.json(); }).then(function (names) {
      var matcher = H.buildMatcher(names), cepherize = H.buildCepherizer(names);
      var controller = H.createController(doc, {
        matcher: matcher, speaker: speaker,
        onReveal: function (entry, ref) { learn.track(entry.id, ref || opts.page || ''); }
      });
      speaker.onMuteChange(function () { controller.refreshSpeech(); });
      return {
        doc: doc, storage: storage, names: names, matcher: matcher, speaker: speaker, learn: learn, settings: settings,
        controller: controller, library: library, BibleData: BD, linkFor: linkFor,
        privateLink: { active: function () { return !!session.key; }, carrying: carryingKey, preview: privateLinkPreview, copy: copyPrivateLink },
        /** Render verse text with tappable names; PD text gets Cepher-style names when enabled. */
        render: function (el, text, o) {
          var t = (o && o.raw) || !settings.cepherNames() ? text : cepherize(text);
          return controller.render(el, t, o);
        }
      };
    });
  }

  root.AppShell = { init: init, PAGES: PAGES, linkFor: linkFor };
})(typeof self !== 'undefined' ? self : this);
