/* hebrew-speech.js — pronunciation audio via the Web Speech API, with a persisted mute toggle.
 * createSpeaker({ synth, Utterance, storage }) — all injectable for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HebrewSpeech = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MUTE_KEY = 'hebrewReveal.muted';

  function normLang(l) { return String(l || '').replace('_', '-').toLowerCase(); }
  function isHebrew(v) { var l = normLang(v.lang); return l === 'he' || l === 'iw' || l.indexOf('he-') === 0 || l.indexOf('iw-') === 0; }
  function isEnglish(v) { var l = normLang(v.lang); return l === 'en' || l.indexOf('en-') === 0; }

  /** Pick the best English voice: en-US (local first, then default), then any en-*. */
  function pickEnglishVoice(voices) {
    var en = (voices || []).filter(isEnglish);
    if (!en.length) return null;
    function score(v) {
      var l = normLang(v.lang);
      return (l === 'en-us' ? 4 : l === 'en-gb' ? 2 : 1) + (v.localService ? 1 : 0) + (v['default'] ? 0.5 : 0);
    }
    return en.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }
  /** Hebrew voice: lang he / he-IL / iw / iw-IL (Android sometimes reports legacy 'iw'). */
  function pickHebrewVoice(voices) {
    var he = (voices || []).filter(isHebrew);
    if (!he.length) return null;
    return he.slice().sort(function (a, b) { return (b.localService ? 1 : 0) - (a.localService ? 1 : 0); })[0];
  }

  function createSpeaker(opts) {
    opts = opts || {};
    var g = typeof window !== 'undefined' ? window : {};
    var synth = opts.synth !== undefined ? opts.synth : g.speechSynthesis;
    var Utt = opts.Utterance !== undefined ? opts.Utterance : g.SpeechSynthesisUtterance;
    var storage = opts.storage !== undefined ? opts.storage : (function () { try { return g.localStorage; } catch (e) { return null; } })();
    var supported = !!(synth && Utt && typeof synth.speak === 'function');
    var voices = [], waiters = [], listeners = [];

    function refresh() {
      try { voices = (synth.getVoices && synth.getVoices()) || []; } catch (e) { voices = []; }
      if (voices.length) { var w = waiters; waiters = []; w.forEach(function (f) { f(voices); }); }
      return voices;
    }
    if (supported) {
      refresh();
      if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
      else synth.onvoiceschanged = refresh;
    }
    /** Resolve with voices; waits for voiceschanged (async loading in Chrome/Android) up to timeoutMs. */
    function ready(timeoutMs) {
      if (!supported) return Promise.resolve([]);
      if (refresh().length) return Promise.resolve(voices);
      return new Promise(function (res) {
        var done = false;
        waiters.push(function (v) { if (!done) { done = true; res(v); } });
        setTimeout(function () { if (!done) { done = true; res(refresh()); } }, timeoutMs == null ? 1500 : timeoutMs);
      });
    }

    function isMuted() { try { return !!storage && storage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } }
    function setMuted(m) {
      try { if (storage) storage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {}
      if (m) cancel();
      listeners.forEach(function (f) { f(!!m); });
    }
    function toggleMute() { setMuted(!isMuted()); return isMuted(); }
    function onMuteChange(f) { listeners.push(f); }
    function cancel() { if (supported) try { synth.cancel(); } catch (e) {} }

    /** Speak entry: English/transliteration first, then Hebrew script if a Hebrew voice exists.
     *  Resolves with a summary {spoken:[...]} (useful for tests and UI). */
    function speak(entry) {
      if (!supported || isMuted() || !entry) return Promise.resolve({ spoken: [], reason: !supported ? 'unsupported' : isMuted() ? 'muted' : 'no-entry' });
      var englishText = (entry.pronunciation && entry.pronunciation.trim()) || (entry.forms && entry.forms[0]) || entry.name || '';
      return ready().then(function (vs) {
        if (isMuted()) return { spoken: [], reason: 'muted' };
        cancel();                                    // stop anything already speaking
        var spoken = [];
        var en = new Utt(englishText);
        var ev = pickEnglishVoice(vs);
        en.lang = ev ? ev.lang : 'en-US';
        if (ev) en.voice = ev;
        en.rate = 0.85;
        synth.speak(en); spoken.push({ text: englishText, lang: en.lang });
        var hv = pickHebrewVoice(vs);
        if (hv && entry.hebrew) {
          var he = new Utt(entry.pointed || entry.hebrew);
          he.voice = hv; he.lang = hv.lang || 'he-IL'; he.rate = 0.8;
          synth.speak(he); spoken.push({ text: he.text, lang: he.lang });
        }
        return { spoken: spoken, hebrewVoice: !!hv };
      });
    }

    return { supported: supported, ready: ready, isMuted: isMuted, setMuted: setMuted, toggleMute: toggleMute,
      onMuteChange: onMuteChange, cancel: cancel, speak: speak,
      hasHebrewVoice: function () { return !!pickHebrewVoice(refresh()); } };
  }

  return { createSpeaker: createSpeaker, pickEnglishVoice: pickEnglishVoice, pickHebrewVoice: pickHebrewVoice, MUTE_KEY: MUTE_KEY };
});
