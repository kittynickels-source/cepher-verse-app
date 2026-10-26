/* hebrew-reveal.js — tap a Cepher-style name to see its Hebrew in a pop-up bubble.
 * UMD: window.HebrewReveal in the browser, module.exports in Node (pure parts are testable).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HebrewReveal = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var APOS = "'\u2019\u2018`\u02BC\u02BB";            // interchangeable apostrophes
  var APOS_CLASS = '[' + APOS + ']';
  var L = '\\p{L}\\p{M}\\d';                           // "word" characters

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function normKey(s) {
    return String(s).normalize('NFC').toLowerCase()
      .replace(new RegExp(APOS_CLASS, 'g'), "'")
      .replace(/[\s\u00a0-]+/g, ' ').trim();
  }

  function formPattern(form) {
    var out = '';
    for (var i = 0; i < form.length; i++) {
      var ch = form[i];
      if (APOS.indexOf(ch) >= 0) out += APOS_CLASS;
      else if (/[\s-]/.test(ch)) { out += '[\\s\\u00a0-]+'; while (i + 1 < form.length && /[\s-]/.test(form[i + 1])) i++; }
      else out += escapeRe(ch);
    }
    return out;
  }

  /** Build a matcher from the hebrew-names.json data (object with .entries or an array). */
  function buildMatcher(data) {
    var entries = Array.isArray(data) ? data : data.entries;
    var byForm = new Map(), byId = new Map(), forms = [];
    entries.forEach(function (e) {
      byId.set(e.id, e);
      (e.forms || []).forEach(function (f) {
        var k = normKey(f);
        if (!k || byForm.has(k)) return;
        byForm.set(k, e); forms.push(f);
      });
    });
    forms.sort(function (a, b) { return b.length - a.length; }); // longest first
    // Boundaries: not preceded by a word char or by "letter+apostrophe" (e.g. Mashiach inside Ha'Mashiach);
    // not followed by a word char, or by an apostrophe+letter unless that is a possessive 's.
    var pre = '(?<![' + L + '])(?<![' + L + ']' + APOS_CLASS + ')';
    var post = '(?![' + L + '])(?!' + APOS_CLASS + '(?!s(?![' + L + ']))[' + L + '])';
    var re = new RegExp(pre + '(' + forms.map(formPattern).join('|') + ')' + post, 'giu');
    return { re: re, byForm: byForm, byId: byId, entries: entries };
  }

  /** Split text into [{type:'text',text}|{type:'name',text,entry}] segments. */
  function segment(text, matcher) {
    var out = [], last = 0, m;
    matcher.re.lastIndex = 0;
    while ((m = matcher.re.exec(text))) {
      var entry = matcher.byForm.get(normKey(m[1]));
      if (!entry) continue;
      if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
      out.push({ type: 'name', text: m[1], entry: entry });
      last = m.index + m[1].length;
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
    return out;
  }

  /** Optional: swap KJV/PD words (entry.english, case-sensitive) for the Cepher form (entry.forms[0]). */
  function buildCepherizer(data) {
    var entries = Array.isArray(data) ? data : data.entries, map = new Map(), keys = [];
    entries.forEach(function (e) {
      (e.english || []).forEach(function (w) {
        if (!map.has(w)) { map.set(w, e.forms[0]); keys.push(w); }
      });
    });
    keys.sort(function (a, b) { return b.length - a.length; });
    if (!keys.length) return function (t) { return t; };
    var re = new RegExp('(?<![' + L + '])(' + keys.map(function (k) { return escapeRe(k).replace(/ /g, '\\s+'); }).join('|') + ')(?![' + L + '])', 'gu');
    return function (text) {
      return text.replace(re, function (w) { return map.get(w.replace(/\s+/g, ' ')) || w; });
    };
  }

  /* ---------- bubble positioning (pure) ----------
   * Below-right of the word: bubble's left edge sits near the word's centre (arrow at upper-left points at it).
   * Clamped to the viewport; flips above when there is no room below. */
  function computeBubblePosition(o) {
    var a = o.anchor, b = o.bubble, vw = o.viewport.width, vh = o.viewport.height;
    var margin = o.margin == null ? 8 : o.margin, gap = o.gap == null ? 10 : o.gap;
    var arrowInset = o.arrowInset == null ? 20 : o.arrowInset, arrowMin = o.arrowMin == null ? 12 : o.arrowMin;
    var cx = a.left + (a.right - a.left) / 2;
    var anchorX = Math.min(cx, a.left + Math.min((a.right - a.left) / 2, 24)); // near left/centre
    var left = anchorX - arrowInset;
    if (left + b.width > vw - margin) left = vw - margin - b.width;   // shift left at right edge
    if (left < margin) left = margin;
    var spaceBelow = vh - margin - (a.bottom + gap), spaceAbove = (a.top - gap) - margin;
    var placement = 'below', top;
    if (o.placement === 'below') top = a.bottom + gap;                 // forced (space already reserved in-flow)
    else if (o.placement === 'above') { placement = 'above'; top = a.top - gap - b.height; }
    else if (b.height <= spaceBelow) top = a.bottom + gap;
    else if (b.height <= spaceAbove) { placement = 'above'; top = a.top - gap - b.height; }
    else if (spaceAbove > spaceBelow) { placement = 'above'; top = Math.max(margin, a.top - gap - b.height); }
    else top = Math.min(a.bottom + gap, Math.max(margin, vh - margin - b.height));
    var arrowLeft = Math.max(arrowMin, Math.min(b.width - arrowMin, anchorX - left));
    return { left: Math.round(left), top: Math.round(top), placement: placement, arrowLeft: Math.round(arrowLeft) };
  }

  /* ---------- in-flow space reservation (pure) ----------
   * While a bubble is open, a zero-width inline-block "spacer" sits on the tapped word's line.
   * below: vertical-align:top, it hangs down from the line top so the NEXT line starts under the bubble.
   * above: vertical-align:bottom, it rises from the line bottom so the PREVIOUS line ends above the bubble.
   * Returns the spacer height in px. */
  function computeSpacerHeight(o) {
    var gap = o.gap == null ? 10 : o.gap, pad = o.pad == null ? 10 : o.pad;
    if (o.placement === 'above') return Math.ceil((o.lineBottom - o.anchorTop) + gap + o.bubbleHeight + pad);
    return Math.ceil((o.anchorBottom - o.lineTop) + gap + o.bubbleHeight + pad);
  }
  /** Do two rects intersect (strictly)? */
  function rectsIntersect(a, b) { return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }

  /* ---------- open/close state (pure) ---------- */
  function createBubbleState() {
    var openKey = null;
    return {
      get openKey() { return openKey; },
      isOpen: function (k) { return k == null ? openKey !== null : openKey === k; },
      toggle: function (k) { openKey = (openKey === k) ? null : k; return openKey; },
      open: function (k) { openKey = k; return openKey; },
      close: function () { var was = openKey; openKey = null; return was; }
    };
  }

  /* ---------- DOM ---------- */
  var uid = 0;

  function renderInto(el, text, matcher, opts) {
    opts = opts || {};
    var doc = el.ownerDocument;
    el.textContent = '';
    segment(text, matcher).forEach(function (seg) {
      if (seg.type === 'text') { el.appendChild(doc.createTextNode(seg.text)); return; }
      var s = doc.createElement('span');
      s.className = 'hr-name';
      s.textContent = seg.text;
      s.setAttribute('role', 'button');
      s.setAttribute('tabindex', '0');
      s.setAttribute('aria-haspopup', 'dialog');
      s.setAttribute('aria-expanded', 'false');
      s.setAttribute('aria-label', seg.text + ', show Hebrew');
      s.dataset.hrId = seg.entry.id;
      s.dataset.hrKey = 'hr' + (++uid);
      if (opts.ref) s.dataset.hrRef = opts.ref;
      el.appendChild(s);
    });
    return el;
  }

  /**
   * Controller for one document: one bubble at a time.
   * options: { matcher, speaker (HebrewSpeech instance, optional), onReveal(entry, ref) optional }
   */
  function createController(doc, options) {
    var win = doc.defaultView, matcher = options.matcher, speaker = options.speaker;
    var state = createBubbleState(), current = null, openedByKeyboard = false;
    var bubble = doc.createElement('div');
    bubble.className = 'hr-bubble';
    bubble.id = 'hr-bubble';
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-modal', 'false');
    bubble.hidden = true;
    bubble.innerHTML =
      '<div class="hr-arrow" aria-hidden="true"></div>' +
      '<div class="hr-heb" lang="he" dir="rtl"></div>' +
      '<div class="hr-pointed" lang="he" dir="rtl"></div>' +
      '<div class="hr-pron"></div><div class="hr-meaning"></div>' +
      '<div class="hr-actions"><button type="button" class="hr-play"></button>' +
      '<button type="button" class="hr-mute"></button></div>';
    doc.body.appendChild(bubble);
    var $ = function (c) { return bubble.querySelector(c); };

    function syncSpeechButtons() {
      var play = $('.hr-play'), mute = $('.hr-mute');
      if (!speaker || !speaker.supported) { play.hidden = true; mute.hidden = true; return; }
      var muted = speaker.isMuted();
      play.hidden = false; mute.hidden = false;
      play.disabled = muted;
      play.textContent = muted ? '\uD83D\uDD07 Muted' : '\u25B6 Play';
      play.setAttribute('aria-label', muted ? 'Pronunciation muted' : 'Play pronunciation');
      mute.textContent = muted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-pressed', String(muted));
      mute.setAttribute('aria-label', muted ? 'Unmute pronunciation audio' : 'Mute pronunciation audio');
    }

    var GAP = 10, PAD = 10, suppressScrollUntil = 0, reserved = null;
    function now() { return (win.performance && win.performance.now()) || Date.now(); }
    function suppressScroll(ms) { suppressScrollUntil = Math.max(suppressScrollUntil, now() + (ms || 400)); }
    function reducedMotion() { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    function anchorRect(span) {                 // first line box of the word (names can wrap)
      var lead = span.querySelector('.hr-lead');
      var rs = (lead || span).getClientRects();
      var r = rs.length ? rs[0] : span.getBoundingClientRect(), whole = span.getClientRects();
      var first = whole.length ? whole[0] : r;
      return { left: first.left, right: first.right, top: first.top, bottom: first.bottom };
    }
    function measureBubble() {
      bubble.style.left = '0px'; bubble.style.top = '0px';   // measure at natural (unconstrained) width
      return { width: bubble.offsetWidth, height: bubble.offsetHeight };
    }
    function viewport() { return { width: doc.documentElement.clientWidth || win.innerWidth, height: win.innerHeight }; }
    function apply(pos) {
      bubble.style.left = pos.left + 'px';
      bubble.style.top = pos.top + 'px';
      bubble.dataset.placement = pos.placement;
      bubble.style.setProperty('--hr-arrow-left', pos.arrowLeft + 'px');
    }

    /** Insert a spacer at the start of the word (wrapped with its first letter in a nowrap span so
     *  no new line-break opportunity appears) and size it so neighbouring lines move out of the way. */
    function reserve(span, placement, bubbleHeight) {
      var text = span.textContent, docFrag = doc.createDocumentFragment();
      var lead = doc.createElement('span'); lead.className = 'hr-lead';
      var sp = doc.createElement('span'); sp.className = 'hr-spacer ' + (placement === 'above' ? 'hr-spacer-above' : 'hr-spacer-below');
      sp.setAttribute('aria-hidden', 'true');
      var chars = Array.from(text);
      lead.appendChild(sp); lead.appendChild(doc.createTextNode(chars[0] || ''));
      docFrag.appendChild(lead); docFrag.appendChild(doc.createTextNode(chars.slice(1).join('')));
      span.textContent = ''; span.appendChild(docFrag);
      var before = anchorRect(span), sr = sp.getBoundingClientRect();
      var h = computeSpacerHeight({ placement: placement, lineTop: sr.top, lineBottom: sr.bottom,
        anchorTop: before.top, anchorBottom: before.bottom, bubbleHeight: bubbleHeight, gap: GAP, pad: PAD });
      var animate = placement === 'below' && !reducedMotion();
      if (animate) sp.classList.add('hr-animate');
      sp.style.height = h + 'px';
      reserved = { span: span, spacer: sp, text: text, height: h };
      return before;
    }
    function release(r, instant) {
      if (!r) return;
      function restore() { r.span.textContent = r.text; }   // drop lead/spacer, back to plain text
      suppressScroll(500);
      if (instant || reducedMotion() || !r.spacer.classList.contains('hr-animate')) { restore(); return; }
      r.spacer.style.height = '0px';
      var done = false; function fin() { if (!done) { done = true; if (current !== r.span) restore(); } }
      r.spacer.addEventListener('transitionend', fin, { once: true });
      win.setTimeout(fin, 250);
    }

    function place() {
      if (!current) return;
      var b = measureBubble();
      apply(computeBubblePosition({ anchor: anchorRect(current), bubble: b, viewport: viewport(),
        gap: GAP, placement: bubble.dataset.placement || undefined }));
    }

    function close(restoreFocus) {
      if (!current) return;
      var span = current, r = reserved;
      state.close();
      current = null; reserved = null;
      span.setAttribute('aria-expanded', 'false');
      span.classList.remove('hr-active');
      span.removeAttribute('aria-controls');
      bubble.hidden = true;
      bubble.classList.remove('hr-shown');
      delete bubble.dataset.placement;
      release(r, false);
      if (speaker && speaker.cancel) speaker.cancel();
      if (restoreFocus || bubble.contains(doc.activeElement)) span.focus({ preventScroll: true });
    }

    function open(span, viaKeyboard) {
      if (current) close(false);
      var e = matcher.byId.get(span.dataset.hrId);
      if (!e) return;
      state.open(span.dataset.hrKey);
      current = span;
      openedByKeyboard = !!viaKeyboard;
      $('.hr-heb').textContent = e.hebrew;
      $('.hr-pointed').textContent = e.pointed && e.pointed !== e.hebrew ? e.pointed : '';
      $('.hr-pointed').hidden = !$('.hr-pointed').textContent;
      $('.hr-pron').textContent = e.pronunciation ? '\u201C' + e.pronunciation + '\u201D' : '';
      $('.hr-meaning').textContent = e.meaning || '';
      bubble.setAttribute('aria-label', 'Hebrew for ' + span.textContent);
      bubble._entry = e;
      syncSpeechButtons();
      bubble.classList.remove('hr-shown');
      bubble.hidden = false;
      span.setAttribute('aria-expanded', 'true');
      span.setAttribute('aria-controls', bubble.id);
      span.classList.add('hr-active');

      // 1) choose placement with the current layout, 2) reserve in-flow space, 3) keep the word still, 4) position.
      suppressScroll(600);
      var size = measureBubble();
      var first = computeBubblePosition({ anchor: anchorRect(span), bubble: size, viewport: viewport(), gap: GAP });
      var before = reserve(span, first.placement, size.height);
      var after = anchorRect(span), dy = after.top - before.top;
      if (Math.abs(dy) > 0.5) win.scrollBy(0, dy);          // 'above' pushes the word down: scroll it back
      bubble.dataset.placement = first.placement;
      place();
      win.requestAnimationFrame ? win.requestAnimationFrame(function () { if (current === span) bubble.classList.add('hr-shown'); }) : bubble.classList.add('hr-shown');

      if (viaKeyboard) { var f = bubble.querySelector('button:not([hidden]):not([disabled])'); (f || bubble).focus({ preventScroll: true }); }
      if (options.onReveal) options.onReveal(e, span.dataset.hrRef || '');
    }

    function toggle(span, viaKeyboard) {
      if (current === span) close(viaKeyboard); else open(span, viaKeyboard);
    }

    bubble.tabIndex = -1;
    $('.hr-play').addEventListener('click', function () { if (bubble._entry && speaker) speaker.speak(bubble._entry); });
    $('.hr-mute').addEventListener('click', function () { speaker.toggleMute(); syncSpeechButtons(); });

    doc.addEventListener('click', function (ev) {
      var span = ev.target.closest && ev.target.closest('.hr-name');
      if (span) { ev.preventDefault(); toggle(span, ev.detail === 0); return; }
      if (!bubble.contains(ev.target)) close(false);
    });
    doc.addEventListener('pointerdown', function (ev) {       // dismiss promptly on outside touch
      if (!current) return;
      if (bubble.contains(ev.target) || (ev.target.closest && ev.target.closest('.hr-name'))) return;
      close(false);
    }, true);
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && current) { ev.preventDefault(); close(true); return; }
      var span = ev.target.closest && ev.target.closest('.hr-name');
      if (span && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar')) { ev.preventDefault(); toggle(span, true); }
    });
    // User scrolling closes the bubble; scroll events caused by our own space reservation are ignored.
    win.addEventListener('scroll', function () { if (now() < suppressScrollUntil) { place(); return; } close(false); }, true);
    win.addEventListener('resize', function () { place(); });

    return {
      render: function (el, text, opts) { return renderInto(el, text, matcher, opts); },
      close: close, open: open, toggle: toggle, state: state, bubble: bubble,
      refreshSpeech: syncSpeechButtons, get current() { return current; }
    };
  }

  return {
    normKey: normKey, buildMatcher: buildMatcher, segment: segment, buildCepherizer: buildCepherizer,
    computeBubblePosition: computeBubblePosition, computeSpacerHeight: computeSpacerHeight, rectsIntersect: rectsIntersect,
    createBubbleState: createBubbleState,
    renderInto: renderInto, createController: createController
  };
});
