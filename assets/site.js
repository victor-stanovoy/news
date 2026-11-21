/* error log used by the ?debug panel */
window.__sparkErrors = [];
window.addEventListener('error', function (e) { window.__sparkErrors.push(e.message); });

/* SparkNews site script. Settings come from site.json -> "ticker". */
(function () {
  /* ---- pause / play button on the in-page ticker ---- */
  var bar = document.querySelector('.ticker'), btn = document.querySelector('.tpause');
  if (bar && btn) {
    btn.addEventListener('click', function () {
      var paused = bar.classList.toggle('paused');
      btn.innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
    });
  }

  /* ---- "Edit this article" link, shown only to people who are signed in to the editor ---- */
  try {
    var signedIn = Object.keys(localStorage).some(function (k) { return /^sb-.*-auth-token$/.test(k); });
    if (signedIn) document.querySelectorAll('.editlink').forEach(function (a) { a.hidden = false; });
  } catch (e) {}

  /* ---- red dot on the "Live" menu link while radio or TV is on air ---- */
  try {
    var ll = document.querySelector('.livelink'), td = document.getElementById('spark-ticker-data');
    var lc = td && JSON.parse(td.textContent).live;
    if (ll && lc && lc.url) {
      var poll = function () {
        fetch(lc.url.replace(/\/+$/, '') + '/rest/v1/live_now?select=kind', { headers: { apikey: lc.key } })
          .then(function (r) { return r.ok ? r.json() : []; })
          .then(function (rows) { ll.classList.toggle('onair', Array.isArray(rows) && rows.length > 0); })
          .catch(function () {});
      };
      poll(); setInterval(function () { if (!document.hidden) poll(); }, 30000);
    }
  } catch (e) {}

  /* ---- light / dark toggle (remembers the choice) ---- */
  var tb = document.querySelector('.theme');
  if (tb) {
    tb.addEventListener('click', function () {
      var root = document.documentElement;
      var now = root.dataset.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = /^(dark|midnight|forest|contrast)$/.test(now) ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('spark-theme', next); } catch (e) {}
    });
  }

  /* ---- visitor preferences (set on the Settings page, kept in this browser only) ---- */
  var PKEY = 'spark-prefs';
  function getPrefs() {
    try { var p = JSON.parse(localStorage.getItem(PKEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function setPrefs(p) { try { localStorage.setItem(PKEY, JSON.stringify(p)); return true; } catch (e) { return false; } }
  var SPEEDS = { slow: 1.8, normal: 1, fast: 0.55 };   /* multiplier on the time between ticks */

  /* ---- tab title ticker: runs while the visitor is away from the page ---- */
  var el = document.getElementById('spark-ticker-data');
  var data = null;
  if (el) { try { data = JSON.parse(el.textContent); } catch (e) { data = null; } }
  var site = data && data.tab, items = (data && data.items) || [];
  var ua = navigator.userAgent || '';
  var isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS|FxiOS|Edg\/|OPR\//.test(ua) || /iP(hone|ad|od)/.test(ua);

  /* site settings, overridden by what this visitor chose */
  function eff() {
    var t = {}, k, pr = getPrefs();
    for (k in site) t[k] = site[k];
    if (pr.tab === false) t.enabled = false;
    if (pr.mode === 'scroll' || pr.mode === 'headline') t.mode = pr.mode;
    var m = SPEEDS[pr.speed] || 1;
    t.interval_ms = Math.round((t.interval_ms || 350) * m);
    t.headline_interval_ms = Math.round((t.headline_interval_ms || 3000) * m);
    return t;
  }

  var original = document.title, timer = null, worker = null, startedAt = 0, testing = false, cur = null;

  /* Safari trims leading spaces from the title and shows only about 20 characters in a tab,
     so use non-breaking spaces and a shorter window there. */
  function fit(str) { return isSafari ? str.replace(/ /g, ' ') : str; }

  /* Position comes from elapsed time, not from counting ticks, so the speed stays
     right even when the browser slows timers down in a background tab. */
  function render() {
    var t = cur; if (!t) return;
    var sep = t.separator || '  ●  ';
    var text = (t.prefix || '') + items.join(sep) + sep;
    var elapsed = Date.now() - startedAt;
    if (t.mode === 'headline') {
      var i = Math.floor(elapsed / (t.headline_interval_ms || 3000)) % items.length;
      document.title = (t.prefix || '') + items[i];
    } else {
      var win = t.window_chars || 34;
      if (isSafari) win = Math.min(win, 22);
      var pos = (Math.floor(elapsed / (t.interval_ms || 350)) * (t.step || 2)) % text.length;
      var loop = text;
      while (loop.length < win + text.length) loop += text;
      document.title = fit(loop.substr(pos, win));
    }
  }
  /* Safari slows setInterval in hidden tabs to about once a second (and more after a few minutes);
     a Web Worker clock is not slowed the same way, so use one when the browser allows it. */
  function tick(ms) {
    if (isSafari && window.Worker && window.Blob && window.URL && URL.createObjectURL) {
      try {
        var src = 'var m=' + ms + ';setInterval(function(){postMessage(1)},m)';
        worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
        worker.onmessage = render;
        return;
      } catch (e) { worker = null; }
    }
    timer = setInterval(render, ms);
  }
  function running() { return !!(timer || worker); }
  function start() {
    if (running() || !site || !items.length) return;
    cur = eff();
    if (!cur.enabled) return;
    original = document.title;
    startedAt = Date.now();
    render();
    tick(Math.min(cur.interval_ms || 350, cur.mode === 'headline' ? 500 : 350));
  }
  function stop() {
    if (!running()) return;
    if (timer) clearInterval(timer);
    if (worker) { worker.terminate(); }
    timer = null; worker = null;
    document.title = original;
  }

  if (site && items.length) {
    /* leaving = switching tab / minimising, or the window losing focus (clicking another window) */
    document.addEventListener('visibilitychange', function () {
      if (testing) return;
      if (document.hidden) start(); else stop();
    });
    window.addEventListener('blur', function () {
      if (testing) return;
      /* clicking into an embedded quiz/interactive also fires blur; that is not leaving.
         Safari fires blur for things that are not leaving, so there only trust visibility. */
      if (isSafari) return;
      setTimeout(function () {
        var a = document.activeElement;
        if (a && a.tagName === 'IFRAME') return;
        start();
      }, 0);
    });
    window.addEventListener('focus', function () { if (!testing) stop(); });
    /* Safari's back/forward cache can freeze the page with the ticker still in the title */
    window.addEventListener('pagehide', function () { stop(); });
    window.addEventListener('pageshow', function () { if (!testing && !document.hidden) stop(); });
    if (document.hidden) start();
  }

  /* add ?tickertest to any page address to preview the tab ticker without leaving; click the page to stop */
  if (site && items.length && /[?&]tickertest\b/.test(location.search)) {
    testing = true; start();
    document.addEventListener('click', function () { testing = false; stop(); }, { once: true });
  }

  /* ---- Settings page ---- */
  var form = document.getElementById('prefs');
  if (form) {
    var pr = getPrefs(), siteOn = !!(site && site.enabled && items.length);
    var q = function (n) { return form.elements[n]; };
    var uiSel = document.getElementById('ui-lang-pref');
    if (uiSel) uiSel.addEventListener('change', function () { if (window.SparkI18n) window.SparkI18n.set(uiSel.value); });
    var themeNow = 'auto';
    try { themeNow = localStorage.getItem('spark-theme') || 'auto'; } catch (e) {}
    q('tab').checked = siteOn && pr.tab !== false;
    q('tab').disabled = !siteOn;
    var off = document.getElementById('prefs-off'); if (off) off.hidden = siteOn;
    [].forEach.call(form.querySelectorAll('input[name=mode]'), function (r) { r.checked = r.value === (pr.mode || (site && site.mode) || 'scroll'); });
    [].forEach.call(form.querySelectorAll('input[name=speed]'), function (r) { r.checked = r.value === (pr.speed || 'normal'); });
    [].forEach.call(form.querySelectorAll('input[name=theme]'), function (r) { r.checked = r.value === themeNow; });
    var msg = document.getElementById('prefs-msg');
    var say = function (m) { if (msg) msg.textContent = m; };
    function sync() {
      var p = getPrefs();
      p.tab = q('tab').checked;
      var m = form.querySelector('input[name=mode]:checked'), sp = form.querySelector('input[name=speed]:checked'), th = form.querySelector('input[name=theme]:checked');
      if (m) p.mode = m.value;
      if (sp) p.speed = sp.value;
      var ok = setPrefs(p);
      if (th) {
        try { if (th.value === 'auto') localStorage.removeItem('spark-theme'); else localStorage.setItem('spark-theme', th.value); } catch (e) { ok = false; }
        if (th.value === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = th.value;
      }
      form.classList.toggle('tab-off', !p.tab);
      say(ok ? 'Saved on this device.' : 'Could not save: your browser is blocking storage.');
    }
    form.addEventListener('change', sync);
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    form.classList.toggle('tab-off', !q('tab').checked);
    var pv = document.getElementById('prefs-preview');
    if (pv && siteOn) pv.addEventListener('click', function () {
      if (running()) { stop(); pv.textContent = 'Preview in this tab'; testing = false; return; }
      testing = true; start(); pv.textContent = 'Stop preview';
      if (!running()) { testing = false; pv.textContent = 'Preview in this tab'; say('The tab ticker is turned off.'); }
    });
    var note = document.getElementById('prefs-safari');
    if (note) note.hidden = !isSafari;
  }
})();

document.addEventListener('visibilitychange', function () { document.documentElement.classList.toggle('tabhid', document.hidden); });

/* add ?debug to any page address to see what the page is doing on your device */
(function () {
  if (!/[?&]debug\b/.test(location.search)) return;
  var original = document.title;
  var box = document.createElement('pre');
  box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99;max-width:92vw;background:#000;color:#0f0;padding:10px;font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px';
  document.body.appendChild(box);
  setInterval(function () {
    var track = document.querySelector('.track'), cs = track && getComputedStyle(track);
    var d = document.getElementById('spark-ticker-data'), n = 0;
    try { n = JSON.parse(d.textContent).items.length; } catch (e) {}
    box.textContent = [
      'site.js: running',
      'ticker bar: ' + (track ? 'found, animation=' + cs.animationName + ' ' + cs.animationPlayState + ' ' + cs.animationDuration : 'MISSING'),
      'headlines: ' + n,
      'document.hidden=' + document.hidden + '  hasFocus=' + document.hasFocus(),
      'tab title now: ' + document.title,
      'theme: ' + (document.documentElement.dataset.theme || 'system'),
      'errors: ' + (window.__sparkErrors.join(' | ') || 'none')
    ].join('\n');
  }, 400);
})();

/* shadow under the section bar once it sticks to the top */
(function () {
  var nb = document.querySelector('.navbar'); if (!nb) return;
  function f() { nb.classList.toggle('stuck', nb.getBoundingClientRect().top <= 0 && window.scrollY > 0); }
  window.addEventListener('scroll', f, { passive: true }); f();
})();
