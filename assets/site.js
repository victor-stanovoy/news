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
    var lp = document.getElementById('listen-pref');
    if (lp) { try { lp.checked = localStorage.getItem('spark-listen-off') !== '1'; } catch (e) { lp.checked = true; }
      lp.addEventListener('change', function () { try { if (lp.checked) localStorage.removeItem('spark-listen-off'); else localStorage.setItem('spark-listen-off', '1'); } catch (e) {} }); }
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
    var sizeNow = ''; try { sizeNow = localStorage.getItem('spark-size') || ''; } catch (e) {}
    [].forEach.call(form.querySelectorAll('input[name=size]'), function (r) { r.checked = r.value === sizeNow; });
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
      var sz = form.querySelector('input[name=size]:checked');
      if (sz) {
        try { if (!sz.value) localStorage.removeItem('spark-size'); else localStorage.setItem('spark-size', sz.value); } catch (e) { ok = false; }
        if (!sz.value) document.documentElement.removeAttribute('data-size'); else document.documentElement.dataset.size = sz.value;
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

/* ---- small comforts ---- */
(function () {
  var root = document.documentElement;
  /* the browser's address bar takes the colour of the current look */
  function tint() {
    var m = document.querySelector('meta[name=theme-color]'); if (!m || !document.body) return;
    var c = getComputedStyle(document.body).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') m.setAttribute('content', c);
  }
  tint(); try { new MutationObserver(tint).observe(root, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) {}
  /* "/" jumps to search, like most news and code sites */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName) || (e.target && e.target.isContentEditable)) return;
    var box = document.querySelector('input[type=search], #q'); if (box) { e.preventDefault(); box.focus(); return; }
    var link = document.querySelector('a[href$="search.html"]'); if (link) { e.preventDefault(); location.href = link.href; }
  });
  /* copy link */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.copylink'); if (!b) return;
    var url = b.getAttribute('data-copy') || location.href.split('#')[0], old = b.textContent;
    function done(okk) { b.textContent = okk ? 'Copied' : 'Press Ctrl+C'; b.classList.toggle('done', okk); setTimeout(function () { b.textContent = old; b.classList.remove('done'); }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); else done(false);
  });
  /* the section bar tucks away while you read down the page and returns as soon as you scroll up */
  var nav = document.querySelector('.navbar');
  if (nav && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    var last = window.scrollY, tick = false;
    addEventListener('scroll', function () {
      if (tick) return; tick = true;
      requestAnimationFrame(function () {
        tick = false; var y = window.scrollY, d = y - last;
        if (Math.abs(d) < 8) return;
        nav.classList.toggle('tuck', d > 0 && y > 360 && !nav.contains(document.activeElement)); last = y;
      });
    }, { passive: true });
    nav.addEventListener('focusin', function () { nav.classList.remove('tuck'); });
  }
  /* saved articles: a list kept in this browser (needs the Preferences choice in the cookie banner, like other settings) */
  var SK = 'spark-saved';
  function saved() { try { var v = JSON.parse(localStorage.getItem(SK) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function keep(v) { try { localStorage.setItem(SK, JSON.stringify(v.slice(0, 60))); } catch (e) {} }
  var sb = document.querySelector('.savebtn');
  if (sb) {
    var me = location.pathname, has = function () { return saved().some(function (x) { return x.u === me; }); };
    var paint = function () { var on = has(); sb.setAttribute('aria-pressed', on ? 'true' : 'false'); sb.textContent = on ? 'Saved ✓' : 'Save'; sb.classList.toggle('done', on); };
    sb.addEventListener('click', function () {
      var v = saved(), h = document.querySelector('h1');
      if (has()) v = v.filter(function (x) { return x.u !== me; }); else v.unshift({ u: me, t: (h ? h.textContent : document.title).trim() });
      keep(v); paint();
    });
    paint();
  }
  var sl = document.getElementById('saved-list');
  if (sl) {
    var draw = function () {
      var v = saved(); sl.textContent = '';
      v.forEach(function (x) {
        var li = document.createElement('li'), a = document.createElement('a'), r = document.createElement('button');
        a.href = x.u; a.textContent = x.t; r.type = 'button'; r.className = 'unsave'; r.textContent = '✕'; r.setAttribute('aria-label', 'Remove');
        r.addEventListener('click', function () { keep(saved().filter(function (y) { return y.u !== x.u; })); draw(); });
        li.appendChild(a); li.appendChild(r); sl.appendChild(li);
      });
      var n = document.getElementById('saved-none'); if (n) n.hidden = v.length > 0;
    };
    draw();
  }
  var ws = document.getElementById('wsaved-list');
  if (ws) { var sv = saved().slice(0, 4); if (sv.length) { sv.forEach(function (x) { var li = document.createElement('li'), a = document.createElement('a'); a.href = x.u; a.textContent = x.t; li.appendChild(a); ws.appendChild(li); }); document.getElementById('wsaved').hidden = false; } }
  /* article pictures: slideshow buttons and the full-screen viewer (cover + extra pictures) */
  (function () {
    var cover = document.querySelector('figure.cover'), gal = document.querySelector('[data-gallery]');
    var figs = [].slice.call(document.querySelectorAll('figure.cover, [data-gallery] figure'));
    if (!figs.length) return;
    var lbl = function (t) { return (window.SparkI18n && window.SparkI18n.t) ? window.SparkI18n.t(t) : t; };
    if (gal && gal.classList.contains('slideshow')) {
      var strip = document.createElement('div'); strip.className = 'strip';
      [].slice.call(gal.children).forEach(function (f) { strip.appendChild(f); }); gal.appendChild(strip);
      var n = strip.children.length, cnt = document.createElement('span'); cnt.className = 'gal-count'; gal.appendChild(cnt);
      var cur = function () { return Math.round(Math.abs(strip.scrollLeft) / Math.max(1, strip.clientWidth)); };
      var upd = function () { cnt.textContent = (cur() + 1) + ' / ' + n; };
      var go = function (d) { var k = Math.max(0, Math.min(n - 1, cur() + d)); strip.scrollTo({ left: (document.dir === 'rtl' ? -1 : 1) * k * strip.clientWidth, behavior: 'smooth' }); };
      if (n > 1) {
        [['gal-prev', '‹', -1, 'Previous'], ['gal-next', '›', 1, 'Next']].forEach(function (b) {
          var el = document.createElement('button'); el.type = 'button'; el.className = 'gal-btn ' + b[0]; el.textContent = b[1]; el.setAttribute('aria-label', b[3]);
          el.addEventListener('click', function (e) { e.stopPropagation(); go(b[2]); }); gal.appendChild(el);
        });
        strip.addEventListener('scroll', function () { clearTimeout(strip._t); strip._t = setTimeout(upd, 60); }); upd();
      } else cnt.hidden = true;
    }
    var box = null, idx = 0, items = [];
    figs.forEach(function (f, k) {
      var im = f.querySelector('img'); if (!im) return;
      im.addEventListener('click', function () { open(f); });
    });
    function collect() { return [].slice.call(document.querySelectorAll('figure.cover, [data-gallery] figure')).filter(function (f) { return f.querySelector('img'); }); }
    function show() {
      var f = items[idx], im = f.querySelector('img'), cap = f.querySelector('figcaption'), credit = f.getAttribute('data-credit') || '';
      var text = ''; if (cap) { var c = cap.cloneNode(true); [].slice.call(c.querySelectorAll('.pcred')).forEach(function (x) { x.remove(); }); text = c.textContent.trim(); }
      box.querySelector('img').src = im.currentSrc || im.src; box.querySelector('img').alt = im.alt || '';
      var p = box.querySelector('p'); p.textContent = text; var sm = document.createElement('small'); sm.textContent = 'Photo: ' + credit; p.appendChild(sm);
      box.querySelector('.lb-c').textContent = items.length > 1 ? (idx + 1) + ' / ' + items.length : '';
      box.querySelector('.lb-p').hidden = box.querySelector('.lb-n').hidden = items.length < 2;
    }
    function step(d) { idx = (idx + d + items.length) % items.length; show(); }
    function close() { if (!box) return; box.hidden = true; document.body.style.overflow = ''; document.removeEventListener('keydown', key); if (box._from) box._from.focus(); }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') step(document.dir === 'rtl' ? -1 : 1); else if (e.key === 'ArrowLeft') step(document.dir === 'rtl' ? 1 : -1); }
    function open(f) {
      items = collect(); idx = Math.max(0, items.indexOf(f));
      if (!box) {
        box = document.createElement('div'); box.className = 'lb'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Picture viewer');
        box.innerHTML = '<span class="lb-c"></span><button type="button" class="lb-x" aria-label="Close">✕</button><button type="button" class="lb-p" aria-label="Previous">‹</button><img alt=""><p></p><button type="button" class="lb-n" aria-label="Next">›</button>';
        box.addEventListener('click', function (e) { if (e.target === box) close(); });
        box.querySelector('.lb-x').addEventListener('click', close);
        box.querySelector('.lb-p').addEventListener('click', function () { step(-1); }); box.querySelector('.lb-n').addEventListener('click', function () { step(1); });
        var x0 = null; box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
        box.addEventListener('touchend', function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); });
        document.body.appendChild(box);
      }
      box._from = document.activeElement; box.hidden = false; document.body.style.overflow = 'hidden'; show(); box.querySelector('.lb-x').focus(); document.addEventListener('keydown', key);
    }
  })();
})();
