/* learn.js — reveal tracking, Leitner-box spaced repetition, quiz options and progress.
 * Pure logic; storage (localStorage-like) and clock are injectable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HebrewLearn = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KEY = 'hebrewReveal.learn.v1';
  var DAY = 86400000, MIN = 60000;
  // Leitner boxes: 0 = learning (just missed / new), 1..6 = graduating intervals in days.
  var INTERVAL_DAYS = [0, 1, 2, 4, 8, 16, 32];
  var MAX_BOX = INTERVAL_DAYS.length - 1, MASTERED_BOX = 5;
  var RELEARN_MS = 1 * MIN;          // wrong answer: due again in a minute (and re-queued in-session)
  var REQUEUE_GAP = 3;               // wrong answer comes back after ~3 other cards
  var DIRECTIONS = ['en2he', 'he2en'];

  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function endOfDay(t) { var d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function displayName(e) { return e.forms && e.forms[0] || e.id; }

  function emptyData() { return { seen: {}, cards: {}, stats: { answers: 0, correct: 0, streak: 0, bestStreak: 0, lastStudyDay: null, dayStreak: 0 } }; }

  function createStore(storage, now) {
    now = now || function () { return Date.now(); };
    var data;
    try { data = JSON.parse(storage && storage.getItem(KEY)) || emptyData(); } catch (e) { data = emptyData(); }
    if (!data.seen || !data.cards || !data.stats) data = emptyData();
    function save() { try { storage && storage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }

    /** Record a bubble reveal. */
    function track(id, ref) {
      var t = now(), s = data.seen[id];
      if (!s) s = data.seen[id] = { firstSeen: t, timesRevealed: 0, refs: [] };
      s.timesRevealed++; s.lastSeen = t;
      if (ref && s.refs.indexOf(ref) < 0) { s.refs.push(ref); if (s.refs.length > 20) s.refs.shift(); }
      save(); return s;
    }

    /** Apply a review result to a card (Leitner). */
    function review(id, dir, correct) {
      var t = now(), k = id + '|' + dir, c = data.cards[k] || { box: 0, due: t, reviews: 0, correct: 0, lapses: 0 };
      c.reviews++;
      if (correct) { c.correct++; c.box = Math.min(MAX_BOX, c.box + 1); c.due = t + INTERVAL_DAYS[c.box] * DAY; }
      else { c.lapses++; c.box = 0; c.due = t + RELEARN_MS; }
      c.last = t; data.cards[k] = c;
      var st = data.stats; st.answers++;
      if (correct) { st.correct++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak); } else st.streak = 0;
      var today = dayKey(t);
      if (st.lastStudyDay !== today) {
        var yesterday = dayKey(t - DAY);
        st.dayStreak = st.lastStudyDay === yesterday ? st.dayStreak + 1 : 1;
        st.lastStudyDay = today;
      }
      save(); return c;
    }

    /** Due items first (oldest due first), then new seen items (oldest seen first). */
    function buildQueue(at) {
      at = at == null ? now() : at;
      var due = [], fresh = [];
      Object.keys(data.seen).forEach(function (id) {
        DIRECTIONS.forEach(function (dir) {
          var c = data.cards[id + '|' + dir];
          if (!c) fresh.push({ id: id, dir: dir, seen: data.seen[id].firstSeen });
          else if (c.due <= at) due.push({ id: id, dir: dir, due: c.due });
        });
      });
      due.sort(function (a, b) { return a.due - b.due || (a.id < b.id ? -1 : 1); });
      fresh.sort(function (a, b) { return a.seen - b.seen || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.dir < b.dir ? -1 : 1); });
      return due.map(function (x) { return { id: x.id, dir: x.dir, kind: 'due' }; })
        .concat(fresh.map(function (x) { return { id: x.id, dir: x.dir, kind: 'new' }; }));
    }

    function progress(entries, at) {
      at = at == null ? now() : at;
      var eod = endOfDay(at), dueToday = 0, mastered = 0;
      var perName = Object.keys(data.seen).map(function (id) {
        var e = null; for (var i = 0; i < entries.length; i++) if (entries[i].id === id) e = entries[i];
        var boxes = {};
        DIRECTIONS.forEach(function (dir) {
          var c = data.cards[id + '|' + dir];
          boxes[dir] = c ? c.box : null;
          if (!c || c.due <= eod) dueToday++;
        });
        var lv = Math.min(boxes.en2he || 0, boxes.he2en || 0);
        if (lv >= MASTERED_BOX) mastered++;
        return { id: id, name: e ? displayName(e) : id, hebrew: e ? e.hebrew : '', boxes: boxes, mastery: lv,
          timesRevealed: data.seen[id].timesRevealed, refs: data.seen[id].refs.slice() };
      });
      var st = data.stats;
      return { seen: perName.length, total: entries.length, mastered: mastered, dueToday: dueToday,
        answers: st.answers, accuracy: st.answers ? st.correct / st.answers : null,
        streak: st.streak, bestStreak: st.bestStreak, dayStreak: st.dayStreak, perName: perName };
    }

    function reset() { data = emptyData(); save(); }

    return { track: track, review: review, buildQueue: buildQueue, progress: progress, reset: reset,
      get data() { return data; } };
  }

  /** In-session queue: wrong answers are re-inserted REQUEUE_GAP cards later. */
  function createSession(queue) {
    var q = queue.slice(), done = 0;
    return {
      get remaining() { return q.length; }, get done() { return done; },
      current: function () { return q[0] || null; },
      answer: function (correct) {
        var item = q.shift(); if (!item) return null;
        done++;
        if (!correct) q.splice(Math.min(REQUEUE_GAP, q.length), 0, { id: item.id, dir: item.dir, kind: 'retry' });
        return item;
      }
    };
  }

  function mulberry32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

  /** 4 unique options incl. the correct one. Distractors never share the correct Hebrew (e.g. שאול = Sha'ul/She'ol). */
  function makeOptions(entry, dir, entries, rng, n) {
    rng = rng || Math.random; n = n || 4;
    var label = dir === 'en2he' ? function (e) { return e.hebrew; } : displayName;
    var correct = label(entry), seen = new Set([correct]), pool = [];
    entries.forEach(function (e) {
      if (e.id === entry.id || !e.hebrew || e.hebrew === entry.hebrew) return;
      var l = label(e); if (!l || seen.has(l)) return; seen.add(l); pool.push(l);
    });
    shuffle(pool, rng);
    return shuffle([correct].concat(pool.slice(0, n - 1)), rng).map(function (l) { return { label: l, correct: l === correct }; });
  }

  function loose(s) {
    return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/['\u2019\u2018`\u02BC\u02BB\-\s.]/g, '');
  }
  function lev(a, b) {
    var m = a.length, n = b.length, d = []; for (var i = 0; i <= m; i++) { d[i] = [i]; }
    for (var j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  /** Lenient typed answer for Hebrew -> English: any form/variant or English equivalent of any entry
   *  with the same Hebrew; ignores case, apostrophes, hyphens, spaces; allows 1 typo for 5+ letters. */
  function checkTyped(input, entry, entries) {
    var x = loose(input); if (!x) return false;
    var accepted = [];
    (entries || [entry]).forEach(function (e) {
      if (e.id === entry.id || e.hebrew === entry.hebrew) accepted = accepted.concat(e.forms || [], e.english || []);
    });
    return accepted.some(function (a) { var y = loose(a); return y === x || (y.length >= 5 && lev(x, y) <= 1); });
  }

  return { KEY: KEY, INTERVAL_DAYS: INTERVAL_DAYS, MASTERED_BOX: MASTERED_BOX, DIRECTIONS: DIRECTIONS, RELEARN_MS: RELEARN_MS,
    createStore: createStore, createSession: createSession, makeOptions: makeOptions, checkTyped: checkTyped,
    mulberry32: mulberry32, displayName: displayName };
});
