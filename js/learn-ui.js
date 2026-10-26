/* learn-ui.js — quiz + progress screens for learn.html (logic lives in learn.js). */
(function (root) {
  'use strict';
  function mount(el, ctx) {
    var L = root.HebrewLearn, doc = el.ownerDocument, entries = ctx.names.entries, store = ctx.learn;
    var byId = new Map(entries.map(function (e) { return [e.id, e]; }));
    var session = null, typed = false;

    function h(tag, cls, text) { var x = doc.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }

    function empty() {
      el.textContent = '';
      var box = h('div', 'empty');
      box.appendChild(h('h2', null, 'Nothing to learn yet'));
      box.appendChild(h('p', null, 'Tap a Hebrew-style name like Elohiym or Yahusha in the reader or today’s verse. Every name you reveal shows up here for practice.'));
      var a = h('a', 'btn primary', 'Open the reader'); a.href = 'reader.html'; box.appendChild(a);
      el.appendChild(box);
    }

    function home() {
      var p = store.progress(entries);
      if (!p.seen) return empty();
      el.textContent = '';
      var top = h('div', 'learn-top');
      var start = h('button', 'btn primary', 'Start practice (' + store.buildQueue().length + ')'); start.type = 'button';
      start.disabled = !store.buildQueue().length;
      start.onclick = function () { session = L.createSession(store.buildQueue()); next(); };
      var tl = h('label', 'typed-toggle'); var cb = h('input'); cb.type = 'checkbox'; cb.checked = typed;
      cb.onchange = function () { typed = cb.checked; }; tl.appendChild(cb); tl.appendChild(doc.createTextNode(' Type answers for Hebrew → English'));
      top.appendChild(start); top.appendChild(tl); el.appendChild(top);
      renderProgress(p);
    }

    function renderProgress(p) {
      var sec = h('section', 'progress'); sec.appendChild(h('h2', null, 'Progress'));
      var stats = h('dl', 'stats');
      [['Seen', p.seen + ' of ' + p.total], ['Mastered', String(p.mastered)], ['Due today', String(p.dueToday)],
       ['Accuracy', p.accuracy == null ? '—' : Math.round(p.accuracy * 100) + '%'],
       ['Streak', p.streak + ' right in a row (best ' + p.bestStreak + ')'], ['Days in a row', String(p.dayStreak)]]
        .forEach(function (r) { stats.appendChild(h('dt', null, r[0])); stats.appendChild(h('dd', null, r[1])); });
      sec.appendChild(stats);
      var ul = h('ul', 'mastery');
      p.perName.sort(function (a, b) { return b.mastery - a.mastery || a.name.localeCompare(b.name); }).forEach(function (n) {
        var li = h('li'); li.appendChild(h('span', 'm-name', n.name));
        var he = h('span', 'm-heb', n.hebrew); he.lang = 'he'; he.dir = 'rtl'; li.appendChild(he);
        var lv = h('span', 'm-level', 'Level ' + n.mastery + '/' + (L.INTERVAL_DAYS.length - 1));
        lv.title = 'English→Hebrew box ' + (n.boxes.en2he == null ? 'new' : n.boxes.en2he) + ', Hebrew→English box ' + (n.boxes.he2en == null ? 'new' : n.boxes.he2en);
        li.appendChild(lv); ul.appendChild(li);
      });
      sec.appendChild(ul);
      var reset = h('button', 'btn danger', 'Reset progress'); reset.type = 'button';
      reset.onclick = function () { if (root.confirm('Erase all learned names and quiz history? This cannot be undone.')) { store.reset(); home(); } };
      sec.appendChild(reset); el.appendChild(sec);
    }

    function next() {
      var item = session.current();
      if (!item) { el.textContent = ''; el.appendChild(h('h2', null, 'Session complete')); el.appendChild(h('p', null, session.done + ' answers. Come back when more are due.')); var b = h('button', 'btn primary', 'Back'); b.type = 'button'; b.onclick = home; el.appendChild(b); return; }
      var e = byId.get(item.id); if (!e) { session.answer(true); return next(); }
      el.textContent = '';
      var card = h('section', 'quiz-card'); card.setAttribute('aria-live', 'polite');
      card.appendChild(h('p', 'quiz-meta', (item.kind === 'retry' ? 'Try again · ' : '') + session.remaining + ' left'));
      var prompt = h('div', 'quiz-prompt');
      if (item.dir === 'en2he') { prompt.textContent = L.displayName(e); card.appendChild(h('p', 'quiz-q', 'Which is the Hebrew?')); }
      else { prompt.textContent = e.hebrew; prompt.lang = 'he'; prompt.dir = 'rtl'; prompt.classList.add('heb'); card.appendChild(h('p', 'quiz-q', 'Which name is this?')); }
      card.appendChild(prompt);
      var answers = h('div', 'quiz-options');
      function finish(ok, chosenBtn) {
        store.review(e.id, item.dir, ok); session.answer(ok);
        answers.querySelectorAll('button,input').forEach(function (b) { b.disabled = true; });
        var fb = h('div', 'quiz-feedback ' + (ok ? 'ok' : 'bad'));
        fb.appendChild(h('p', null, ok ? 'Correct!' : 'Not quite — it will come back shortly.'));
        var ans = h('p', 'quiz-answer'); ans.appendChild(doc.createTextNode(L.displayName(e) + ' = '));
        var he = h('span', 'heb', e.hebrew); he.lang = 'he'; he.dir = 'rtl'; ans.appendChild(he); fb.appendChild(ans);
        if (e.pronunciation) fb.appendChild(h('p', 'hr-pron', '“' + e.pronunciation + '”'));
        if (e.meaning) fb.appendChild(h('p', 'hr-meaning', e.meaning));
        if (ctx.speaker.supported) {
          var play = h('button', 'btn', ctx.speaker.isMuted() ? 'Muted' : '▶ Play'); play.type = 'button';
          play.disabled = ctx.speaker.isMuted(); play.setAttribute('aria-label', 'Play pronunciation of ' + L.displayName(e));
          play.onclick = function () { ctx.speaker.speak(e); }; fb.appendChild(play);
        }
        var n = h('button', 'btn primary', 'Next'); n.type = 'button'; n.onclick = next; fb.appendChild(n);
        card.appendChild(fb); n.focus();
      }
      if (item.dir === 'he2en' && typed) {
        var f = h('form', 'typed'); var inp = h('input'); inp.type = 'text'; inp.setAttribute('aria-label', 'Type the name'); inp.autocomplete = 'off';
        var go = h('button', 'btn primary', 'Check'); f.appendChild(inp); f.appendChild(go);
        f.onsubmit = function (ev) { ev.preventDefault(); finish(L.checkTyped(inp.value, e, entries)); };
        answers.appendChild(f); card.appendChild(answers); el.appendChild(card); inp.focus(); return;
      }
      L.makeOptions(e, item.dir, entries).forEach(function (o) {
        var b = h('button', 'btn option', o.label); b.type = 'button';
        if (item.dir === 'en2he') { b.lang = 'he'; b.dir = 'rtl'; b.classList.add('heb'); }
        b.dataset.correct = o.correct ? '1' : '0';
        b.onclick = function () { b.classList.add(o.correct ? 'right' : 'wrong'); var r = answers.querySelector('[data-correct="1"]'); if (r) r.classList.add('right'); finish(o.correct, b); };
        answers.appendChild(b);
      });
      card.appendChild(answers); el.appendChild(card);
    }
    home();
  }
  root.LearnUI = { mount: mount };
})(typeof self !== 'undefined' ? self : this);
