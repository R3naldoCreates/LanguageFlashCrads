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
      var out = {}, srs = {}, acc = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX + 'tl:') === 0) {
          try { out[k.slice((PREFIX + 'tl:').length)] = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
        } else if (k && k.indexOf(PREFIX + 'srs:') === 0) {
          try { srs[k.slice((PREFIX + 'srs:').length)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) {}
        } else if (k && k.indexOf(PREFIX + 'acc:') === 0) {
          try { acc[k.slice((PREFIX + 'acc:').length)] = JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) {}
        }
      }
      return {
        app: 'language-flash-cards', version: 2, exported: new Date().toISOString(),
        tolearn: out, srs: srs, acc: acc,
        daily: dailyLoad(), goal: getGoal(),
        missing: missingExport(),
        extra: extraExport(),
        lexfiles: lextextExport()
      };
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
      if (data.srs && typeof data.srs === 'object') {
        Object.keys(data.srs).forEach(function (code) {
          var cur = srsLoad(code);
          var inc = data.srs[code] || {};
          Object.keys(inc).forEach(function (id) {
            var a = cur[id], b = inc[id];
            if (!a || (b && b.n > a.n)) cur[id] = b;
          });
          srsSave(code, cur);
        });
      }
      if (data.acc && typeof data.acc === 'object') {
        Object.keys(data.acc).forEach(function (code) {
          var cur = accLoad(code), inc = data.acc[code] || {};
          var merged = { right: Math.max(cur.right || 0, inc.right || 0), wrong: Math.max(cur.wrong || 0, inc.wrong || 0) };
          try { localStorage.setItem(PREFIX + 'acc:' + code, JSON.stringify(merged)); } catch (e) {}
        });
      }
      if (data.daily && typeof data.daily === 'object') {
        var map = dailyLoad();
        Object.keys(data.daily).forEach(function (k) {
          if (!map[k] || (data.daily[k].n || 0) > (map[k].n || 0)) map[k] = data.daily[k];
        });
        dailySave(map);
      }
      if (data.goal > 0) setGoal(data.goal);
      if (data.missing && typeof data.missing === 'object') {
        Object.keys(data.missing).forEach(function (code) {
          (data.missing[code] || []).forEach(function (w) {
            if (typeof w === 'string') missingAdd(code, w);
          });
        });
      }
      if (data.extra && typeof data.extra === 'object') {
        Object.keys(data.extra).forEach(function (code) {
          (data.extra[code] || []).forEach(function (e) {
            if (e && e.id && e.front && e.back) extraAdd(code, e);
          });
        });
      }
      if (data.lexfiles && typeof data.lexfiles === 'object') {
        Object.keys(data.lexfiles).forEach(function (code) {
          if (!lextextGet(code) && typeof data.lexfiles[code] === 'string') {
            lextextSet(code, data.lexfiles[code]);
          }
        });
      }
      return changed;
    }
  };

  /* ───────────────── SRS / daily goal / accuracy ─────────────
     Spaced repetition: each card has a stage 0..5 with growing
     review intervals. "Known" = stage >= 3. Wrong → stage 0.
     Daily goal: unique cards studied per day + streak.
  ─────────────────────────────────────────────────────────── */

  var SRS_INTERVALS = [0, 1, 3, 7, 14, 30]; /* days per stage */

  function srsLoad(code) {
    try { return JSON.parse(localStorage.getItem(PREFIX + 'srs:' + code) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function srsSave(code, map) {
    try { localStorage.setItem(PREFIX + 'srs:' + code, JSON.stringify(map)); } catch (e) {}
  }

  function srsGet(code, id) {
    var m = srsLoad(code);
    return m[id] || { s: 0, d: 0, n: 0 };
  }

  function srsMark(code, id, ok) {
    var m = srsLoad(code);
    var rec = m[id] || { s: 0, d: 0, n: 0 };
    if (ok) {
      rec.s = Math.min(5, rec.s + 1);
      rec.d = Date.now() + SRS_INTERVALS[rec.s] * 86400000;
    } else {
      rec.s = 0;
      rec.d = Date.now();
    }
    rec.n++;
    m[id] = rec;
    srsSave(code, m);
  }

  function masteryClass(rec) {
    if (rec.n === 0) return 'new';
    if (rec.s >= 3) return 'known';
    return 'learning';
  }

  function srsStats(lang) {
    var code = lang.meta.code;
    var m = srsLoad(code);
    var out = { fresh: 0, learning: 0, known: 0, due: 0 };
    var now = Date.now();
    lang.entries.forEach(function (e) {
      var rec = m[e.id];
      if (!rec || rec.n === 0) { out.fresh++; return; }
      if (rec.s >= 3) out.known++; else out.learning++;
      if (rec.d <= now) out.due++;
    });
    out.total = lang.entries.length;
    return out;
  }

  function dueEntries(lang) {
    var code = lang.meta.code;
    var m = srsLoad(code);
    var now = Date.now();
    var due = [], fresh = [];
    lang.entries.forEach(function (e) {
      var rec = m[e.id];
      if (!rec || rec.n === 0) { fresh.push(e); return; }
      if (rec.d <= now) due.push({ e: e, s: rec.s, d: rec.d });
    });
    due.sort(function (a, b) { return a.s - b.s || a.d - b.d; });
    return { due: due.map(function (x) { return x.e; }), fresh: fresh };
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function dayKey(offset) {
    var d = new Date();
    d.setDate(d.getDate() - offset);
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function dailyLoad() {
    try { return JSON.parse(localStorage.getItem(PREFIX + 'daily') || '{}') || {}; }
    catch (e) { return {}; }
  }

  function dailySave(map) {
    try {
      var keys = Object.keys(map);
      if (keys.length > 90) {
        keys.sort();
        keys.slice(0, keys.length - 90).forEach(function (k) { delete map[k]; });
      }
      localStorage.setItem(PREFIX + 'daily', JSON.stringify(map));
    } catch (e) {}
  }

  /* mark one card studied today (unique per day, counts toward goal) */
  function markStudy(code, id) {
    var map = dailyLoad();
    var key = todayKey();
    var rec = map[key] || { n: 0, ids: {} };
    if (!rec.ids) rec.ids = {};
    if (rec.ids[id]) return rec.n;
    rec.ids[id] = 1;
    rec.n++;
    map[key] = rec;
    dailySave(map);
    return rec.n;
  }

  function todayStudied() {
    var rec = dailyLoad()[todayKey()];
    return rec ? (rec.n || 0) : 0;
  }

  function getGoal() {
    try {
      var g = parseInt(localStorage.getItem(PREFIX + 'goal'), 10);
      return g > 0 ? g : 10;
    } catch (e) { return 10; }
  }

  function setGoal(g) {
    try {
      if (g > 0) localStorage.setItem(PREFIX + 'goal', String(g));
      else localStorage.removeItem(PREFIX + 'goal');
    } catch (e) {}
  }

  function streakInfo() {
    var goal = getGoal();
    var map = dailyLoad();
    var best = 0, run = 0, i;
    var keys = Object.keys(map);
    keys.sort();
    for (i = 0; i < keys.length; i++) {
      if ((map[keys[i]].n || 0) >= goal) { run++; if (run > best) best = run; }
      else run = 0;
    }
    var current = 0;
    var start = (map[dayKey(0)] && (map[dayKey(0)].n || 0) >= goal) ? 0 : 1;
    if (start === 1 && !(map[dayKey(1)] && (map[dayKey(1)].n || 0) >= goal)) {
      return { current: 0, best: best, doneToday: map[dayKey(0)] ? (map[dayKey(0)].n || 0) >= goal : false };
    }
    for (i = start; i < 400; i++) {
      var r = map[dayKey(i)];
      if (r && (r.n || 0) >= goal) current++;
      else break;
    }
    return { current: current, best: best, doneToday: map[dayKey(0)] ? (map[dayKey(0)].n || 0) >= goal : false };
  }

  function accLoad(code) {
    try { return JSON.parse(localStorage.getItem(PREFIX + 'acc:' + code) || '{}') || { right: 0, wrong: 0 }; }
    catch (e) { return { right: 0, wrong: 0 }; }
  }

  function accAdd(code, ok) {
    var a = accLoad(code);
    if (ok) a.right = (a.right || 0) + 1; else a.wrong = (a.wrong || 0) + 1;
    try { localStorage.setItem(PREFIX + 'acc:' + code, JSON.stringify(a)); } catch (e) {}
  }

  function getRevPref(code) {
    try { return localStorage.getItem(PREFIX + 'rev:' + code) === 'on'; } catch (e) { return false; }
  }

  function setRevPref(code, on) {
    try {
      if (on) localStorage.setItem(PREFIX + 'rev:' + code, 'on');
      else localStorage.removeItem(PREFIX + 'rev:' + code);
    } catch (e) {}
  }

  function isRev(l) { return getRevPref(l.meta.code); }

  /* which word is the prompt / which is the answer (reverse mode flips them) */
  function promptText(l, e) { return isRev(l) ? e.back : e.front; }
  function answerText(l, e) { return isRev(l) ? e.front : e.back; }

  function normalizeAns(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
      .replace(/[.!?…]+$/g, '');
  }

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
    search: '',
    botBusy: false,
    basic: null,
    test: null,
    testCfg: { len: 10, src: 'all', typing: false }
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

  function copyFallback(txt) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('📋 Copied to clipboard');
    } catch (e) { showToast('Copy failed — long-press to select'); }
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
      /* merge cards created by the bot on earlier runs */
      state.langs.forEach(mergeExtras);
      /* built-in word bank per language (optional file) */
      state.allIssues = issues;
      return Promise.all(state.langs.map(function (l) {
        return fetchText('data/lexicon-' + l.meta.code + '.txt').then(function (body) {
          l.lexicon = parseLexiconText(body);
        }).catch(function () { l.lexicon = []; });
      }));
    }).then(function () {
      /* bot: pull in words from the phone word file on every launch */
      state.langs.forEach(function (l) {
        try { resolveMissing(l, 'file'); } catch (e) {}
      });
      state.loaded = true;
    }).catch(function (err) {
      state.loadError = err && err.message ? err.message : String(err);
    });
  }

  /* ── practice selection (theme + word range + how many) ──────
        Remembered per language in localStorage. Choosing a chip
        only changes the setting — nothing starts by itself.  */

  var THEME_LABELS = {
    basico: 'Basics', familia: 'Family & people', comida: 'Food & drink',
    casa: 'Home & daily life', lugares: 'Places & city', viagem: 'Travel',
    trabalho: 'Work & money', tecnologia: 'Tech', sentimento: 'Feelings',
    social: 'Social phrases', corpo: 'Body & health', vestuario: 'Clothes & shopping',
    natureza: 'Nature & weather', escola: 'School & study', animal: 'Animals',
    acoes: 'Everyday actions', descricoes: 'Descriptions', tempo: 'Time',
    geral: 'General', divertimento: 'Fun & hobbies'
  };

  var COUNT_CHOICES = [10, 20, 30, 50, 100, 0]; /* 0 = all */

  function themeLabel(t) { return THEME_LABELS[t] || t; }

  function getPick(code) {
    var p;
    try { p = JSON.parse(localStorage.getItem(PREFIX + 'pick:' + code) || '{}'); } catch (e) { p = {}; }
    if (!p || typeof p !== 'object') p = {};
    var themes = Array.isArray(p.themes) ? p.themes.slice() : [];
    if (!themes.length && p.theme && p.theme !== 'all') themes = [p.theme];
    return {
      range: String(p.range != null ? p.range : 'all'),
      themes: themes,
      count: typeof p.count === 'number' ? p.count : 30
    };
  }

  function setPick(code, key, val) {
    var p = getPick(code);
    if (key === 'themes') p.themes = val;
    else if (key === 'theme') p.themes = (val && val !== 'all') ? [val] : [];
    else p[key] = val;
    try { localStorage.setItem(PREFIX + 'pick:' + code, JSON.stringify(p)); } catch (e) {}
  }

  function getOpenSec() {
    try {
      var o = JSON.parse(localStorage.getItem(PREFIX + 'ui:open') || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function setOpenSec(id, open) {
    var o = getOpenSec();
    if (open) o[id] = 1; else delete o[id];
    try { localStorage.setItem(PREFIX + 'ui:open', JSON.stringify(o)); } catch (e) {}
  }

  function themeList(l) {
    var counts = {};
    l.entries.forEach(function (e) {
      var t = featVal(e, 'theme');
      if (t) counts[t] = (counts[t] || 0) + 1;
    });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  }

  function rangeList(l) {
    var out = [];
    var base = typeof l.baseCount === 'number' ? l.baseCount : l.entries.length;
    var total = l.entries.length;
    for (var b = 0; b * 100 < base; b++) {
      var from = b * 100 + 1;
      var to = Math.min(b * 100 + 100, base);
      out.push({ id: String(b), b: b, from: from, to: to, personal: false, size: to - from + 1 });
    }
    if (total > base) {
      out.push({
        id: 'p', b: -1, from: base + 1, to: total,
        personal: true, size: total - base
      });
    }
    return out;
  }

  function rangeLabel(l, id) {
    var r = null;
    rangeList(l).forEach(function (x) { if (x.id === id) r = x; });
    return r ? (r.personal ? 'Personal' : (r.from + '–' + r.to)) : '';
  }

  /* entries matching a theme + range selection */
  function poolFor(l, themes, range) {
    var from, to;
    if (range === 'all') {
      from = 0; to = l.entries.length;
    } else if (range === 'p') {
      var base = typeof l.baseCount === 'number' ? l.baseCount : l.entries.length;
      from = base; to = l.entries.length;
    } else {
      from = parseInt(range, 10) * 100;
      to = from + 100;
    }
    var sel = Array.isArray(themes) ? themes : (themes && themes !== 'all' ? [themes] : []);
    var pool = [];
    l.entries.forEach(function (e, i) {
      if (range !== 'all' && (i < from || i >= to)) return;
      if (sel.length && sel.indexOf(featVal(e, 'theme')) < 0) return;
      pool.push(e);
    });
    return pool;
  }

  function pickPool(l) { var p = getPick(l.meta.code); return poolFor(l, p.themes, p.range); }

  function pickSummary(l) {
    var p = getPick(l.meta.code);
    var bits = [];
    if (!p.themes.length) bits.push('All topics');
    else if (p.themes.length === 1) bits.push(themeLabel(p.themes[0]));
    else bits.push(p.themes.length + ' topics');
    if (p.range === 'all') {
      bits.push('random from all');
    } else {
      var pr = null;
      rangeList(l).forEach(function (x) { if (x.id === p.range) pr = x; });
      bits.push(pr && pr.personal ? 'Personal words' : 'words ' + rangeLabel(l, p.range));
    }
    bits.push(p.count > 0 ? p.count + ' cards' : 'every card');
    return bits.join(' · ');
  }

  function startPick() {
    var l = L();
    var pool = pickPool(l);
    if (!pool.length) { showToast('Nothing matches — try another topic or range'); return; }
    var p = getPick(l.meta.code);
    var deck = state.shuffle ? shuffleArr(pool) : pool.slice();
    if (p.count > 0) deck = deck.slice(0, p.count);
    if (!deck.length) { showToast('Nothing matches — try a bigger range'); return; }
    state.basic = { deck: deck, i: 0, flipped: false, title: pickSummary(l) };
    nav('basic');
  }

  /* level blocks + per-block star counts */
  function levelStats(l) {
    var m = srsLoad(l.meta.code);
    var out = [];
    rangeList(l).forEach(function (r) {
      var known = 0;
      for (var i = r.from - 1; i < r.to; i++) {
        var rec = m[l.entries[i].id];
        if (rec && rec.n > 0 && rec.s >= 3) known++;
      }
      out.push({ id: r.id, from: r.from, to: r.to, size: r.to - r.from + 1, known: known,
        personal: r.personal,
        done: known >= Math.ceil((r.to - r.from + 1) * 0.9) });
    });
    return out;
  }

  function setupHTML(l) {
    var p = getPick(l.meta.code);
    var themes = themeList(l);
    var ranges = rangeList(l);
    var pool = pickPool(l);
    var blocks = levelStats(l);
    var next = null;
    blocks.forEach(function (b) { if (!next && !b.done) next = b; });

    var h = '';

    /* 1 · topics (multi-select) */
    var topicSum = !p.themes.length ? 'all' :
      (p.themes.length === 1 ? themeLabel(p.themes[0]) : p.themes.length + ' selected');
    var topicBody = '<div class="chiprow">';
    topicBody += '<button class="chip' + (!p.themes.length ? ' active' : '') + '" data-act="pick" data-key="theme" data-val="all">All topics <span class="count">' + l.entries.length + '</span></button>';
    themes.forEach(function (t) {
      var n = poolFor(l, [t], 'all').length;
      topicBody += '<button class="chip' + (p.themes.indexOf(t) >= 0 ? ' active' : '') + '" data-act="pick" data-key="theme" data-val="' + esc(t) + '">' +
        esc(themeLabel(t)) + ' <span class="count">' + n + '</span></button>';
    });
    topicBody += '</div><p class="home-foot">Tap one or more topics — they combine (e.g. Home + Family).</p>';
    h += sectionHTML('topic', 1, 'Choose a topic', topicSum, topicBody);

    /* 2 · word range */
    var rangeSum = p.range === 'all' ? 'random from all' : 'words ' + rangeLabel(l, p.range);
    var rangeBody = '<div class="chiprow tight">';
    rangeBody += '<button class="chip' + (p.range === 'all' ? ' active' : '') + '" data-act="pick" data-key="range" data-val="all">Random from all <span class="count">' + l.entries.length + '</span></button>';
    blocks.forEach(function (b) {
      var n = poolFor(l, p.themes, b.id).length;
      rangeBody += '<button class="chip' + (p.range === b.id ? ' active' : '') + (n === 0 ? ' empty' : '') + '" data-act="pick" data-key="range" data-val="' + b.id + '">' +
        (b.done ? '✅' : '') + (b.personal ? '⭐ Personal' : b.from + '–' + b.to) +
        ' <span class="count">' + (n === 0 ? '0' : b.known + '★/' + n) + '</span></button>';
    });
    rangeBody += '</div>';
    if (next && p.range === 'all') {
      rangeBody += '<p class="home-foot">Next unfinished block: <b>' + (next.personal ? '⭐ Personal' : 'words ' + next.from + '–' + next.to) + '</b> (★' +
        next.known + '/' + next.size + ') <button class="mini-link" data-act="use-next" data-b="' + next.id + '">select it</button></p>';
    }
    h += sectionHTML('range', 2, 'Choose the words', rangeSum, rangeBody);

    /* 3 · how many */
    var countBody = '<div class="chiprow tight">';
    COUNT_CHOICES.forEach(function (n) {
      countBody += '<button class="chip' + (p.count === n ? ' active' : '') + '" data-act="pick" data-key="count" data-val="' + n + '">' +
        (n === 0 ? 'All' : n) + '</button>';
    });
    countBody += '</div>';
    h += sectionHTML('count', 3, 'How many cards', p.count > 0 ? String(p.count) : 'all', countBody);

    h += '<div class="picksum">' +
      '<div class="picksum-line">Ready: <b>' + esc(pickSummary(l)) + '</b> · ' + pool.length + ' card(s) match</div>' +
      '</div>';
    h += '<button class="btn primary block" data-act="start-pick" style="min-height:56px">▶ Start studying</button>';
    return h;
  }

  function sectionHTML(id, num, title, summary, body) {
    var open = !!getOpenSec()[id];
    var h = '<button class="sechead' + (open ? ' open' : '') + '" data-act="toggle-sec" data-sec="' + id + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="secnum">' + num + '</span>' +
      '<span class="sectitle">' + esc(title) + '</span>' +
      '<span class="secsum">' + esc(summary) + '</span>' +
      '<span class="secarrow">' + (open ? '▾' : '▸') + '</span>' +
      '</button>';
    if (open) h += '<div class="secbody">' + body + '</div>';
    return h;
  }

  /* ───────────────── search + missing words ─────────────────── */

  function normSearch(s) {
    var t = String(s || '').toLowerCase().trim();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t;
  }

  function searchMatches(l, q) {
    var nq = normSearch(q);
    if (!nq) return [];
    var out = [];
    for (var i = 0; i < l.entries.length && out.length < 80; i++) {
      var e = l.entries[i];
      if (normSearch(e.front).indexOf(nq) >= 0 || normSearch(e.back).indexOf(nq) >= 0) out.push(e);
    }
    return out;
  }

  function searchResultsHTML(l) {
    var q = state.search || '';
    if (!q.trim()) {
      return '<p class="home-foot">Type a word in ' + esc(l.meta.frontLabel) + ' or ' + esc(l.meta.backLabel) + ' — accents optional.</p>';
    }
    var res = searchMatches(l, q);
    if (!res.length) {
      return '<div class="empty small"><span class="big-ico">🔍</span>No “' + esc(q.trim()) + '” in this deck.</div>' +
        '<button class="btn primary block" data-act="missing-add" data-text="' + esc(q.trim()) + '">＋ Add “' + esc(q.trim()) + '” to missing words</button>';
    }
    var h = '<div class="search-actions">' +
      '<button class="btn small" data-act="search-tol">⭐ Add all ' + res.length + ' to To Learn</button>' +
      '<button class="btn small primary" data-act="search-study">▶ Study these ' + res.length + '</button>' +
      '</div><div class="searchlist">';
    res.forEach(function (e) {
      var on = Store.has(l.meta.code, e.id);
      h += '<div class="srow">' +
        '<div class="sinfo"><div class="sword">' + esc(e.front) + '</div>' +
        '<div class="smean">' + esc(e.back) + '</div></div>' +
        '<button class="sstar' + (on ? ' on' : '') + '" data-act="star" data-id="' + esc(e.id) + '" aria-label="Toggle To Learn">' + (on ? '★' : '☆') + '</button>' +
        '</div>';
    });
    h += '</div>';
    return h;
  }

  function searchHTML(l) {
    var q = state.search || '';
    return '<div class="searchrow">' +
      '<input id="searchbox" class="searchinput" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" ' +
      'placeholder="Search ' + esc(l.meta.frontLabel) + ' or ' + esc(l.meta.backLabel) + '…" value="' + esc(q) + '" aria-label="Search words">' +
      '<button class="btn small missbtn" data-act="missing-add" data-text="' + esc(q.trim()) + '"' +
      (!q.trim() ? ' disabled' : '') + ' title="Add what you typed to missing words">＋ Missing</button>' +
      '</div><div id="searchres">' + searchResultsHTML(l) + '</div>';
  }

  function missingLoad(code) {
    try {
      var a = JSON.parse(localStorage.getItem(PREFIX + 'missing:' + code) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function missingSave(code, arr) {
    try { localStorage.setItem(PREFIX + 'missing:' + code, JSON.stringify(arr)); } catch (e) {}
  }

  function missingExport() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX + 'missing:') === 0) {
        try { out[k.slice((PREFIX + 'missing:').length)] = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
      }
    }
    return out;
  }

  /* ───────────────── bot: extra cards + word files ──────────── */

  function extraLoad(code) {
    try {
      var a = JSON.parse(localStorage.getItem(PREFIX + 'extra:' + code) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function extraSave(code, arr) {
    try { localStorage.setItem(PREFIX + 'extra:' + code, JSON.stringify(arr)); } catch (e) {}
  }

  function extraAdd(code, entry) {
    var a = extraLoad(code);
    for (var i = 0; i < a.length; i++) if (a[i].id === entry.id) return false;
    a.push(entry);
    extraSave(code, a);
    return true;
  }

  function extraExport() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX + 'extra:') === 0) {
        try { out[k.slice((PREFIX + 'extra:').length)] = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
      }
    }
    return out;
  }

  /* deck words first, personal (bot-added) words last */
  function mergeExtras(l) {
    var seen = {};
    var extras = extraLoad(l.meta.code).filter(function (e) { return e && e.front && e.back && e.id; });
    l.entries.forEach(function (e) { seen[e.id] = true; });
    l.baseCount = l.entries.length;
    extras.forEach(function (e) {
      if (seen[e.id]) return;
      seen[e.id] = true;
      l.entries.push({
        id: e.id, front: e.front, back: e.back, pos: e.pos || '',
        features: e.features || { theme: 'geral' },
        example: e.example || '', exampleTrans: e.exampleTrans || '',
        file: 'bot', line: 0
      });
    });
    l._lex = null;
  }

  function lextextGet(code) {
    try { return localStorage.getItem(PREFIX + 'lextext:' + code) || ''; } catch (e) { return ''; }
  }

  function lextextSet(code, txt) {
    try { localStorage.setItem(PREFIX + 'lextext:' + code, txt); } catch (e) {}
  }

  function lextextClear(code) {
    try { localStorage.removeItem(PREFIX + 'lextext:' + code); } catch (e) {}
  }

  function lextextExport() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX + 'lextext:') === 0) {
        try { out[k.slice((PREFIX + 'lextext:').length)] = localStorage.getItem(k) || ''; } catch (e) {}
      }
    }
    return out;
  }

  function parseLexiconText(txt) {
    var out = [];
    var lines = String(txt || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#' || line.charAt(0) === '@') continue;
      var front = '', back = '', pos = '', feats = {};
      if (line.indexOf('|') >= 0) {
        var p = line.split('|');
        front = (p[0] || '').trim();
        back = (p[1] || '').trim();
        pos = (p[2] || '').trim();
        feats = p[3] ? parseFeatures(p[3].trim()) : {};
      } else {
        var m = line.split(/\s+=\s+|\t+|\s+[–—-]\s+/);
        if (m.length < 2) continue;
        front = (m[0] || '').trim();
        back = (m[1] || '').trim();
      }
      if (!front || !back) continue;
      out.push({ front: front, back: back, pos: pos, features: feats });
    }
    return out;
  }

  function editDist(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    if (Math.abs(m - n) > 2) return 9;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function lexiconFor(l) {
    if (l._lex) return l._lex;
    var out = [], seen = {};
    function push(e, src) {
      var k = normSearch(e.front) + '§' + normSearch(e.back);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push({ front: e.front, back: e.back, pos: e.pos, features: e.features, id: e.id, src: src });
    }
    l.entries.forEach(function (e) {
      push({ front: e.front, back: e.back, pos: e.pos, features: e.features, id: e.id }, 'deck');
    });
    (l.lexicon || []).forEach(function (e) { push(e, 'bank'); });
    var txt = lextextGet(l.meta.code);
    if (txt) parseLexiconText(txt).forEach(function (e) { push(e, 'file'); });
    l._lex = out;
    return out;
  }

  function lexFind(l, q) {
    var nq = normSearch(q);
    if (!nq) return null;
    var lex = lexiconFor(l);
    var best = null, bestScore = 1e9;
    for (var i = 0; i < lex.length; i++) {
      var e = lex[i];
      var nf = normSearch(e.front), nb = normSearch(e.back);
      if (nf === nq || nb === nq) return { entry: e, exact: true };
      var limit = nq.length <= 4 ? 0 : (nq.length <= 7 ? 1 : 2);
      if (!limit) continue;
      var d = Math.min(editDist(nq, nf), editDist(nq, nb));
      if (d <= limit && d < bestScore) { bestScore = d; best = e; }
      else if (nf.indexOf(nq) === 0 || nb.indexOf(nq) === 0) {
        if (1 < bestScore) { bestScore = 1; best = e; }
      }
    }
    return best ? { entry: best, exact: false } : null;
  }

  function personalAdd(l, src) {
    var code = l.meta.code;
    var pos = src.pos || '';
    var id = hashId(code + '|' + src.front + '|' + (pos || '?'));
    for (var i = 0; i < l.entries.length; i++) if (l.entries[i].id === id) return { id: id, isNew: false, entry: l.entries[i] };
    var e = {
      id: id, front: src.front, back: src.back, pos: pos,
      features: (src.features && src.features.theme) ? src.features : { theme: 'geral' },
      example: '', exampleTrans: '',
      file: 'bot', line: 0
    };
    if (!extraAdd(code, e)) return { id: id, isNew: false, entry: e };
    l.entries.push(e);
    l._lex = null;
    return { id: id, isNew: true, entry: e };
  }

  function resolveOne(l, word, mode) {
    var hit = lexFind(l, word);
    if (hit && mode === 'file' && hit.entry.src !== 'file') hit = null;
    if (!hit) return { ok: false };
    var r = personalAdd(l, hit.entry);
    Store.add(l.meta.code, r.id);
    missingRemove(l.meta.code, word);
    return { ok: true, entry: hit.entry, isNew: r.isNew };
  }

  function resolveMissing(l, mode) {
    var code = l.meta.code;
    var miss = missingLoad(code);
    if (!miss.length) return { resolved: 0, added: 0 };
    var keep = [], resolved = 0, added = 0;
    miss.forEach(function (q) {
      var r = resolveOne(l, q, mode || 'all');
      if (!r.ok) { keep.push(q); return; }
      resolved++;
      if (r.isNew) added++;
    });
    missingSave(code, keep);
    return { resolved: resolved, added: added };
  }

  /* ───────────────── online lookup (bot) ───────────────────── */

  function decodeEntities(s) {
    try {
      var d = document.createElement('textarea');
      d.innerHTML = s;
      return d.value;
    } catch (e) { return String(s || ''); }
  }

  function guessPos(back, q) {
    var en = normSearch(back), ql = normSearch(q);
    if (/^to\s/.test(en) || /^to\s/.test(ql)) return 'verb';
    if (/^(a|an|the)\s/.test(en)) return 'noun';
    return '';
  }

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function cleanTranslation(t) {
    t = decodeEntities(String(t || '')).replace(/[.,;:!?¡¿]+$/g, '').trim();
    if (!t || t.length > 40) return '';
    if (/[,;]/.test(t)) return '';
    if (/^[A-ZÄÖÅ]/.test(t) && !/^[A-ZÄÖÅ]{2}/.test(t)) t = t.charAt(0).toLowerCase() + t.slice(1);
    return t;
  }

  function gtxTranslate(q, from, to) {
    var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t' +
      '&sl=' + encodeURIComponent(from) + '&tl=' + encodeURIComponent(to) + '&q=' + encodeURIComponent(q);
    return fetchJSON(url).then(function (data) {
      if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
      var out = '';
      data[0].forEach(function (seg) { if (seg && seg[0]) out += seg[0]; });
      return cleanTranslation(out) || null;
    });
  }

  function myMemoryTranslate(q, from, to) {
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) +
      '&langpair=' + encodeURIComponent(from + '|' + to);
    return fetchJSON(url).then(function (j) {
      var cands = [];
      var matches = (j && Array.isArray(j.matches)) ? j.matches : [];
      matches.forEach(function (m) {
        if (m && m.translation) cands.push({ text: m.translation, q: typeof m.quality === 'number' ? m.quality : 0 });
      });
      if (!matches.length && j && j.responseData && j.responseData.translatedText) {
        cands.push({ text: j.responseData.translatedText, q: 50 });
      }
      var best = null, bestScore = -1, seen = {};
      cands.forEach(function (c) {
        var t = cleanTranslation(c.text);
        if (!t) return;
        var nt = normSearch(t);
        if (!nt || nt === normSearch(q) || seen[nt]) return;
        seen[nt] = true;
        var score = c.q * 100 - t.length;
        if (score > bestScore) { bestScore = score; best = t; }
      });
      return best;
    });
  }

  function wikiTranslate(q, from, to) {
    if (from !== 'en') return Promise.resolve(null);
    var url = 'https://en.wiktionary.org/w/api.php?action=parse&page=' + encodeURIComponent(q) +
      '&prop=wikitext&format=json&origin=*&redirects=1';
    return fetchJSON(url).then(function (j) {
      var wt = j && j.parse && j.parse.wikitext && j.parse.wikitext['*'];
      if (!wt) return null;
      var re = /\{\{t[^|}]*\|([a-z-]+)\|([^}|]+)/g, m, out = null;
      while ((m = re.exec(wt))) {
        if (m[1].toLowerCase() === to) { out = m[2]; break; }
      }
      return out ? (cleanTranslation(out) || null) : null;
    });
  }

  function onlineTranslate(l, word) {
    var q = String(word || '').trim();
    var target = l.meta.code;
    if (!q) return Promise.resolve(null);
    var ascii = !/[^\x00-\x7F]/.test(q);
    var dirs = ascii ? [['en', target], [target, 'en']] : [[target, 'en'], ['en', target]];

    var combos = [];
    dirs.forEach(function (d) {
      combos.push({ src: 'gtx', from: d[0], to: d[1] });
      combos.push({ src: 'mm', from: d[0], to: d[1] });
      combos.push({ src: 'wiki', from: d[0], to: d[1] });
    });

    var okCount = 0;

    function step(i) {
      if (i >= combos.length) return Promise.resolve(null);
      var c = combos[i];
      var pr = c.src === 'gtx' ? gtxTranslate(q, c.from, c.to)
        : c.src === 'mm' ? myMemoryTranslate(q, c.from, c.to)
          : wikiTranslate(q, c.from, c.to);
      return pr.then(function (text) {
        if (c.src !== 'wiki' || c.from === 'en') okCount++;
        if (!text) return step(i + 1);
        if (normSearch(text) === normSearch(q)) return step(i + 1);
        return { from: c.from, to: c.to, text: text };
      }, function () { return step(i + 1); });
    }

    return step(0).then(function (res) {
      if (!res && !okCount) throw new Error('offline');
      if (!res) return null;
      var front = res.from === 'en' ? res.text : q;
      var back = res.from === 'en' ? q : res.text;
      if (!front || !back || normSearch(front) === normSearch(back)) return null;
      return { front: front, back: back, pos: guessPos(back, q) };
    });
  }

  function lextextAppend(code, front, back) {
    var txt = lextextGet(code);
    var exists = parseLexiconText(txt).some(function (e) {
      return normSearch(e.front) === normSearch(front) && normSearch(e.back) === normSearch(back);
    });
    if (exists) return;
    txt = (txt ? txt.replace(/\s+$/, '') + '\n' : '') + front + ' = ' + back;
    lextextSet(code, txt);
  }

  /* the app's own dictionary file: every learned word pair */
  function dictEntries(l) {
    var out = [], seen = {};
    function push(front, back) {
      var k = normSearch(front) + '§' + normSearch(back);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push({ front: front, back: back });
    }
    parseLexiconText(lextextGet(l.meta.code)).forEach(function (e) { push(e.front, e.back); });
    extraLoad(l.meta.code).forEach(function (e) { push(e.front, e.back); });
    return out;
  }

  function dictFileText(l) {
    var rows = dictEntries(l);
    var head = '# My ' + l.meta.name + ' dictionary — created by Language Flash Cards\n' +
      '# saved ' + new Date().toISOString().slice(0, 10) + ' · ' + rows.length + ' words\n' +
      '# format: word = english\n\n';
    return head + rows.map(function (r) { return r.front + ' = ' + r.back; }).join('\n') + '\n';
  }

  function saveDictFile(l) {
    var txt = dictFileText(l);
    try {
      var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'my-dictionary-' + l.meta.code + '.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1200);
      showToast('💾 Dictionary file saved');
    } catch (e) {
      showToast('Could not save the file on this device');
    }
  }

  function onlineResolve(l, word) {
    return onlineTranslate(l, word).then(function (res) {
      if (!res) return null;
      var r = personalAdd(l, { front: res.front, back: res.back, pos: res.pos, features: { theme: 'geral' } });
      Store.add(l.meta.code, r.id);
      missingRemove(l.meta.code, word);
      lextextAppend(l.meta.code, res.front, res.back);
      l._lex = null;
      return r.entry;
    });
  }

  function onlineResolveMany(l, words, limit) {
    var queue = words.slice(0, limit || 8);
    var done = 0;
    function next() {
      if (!queue.length) return Promise.resolve(done);
      var w = queue.shift();
      return onlineResolve(l, w).then(function (e) {
        if (e) done++;
        return next();
      }, function () { return next(); });
    }
    return next();
  }

  function missingAdd(code, text) {
    text = String(text || '').trim();
    if (!text) return false;
    var a = missingLoad(code);
    for (var i = 0; i < a.length; i++) if (normSearch(a[i]) === normSearch(text)) return false;
    a.push(text);
    missingSave(code, a);
    return true;
  }

  function missingRemove(code, text) {
    var a = missingLoad(code).filter(function (x) { return x !== text; });
    missingSave(code, a);
  }

  function missingHTML(l) {
    var a = missingLoad(l.meta.code);
    var txt = lextextGet(l.meta.code);
    var fileCount = txt ? parseLexiconText(txt).length : 0;
    var body = '<p class="home-foot">Tap a word — the bot checks the deck, the built-in word banks and your words file, ' +
      'then looks it up online if needed. New words become cards in ⭐ Personal and are saved to your local words file.</p>';

    if (a.length) {
      body += '<p class="home-foot">Tap a word — the bot looks it up and moves it into ⭐ Personal at the end of the deck.</p>';
      body += '<div class="misslist">';
      a.forEach(function (w) {
        body += '<div class="missrow">' +
          '<button class="missword missadd" data-act="missing-resolve" data-text="' + esc(w) + '">🤖 ' + esc(w) + '</button>' +
          '<button class="missdel" data-act="missing-del" data-text="' + esc(w) + '" aria-label="Remove">✕</button></div>';
      });
      body += '</div>';
    } else {
      body += '<p class="home-foot">Nothing missing right now.</p>';
    }

    body += '<div class="missactions">' +
      (a.length ? '<button class="btn small primary" data-act="bot-run">🤖 Resolve ' + a.length + ' word(s)</button>' : '') +
      '<button class="btn small" data-act="lex-import">📄 Load dictionary</button>' +
      '<button class="btn small" data-act="dict-save">💾 Save dictionary</button>' +
      (a.length ? '<button class="btn small" data-act="missing-copy">📋 Copy list</button>' : '') +
      (txt ? '<button class="btn small" data-act="lex-clear">✕ File</button>' : '') +
      '</div>';
    body += '<p class="home-foot">📖 My dictionary: <b>' + dictEntries(l).length + ' word(s)</b> saved in this app' +
      (fileCount ? ' (' + fileCount + ' from your loaded file)' : '') +
      ' — “word = translation”, tab or “front | back” per line. “Save dictionary” writes my-dictionary-' + l.meta.code + '.txt to your phone.</p>';
    body += '<input type="file" id="lexfile" class="fileinput" accept=".txt,text/plain">';

    return sectionHTML('missing', '＋', 'Missing words (' + a.length + ')', a.length ? a.length + ' to add' : 'words file', body);
  }

  /* ───────────────────────── rendering ───────────────────── */

  var app = null;

  /* navigate to a view, recording it in browser history so the
     phone/desktop back button steps through screens instead of
     leaving the app */
  function nav(view, push) {
    state.view = view;
    if (push !== false) {
      try { history.pushState({ v: view, code: state.code }, ''); } catch (e) {}
    }
    render();
  }

  function onPopState(ev) {
    var st = ev.state || { v: 'home', code: null };
    var v = st.v || 'home';
    if (st.code) state.code = st.code;
    if ((v === 'basic' && !state.basic) || (v === 'tol' && !state.tol) ||
        (v === 'testRun' && !state.test) || (v === 'testResult' && !(state.test && state.test.result)) ||
        (v === 'stats' && !state.code)) {
      v = state.code ? 'hub' : 'home';
    }
    state.view = v;
    render();
  }

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
      case 'stats': html += statsHTML(); break;
      default: html += homeHTML();
    }
    app.innerHTML = html;
    if (state.view === 'testRun' && state.test &&
        (state.test.style === 'typing' || state.test.style === 'listen')) {
      var inp = document.getElementById('typeinput');
      if (inp) inp.focus();
    }
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
    var st = streakInfo();
    var goal = getGoal();
    if (goal > 0 || st.current > 0) {
      h += '<div class="goalbar">' +
        (st.current > 0 ? '<span class="streak">🔥 ' + st.current + '-day streak</span>' : '') +
        '<span class="today">Today: ' + todayStudied() + ' / ' + goal + (st.doneToday ? ' ✓' : '') + '</span>' +
        '</div>';
    }
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
    h += '<button class="chip' + (isRev(l) ? ' active' : '') + '" data-act="rev" title="Practice English → ' + esc(l.meta.name) + '">↺ ' + esc(l.meta.backLabel) + ' → ' + esc(l.meta.frontLabel) + '</button>';
    h += '</div>';

    var sts = srsStats(l);
    h += '<div class="mastery-row">' +
      '<div class="mastery-bar">' +
      '<div class="seg known" style="width:' + (sts.known / sts.total * 100) + '%"></div>' +
      '<div class="seg learning" style="width:' + (sts.learning / sts.total * 100) + '%"></div>' +
      '</div>' +
      '<div class="mastery-labels"><span class="k">★ ' + sts.known + ' known</span>' +
      '<span class="l">◐ ' + sts.learning + ' learning</span>' +
      '<span class="n">● ' + sts.fresh + ' new</span>' +
      '<button class="mini-link" data-act="go-stats">Stats ›</button></div>' +
      '</div>';

    var st = streakInfo();
    var goal = getGoal();
    h += setupHTML(l);
    h += sectionHTML('search', '🔍', 'Search words', state.search ? '“' + state.search + '”' : 'find & star', searchHTML(l));
    h += '<div class="goalbar">' +
      (st.current > 0 ? '<span class="streak">🔥 ' + st.current + '</span>' : '') +
      '<span class="today">Today: ' + todayStudied() + ' / ' + goal + (st.doneToday ? ' ✓' : '') + '</span>' +
      '<span class="goalpick">';
    [5, 10, 20, 30].forEach(function (g) {
      h += '<button class="chip tiny' + (goal === g ? ' active' : '') + '" data-act="goal" data-g="' + g + '">' + g + '</button>';
    });
    h += '</span></div>';

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

    var pool = pickPool(l);
    var due = dueEntries(l);
    var dueCount = due.due.length;
    h += '<div class="mode-grid">';
    if (dueCount > 0) {
      h += '<button class="mode-btn due" data-act="start-due"><span class="ico">⏰</span><span><span class="t">Due today (' + dueCount + ')</span><div class="d">Smart review — hardest first, then new words</div></span></button>';
    }
    h += '<button class="mode-btn" data-act="start-tol"><span class="ico">⭐</span><span><span class="t">To Learn (' + tl + ')</span><div class="d">Drill only your weak cards</div></span></button>' +
      '<button class="mode-btn" data-act="go-testsetup"><span class="ico">📝</span><span><span class="t">Test me</span><div class="d">10 / 20 / 30 cards from your selection · wrong words go to To Learn</div></span></button>' +
      '<button class="mode-btn" data-act="start-listen"><span class="ico">🎧</span><span><span class="t">Listen</span><div class="d">Hear the word, type what it means</div></span></button>' +
      '</div>';
    h += '<p class="home-foot">Everything above uses your selection: ' +
      esc(pickSummary(l)) +
      (state.posFilter === 'all' ? '' : ' · ' + esc(posLabel(l, state.posFilter)) + ' only') +
      ' · ' + pool.length + ' card(s) available' +
      '</p>';
    h += missingHTML(l);
    return h;
  }

  function topbarHTML(title, sub, showBack) {
    var h = '<div class="topbar">';
    if (showBack !== false) h += '<button class="backbtn" data-act="back" aria-label="Back">←</button>';
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
    var rec = srsGet(l.meta.code, e.id);
    var mcls = masteryClass(rec);
    var mGlyph = mcls === 'known' ? '★' : (mcls === 'learning' ? '◐' : '●');
    var word = promptText(l, e);
    var h = '<div class="face front">';
    h += '<div class="face-top">';
    if (speechOK()) {
      h += '<button class="speak-btn" data-act="speak" data-text="' + esc(e.front) + '" data-lang="' + ttsCode + '" data-code="' + esc(l.meta.code) + '" data-name="' + esc(l.meta.name) + '" aria-label="Hear the word">🔊</button>';
    } else {
      h += '<span></span>';
    }
    h += '<span class="mastery m-' + mcls + '" title="' + mcls + '">' + mGlyph + '</span>';
    if (opts.star !== false) {
      h += '<button class="star' + (starred ? ' on' : '') + '" data-act="star" data-id="' + esc(e.id) + '" aria-label="To Learn">' + (starred ? '★' : '☆') + '</button>';
    }
    h += '</div>';
    h += '<div class="word">' + esc(word) + '</div>';
    h += '<div class="pos-line">' + esc(posLabel(l, e.pos)) +
      (featVal(e, 'pron') ? ' · ' + esc(featVal(e, 'pron')) : '') + '</div>';
    h += '<div class="hint">tap to flip' + (speechOK() ? ' · 🔊 to hear' : '') + '</div>';
    h += '</div>';
    return h;
  }

  function backFaceHTML(l, e) {
    var rev = isRev(l);
    var h = '<div class="face back">';
    h += '<div class="back-head"><div class="back-word">' + esc(rev ? e.back : e.front) + '</div></div>';
    h += '<div class="back-meaning">' + esc(rev ? e.front : e.back) + '</div>';

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
    var title = sess.title || (mode === 'tol' ? '⭐ To Learn' : '🃏 Flash cards');
    var h = topbarHTML(title, (sess.i + 1) + ' / ' + sess.deck.length);
    h += '<div class="counter" id="counter-line">' + esc(promptText(l, e)) + ' — ' + (sess.flipped ? esc(answerText(l, e)) : '?') + '</div>';
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
    h += '<div class="section-label">How to answer</div><div class="pickrow">' +
      '<button class="btn' + (!cfg.typing ? ' primary' : '') + '" data-act="test-typing" data-typing="0">Flip &amp; choose</button>' +
      '<button class="btn' + (cfg.typing ? ' primary' : '') + '" data-act="test-typing" data-typing="1">✏️ Type it</button>' +
      '</div>';
    h += '<div style="height:12px"></div>';
    h += '<button class="btn primary block" data-act="test-start" style="min-height:56px">Start test</button>';
    h += '<p class="home-foot">' +
      (cfg.typing
        ? 'Type the answer shown on the card and press Enter. Wrong answers show the solution, then move on.'
        : 'Flip each card, then honestly mark ✗ Wrong or ✓ Knew it.') +
      ' Wrong cards join To Learn; cards you now know leave it.</p>';
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
    var style = t.style || 'flip';
    var title = style === 'listen' ? '🎧 Listen' : '📝 Test';

    var h = topbarHTML(title, (t.i + 1) + ' / ' + t.deck.length);
    h += '<div class="progressbar"><div style="width:' + pct + '%"></div></div>';
    h += '<div class="counter" id="counter-line">✓ ' + t.right.length + ' · ✗ ' + t.wrong.length + '</div>';

    if (style === 'flip') {
      h += '<div class="card-scene"><div class="card' + (t.flipped ? ' flipped' : '') + '" data-act="flip">' +
        frontFaceHTML(l, e, { star: false }) +
        backFaceHTML(l, e) +
        '</div></div>';
      h += '<div id="test-actions">' + testActionsHTML() + '</div>';
      return h;
    }

    /* typing & listening share the input flow */
    if (style === 'listen') {
      h += '<div class="listen-box">';
      h += '<button class="listen-btn" data-act="replay" aria-label="Play the word">🔊</button>';
      h += '<div class="listen-hint">What does it mean in ' + esc(l.meta.backLabel) + '?</div>';
      h += '<button class="btn small ghost" data-act="replay">▶ Play again</button>';
      h += '</div>';
    } else {
      h += '<div class="card-scene"><div class="card show-front">' +
        frontFaceHTML(l, e, { star: false }) +
        '</div></div>';
      h += '<div class="listen-hint">Type the ' + (isRev(l) ? esc(l.meta.frontLabel) : esc(l.meta.backLabel)) + ' meaning</div>';
    }

    if (t.fb) {
      h += '<div class="fb ' + (t.fb.ok ? 'good' : 'bad') + '">' +
        (t.fb.ok ? '✓ Correct!' : '✗ Wrong — it was “' + esc(t.fb.expected) + '”') +
        (t.fb.ok ? '' : '<div class="fb-you">you typed: “' + esc(t.fb.you) + '”</div>') +
        '</div>';
      h += '<button class="btn block" data-act="fb-next">' + (t.i + 1 < t.deck.length ? 'Next →' : 'See results') + '</button>';
    } else {
      h += '<div class="typebox">' +
        '<input id="typeinput" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="type here…" aria-label="Your answer">' +
        '<button class="btn primary" data-act="typing-check">Check</button>' +
        '</div>';
      h += '<p class="home-foot">Press Enter to check · audio plays automatically' + (style === 'listen' ? ' · tap 🔊 to replay' : '') + '</p>';
    }
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

  /* ── stats ──────────────────────────────────────────────── */

  function statsHTML() {
    var l = L();
    if (!l) { state.view = 'home'; return homeHTML(); }
    var sts = srsStats(l);
    var acc = accLoad(l.meta.code);
    var total = sts.total || 1;
    var accTotal = (acc.right || 0) + (acc.wrong || 0);
    var accPct = accTotal ? Math.round((acc.right / accTotal) * 100) : 0;
    var st = streakInfo();
    var due = dueEntries(l);

    var h = topbarHTML('📊 ' + esc(l.meta.name) + ' stats');
    h += '<div class="score-card">' +
      '<div class="big">' + sts.known + ' / ' + sts.total + '</div>' +
      '<div class="frac">words known (stage ★3+)</div>' +
      '<div class="mastery-bar big-bar">' +
      '<div class="seg known" style="width:' + (sts.known / total * 100) + '%"></div>' +
      '<div class="seg learning" style="width:' + (sts.learning / total * 100) + '%"></div>' +
      '</div>' +
      '<div class="mastery-labels"><span class="k">★ ' + sts.known + '</span>' +
      '<span class="l">◐ ' + sts.learning + '</span>' +
      '<span class="n">● ' + sts.fresh + '</span></div>' +
      '</div>';

    h += '<div class="statgrid">' +
      '<div class="statbox"><div class="v">' + accPct + '%</div><div class="l">accuracy (' + accTotal + ' answers)</div></div>' +
      '<div class="statbox"><div class="v">' + due.due.length + '</div><div class="l">due now</div></div>' +
      '<div class="statbox"><div class="v">' + todayStudied() + ' / ' + getGoal() + '</div><div class="l">today vs goal</div></div>' +
      '<div class="statbox"><div class="v">🔥 ' + st.current + '</div><div class="l">streak (best ' + st.best + ')</div></div>' +
      '</div>';

    h += '<div class="section-label">How SRS works</div>';
    h += '<p class="home-foot">Cards you answer correctly move up a stage with longer gaps (today → 3d → 7d → 14d → 30d). ' +
      'Cards you get wrong drop back to stage 0 and reappear in <b>Due today</b>. ★ = stage 3+ counts as known. ' +
      'Daily goal counts unique words studied across all modes.</p>';
    h += '<button class="btn block" data-act="go-hub">Back</button>';
    return h;
  }

  /* ───────────────────────── sessions ────────────────────── */

  function startBasic() {
    var l = L();
    var deck = entriesFor(l);
    if (state.shuffle) deck = shuffleArr(deck);
    state.basic = { deck: deck, i: 0, flipped: false };
    nav('basic');
  }

  function startTol() {
    var l = L();
    var p = getPick(l.meta.code);
    var pool = tolearnEntries(l);
    if (!pool.length) pool = pickPool(l);
    if (state.shuffle) pool = shuffleArr(pool);
    if (p.count > 0) pool = pool.slice(0, p.count);
    state.tol = { deck: pool, i: 0, flipped: false, title: '⭐ ' + pickSummary(l) };
    nav('tol');
  }

  function startDue() {
    var l = L();
    var d = dueEntries(l);
    var deck = d.due.concat(state.shuffle ? shuffleArr(d.fresh) : d.fresh);
    if (!deck.length) {
      showToast('Nothing due — all caught up 🎉');
      return;
    }
    state.basic = { deck: deck, i: 0, flipped: false };
    nav('basic');
  }

  function startTest() {
    var l = L();
    var cfg = state.testCfg || { len: 10, src: 'all', typing: false };
    var pool = cfg.src === 'tl' ? tolearnEntries(l) : pickPool(l);
    if (state.shuffle) pool = shuffleArr(pool);
    var deck = pool.slice(0, cfg.len);
    state.test = {
      deck: deck, i: 0, flipped: false, right: [], wrong: [],
      result: null, style: cfg.typing ? 'typing' : 'flip', fb: null
    };
    nav('testRun');
    if (!cfg.typing) speakCurrent();
  }

  function startListen() {
    var l = L();
    var lang = l.meta.ttsLang || l.meta.code;
    if (!speechOK() || voiceMissing(lang)) {
      showToast('No ' + l.meta.name + ' voice on this device — Listen mode needs audio');
      return;
    }
    var p = getPick(l.meta.code);
    var pool = pickPool(l);
    if (state.shuffle) pool = shuffleArr(pool);
    pool = pool.slice(0, p.count > 0 ? Math.min(p.count, 15) : 15);
    state.test = {
      deck: pool, i: 0, flipped: true, right: [], wrong: [],
      result: null, style: 'listen', fb: null
    };
    nav('testRun');
    if (pool.length) trySpeak(pool[0].front, lang, l.meta.code, l.meta.name, true);
  }

  function answer(ok) {
    var t = state.test;
    var l = L();
    var e = t.deck[t.i];
    if (ok) t.right.push(e); else t.wrong.push(e);
    srsMark(l.meta.code, e.id, ok);
    accAdd(l.meta.code, ok);
    markStudy(l.meta.code, e.id);
    t.flipped = false;
    t.fb = null;
    if (t.i + 1 < t.deck.length) {
      t.i++;
    } else {
      finishTest();
    }
  }

  function checkTyped() {
    var t = state.test;
    var l = L();
    if (!t || t.fb) return;
    var inp = document.getElementById('typeinput');
    var val = inp ? inp.value : '';
    if (!String(val).trim()) return;
    var expected = answerText(l, t.deck[t.i]);
    var ok = normalizeAns(val) === normalizeAns(expected);
    t.fb = { ok: ok, you: val, expected: expected };
    render();
    setTimeout(function () {
      if (state.view === 'testRun' && state.test === t && t.fb) {
        answer(ok);
        render();
        speakCurrent();
      }
    }, 1800);
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
    nav('testResult');
  }

  function retryWrong() {
    var t = state.test;
    var style = t.style || 'flip';
    state.test = {
      deck: shuffleArr(t.result.wrong),
      i: 0, flipped: style === 'listen', right: [], wrong: [], result: null,
      style: style, fb: null
    };
    nav('testRun');
    speakCurrent();
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
          state.langs.forEach(mergeExtras);
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
      case 'back':
        if (history.state && history.state.v) history.back();
        else nav(state.code ? 'hub' : 'home');
        return;
      case 'go-home':
        nav('home'); return;
      case 'go-hub':
        nav('hub'); return;
      case 'go-stats':
        nav('stats'); return;
      case 'go-lang':
        state.code = el.getAttribute('data-code');
        state.posFilter = 'all';
        state.search = '';
        nav('hub');
        return;
      case 'search-study': {
        var ls = L();
        if (!ls) return;
        var sres = searchMatches(ls, state.search || '');
        if (!sres.length) return;
        state.basic = { deck: sres, i: 0, flipped: false };
        nav('basic');
        speakCurrent();
        return;
      }
      case 'search-tol': {
        var lt = L();
        if (!lt) return;
        var tr = searchMatches(lt, state.search || '');
        var added = 0;
        tr.forEach(function (e) {
          if (!Store.has(lt.meta.code, e.id)) { Store.add(lt.meta.code, e.id); added++; }
        });
        showToast(added ? '⭐ Added ' + added + ' word(s) to To Learn' : 'Already all in To Learn');
        render();
        return;
      }
      case 'bot-run': {
        var lb = L();
        if (!lb) return;
        var rb = resolveMissing(lb);
        var left = missingLoad(lb.meta.code);
        if (!left.length) {
          showToast('🤖 All missing words resolved' + (rb.resolved ? ' — ' + rb.resolved + ' matched' : ''));
          render();
          return;
        }
        if (state.botBusy) { showToast('🌐 Still looking…'); return; }
        state.botBusy = true;
        showToast('🌐 Looking up ' + Math.min(left.length, 8) + ' word(s) online…');
        onlineResolveMany(lb, left, 8).then(function (n) {
          state.botBusy = false;
          showToast(n
            ? '✅ ' + n + ' word(s) added to ⭐ Personal' + (rb.resolved ? ' · ' + rb.resolved + ' from word banks' : '')
            : '🤖 No online matches — kept in Missing words');
          render();
        });
        return;
      }
      case 'dict-save': {
        var lds = L();
        if (!lds) return;
        saveDictFile(lds);
        return;
      }
      case 'lex-import': {
        var fi = document.getElementById('lexfile');
        if (fi) fi.click();
        return;
      }
      case 'lex-clear': {
        var lxc = L();
        if (!lxc) return;
        lextextClear(lxc.meta.code);
        lxc._lex = null;
        showToast('Words file removed');
        render();
        return;
      }
      case 'missing-add': {
        var lm = L();
        if (!lm) return;
        var text = (el.getAttribute('data-text') || state.search || '').trim();
        if (!text) { showToast('Type a word first'); return; }
        if (!missingAdd(lm.meta.code, text)) {
          showToast('Already in missing words');
          render();
          return;
        }
        showToast('＋ “' + text + '” saved — tap it in Missing words to let the bot add it');
        render();
        return;
      }
      case 'missing-resolve': {
        var lr2 = L();
        if (!lr2) return;
        var mw = el.getAttribute('data-text') || '';
        var rOne = resolveOne(lr2, mw);
        if (rOne.ok) {
          showToast('✅ “' + mw + '” added to ⭐ Personal');
          trySpeak(rOne.entry.front, lr2.meta.ttsLang || lr2.meta.code, lr2.meta.code, lr2.meta.name, false);
          render();
          return;
        }
        if (state.botBusy) { showToast('🌐 Still looking…'); return; }
        state.botBusy = true;
        showToast('🌐 Looking up “' + mw + '” online…');
        onlineResolve(lr2, mw).then(function (entry) {
          state.botBusy = false;
          if (entry) {
            showToast('✅ “' + entry.front + '” — ' + entry.back + ' · added to ⭐ Personal');
            trySpeak(entry.front, lr2.meta.ttsLang || lr2.meta.code, lr2.meta.code, lr2.meta.name, false);
          } else {
            showToast('🤖 No translation found — check spelling or load a 📄 Words file');
          }
          render();
        }).catch(function () {
          state.botBusy = false;
          showToast('🌐 No internet — word stays in Missing words');
          render();
        });
        return;
      }
      case 'missing-del': {
        var ld = L();
        if (!ld) return;
        missingRemove(ld.meta.code, el.getAttribute('data-text'));
        render();
        return;
      }
      case 'missing-copy': {
        var lc = L();
        if (!lc) return;
        var words = missingLoad(lc.meta.code);
        if (!words.length) return;
        var txt = words.join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(function () {
            showToast('📋 Copied ' + words.length + ' missing word(s)');
          }, function () { copyFallback(txt); });
        } else {
          copyFallback(txt);
        }
        return;
      }
      case 'filter':
        state.posFilter = el.getAttribute('data-pos');
        render(); return;
      case 'shuffle':
        state.shuffle = !state.shuffle;
        render(); return;
      case 'rev': {
        var lr = L();
        setRevPref(lr.meta.code, !isRev(lr));
        showToast(isRev(lr) ? '↺ Reversed: ' + lr.meta.backLabel + ' → ' + lr.meta.frontLabel : '↺ Normal order');
        render(); return;
      }
      case 'goal': {
        var g = parseInt(el.getAttribute('data-g'), 10);
        setGoal(g);
        render(); return;
      }
      case 'start-basic': startBasic(); speakCurrent(); return;
      case 'start-pick': startPick(); speakCurrent(); return;
      case 'pick': {
        var pl = L();
        if (!pl) return;
        var key = el.getAttribute('data-key');
        var val = el.getAttribute('data-val');
        if (key === 'count') val = parseInt(val, 10);
        if (key === 'theme') {
          var list = getPick(pl.meta.code).themes.slice();
          if (val === 'all') {
            list = [];
          } else {
            var idx = list.indexOf(val);
            if (idx >= 0) list.splice(idx, 1); else list.push(val);
          }
          setPick(pl.meta.code, 'themes', list);
          render();
          return;
        }
        setPick(pl.meta.code, key, val);
        render();
        return;
      }
      case 'toggle-sec': {
        var sec = el.getAttribute('data-sec');
        setOpenSec(sec, !getOpenSec()[sec]);
        render();
        return;
      }
      case 'use-next': {
        var pnl = L();
        setPick(pnl.meta.code, 'range', el.getAttribute('data-b'));
        showToast('Selected — now press Start');
        render();
        return;
      }
      case 'start-tol': startTol(); speakCurrent(); return;
      case 'start-due': startDue(); speakCurrent(); return;
      case 'start-listen': startListen(); return;
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
      case 'go-testsetup': nav('testSetup'); return;
      case 'test-len':
        state.testCfg = state.testCfg || { len: 10, src: 'all', typing: false };
        state.testCfg.len = parseInt(el.getAttribute('data-n'), 10);
        render(); return;
      case 'test-src':
        state.testCfg = state.testCfg || { len: 10, src: 'all', typing: false };
        state.testCfg.src = el.getAttribute('data-src');
        render(); return;
      case 'test-typing':
        state.testCfg = state.testCfg || { len: 10, src: 'all', typing: false };
        state.testCfg.typing = el.getAttribute('data-typing') === '1';
        render(); return;
      case 'test-start': startTest(); return;
      case 'typing-check': checkTyped(); return;
      case 'fb-next': {
        var t = state.test;
        if (t && t.fb) {
          var ok = t.fb.ok;
          answer(ok);
          render();
          speakCurrent();
        }
        return;
      }
      case 'replay': {
        var l = L();
        var t2 = state.test;
        if (l && t2 && t2.deck[t2.i]) {
          trySpeak(t2.deck[t2.i].front, l.meta.ttsLang || l.meta.code, l.meta.code, l.meta.name, true);
        }
        return;
      }
      case 'answer': answer(el.getAttribute('data-ok') === '1'); render(); speakCurrent(); return;
      case 'retry-wrong': retryWrong(); return;
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
    var l = L();
    if (counter && l && (state.view === 'basic' || state.view === 'tol')) {
      var e = sess.deck[sess.i];
      counter.textContent = promptText(l, e) + ' — ' + (sess.flipped ? answerText(l, e) : '?');
      if (sess.flipped) markStudy(l.meta.code, e.id);
    }
    if (state.view === 'testRun') {
      var slot = document.getElementById('test-actions');
      if (slot) slot.innerHTML = testActionsHTML();
    }
  }

  function handleKeys(ev) {
    var curTest = state.view === 'testRun' ? state.test : null;
    if (curTest && (curTest.style === 'typing' || curTest.style === 'listen') && !curTest.fb &&
        ev.key === 'Enter' && ev.target && ev.target.id === 'typeinput') {
      ev.preventDefault();
      checkTyped();
      return;
    }
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    var k = ev.key;
    if (state.view === 'basic' || state.view === 'tol') {
      if (k === ' ' || k === 'Enter') { ev.preventDefault(); flipCard(); }
      else if (k === 'ArrowRight') { ev.preventDefault(); move(1); render(); speakCurrent(); }
      else if (k === 'ArrowLeft') { ev.preventDefault(); move(-1); render(); speakCurrent(); }
    } else if (state.view === 'testRun') {
      var st = state.test;
      if (st && (st.style === 'typing' || st.style === 'listen')) {
        if (k === 'Enter' && !st.fb) { ev.preventDefault(); checkTyped(); }
        return;
      }
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
    window.addEventListener('popstate', onPopState);
    try { history.replaceState({ v: 'home', code: null }, ''); } catch (e) {}
    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.id === 'voicesel' && state.code) {
        setVoicePref(state.code, t.value);
        render();
        return;
      }
      if (t && t.id === 'lexfile' && t.files && t.files[0] && state.code) {
        var f = t.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          var l = L();
          if (!l) return;
          lextextSet(l.meta.code, String(reader.result || ''));
          l._lex = null;
          var r = resolveMissing(l, 'file');
          showToast('📄 ' + f.name + ' loaded · ' + r.resolved + ' word(s) matched');
          render();
        };
        reader.readAsText(f, 'utf-8');
        t.value = '';
      }
    });
    document.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t && t.id === 'searchbox') {
        state.search = t.value;
        var res = document.getElementById('searchres');
        var l = L();
        if (res && l) res.innerHTML = searchResultsHTML(l);
        var mb = document.querySelector('.missbtn');
        if (mb) {
          var tv = t.value.trim();
          mb.setAttribute('data-text', tv);
          if (tv) mb.removeAttribute('disabled');
          else mb.setAttribute('disabled', 'disabled');
        }
      }
    });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: false });

    /* offline web app (PWA) */
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
        (location.protocol === 'https:' ||
         location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').then(function () {
        /* ask the browser to fetch a newer service worker right away */
        if (navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(function (reg) { if (reg.update) reg.update(); });
        }
      }).catch(function () {});
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
