/* SparkNews site script. Settings come from site.json -> "ticker". */
(function () {
  var el = document.getElementById('spark-ticker-data');
  if (!el) return;
  var data;
  try { data = JSON.parse(el.textContent); } catch (e) { return; }
  var t = data.tab, items = data.items || [];
  if (!t || !t.enabled || !items.length) return;

  var original = document.title, timer = null, pos = 0, idx = 0;

  function tickScroll(text) {
    var win = t.window_chars || 34;
    var loop = text.repeat(Math.ceil((win * 2) / text.length) + 1);
    document.title = loop.substr(pos, win);
    pos = (pos + (t.step || 2)) % text.length;
  }
  function tickHeadline() {
    document.title = (t.prefix || '') + items[idx];
    idx = (idx + 1) % items.length;
  }
  function start() {
    if (timer) return;
    pos = 0; idx = 0;
    if (t.mode === 'headline') {
      tickHeadline();
      timer = setInterval(tickHeadline, t.headline_interval_ms || 3000);
    } else {
      var text = (t.prefix || '') + items.join(t.separator || '  ●  ') + (t.separator || '  ●  ');
      tickScroll(text);
      timer = setInterval(function () { tickScroll(text); }, t.interval_ms || 350);
    }
  }
  function stop() {
    clearInterval(timer); timer = null;
    document.title = original;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) start(); else stop();
  });
})();
