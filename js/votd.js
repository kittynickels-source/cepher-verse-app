/* votd.js — verse of the day: deterministic pick by local date, version fallback, card rendering. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerseOfTheDay = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** 0-based local day of year (Jan 1 = 0, Dec 31 = 364 or 365). Stable all local day. */
  function dayOfYear(date) {
    var d = date || new Date();
    return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000);
  }
  function pickRef(refs, date) { return refs[dayOfYear(date) % refs.length]; }

  function readerLink(r, version) {
    return 'reader.html?v=' + encodeURIComponent(version) + '&b=' + encodeURIComponent(r.book) + '&c=' + r.chapter + '#v' + r.verse;
  }

  /** Browser: mount the card. ctx from AppShell.init(). */
  function mount(el, ctx, refs) {
    var BD = ctx.BibleData, doc = el.ownerDocument;
    var refStr = pickRef(refs, new Date()), r = BD.parseRef(refStr);
    el.innerHTML = '<p class="votd-date"></p><a class="votd-link"><p class="votd-ref"></p></a>' +
      '<blockquote class="votd-text verse" aria-live="polite">Loading…</blockquote>' +
      '<p class="votd-version"></p><a class="votd-open btn">Read the chapter →</a>';
    el.querySelector('.votd-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    el.querySelector('.votd-ref').textContent = refStr;
    var chosen = ctx.settings.version();
    return ctx.library.resolve(r, chosen).then(function (res) {
      var textEl = el.querySelector('.votd-text');
      if (!res.text) { textEl.textContent = 'This verse is not in any bundled version.'; return res; }
      ctx.render(textEl, res.text, { ref: refStr });
      var info = BD.versionInfo(res.version);
      el.querySelector('.votd-version').textContent = info.label + (res.fallback ? ' — ' + BD.versionInfo(chosen).label + ' lacks this verse' : '');
      var href = readerLink(r, res.version);
      el.querySelector('.votd-open').href = href;
      el.querySelector('.votd-link').href = href;
      // Tapping the verse (not a Hebrew name) is a doorway to the reader.
      textEl.addEventListener('click', function (ev) {
        if (ev.target.closest('.hr-name') || ev.defaultPrevented) return;
        doc.defaultView.location.href = ctx.linkFor ? ctx.linkFor(href) : href;
      });
      return res;
    }, function (err) { el.querySelector('.votd-text').textContent = 'Could not unlock the Bible files: ' + err.message; throw err; });
  }

  return { dayOfYear: dayOfYear, pickRef: pickRef, readerLink: readerLink, mount: mount };
});
