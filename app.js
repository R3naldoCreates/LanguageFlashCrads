/* ═══════════════════════════════════════════════════════════════
   Language Flash Cards — app logic
   Single file: parser + UI. Also loadable by Node (tools/validate.js).
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var PREFIX = 'lfc:v1:';

  /* ───────────────────────── utils ───────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hashId(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function shuffleArr(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ───────────────────────── parser ────────────────────────
     Deck file format:
       @code / @name / @emoji / @frontLabel / @backLabel
       @pos   key=Label, key=Label …
       @feature key=Label, key=Label …
       entries:  front | english | pos | features | example | example-tr
     Features field: "key=value; key=value" (values may contain commas).
  ─────────────────────────────────────────────────────────── */

  function parseKeyValueList(text) {
    var out = {};
    String(text || '').split(',').forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var eq = chunk.indexOf('=');
      if (eq === -1) out[chunk] = chunk;
      else out[chunk.slice(0, eq).trim()] = chunk.slice(eq + 1).trim();
    });
    return out;
  }

  function parseFeatures(text) {
    var out = [];
    String(text || '').split(';').forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var eq = chunk.indexOf('=');
      if (eq === -1) out.push({ key: chunk, value: '' });
      else out.push({ key: chunk.slice(0, eq).trim(), value: chunk.slice(eq + 1).trim() });
    });
    return out;
  }

  function parseLanguageFile(text, path) {
    var meta = {
      code: '', name: '', emoji: '🌐',
      frontLabel: 'Front', backLabel: 'English',
      ttsLang: '',
      pos: {}, feature: {}, path: path
    };
    var entries = [];
    var issues = [];
    var lines = String(text || '').split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;

      if (line.charAt(0) === '@') {
        var m = line.match(/^@(\S+)\s+(.*)$/);
        if (!m) { issues.push({ file: path, line: i + 1, msg: 'Bad @ directive: ' + line }); continue; }
        var key = m[1].toLowerCase(), val = m[2].trim();
        if (key === 'code') meta.code = val.toLowerCase();
        else if (key === 'name') meta.name = val;
        else if (key === 'emoji') meta.emoji = val;
        else if (key === 'frontlabel') meta.frontLabel = val;
        else if (key === 'backlabel') meta.backLabel = val;
        else if (key === 'ttslang') meta.ttsLang = val;
        else if (key === 'pos') meta.pos = parseKeyValueList(val);
        else if (key === 'feature') meta.feature = parseKeyValueList(val);
        else issues.push({ file: path, line: i + 1, msg: 'Unknown @ directive: @' + key });
        continue;
      }

      var parts = line.split('|');
      if (parts.length < 2) {
        issues.push({ file: path, line: i + 1, msg: 'Entry needs at least "front | english": ' + line.slice(0, 60) });
        continue;
      }
      var front = parts[0].trim();
      var back = (parts[1] || '').trim();
      if (!front || !back) {
        issues.push({ file: path, line: i + 1, msg: 'Entry has empty front or english' });
        continue;
      }
      var pos = (parts[2] || '').trim();
      var code = meta.code || (path || '').replace(/^.*[\\\/]/, '').replace(/\.[^.]+$/, '');
      entries.push({
        id: hashId(code + '|' + front + '|' + (pos || '?')),
        front: front,
        back: back,
        pos: pos,
        features: parseFeatures((parts[3] || '').trim()),
        example: (parts[4] || '').trim(),
        exampleTrans: (parts[5] || '').trim(),
        file: path,
        line: i + 1
      });
    }
    if (!meta.code) {
      meta.code = (path || 'xx').replace(/^.*[\\\/]/, '').replace(/\.[^.]+$/, '').toLowerCase();
      issues.push({ file: path, line: 0, msg: 'No @code directive — derived "' + meta.code + '" from filename' });
    }
    if (!meta.name) meta.name = meta.code.toUpperCase();
    return { meta: meta, entries: entries, issues: issues };
  }

  /* ───────────────────────── storage ─────────────────────── */

  var Store = {
    key: function (code) { return PREFIX + 'tl:' + code; },
    get: function (code) {
      try { return new Set(JSON.parse(localStorage.getItem(this.key(code)) || '[]')); }
      catch (e) { return new Set(); }
    },
    save: function (code, set) {
      try { localStorage.setItem(this.key(code), JSON.stringify(Array.from(set))); } catch (e) {}
    },
    has: function (code, id) { return this.get(code).has(id); },
    add: function (code, id) {
      var s = this.get(code);
      if (!s.has(id)) { s.add(id); this.save(code, s); return true; }
      return false;
    },
    remove: function (code, id) {
      var s = this.get(code);
      if (s.has(id)) { s.delete(id); this.save(code, s); return true; }
      return false;
    },
    count: function (code) { return this.get(code).size; },
    exportAll: function () {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX + 'tl:') === 0) {
          try { out[k.slice((PREFIX + 'tl:').length)] = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
        }
      }
      return { app: 'language-flash-cards', version: 1, exported: new Date().toISOString(), tolearn: out };
    },
    importMerge: function (data) {
      if (!data || typeof data.tolearn !== 'object' || data.tolearn === null) throw new Error('Not a valid export file');
      var changed = 0;
      Object.keys(data.tolearn).forEach(function (code) {
        var s = Store.get(code);
        (data.tolearn[code] || []).forEach(function (id) {
          if (typeof id === 'string' && !s.has(id)) { s.add(id); changed++; }
        });
        Store.save(code, s);
      });
      return changed;
    }
  };

  /* ───────────────────────── state ───────────────────────── */

  var state = {
    langs: [],
    byCode: {},
    allIssues: [],
    loaded: false,
    loadError: null,
    view: 'home',
    code: null,
    posFilter: 'all',
    shuffle: true,
    basic: null,
    test: null
  };

  function L() { return state.byCode[state.code]; }

  function posLabel(l, key) {
    if (!key) return '';
    return (l.meta.pos && l.meta.pos[key]) || key;
  }

  function featLabel(l, key) {
    return (l.meta.feature && l.meta.feature[key]) || key;
  }

  function entriesFor(l) {
    return l.entries.filter(function (e) {
      return state.posFilter === 'all' || e.pos === state.posFilter;
    });
  }

  function tolearnEntries(l) {
    var s = Store.get(l.meta.code);
    return l.entries.filter(function (e) { return s.has(e.id); });
  }

  function featVal(e, key) {
    for (var i = 0; i < e.features.length; i++) if (e.features[i].key === key) return e.features[i].value;
    return '';
  }

  /* ─────────────────────── speech (TTS) ───────────────────────
     Web Speech API — uses the voices installed on the device.
     NEVER falls back to a wrong-language voice (that's how you
     get a British voice reading Finnish): if no matching voice
     exists we show a toast instead of mangling the word.
     The user can also force a specific voice per language.
  ─────────────────────────────────────────────────────────── */

  function speechOK() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window &&
      typeof window.SpeechSynthesisUtterance !== 'undefined';
  }

  function loadVoices() {
    if (!speechOK()) return [];
    return window.speechSynthesis.getVoices() || [];
  }

  function onVoicesChanged() {
    loadVoices();
    if (state.view === 'hub') render();
  }

  if (speechOK()) {
    try { window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged); } catch (e) {}
    loadVoices();
  }

  function voiceScore(v, lang) {
    var vl = String(v.lang || '').toLowerCase().replace(/_/g, '-');
    var lower = String(lang || '').toLowerCase();
    if (!vl || !lower) return -1;
    var prefix = lower.split('-')[0];
    var s;
    if (vl === lower) s = 100;
    else if (vl.indexOf(lower + '-') === 0 || lower.indexOf(vl + '-') === 0) s = 85;
    else if (vl.split('-')[0] === prefix) s = 70;
    else return -1;
    if (v.localService === false) s += 15;
    if (/natural|neural|online|enhanced/i.test(String(v.name || ''))) s += 10;
    return s;
  }

  function pickVoice(lang) {
    var voices = loadVoices();
    if (!voices.length || !lang) return null;
    var best = null, bestS = -1;
    for (var i = 0; i < voices.length; i++) {
      var s = voiceScore(voices[i], lang);
      if (s > bestS) { bestS = s; best = voices[i]; }
    }
    return bestS >= 0 ? best : null;
  }

  function findVoiceByURI(uri) {
    if (!uri) return null;
    var voices = loadVoices();
    for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === uri) return voices[i];
    return null;
  }

  function getVoicePref(code) {
    try { return localStorage.getItem(PREFIX + 'voice:' + code) || ''; } catch (e) { return ''; }
  }

  function setVoicePref(code, uri) {
    try {
      if (uri) localStorage.setItem(PREFIX + 'voice:' + code, uri);
      else localStorage.removeItem(PREFIX + 'voice:' + code);
    } catch (e) {}
  }

  function voiceMissing(lang) {
    if (!speechOK()) return false;
    if (!loadVoices().length) return false; // voices not loaded yet — don't warn
    return !pickVoice(lang);
  }

  function trySpeak(text, lang, code, humanName, announceMissing) {
    if (!speechOK() || !text) return false;
    var v = findVoiceByURI(code ? getVoicePref(code) : '');
    if (!v) v = pickVoice(lang);
    if (!v) {
      if (announceMissing) {
        showToast('No ' + (humanName || lang) + ' voice on this device — see the tip on the language screen');
      }
      return false;
    }
    try { window.speechSynthesis.cancel(); } catch (e) {}
    var u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = v.lang || lang || '';
    u.rate = 0.95;
    try { window.speechSynthesis.speak(u); } catch (e) {}
    return true;
  }

  function showToast(msg) {
    if (typeof document === 'undefined') return;
    var old = document.querySelector('.toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
    }, 3000);
  }

  function getSpeakPref() {
    try { return localStorage.getItem(PREFIX + 'speak') !== 'off'; } catch (e) { return true; }
  }

  function currentEntry() {
    var sess = null;
    if (state.view === 'basic') sess = state.basic;
    else if (state.view === 'tol') sess = state.tol;
    else if (state.view === 'testRun') sess = state.test;
    if (!sess || !sess.deck || !sess.deck.length) return null;
    return sess.deck[sess.i] || null;
  }

  function speakCurrent() {
    if (!getSpeakPref()) return;
    var l = L();
    var e = currentEntry();
    if (!l || !e) return;
    trySpeak(e.front, l.meta.ttsLang || l.meta.code, l.meta.code, l.meta.name, false);
  }

  /* ───────────────────────── loading ─────────────────────── */

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.text();
    });
  }

  function loadAll() {
    state.loadError = null;
    return fetchText('languages.json').then(function (txt) {
      var manifest = JSON.parse(txt);
      var files = Array.isArray(manifest) ? manifest : manifest.files;
      if (!Array.isArray(files) || !files.length) throw new Error('languages.json has no files listed');
      return Promise.all(files.map(function (f) {
        return fetchText(f).then(function (body) {
          return { path: f, body: body };
        });
      }));
    }).then(function (results) {
      var byCode = {};
      var issues = [];
      results.forEach(function (r) {
        var parsed = parseLanguageFile(r.body, r.path);
        issues = issues.concat(parsed.issues);
        var code = parsed.meta.code;
        if (!byCode[code]) {
          byCode[code] = {
            meta: parsed.meta,
            entries: [],
            posOrder: [],
            featOrder: []
          };
          Object.keys(parsed.meta.pos).forEach(function (k) { byCode[code].posOrder.push(k); });
          Object.keys(parsed.meta.feature).forEach(function (k) { byCode[code].featOrder.push(k); });
        } else {
          var lm = byCode[code].meta;
          Object.keys(parsed.meta.pos).forEach(function (k) {
            if (!(k in lm.pos)) { lm.pos[k] = parsed.meta.pos[k]; byCode[code].posOrder.push(k); }
          });
          Object.keys(parsed.meta.feature).forEach(function (k) {
            if (!(k in lm.feature)) { lm.feature[k] = parsed.meta.feature[k]; byCode[code].featOrder.push(k); }
          });
        }
        var seen = {};
        byCode[code].entries.forEach(function (e) { seen[e.id] = true; });
        parsed.entries.forEach(function (e) {
          if (seen[e.id]) {
            issues.push({ file: r.path, line: e.line, msg: 'Duplicate entry (same code|front|pos): ' + e.front });
            return;
          }
          seen[e.id] = true;
          byCode[code].entries.push(e);
        });
      });
      state.byCode = byCode;
      state.langs = Object.keys(byCode).map(function (c) { return byCode[c]; });
      state.allIssues = issues;
      state.loaded = true;
    }).catch(function (err) {
      state.loadError = err && err.message ? err.message : String(err);
    });
  }

  /* ───────────────────────── rendering ───────────────────── */

  var app = null;

  function render() {
    var html = '';
    if (state.loadError) html += bannerHTML(state.loadError);
    switch (state.view) {
      case 'home': html += homeHTML(); break;
      case 'hub': html += hubHTML(); break;
      case 'basic': html += studyHTML('basic'); break;
      case 'tol': html += studyHTML('tol'); break;
      case 'testSetup': html += testSetupHTML(); break;
      case 'testRun': html += testRunHTML(); break;
      case 'testResult': html += testResultHTML(); break;
      default: html += homeHTML();
    }
    app.innerHTML = html;
  }

  function bannerHTML(msg) {
    return '<div class="banner">⚠️ ' + esc(msg) +
      '<br>Local testing needs a server — run <code>python -m http.server</code> in this folder, ' +
      'then open <code>http://localhost:8000</code>. On GitHub Pages this works automatically.' +
      '</div>';
  }

  function themeBtn() {
    var t = document.documentElement.getAttribute('data-theme');
    var icon = t === 'dark' ? '☀️' : (t === 'light' ? '🌙' : '🌗');
    return '<button class="backbtn" data-act="theme" title="Theme" aria-label="Toggle theme">' + icon + '</button>';
  }

  function homeHTML() {
    if (!state.loaded) return '';
    var h = '<div class="spacer"></div>';
    h += '<h1 class="home-title">Language Flash Cards</h1>';
    h += '<p class="home-sub">Pick a language. Tap cards to flip, test yourself, clear the To&nbsp;Learn deck.</p>';
    h += '<div class="home-grid">';
    state.langs.forEach(function (l) {
      var n = Store.count(l.meta.code);
      h += '<button class="lang-card" data-act="go-lang" data-code="' + esc(l.meta.code) + '">' +
        '<span class="flag">' + esc(l.meta.emoji) + '</span>' +
        '<span class="info">' +
        '<span class="name">' + esc(l.meta.name) + '</span>' +
        '<div class="meta">' + l.entries.length + ' cards · ' + esc(l.meta.backLabel) + ' → ' + esc(l.meta.frontLabel) + '</div>' +
        (n > 0 ? '<span class="tl">To Learn: ' + n + '</span>' : '') +
        '</span>' +
        '<span class="arrow">›</span>' +
        '</button>';
    });
    h += '</div>';
    h += '<div class="home-actions">' +
      '<button class="btn small" data-act="export">⬇︎ Export progress</button>' +
      '<button class="btn small" data-act="import">⬆︎ Import progress</button>' +
      '<button class="btn small" data-act="reload">↻ Reload data</button>' +
      (speechOK() ? '<button class="btn small" data-act="speak-pref" aria-label="Toggle audio">' + (getSpeakPref() ? '🔊 Audio on' : '🔇 Audio off') + '</button>' : '') +
      themeBtn() +
      '</div>';
    var errCount = state.allIssues.filter(function (i) { return !/derived/.test(i.msg); }).length;
    h += '<div class="home-foot">Decks edited in data/*.txt · ' +
      (errCount ? '<b style="color:var(--bad)">' + errCount + ' file issue(s) — run node tools/validate.js</b>' : 'files OK') +
      '<br>Add a language: drop a .txt in data/ and list it in languages.json.</div>';
    h += '<div class="spacer"></div>';
    return h;
  }

  function voiceSelectHTML(l) {
    var voices = loadVoices();
    var lang = l.meta.ttsLang || l.meta.code;
    var saved = getVoicePref(l.meta.code);
    var h = '<select class="voicesel" id="voicesel" aria-label="Voice for ' + esc(l.meta.name) + '">';
    h += '<option value=""' + (saved ? '' : ' selected') + '>Auto — best matching voice</option>';
    if (!voices.length) {
      h += '<option disabled>Loading voices…</option>';
    } else {
      var sorted = voices.slice().sort(function (a, b) {
        return voiceScore(b, lang) - voiceScore(a, lang);
      });
      sorted.forEach(function (v) {
        var sc = voiceScore(v, lang);
        var tag = sc >= 85 ? ' ✓ speaks this language' : (sc >= 0 ? ' ~ maybe' : '');
        h += '<option value="' + esc(v.voiceURI) + '"' + (saved === v.voiceURI ? ' selected' : '') + '>' +
          esc(v.name) + ' (' + esc(v.lang || '?') + ')' +
          (v.localService === false ? ' · online' : '') + tag + '</option>';
      });
    }
    h += '</select>';
    h += '<p class="home-foot">✓ = proper voice for this language. Tap 🔊 on a card to test. On Samsung/Android, a "· online" voice sounds best if one is listed.</p>';
    return h;
  }

  function hubHTML() {
    var l = L();
    if (!l) { state.view = 'home'; return homeHTML(); }
    var counts = { all: l.entries.length };
    l.posOrder.forEach(function (k) { counts[k] = 0; });
    l.entries.forEach(function (e) { if (counts[e.pos] != null) counts[e.pos]++; });
    var tl = Store.count(l.meta.code);

    var h = topbarHTML(l.meta.emoji + ' ' + esc(l.meta.name), l.entries.length + ' cards');
    h += '<div class="section-label">Word type</div><div class="chiprow">';
    h += '<button class="chip' + (state.posFilter === 'all' ? ' active' : '') + '" data-act="filter" data-pos="all">All <span class="count">' + counts.all + '</span></button>';
    l.posOrder.forEach(function (k) {
      if (!counts[k]) return;
      h += '<button class="chip' + (state.posFilter === k ? ' active' : '') + '" data-act="filter" data-pos="' + esc(k) + '">' +
        esc(posLabel(l, k)) + ' <span class="count">' + counts[k] + '</span></button>';
    });
    h += '</div>';

    h += '<div class="chiprow">';
    h += '<button class="chip' + (state.shuffle ? ' active' : '') + '" data-act="shuffle">🔀 Shuffle ' + (state.shuffle ? 'on' : 'off') + '</button>';
    h += '</div>';
    if (speechOK()) {
      var hubLang = l.meta.ttsLang || l.meta.code;
      h += '<div class="section-label">Voice — ' + esc(l.meta.name) + '</div>';
      h += voiceSelectHTML(l);
      if (voiceMissing(hubLang)) {
        h += '<p class="home-foot">⚠ No ' + esc(l.meta.name) + ' voice found on this device — the 🔊 button stays silent instead of using a wrong voice. ' +
          'Android/Samsung: Settings → General management → Text-to-speech → ⚙ → Install voice data → download Portuguese &amp; Finnish. ' +
          'Windows: Settings → Time &amp; Language → Speech. Apple devices usually have the voices built in.</p>';
      }
    }

    var pool = entriesFor(l).length;
    h += '<div class="mode-grid">' +
      '<button class="mode-btn" data-act="start-basic"><span class="ico">🃏</span><span><span class="t">Flash cards</span><div class="d">See a word, tap to reveal the meaning</div></span></button>' +
      '<button class="mode-btn" data-act="go-testsetup"><span class="ico">📝</span><span><span class="t">Test me</span><div class="d">10 / 20 / 30 cards · score + wrong words go to To Learn</div></span></button>' +
      '<button class="mode-btn" data-act="start-tol"><span class="ico">⭐</span><span><span class="t">To Learn (' + tl + ')</span><div class="d">Drill only your weak cards</div></span></button>' +
      '</div>';
    h += '<p class="home-foot">Current filter: ' +
      (state.posFilter === 'all' ? 'all word types' : esc(posLabel(l, state.posFilter))) +
      ' · ' + pool + ' card(s) in pool</p>';
    return h;
  }

  function topbarHTML(title, sub, showBack) {
    var h = '<div class="topbar">';
    if (showBack !== false) h += '<button class="backbtn" data-act="go-home" aria-label="Back">←</button>';
    h += '<h1>' + title + (sub ? ' <span class="sub">· ' + esc(sub) + '</span>' : '') + '</h1>';
    if (speechOK()) {
      h += '<button class="backbtn" data-act="speak-pref" title="Mute / unmute audio" aria-label="Toggle audio">' + (getSpeakPref() ? '🔊' : '🔇') + '</button>';
    }
    h += themeBtn();
    h += '</div>';
    return h;
  }

  /* ── card faces ─────────────────────────────────────────── */

  var LONG_KEYS = { conj: 1, pres: 1, conjugation: 1 };

  function frontFaceHTML(l, e, opts) {
    opts = opts || {};
    var starred = Store.has(l.meta.code, e.id);
    var ttsCode = esc(l.meta.ttsLang || l.meta.code);
    var h = '<div class="face front">';
    h += '<div class="face-top">';
    if (speechOK()) {
      h += '<button class="speak-btn" data-act="speak" data-text="' + esc(e.front) + '" data-lang="' + ttsCode + '" data-code="' + esc(l.meta.code) + '" data-name="' + esc(l.meta.name) + '" aria-label="Hear the word">🔊</button>';
    } else {
      h += '<span></span>';
    }
    if (opts.star !== false) {
      h += '<button class="star' + (starred ? ' on' : '') + '" data-act="star" data-id="' + esc(e.id) + '" aria-label="To Learn">' + (starred ? '★' : '☆') + '</button>';
    }
    h += '</div>';
    h += '<div class="word">' + esc(e.front) + '</div>';
    h += '<div class="pos-line">' + esc(posLabel(l, e.pos)) +
      (featVal(e, 'pron') ? ' · ' + esc(featVal(e, 'pron')) : '') + '</div>';
    h += '<div class="hint">tap to flip' + (speechOK() ? ' · 🔊 to hear' : '') + '</div>';
    h += '</div>';
    return h;
  }

  function backFaceHTML(l, e) {
    var h = '<div class="face back">';
    h += '<div class="back-head"><div class="back-word">' + esc(e.front) + '</div></div>';
    h += '<div class="back-meaning">' + esc(e.back) + '</div>';

    var chips = '', forms = '';
    e.features.forEach(function (f) {
      if (!f.value) return;
      if (LONG_KEYS[f.key] || f.value.length > 22) {
        var items = f.value.split(',').map(function (s) { return '<li>' + esc(s.trim()) + '</li>'; }).join('');
        forms += '<div class="forms"><div class="forms-title">' + esc(featLabel(l, f.key)) + '</div><ul>' + items + '</ul></div>';
      } else {
        chips += '<span class="gchip"><b>' + esc(featLabel(l, f.key)) + ':</b> ' + esc(f.value) + '</span>';
      }
    });
    if (chips) h += '<div class="chips-back">' + chips + '</div>';
    h += forms;

    if (e.example || e.exampleTrans) {
      h += '<div class="example">';
      if (e.example) h += '<div class="ex">' + esc(e.example) + '</div>';
      if (e.exampleTrans) h += '<div class="ex-tr">' + esc(e.exampleTrans) + '</div>';
      h += '</div>';
    }
    h += '<div class="hint">tap to flip back</div>';
    h += '</div>';
    return h;
  }

  /* ── basic / to-learn study views ───────────────────────── */

  function studyHTML(mode) {
    var l = L();
    if (!l) { state.view = 'home'; return homeHTML(); }
    var sess = mode === 'basic' ? state.basic : state.tol;
    if (!sess || !sess.deck.length) {
      var msg = mode === 'tol'
        ? '<div class="empty"><span class="big-ico">⭐</span>Your To Learn deck is empty.<br>Star cards in Flash cards mode, or get words wrong in a test — they land here.</div>'
        : '<div class="empty"><span class="big-ico">🃏</span>No cards match this filter.</div>';
      return topbarHTML(mode === 'tol' ? '⭐ To Learn' : '🃏 Flash cards') + msg +
        '<button class="btn block" data-act="go-hub">Back</button>';
    }

    var e = sess.deck[sess.i];
    var title = mode === 'tol' ? '⭐ To Learn' : '🃏 Flash cards';
    var h = topbarHTML(title, (sess.i + 1) + ' / ' + sess.deck.length);
    h += '<div class="counter" id="counter-line">' + esc(e.front) + ' — ' + (sess.flipped ? esc(e.back) : '?') + '</div>';
    h += '<div class="card-scene"><div class="card' + (sess.flipped ? ' flipped' : '') + '" data-act="flip">' +
      frontFaceHTML(l, e, { star: mode === 'basic' }) +
      backFaceHTML(l, e) +
      '</div></div>';
    h += '<div class="navrow">' +
      '<button class="btn nav" data-act="prev" aria-label="Previous">‹</button>' +
      '<button class="btn flip-btn" data-act="flip">Flip</button>' +
      '<button class="btn nav" data-act="next" aria-label="Next">›</button>' +
      '</div>';
    h += '<div class="subrow">' +
      '<button class="btn small ghost" data-act="reshuffle">🔀 Shuffle</button>' +
      '<span class="swipehint">swipe card to move</span>' +
      '</div>';
    if (mode === 'tol') {
      h += '<div style="margin-top:10px"><button class="btn block" data-act="go-testsetup">📝 Test these cards</button></div>';
    }
    return h;
  }

  /* ── test mode ──────────────────────────────────────────── */

  function testSetupHTML() {
    var l = L();
    if (!l) { state.view = 'home'; return homeHTML(); }
    var pool = entriesFor(l).length;
    var tlPool = tolearnEntries(l).length;
    var cfg = state.testCfg || { len: 10, src: 'all' };

    var h = topbarHTML('📝 Test me');
    h += '<div class="section-label">How many cards?</div><div class="pickrow">';
    [10, 20, 30].forEach(function (n) {
      h += '<button class="btn' + (cfg.len === n ? ' primary' : '') + '" data-act="test-len" data-n="' + n + '"><span class="big">' + n + '</span>cards</button>';
    });
    h += '</div>';
    h += '<div class="section-label">From</div><div class="pickrow">' +
      '<button class="btn' + (cfg.src === 'all' ? ' primary' : '') + '" data-act="test-src" data-src="all">All words<span class="d" style="font-size:12px;color:var(--text-dim)"> (' + pool + ' under filter)</span></button>' +
      '<button class="btn' + (cfg.src === 'tl' ? ' primary' : '') + '" data-act="test-src" data-src="tl">To Learn<span class="d" style="font-size:12px;color:var(--text-dim)"> (' + tlPool + ')</span></button>' +
      '</div>';
    h += '<div style="height:12px"></div>';
    h += '<button class="btn primary block" data-act="test-start" style="min-height:56px">Start test</button>';
    h += '<p class="home-foot">Flip each card, then honestly mark ✗ Wrong or ✓ Knew it. Wrong cards join To Learn; cards you now know leave it.</p>';
    return h;
  }

  function testRunHTML() {
    var l = L();
    var t = state.test;
    if (!l || !t) { state.view = 'home'; return homeHTML(); }
    if (!t.deck.length) {
      return topbarHTML('📝 Test') +
        '<div class="empty"><span class="big-ico">📝</span>Nothing to test here yet.</div>' +
        '<button class="btn block" data-act="go-hub">Back</button>';
    }
    var e = t.deck[t.i];
    var done = t.right.length + t.wrong.length;
    var pct = Math.round((done / t.deck.length) * 100);

    var h = topbarHTML('📝 Test', (t.i + 1) + ' / ' + t.deck.length);
    h += '<div class="progressbar"><div style="width:' + pct + '%"></div></div>';
    h += '<div class="counter" id="counter-line">✓ ' + t.right.length + ' · ✗ ' + t.wrong.length + '</div>';
    h += '<div class="card-scene"><div class="card' + (t.flipped ? ' flipped' : '') + '" data-act="flip">' +
      frontFaceHTML(l, e, { star: false }) +
      backFaceHTML(l, e) +
      '</div></div>';
    h += '<div id="test-actions">' + testActionsHTML() + '</div>';
    return h;
  }

  function testActionsHTML() {
    return state.test && state.test.flipped
      ? '<div class="test-actions"><button class="btn bad" data-act="answer" data-ok="0">✗ Wrong</button><button class="btn good" data-act="answer" data-ok="1">✓ Knew it</button></div>'
      : '<button class="btn block" data-act="flip" style="min-height:56px">Show answer</button>';
  }

  function testResultHTML() {
    var t = state.test;
    var r = t && t.result;
    if (!r) { state.view = 'home'; return homeHTML(); }
    var total = r.right.length + r.wrong.length;
    var score = total ? Math.round((r.right.length / total) * 100) : 0;

    var h = topbarHTML('📝 Results', null, false);
    h += '<div class="score-card">' +
      '<div class="big">' + score + '%</div>' +
      '<div class="frac">' + r.right.length + ' / ' + total + ' correct</div>' +
      '<div class="note">' +
      (r.added.length ? '<b class="add">' + r.added.length + ' added to To Learn</b>' : '') +
      (r.added.length && r.cleared.length ? ' · ' : '') +
      (r.cleared.length ? '<b class="cleared">' + r.cleared.length + ' cleared from To Learn</b>' : '') +
      (!r.added.length && !r.cleared.length ? 'Nice — nothing to review.' : '') +
      '</div></div>';

    if (r.wrong.length) {
      h += '<div class="section-label">What you got wrong</div><div class="wronglist">';
      r.wrong.forEach(function (e) {
        var l = L();
        var g = e.features.filter(function (f) { return f.key !== 'note' && f.value && f.value.length <= 26; })
          .map(function (f) { return esc(featLabel(l, f.key)) + ': ' + esc(f.value); }).join(' · ');
        h += '<div class="wrongitem"><div class="w">' + esc(e.front) + '</div>' +
          '<div class="m">' + esc(e.back) + '</div>' +
          (g ? '<div class="g">' + g + '</div>' : '') + '</div>';
      });
      h += '</div>';
      h += '<button class="btn primary block" data-act="retry-wrong" style="margin-bottom:8px">🔁 Drill the ' + r.wrong.length + ' again</button>';
    }
    h += '<button class="btn block" data-act="go-hub">Done</button>';
    return h;
  }

  /* ───────────────────────── sessions ────────────────────── */

  function startBasic() {
    var l = L();
    var deck = entriesFor(l);
    if (state.shuffle) deck = shuffleArr(deck);
    state.basic = { deck: deck, i: 0, flipped: false };
    state.view = 'basic';
  }

  function startTol() {
    var l = L();
    var deck = tolearnEntries(l);
    if (state.shuffle) deck = shuffleArr(deck);
    state.tol = { deck: deck, i: 0, flipped: false };
    state.view = 'tol';
  }

  function startTest() {
    var l = L();
    var cfg = state.testCfg || { len: 10, src: 'all' };
    var pool = cfg.src === 'tl' ? tolearnEntries(l) : entriesFor(l);
    if (state.shuffle) pool = shuffleArr(pool);
    var deck = pool.slice(0, cfg.len);
    state.test = { deck: deck, i: 0, flipped: false, right: [], wrong: [], result: null };
    state.view = 'testRun';
  }

  function answer(ok) {
    var t = state.test;
    var e = t.deck[t.i];
    if (ok) t.right.push(e); else t.wrong.push(e);
    t.flipped = false;
    if (t.i + 1 < t.deck.length) {
      t.i++;
    } else {
      finishTest();
    }
  }

  function finishTest() {
    var l = L();
    var code = l.meta.code;
    var added = [], cleared = [];
    state.test.wrong.forEach(function (e) {
      if (Store.add(code, e.id)) added.push(e);
    });
    state.test.right.forEach(function (e) {
      if (Store.remove(code, e.id)) cleared.push(e);
    });
    state.test.result = { right: state.test.right, wrong: state.test.wrong, added: added, cleared: cleared };
    state.view = 'testResult';
  }

  function retryWrong() {
    var t = state.test;
    state.test = {
      deck: shuffleArr(t.result.wrong),
      i: 0, flipped: false, right: [], wrong: [], result: null
    };
    state.view = 'testRun';
  }

  function move(dir) {
    var sess = state.view === 'basic' ? state.basic : (state.view === 'tol' ? state.tol : null);
    if (!sess || !sess.deck.length) return;
    sess.i = (sess.i + dir + sess.deck.length) % sess.deck.length;
    sess.flipped = false;
  }

  /* ───────────────────────── actions ─────────────────────── */

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next;
    if (cur === 'dark') next = 'light';
    else if (cur === 'light') next = 'dark';
    else next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(PREFIX + 'theme', next); } catch (e) {}
    render();
  }

  function exportProgress() {
    var data = Store.exportAll();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flashcards-progress-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function importProgress() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = Store.importMerge(JSON.parse(reader.result));
          alert('Imported ' + n + ' card(s) into To Learn decks.');
          render();
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
      };
      reader.readAsText(f);
    };
    input.click();
  }

  function handleClick(ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');

    switch (act) {
      case 'theme': toggleTheme(); return;
      case 'export': exportProgress(); return;
      case 'import': importProgress(); return;
      case 'reload':
        loadAll().then(function () { render(); });
        return;
      case 'go-home':
        state.view = 'home'; render(); return;
      case 'go-hub':
        state.view = 'hub'; render(); return;
      case 'go-lang':
        state.code = el.getAttribute('data-code');
        state.posFilter = 'all';
        state.view = 'hub';
        render(); return;
      case 'filter':
        state.posFilter = el.getAttribute('data-pos');
        render(); return;
      case 'shuffle':
        state.shuffle = !state.shuffle;
        render(); return;
      case 'start-basic': startBasic(); render(); speakCurrent(); return;
      case 'start-tol': startTol(); render(); speakCurrent(); return;
      case 'speak':
        trySpeak(
          el.getAttribute('data-text') || '',
          el.getAttribute('data-lang') || '',
          el.getAttribute('data-code') || '',
          el.getAttribute('data-name') || '',
          true
        );
        return;
      case 'speak-pref': {
        var nowOn = !getSpeakPref();
        try { localStorage.setItem(PREFIX + 'speak', nowOn ? 'on' : 'off'); } catch (e) {}
        if (!nowOn && speechOK()) { try { window.speechSynthesis.cancel(); } catch (e) {} }
        showToast(nowOn ? '🔊 Audio on' : '🔇 Audio off');
        render();
        if (nowOn) speakCurrent();
        return;
      }
      case 'go-testsetup': state.view = 'testSetup'; render(); return;
      case 'test-len':
        state.testCfg = state.testCfg || { len: 10, src: 'all' };
        state.testCfg.len = parseInt(el.getAttribute('data-n'), 10);
        render(); return;
      case 'test-src':
        state.testCfg = state.testCfg || { len: 10, src: 'all' };
        state.testCfg.src = el.getAttribute('data-src');
        render(); return;
      case 'test-start': startTest(); render(); speakCurrent(); return;
      case 'answer': answer(el.getAttribute('data-ok') === '1'); render(); speakCurrent(); return;
      case 'retry-wrong': retryWrong(); render(); speakCurrent(); return;
      case 'flip': flipCard(); return;
      case 'next': move(1); render(); speakCurrent(); return;
      case 'prev': move(-1); render(); speakCurrent(); return;
      case 'reshuffle': {
        var sess = state.view === 'basic' ? state.basic : state.tol;
        if (sess) {
          var cur = sess.deck[sess.i];
          sess.deck = shuffleArr(sess.deck);
          var idx = sess.deck.indexOf(cur);
          sess.i = idx >= 0 ? idx : 0;
          sess.flipped = false;
        }
        render(); return;
      }
      case 'star': {
        var l = L();
        var id = el.getAttribute('data-id');
        if (Store.has(l.meta.code, id)) Store.remove(l.meta.code, id);
        else Store.add(l.meta.code, id);
        render(); return;
      }
    }
  }

  function flipCard() {
    var sess = null;
    if (state.view === 'basic') sess = state.basic;
    else if (state.view === 'tol') sess = state.tol;
    else if (state.view === 'testRun') sess = state.test;
    if (!sess) return;
    sess.flipped = !sess.flipped;
    var card = document.querySelector('.card');
    if (card) card.classList.toggle('flipped', sess.flipped);
    var counter = document.getElementById('counter-line');
    if (counter && (state.view === 'basic' || state.view === 'tol')) {
      var e = sess.deck[sess.i];
      counter.textContent = e.front + ' — ' + (sess.flipped ? e.back : '?');
    }
    if (state.view === 'testRun') {
      var slot = document.getElementById('test-actions');
      if (slot) slot.innerHTML = testActionsHTML();
    }
  }

  function handleKeys(ev) {
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    var k = ev.key;
    if (state.view === 'basic' || state.view === 'tol') {
      if (k === ' ' || k === 'Enter') { ev.preventDefault(); flipCard(); }
      else if (k === 'ArrowRight') { ev.preventDefault(); move(1); render(); speakCurrent(); }
      else if (k === 'ArrowLeft') { ev.preventDefault(); move(-1); render(); speakCurrent(); }
    } else if (state.view === 'testRun') {
      if (k === ' ' || k === 'Enter') {
        ev.preventDefault();
        if (state.test && !state.test.flipped) flipCard();
      } else if (state.test && state.test.flipped && (k === '1' || k === '2')) {
        ev.preventDefault();
        answer(k === '2');
        render();
      }
    }
  }

  /* touch swipe on cards (and the nav row under them) */
  var touchX = null, touchY = null, swiped = false;
  function swipeZone(ev) {
    var t = ev.target;
    if (!t || !t.closest) return null;
    return t.closest('.card-scene') || t.closest('.navrow') || null;
  }
  function onTouchStart(ev) {
    if (!swipeZone(ev)) { touchX = null; return; }
    touchX = ev.changedTouches[0].clientX;
    touchY = ev.changedTouches[0].clientY;
    swiped = false;
  }
  function onTouchMove(ev) {
    if (touchX == null || swiped) return;
    var dx = ev.changedTouches[0].clientX - touchX;
    var dy = ev.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) swiped = true;
  }
  function onTouchEnd(ev) {
    if (touchX == null) return;
    var dx = ev.changedTouches[0].clientX - touchX;
    var dy = ev.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy)) return;
    if (state.view !== 'basic' && state.view !== 'tol') return;
    ev.preventDefault();
    swiped = true;
    move(dx < 0 ? 1 : -1);
    render();
    speakCurrent();
  }

  /* ───────────────────────── boot ────────────────────────── */

  function boot() {
    app = document.getElementById('app');
    try {
      var t = localStorage.getItem(PREFIX + 'theme');
      if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}

    app.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeys);
    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.id === 'voicesel' && state.code) {
        setVoicePref(state.code, t.value);
        render();
      }
    });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: false });

    /* offline web app (PWA) */
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
        (location.protocol === 'https:' ||
         location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    loadAll().then(render);
  }

  /* ───────────────────────── export ──────────────────────── */

  var api = {
    parseLanguageFile: parseLanguageFile,
    parseFeatures: parseFeatures,
    parseKeyValueList: parseKeyValueList,
    hashId: hashId
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LFC = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : global);
