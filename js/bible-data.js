/* bible-data.js — load, decrypt (WebCrypto AES-256-GCM) and index the encrypted versions.
 * File format: 12-byte IV || ciphertext || 16-byte tag; plaintext = JSON [{book,chapter,verse,text}].
 * The key never lives in source: it comes from a KeyProvider ({ getKey(): Promise<Uint8Array|ArrayBuffer|string(base64)> }).
 *   - Real app: a native bridge reading Android Keystore / iOS Keychain (see NativeKeyProvider).
 *   - Hosted build: PasteKeyProvider (paste or pick the key file; kept in memory only). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BibleData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSIONS = [
    { id: 'kjv', label: 'KJV', name: 'King James Version' },
    { id: 'webster', label: 'Webster', name: 'Webster Bible' },
    { id: 'asv', label: 'ASV', name: 'American Standard Version' },
    { id: 'web', label: 'WEB', name: 'World English Bible' },
    { id: 'darby', label: 'Darby', name: 'Darby Translation' },
    { id: 'ylt', label: 'YLT', name: "Young's Literal Translation" },
    { id: 'bbe', label: 'BBE', name: 'Bible in Basic English' },
    { id: 'dra', label: 'DRA', name: 'Douay-Rheims (American)' },
    { id: 'oeb', label: 'OEB', name: 'Open English Bible (partial OT)' }
  ];
  var FALLBACK_ORDER = VERSIONS.map(function (v) { return v.id; });
  // Books whose chapter/verse numbering differs from the KJV-style references used by verse-refs.json.
  // DRA follows Vulgate/LXX Psalm numbering (KJV Ps 23 = DRA Ps 22, titles counted as verses), so a
  // reference like "Psalms 23:1" would silently show the wrong verse; resolution skips DRA for these books.
  var VERSIFICATION_DIFFERS = { dra: ['Psalms'] };
  // Master canonical order (DRA's 73 books contain all 66 Protestant books).
  var CANON = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth','1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles','Ezra','Nehemiah','Tobit','Judith','Esther','Job','Psalms','Proverbs','Ecclesiastes','Song of Solomon','Wisdom','Sirach','Isaiah','Jeremiah','Lamentations','Baruch','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi','1 Maccabees','2 Maccabees','Matthew','Mark','Luke','John','Acts','Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians','Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy','Titus','Philemon','Hebrews','James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation'];

  function versionInfo(id) { for (var i = 0; i < VERSIONS.length; i++) if (VERSIONS[i].id === id) return VERSIONS[i]; return null; }

  function getSubtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof self !== 'undefined' && self.crypto);
    if (c && c.subtle) return c.subtle;
    if (typeof require === 'function') return require('crypto').webcrypto.subtle;
    throw new Error('WebCrypto not available');
  }

  function b64ToBytes(s) {
    s = String(s).trim();
    if (typeof atob === 'function') { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  /** Turn provider output into a non-extractable AES-GCM CryptoKey; wipes the raw copy. */
  function importKey(raw) {
    var bytes = typeof raw === 'string' ? b64ToBytes(raw) : new Uint8Array(raw);
    if (bytes.length !== 32) return Promise.reject(new Error('Key must be 32 bytes (AES-256)'));
    return getSubtle().importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']).then(function (k) { bytes.fill(0); return k; });
  }

  function decryptBytes(buf, cryptoKey) {
    var u = new Uint8Array(buf);
    if (u.length < 12 + 16) return Promise.reject(new Error('File too short'));
    return getSubtle().decrypt({ name: 'AES-GCM', iv: u.slice(0, 12), tagLength: 128 }, cryptoKey, u.slice(12))
      .then(function (plain) { return JSON.parse(new TextDecoder('utf-8').decode(plain)); });
  }

  /** Group rows into ordered books -> chapters -> verses (book order = first appearance in the file). */
  function group(rows) {
    var books = [], byName = new Map(), index = new Map();
    rows.forEach(function (r) {
      var b = byName.get(r.book);
      if (!b) { b = { name: r.book, chapters: [], byNum: new Map() }; byName.set(r.book, b); books.push(b); }
      var c = b.byNum.get(r.chapter);
      if (!c) { c = { number: r.chapter, verses: [] }; b.byNum.set(r.chapter, c); b.chapters.push(c); }
      if (r.text == null || String(r.text).trim() === '') return;     // omitted verse: skip, no blank row
      c.verses.push({ verse: r.verse, text: r.text });
      index.set(r.book + '|' + r.chapter + '|' + r.verse, r.text);
    });
    books.forEach(function (b) {
      b.chapters.sort(function (x, y) { return x.number - y.number; });
      b.chapters.forEach(function (c) { c.verses.sort(function (x, y) { return x.verse - y.verse; }); });
      b.chapters = b.chapters.filter(function (c) { return c.verses.length; });
    });
    return {
      books: books,
      book: function (name) { return byName.get(name) || null; },
      chapter: function (name, n) { var b = byName.get(name); return (b && b.byNum.get(n)) || null; },
      get: function (book, ch, v) { var t = index.get(book + '|' + ch + '|' + v); return t === undefined ? null : t; },
      verseCount: index.size
    };
  }

  /** "John 3:16" / "1 John 4:8" / "Song of Solomon 2:4" -> {book, chapter, verse} */
  function parseRef(s) {
    var m = /^\s*(.+?)\s+(\d+):(\d+)\s*$/.exec(String(s));
    return m ? { book: m[1], chapter: +m[2], verse: +m[3] } : null;
  }

  /** Library: caches one decrypted, grouped version per id; loads on demand. */
  function createLibrary(opts) {
    var keyProvider = opts.keyProvider, fetchBytes = opts.fetchBytes, cache = new Map(), keyPromise = null, unlocked = false;
    function key() {
      if (!keyPromise) keyPromise = Promise.resolve(keyProvider.getKey()).then(importKey)
        .catch(function (e) { keyPromise = null; throw e; });
      return keyPromise;
    }
    function load(id) {
      if (!cache.has(id)) {
        var p = Promise.all([key(), fetchBytes(id)]).then(function (a) { return decryptBytes(a[1], a[0]); }).then(function (rows) {
          if (!unlocked) { unlocked = true; if (opts.onUnlock) try { opts.onUnlock(); } catch (e) {} }
          return group(rows);
        });
        p.catch(function () { cache.delete(id); });
        cache.set(id, p);
      }
      return cache.get(id);
    }
    /** Find a verse in `preferred`, else the next version in FALLBACK_ORDER. */
    function resolve(ref, preferred) {
      return resolveWith(ref, preferred, load);
    }
    return { load: load, resolve: resolve, key: key, cached: function (id) { return cache.has(id); } };
  }

  function fallbackChain(preferred) {
    var order = FALLBACK_ORDER.slice();
    var i = order.indexOf(preferred);
    if (i > 0) { order.splice(i, 1); order.unshift(preferred); }
    return order;
  }

  /** Generic fallback resolution; loader(id) -> Promise<grouped>. */
  function resolveWith(ref, preferred, loader) {
    var r = typeof ref === 'string' ? parseRef(ref) : ref;
    var chain = fallbackChain(preferred), tried = [];
    function step(i) {
      if (i >= chain.length) return Promise.resolve({ ref: r, text: null, version: null, tried: tried, fallback: true });
      var id = chain[i];
      if ((VERSIFICATION_DIFFERS[id] || []).indexOf(r.book) >= 0) { tried.push(id); return step(i + 1); }
      return Promise.resolve(loader(id)).then(function (g) {
        var t = g.get(r.book, r.chapter, r.verse);
        tried.push(id);
        if (t != null) return { ref: r, text: t, version: id, tried: tried, fallback: id !== preferred };
        return step(i + 1);
      }, function () { tried.push(id); return step(i + 1); });
    }
    return step(0);
  }

  /** Nearest book (by master canonical position) that the version has. */
  function nearestBook(grouped, name) {
    var have = grouped.books.map(function (b) { return b.name; });
    if (have.indexOf(name) >= 0) return name;
    var lower = String(name).toLowerCase();
    for (var i = 0; i < have.length; i++) if (have[i].toLowerCase() === lower) return have[i];
    var pos = CANON.indexOf(name);
    if (pos < 0) { for (i = 0; i < CANON.length; i++) if (CANON[i].toLowerCase() === lower) pos = i; }
    if (pos < 0) return have[0] || null;
    var best = null, bestD = Infinity;
    have.forEach(function (h) { var d = Math.abs(CANON.indexOf(h) - pos); if (d < bestD) { bestD = d; best = h; } });
    return best;
  }

  /* ---------- private key link (#key=<base64url>) ---------- */
  /** Accepts base64 or base64url (padding optional, %-encoding ok). Returns canonical padded base64 of a
   *  32-byte key, or null if it is not one. */
  function normalizeKey(s) {
    if (s == null) return null;
    s = String(s).trim();
    try { s = decodeURIComponent(s); } catch (e) { return null; }
    s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (!/^[A-Za-z0-9+\/]+$/.test(s) || s.length % 4 === 1) return null;
    while (s.length % 4) s += '=';
    var bytes; try { bytes = b64ToBytes(s); } catch (e) { return null; }
    var ok = bytes.length === 32; bytes.fill(0);
    return ok ? s : null;
  }
  function toBase64Url(b64) { return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  /** "#key=abc&v16" -> {present: true, key: <base64>|null (null = malformed), rest: "v16"}. */
  function parseHashKey(hash) {
    var h = String(hash || '').replace(/^#/, ''), present = false, key = null, rest = [];
    (h ? h.split('&') : []).forEach(function (p) {
      if (/^key=/i.test(p)) { present = true; key = normalizeKey(p.slice(4)); }
      else if (p) rest.push(p);
    });
    return { present: present, key: present ? key : null, rest: rest.join('&') };
  }
  /** Put the key into a link's hash, keeping any other hash part (e.g. reader's #v16). */
  function withHashKey(href, key) {
    var i = href.indexOf('#'), base = i < 0 ? href : href.slice(0, i), rest = parseHashKey(i < 0 ? '' : href.slice(i + 1)).rest;
    return base + '#key=' + toBase64Url(key) + (rest ? '&' + rest : '');
  }
  /** Key works only if importKey succeeds AND a real versions file decrypts (GCM tag check). Resolves the CryptoKey. */
  function validateKey(raw, fetchBytes, id) {
    return importKey(raw).then(function (k) {
      return Promise.resolve(fetchBytes(id || 'oeb')).then(function (buf) {
        var u = new Uint8Array(buf);
        if (u.length < 12 + 16) throw new Error('File too short');
        return getSubtle().decrypt({ name: 'AES-GCM', iv: u.slice(0, 12), tagLength: 128 }, k, u.slice(12));
      }).then(function () { return k; }, function () { throw new Error('This key does not unlock the Bible files'); });
    });
  }

  /* ---------- key providers ---------- */
  /** Demo: user pastes the base64 key or picks the key file. ui: async () => string|ArrayBuffer */
  function PasteKeyProvider(ui) { return { getKey: function () { return ui(); } }; }
  /** Real app: native bridge, e.g. a Capacitor/Cordova plugin backed by Android Keystore / iOS Keychain.
   *  bridge.getSecret('bible-versions') -> Promise<base64>. Not implemented here (no native build). */
  function NativeKeyProvider(bridge) { return { getKey: function () { return bridge.getSecret('bible-versions'); } }; }
  /** Try providers in order. */
  function ChainKeyProvider(list) {
    return { getKey: function () {
      var i = 0;
      function next(err) { if (i >= list.length) return Promise.reject(err || new Error('No key provider')); var p = list[i++]; return Promise.resolve().then(p.getKey).catch(next); }
      return next();
    } };
  }

  function browserFetchBytes(base) {
    base = base || 'versions/';
    return function (id) { return fetch(base + id + '.enc').then(function (r) { if (!r.ok) throw new Error(id + '.enc: HTTP ' + r.status); return r.arrayBuffer(); }); };
  }

  return { VERSIONS: VERSIONS, FALLBACK_ORDER: FALLBACK_ORDER, VERSIFICATION_DIFFERS: VERSIFICATION_DIFFERS, CANON: CANON, versionInfo: versionInfo,
    importKey: importKey, decryptBytes: decryptBytes, group: group, parseRef: parseRef, createLibrary: createLibrary,
    fallbackChain: fallbackChain, resolveWith: resolveWith, nearestBook: nearestBook,
    PasteKeyProvider: PasteKeyProvider, NativeKeyProvider: NativeKeyProvider,
    ChainKeyProvider: ChainKeyProvider, browserFetchBytes: browserFetchBytes,
    normalizeKey: normalizeKey, toBase64Url: toBase64Url, parseHashKey: parseHashKey, withHashKey: withHashKey, validateKey: validateKey };
});
