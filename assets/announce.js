/* SparkNews announcements: coloured bars above the header and pop-ups, with start/end times and "close" memory. */
(function () {
  'use strict';
  var el = document.getElementById('ann-data'), cfg = null;
  try { cfg = JSON.parse(el.textContent); } catch (e) { return; }
  if (!cfg || !cfg.items) return;
  var mem = {};
  function seen(id, v) {
    var k = 'spark-ann-' + id;
    try { if (v === undefined) return (cfg.lock ? mem[k] : localStorage.getItem(k)) === '1'; if (cfg.lock) mem[k] = '1'; else localStorage.setItem(k, '1'); } catch (e) { if (v === undefined) return !!mem[k]; mem[k] = '1'; }
    return false;
  }
  function mk(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function href(l) { return /^https?:\/\//i.test(l) ? l : cfg.root + l.replace(/^\/+/, ''); }
  var now = Date.now(), bars = [], pops = [];
  cfg.items.forEach(function (a) {
    if (a.where === 'home' && !cfg.home) return;
    if (a.start && Date.parse(a.start) > now) return;
    if (a.end && Date.parse(a.end) < now) return;
    if (a.dismissible !== false && seen(a.id)) return;
    (a.mode === 'popup' ? pops : bars).push(a);
  });
  function link(a, p) { if (!a.link) return; var l = mk('a', 'annlink', a.link_label || 'Read more'); l.href = href(a.link); if (/^https?:\/\//i.test(a.link) && a.link.indexOf(location.origin) !== 0) { l.target = '_blank'; l.rel = 'noopener noreferrer'; } p.appendChild(l); }
  var wrap = null;
  bars.forEach(function (a) {
    if (!wrap) { wrap = mk('div', 'annwrap'); var skip = document.querySelector('.skip'); document.body.insertBefore(wrap, skip ? skip.nextSibling : document.body.firstChild); }
    var b = mk('div', 'annbar ann-' + a.style); b.setAttribute('role', 'status');
    var in_ = mk('div', 'anninner'); in_.appendChild(mk('span', 'anntext', a.text)); link(a, in_); b.appendChild(in_);
    if (a.dismissible !== false) { var x = mk('button', 'annx', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close this announcement'); x.onclick = function () { seen(a.id, 1); b.remove(); }; b.appendChild(x); }
    wrap.appendChild(b);
  });
  if (pops.length) {
    var a = pops[0], prev = document.activeElement;
    var ov = mk('div', 'annov'), box = mk('div', 'annpop ann-' + a.style); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Announcement');
    box.appendChild(mk('p', 'annptext', a.text)); var row = mk('div', 'annrow'); link(a, row);
    var ok = mk('button', 'annok', 'Got it'); ok.type = 'button'; row.appendChild(ok); box.appendChild(row); ov.appendChild(box);
    function close() { seen(a.id, 1); ov.remove(); document.removeEventListener('keydown', key); try { prev && prev.focus && prev.focus(); } catch (e) {} }
    function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'Tab') { var f = box.querySelectorAll('a,button'); if (!f.length) return; var first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }
    ok.onclick = close; ov.addEventListener('click', function (e) { if (e.target === ov) close(); }); document.addEventListener('keydown', key);
    setTimeout(function () { document.body.appendChild(ov); ok.focus(); }, 600);
  }
})();
