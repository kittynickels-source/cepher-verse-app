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
  // A pasted key is carried too once it has unlocked the files (each page is a fresh load, so memory alone is lost on navigation).
  function carryingKey() { return !!(session.key && (session.source === 'link' || (session.source === 'paste' && session.verified))); }
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
  /* ---------- clipboard ----------
   * The copy must START inside the click: Safari/iOS (and Chrome after ~5 s) drop the user gesture across awaits, so
   * "check the key, then writeText" fails with NotAllowedError once the key check has to download a Bible file. */
  function codedError(code, msg) { var e = new Error(msg); e.code = code; return e; }
  /** Synchronous execCommand('copy') from a hidden textarea placed beside `near`. Inside an open modal <dialog> a
   *  body-level textarea is inert, select() fails and the copy grabs the wrong selection while still returning true,
   *  so the textarea goes into the dialog and we only report success if our text really was selected. */
  function execCopy(text, doc, near) {
    var host = (near && near.closest && near.closest('dialog')) || doc.body, prev = doc.activeElement, ok = false;
    var t = doc.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.setAttribute('aria-hidden', 'true');
    t.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    host.appendChild(t);
    try {
      t.focus(); t.select(); t.setSelectionRange(0, text.length);
      ok = doc.activeElement === t && t.selectionStart === 0 && t.selectionEnd === text.length && doc.execCommand('copy') === true;
    } catch (e) { ok = false; }
    t.value = ''; t.remove();
    if (prev && prev !== doc.body && prev.focus) try { prev.focus({ preventScroll: true }); } catch (e) {}
    return ok;
  }
  /** Copy `text` — a string, or a Promise<string> while the key is still being checked. Call it synchronously from the
   *  click handler. Resolves 'copied'. Rejects with .code: 'invalid' (the text promise failed), 'blocked' (the browser
   *  refused every method), 'tap-again' (text was not ready and the gesture could not be kept: a second tap copies). */
  function copyNow(text, env) {
    var nav = env.nav, doc = env.doc, W = env.win || root, cb = nav && nav.clipboard;
    if (typeof text === 'string') {
      if (cb && cb.writeText) {
        var w; try { w = cb.writeText(text); } catch (e) { w = Promise.reject(e); }
        return Promise.resolve(w).then(function () { return 'copied'; }, function () {
          if (execCopy(text, doc, env.near)) return 'copied';
          throw codedError('blocked', 'Your browser blocked copying.');
        });
      }
      return execCopy(text, doc, env.near) ? Promise.resolve('copied') : Promise.reject(codedError('blocked', 'Your browser blocked copying.'));
    }
    var checked = Promise.resolve(text).catch(function (e) { throw codedError('invalid', (e && e.message) || 'This key does not unlock the Bible files.'); });
    var item = null;
    if (cb && cb.write && W.ClipboardItem && W.Blob) {
      // Promised ClipboardItem: the write is requested now (inside the gesture); the browser waits for the blob.
      try { item = new W.ClipboardItem({ 'text/plain': checked.then(function (t) { return new W.Blob([t], { type: 'text/plain' }); }) }); } catch (e) { item = null; }
    }
    if (item) {
      var wp; try { wp = cb.write([item]); } catch (e) { wp = Promise.reject(e); }
      return Promise.resolve(wp).then(function () { return 'copied'; }, function () {
        return checked.then(function (t) {
          // Clipboard API refused (e.g. permission denied): if the gesture is still live, the textarea copy may work.
          if (!(nav.userActivation && !nav.userActivation.isActive) && execCopy(t, doc, env.near)) return 'copied';
          throw codedError('tap-again', 'Tap again to copy.');
        });
      });
    }
    return checked.then(function (t) {
      if (nav && nav.userActivation && !nav.userActivation.isActive) throw codedError('tap-again', 'Tap again to copy.');
      return copyNow(t, env).catch(function (e) { if (e.code === 'blocked') throw codedError('tap-again', 'Tap again to copy.'); throw e; });
    });
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
    var banner = doc.querySelector('body > .app-banner');   // the nav goes just below the header banner, if the page has one
    doc.body.insertBefore(nav, banner ? banner.nextSibling : doc.body.firstChild);
  }

  /** Demo key prompt: paste base64 or pick the key file. Key stays in memory only (never stored). */
  function promptForKey(doc, wireCopy) {
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
      wireCopy(d.querySelector('.k-copy'), d.querySelector('.k-copy-status'), function () { return fileText || d.querySelector('.k-text').value.trim(); });
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
    function currentLink() { return session.key ? appBase() + 'verse-of-the-day.html#key=' + BD.toBase64Url(session.key) : null; }
    /** Copy verse-of-the-day.html#key=… for the key unlocked this visit (raw empty) or a pasted key (raw). Must be called
     *  synchronously from the click. An unchecked key is checked (decrypt test of the smallest file) while the copy is
     *  already pending. Resolves the redacted preview; rejects with .code nokey | invalid | blocked | tap-again. */
    function copyPrivateLink(raw, near) {
      var key = raw ? BD.normalizeKey(raw) : session.key;
      if (!key) return Promise.reject(codedError('nokey', raw ? 'That is not a valid key: it must be the 32-byte base64 key.'
        : 'No key yet. Paste the key into the Key field here, then tap Copy private link again.'));
      var link = appBase() + 'verse-of-the-day.html#key=' + BD.toBase64Url(key);
      function adopt() { if (!session.key) { session.key = key; session.source = 'paste'; } if (key === session.key) session.verified = true; }
      var text = session.verified && key === session.key ? link
        : BD.validateKey(key, rawFetch, 'oeb').then(function () { adopt(); return link; });
      return copyNow(text, { nav: root.navigator, doc: doc, win: root, near: near }).then(function () { adopt(); return privateLinkPreview(); });
    }
    /** Hook a "Copy private link" button: always ends in a visible success or failure message, never silently. */
    function wireCopy(btn, status, getRaw, after) {
      var fb = null;
      btn.addEventListener('click', function () {
        if (fb) { fb.remove(); fb = null; }
        var raw = (getRaw && getRaw()) || '';
        status.textContent = session.verified && !raw ? 'Copying…' : 'Checking key…';
        copyPrivateLink(raw, btn).then(function (preview) {
          status.textContent = 'Copied ' + preview + ' to the clipboard. Anyone with this link can read the Bible files, so do not post it publicly.';
          if (after) after(true);
        }, function (e) {
          if (e.code === 'tap-again') status.textContent = 'Key checked. Tap “Copy private link” again to copy it (your browser needs a fresh tap).';
          else if (e.code === 'blocked') { status.textContent = 'Nothing was copied: this browser blocked the clipboard.'; fb = manualCopy(btn, status); }
          else status.textContent = e.message;
          if (after) after(false);
        });
      });
    }
    /** Last resort: the link in a masked read-only field; "Show link" reveals and selects it for a manual copy. */
    function manualCopy(btn, status) {
      var box = doc.createElement('div'); box.className = 'pl-fallback';
      box.innerHTML = '<p class="note">Copy it by hand instead: tap “Show link”, then copy the selected text. The link contains the key, so make sure no one can see your screen.</p>' +
        '<input type="password" readonly class="pl-manual" aria-label="Private link" autocomplete="off" spellcheck="false"> <button type="button" class="btn pl-show">Show link</button>';
      var input = box.querySelector('.pl-manual'), show = box.querySelector('.pl-show');
      show.addEventListener('click', function () {
        if (input.type === 'password') { input.value = currentLink() || ''; input.type = 'text'; input.focus(); input.select(); show.textContent = 'Hide'; }
        else { input.type = 'password'; input.value = ''; show.textContent = 'Show link'; }
      });
      status.parentNode.insertBefore(box, status.nextSibling);
      return box;
    }
    var keyProvider = BD ? BD.ChainKeyProvider([].concat(
      root.NativeSecrets ? [BD.NativeKeyProvider(root.NativeSecrets)] : [],
      [linkKeyProvider],
      [BD.PasteKeyProvider(function () {
        return promptForKey(doc, wireCopy).then(function (v) {
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
        privateLink: { active: function () { return !!session.key; }, carrying: carryingKey, preview: privateLinkPreview, copy: copyPrivateLink, wire: wireCopy },
        /** Render verse text with tappable names; PD text gets Cepher-style names when enabled. */
        render: function (el, text, o) {
          var t = (o && o.raw) || !settings.cepherNames() ? text : cepherize(text);
          return controller.render(el, t, o);
        }
      };
    });
  }

  root.AppShell = { init: init, PAGES: PAGES, linkFor: linkFor, _copyNow: copyNow, _execCopy: execCopy };
})(typeof self !== 'undefined' ? self : this);
