/* reader.js — chapter reader: pickers, prev/next across books, deep links, last-read position. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChapterReader = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var LAST_KEY = 'hebrewReveal.lastRead';

  function bookList(g) { return g.books.map(function (b) { return b.name; }); }
  function chapterList(g, book) { var b = g.book(book); return b ? b.chapters.map(function (c) { return c.number; }) : []; }
  /** Linear list of {book, chapter} in canon order of the version. */
  function flatten(g) { var out = []; g.books.forEach(function (b) { b.chapters.forEach(function (c) { out.push({ book: b.name, chapter: c.number }); }); }); return out; }
  function neighbors(g, book, chapter) {
    var f = flatten(g), i = -1;
    for (var k = 0; k < f.length; k++) if (f[k].book === book && f[k].chapter === chapter) { i = k; break; }
    if (i < 0) return { prev: null, next: null };
    return { prev: i > 0 ? f[i - 1] : null, next: i < f.length - 1 ? f[i + 1] : null };
  }
  /** ?v=kjv&b=John&c=3#v16 -> {version, book, chapter, verse} (missing parts null). */
  function parseDeepLink(search, hash) {
    var p = new URLSearchParams(search || '');
    var c = parseInt(p.get('c'), 10), vm = /^#?v(\d+)$/.exec(hash || '');
    var ver = (p.get('v') || '').toLowerCase();
    return { version: ver || null, book: p.get('b') || null, chapter: isFinite(c) && c > 0 ? c : null, verse: vm ? +vm[1] : null };
  }
  function buildDeepLink(version, book, chapter, verse) {
    return 'reader.html?v=' + encodeURIComponent(version) + '&b=' + encodeURIComponent(book) + '&c=' + chapter + (verse ? '#v' + verse : '');
  }

  function mount(root, ctx) {
    var BD = ctx.BibleData, doc = root.ownerDocument, win = doc.defaultView, storage = ctx.storage;
    root.innerHTML =
      '<div class="reader-controls">' +
      '<label>Version <select class="sel-version"></select></label>' +
      '<label>Book <select class="sel-book"></select></label>' +
      '<label>Chapter <select class="sel-chapter"></select></label></div>' +
      '<div class="reader-msg" role="status" hidden></div>' +
      '<h2 class="reader-title"></h2><div class="reader-body"></div>' +
      '<nav class="reader-nav"><button type="button" class="btn prev">← Previous</button><button type="button" class="btn next">Next →</button></nav>';
    var $ = function (s) { return root.querySelector(s); };
    var selV = $('.sel-version'), selB = $('.sel-book'), selC = $('.sel-chapter'), msg = $('.reader-msg');
    BD.VERSIONS.forEach(function (v) { var o = doc.createElement('option'); o.value = v.id; o.textContent = v.label + ' — ' + v.name; selV.appendChild(o); });
    var state = { version: null, book: null, chapter: null, g: null };

    function fill(sel, items) { sel.textContent = ''; items.forEach(function (x) { var o = doc.createElement('option'); o.value = String(x); o.textContent = String(x); sel.appendChild(o); }); }
    function say(html) { if (!html) { msg.hidden = true; msg.textContent = ''; return; } msg.hidden = false; msg.innerHTML = ''; msg.appendChild(html); }

    function show(version, book, chapter, verse, opts) {
      opts = opts || {};
      $('.reader-body').textContent = 'Loading…';
      return ctx.library.load(version).then(function (g) {
        say(null);
        var b = book;
        if (!g.book(b)) {
          var near = BD.nearestBook(g, b);
          var info = BD.versionInfo(version), frag = doc.createElement('span');
          frag.textContent = (info ? info.label : version) + ' does not include ' + b + '. ';
          var btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'btn';
          btn.textContent = 'Open ' + near + ' instead';
          btn.addEventListener('click', function () { show(version, near, chapterList(g, near)[0], null); });
          frag.appendChild(btn); say(frag);
          state.g = g; state.version = version; selV.value = version; fill(selB, bookList(g));
          $('.reader-body').textContent = ''; $('.reader-title').textContent = '';
          return;
        }
        var chs = chapterList(g, b);
        var c = chs.indexOf(chapter) >= 0 ? chapter : chs[0];
        if (chapter && c !== chapter) { var m = doc.createElement('span'); m.textContent = b + ' ' + chapter + ' is not in this version; showing chapter ' + c + '.'; say(m); }
        state = { version: version, book: b, chapter: c, g: g };
        selV.value = version; fill(selB, bookList(g)); selB.value = b; fill(selC, chs); selC.value = String(c);
        $('.reader-title').textContent = b + ' ' + c;
        var body = $('.reader-body'); body.textContent = '';
        g.chapter(b, c).verses.forEach(function (v) {
          var p = doc.createElement('p'); p.className = 'verse reader-verse'; p.id = 'v' + v.verse;
          var n = doc.createElement('sup'); n.className = 'vnum'; n.textContent = v.verse; n.setAttribute('aria-label', 'verse ' + v.verse);
          var t = doc.createElement('span');
          ctx.render(t, v.text, { ref: b + ' ' + c + ':' + v.verse });
          p.appendChild(n); p.appendChild(doc.createTextNode(' ')); p.appendChild(t); body.appendChild(p);
        });
        var nb = neighbors(g, b, c);
        $('.prev').disabled = !nb.prev; $('.next').disabled = !nb.next;
        $('.prev').onclick = function () { show(version, nb.prev.book, nb.prev.chapter, null); };
        $('.next').onclick = function () { show(version, nb.next.book, nb.next.chapter, null); };
        try { storage.setItem(LAST_KEY, JSON.stringify({ version: version, book: b, chapter: c, verse: verse || null })); } catch (e) {}
        if (!opts.noHistory) win.history.replaceState(null, '', buildDeepLink(version, b, c, verse));
        if (verse) {
          var el = doc.getElementById('v' + verse);
          if (el) { el.classList.add('highlight'); el.scrollIntoView({ block: 'center' }); }
        } else win.scrollTo(0, 0);
      }, function (err) { $('.reader-body').textContent = 'Could not unlock the Bible files: ' + err.message; });
    }

    selV.addEventListener('change', function () { show(selV.value, state.book || 'Genesis', state.chapter || 1, null); });
    selB.addEventListener('change', function () { show(state.version, selB.value, 1, null); });
    selC.addEventListener('change', function () { show(state.version, state.book, parseInt(selC.value, 10), null); });

    var dl = parseDeepLink(win.location.search, win.location.hash), last = null;
    try { last = JSON.parse(storage.getItem(LAST_KEY)); } catch (e) {}
    var version = dl.version && BD.versionInfo(dl.version) ? dl.version : (last && last.version) || ctx.settings.version();
    var book = dl.book || (last && last.book) || 'Genesis';
    var chapter = dl.chapter || (dl.book ? 1 : (last && last.chapter)) || 1;
    return show(version, book, chapter, dl.verse);
  }

  return { LAST_KEY: LAST_KEY, bookList: bookList, chapterList: chapterList, flatten: flatten, neighbors: neighbors,
    parseDeepLink: parseDeepLink, buildDeepLink: buildDeepLink, mount: mount };
});
