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
  function promptForKey(doc) {
    return new Promise(function (resolve, reject) {
      var d = doc.createElement('dialog'); d.className = 'key-dialog';
      d.innerHTML = '<form method="dialog"><h2>Unlock Bible files</h2>' +
        '<p>The Bible files are encrypted. Paste the base64 key or choose the key file. It is kept in memory for this visit only and never saved.</p>' +
        '<label>Key <input type="password" class="k-text" autocomplete="off" spellcheck="false"></label>' +
        '<label>or file <input type="file" class="k-file"></label>' +
        '<div class="row"><button value="cancel" class="btn">Cancel</button><button value="ok" class="btn primary">Unlock</button></div></form>';
      doc.body.appendChild(d);
      var fileText = null;
      d.querySelector('.k-file').addEventListener('change', function (e) {
        var f = e.target.files[0]; if (!f) return;
        f.text().then(function (t) { fileText = t.trim(); });
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
    var keyProvider = BD ? BD.ChainKeyProvider([].concat(
      root.NativeSecrets ? [BD.NativeKeyProvider(root.NativeSecrets)] : [],
      [BD.PasteKeyProvider(function () { return promptForKey(doc); })]
    )) : null;
    var library = BD ? BD.createLibrary({ keyProvider: keyProvider, fetchBytes: BD.browserFetchBytes(opts.versionsBase || 'versions/') }) : null;

    return fetch(opts.namesUrl || 'hebrew-names.json').then(function (r) { return r.json(); }).then(function (names) {
      var matcher = H.buildMatcher(names), cepherize = H.buildCepherizer(names);
      var controller = H.createController(doc, {
        matcher: matcher, speaker: speaker,
        onReveal: function (entry, ref) { learn.track(entry.id, ref || opts.page || ''); }
      });
      speaker.onMuteChange(function () { controller.refreshSpeech(); });
      return {
        doc: doc, storage: storage, names: names, matcher: matcher, speaker: speaker, learn: learn, settings: settings,
        controller: controller, library: library, BibleData: BD,
        /** Render verse text with tappable names; PD text gets Cepher-style names when enabled. */
        render: function (el, text, o) {
          var t = (o && o.raw) || !settings.cepherNames() ? text : cepherize(text);
          return controller.render(el, t, o);
        }
      };
    });
  }

  root.AppShell = { init: init, PAGES: PAGES };
})(typeof self !== 'undefined' ? self : this);
