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

  /* ---- light / dark toggle (remembers the choice) ---- */
  var tb = document.querySelector('.theme');
  if (tb) {
    tb.addEventListener('click', function () {
      var root = document.documentElement;
      var now = root.dataset.theme || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      var next = now === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('spark-theme', next); } catch (e) {}
    });
  }

  /* ---- tab title ticker: runs while the visitor is away from the page ---- */
  var el = document.getElementById('spark-ticker-data');
  if (!el) return;
  var data;
  try { data = JSON.parse(el.textContent); } catch (e) { return; }
  var t = data.tab, items = data.items || [];
  if (!t || !t.enabled || !items.length) return;

  var original = document.title, timer = null, startedAt = 0, testing = false;
  var sep = t.separator || '  ●  ';
  var text = (t.prefix || '') + items.join(sep) + sep;

  /* Position comes from elapsed time, not from counting ticks, so the speed stays
     right even when the browser slows timers down in a background tab. */
  function render() {
    var elapsed = Date.now() - startedAt;
    if (t.mode === 'headline') {
      var i = Math.floor(elapsed / (t.headline_interval_ms || 3000)) % items.length;
      document.title = (t.prefix || '') + items[i];
    } else {
      var win = t.window_chars || 34;
      var pos = (Math.floor(elapsed / (t.interval_ms || 350)) * (t.step || 2)) % text.length;
      var loop = text.repeat(Math.ceil((win * 2) / text.length) + 1);
      document.title = loop.substr(pos, win);
    }
  }
  function start() {
    if (timer) return;
    startedAt = Date.now();
    render();
    timer = setInterval(render, Math.min(t.interval_ms || 350, t.mode === 'headline' ? 500 : 350));
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer); timer = null;
    document.title = original;
  }

  /* leaving = switching tab / minimising, or the window losing focus (clicking another window) */
  document.addEventListener('visibilitychange', function () {
    if (testing) return;
    if (document.hidden) start(); else stop();
  });
  window.addEventListener('blur', function () {
    if (testing) return;
    /* clicking into an embedded quiz/interactive also fires blur; that is not leaving */
    setTimeout(function () {
      var a = document.activeElement;
      if (a && a.tagName === 'IFRAME') return;
      start();
    }, 0);
  });
  window.addEventListener('focus', function () { if (!testing) stop(); });
  if (document.hidden) start();

  /* add ?tickertest to any page address to preview the tab ticker without leaving; click the page to stop */
  if (/[?&]tickertest\b/.test(location.search)) {
    testing = true; start();
    document.addEventListener('click', function () { testing = false; stop(); }, { once: true });
  }
})();

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
