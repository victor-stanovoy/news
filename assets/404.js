/* SparkNews 404 page: suggestions from the address, plus a little game. Arrow keys / A D / mouse / touch. */
(function () {
  'use strict';
  var root = (window.__root || '/');
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }

  /* ---------- "Maybe you were looking for" ---------- */
  var box = document.getElementById('lostsug');
  if (box) fetch(root + 'search.json').then(function (r) { return r.json(); }).then(function (list) {
    if (!Array.isArray(list) || !list.length) return;
    var stop = { html: 1, news: 1, index: 1, the: 1, and: 1, a: 1, www: 1 };
    var toks = decodeURIComponent(location.pathname).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && !stop[w]; });
    var scored = list.map(function (x) {
      var hay = ((x.t || '') + ' ' + (x.u || '') + ' ' + (x.c || '')).toLowerCase(), n = 0;
      toks.forEach(function (w) { if (hay.indexOf(w) >= 0) n++; });
      return { x: x, n: n };
    }).filter(function (o) { return o.n > 0; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 4).map(function (o) { return o.x; });
    var guess = scored.length > 0;
    var show = guess ? scored : list.slice().sort(function (a, b) { return String(b.d).localeCompare(String(a.d)); }).slice(0, 4);
    box.appendChild(el('h2', '', guess ? 'Maybe you were looking for' : 'Fresh from the newsroom'));
    var ul = el('ul', 'lostlist');
    show.forEach(function (x) {
      var li = el('li'), a = el('a', '', x.t); a.href = root + x.u; li.appendChild(a);
      if (x.c) li.appendChild(el('small', '', x.c)); ul.appendChild(li);
    });
    box.appendChild(ul); box.hidden = false;
    var rnd = document.getElementById('lostrand');
    if (rnd) { rnd.hidden = false; rnd.addEventListener('click', function () { location.href = root + list[(Math.random() * list.length) | 0].u; }); }
  }).catch(function () {});

  /* ---------- the game ---------- */
  var cv = document.getElementById('game'); if (!cv) return;
  var W = 400, H = 500, dpr = Math.min(2, window.devicePixelRatio || 1), g = cv.getContext('2d');
  cv.width = W * dpr; cv.height = H * dpr; g.scale(dpr, dpr);
  var css = getComputedStyle(document.documentElement);
  function v(n, d) { return (css.getPropertyValue(n) || '').trim() || d; }
  var PINK = v('--spark', '#fe2c55'), NAVY = v('--head', '#110c4a');
  var HEADS = ['Cat elected mayor', 'Local page found!', 'Coffee prices fall', 'Robot learns to knit', 'Moon gets a zip code', 'Sun rises again', 'Typo wins prize', 'Bus arrives early', 'Pigeon joins council', 'Wi-Fi reaches Mars'];
  var best = 0; try { best = parseInt(localStorage.getItem('spark-404-best'), 10) || 0; } catch (e) {}
  var scoreEl = document.getElementById('gscore'), bestEl = document.getElementById('gbest'), livesEl = document.getElementById('glives');
  bestEl.textContent = best;
  var stars = []; for (var i = 0; i < 60; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 1.2 });
  var s, mode = 'idle', last = 0, raf = 0, keys = {}, tx = null;
  function reset() { s = { x: W / 2, score: 0, lives: 3, items: [], spawn: 0.4, time: 0, combo: 0, shake: 0, pops: [], parts: [], flash: 0 }; paintHud(); }
  function paintHud() { scoreEl.textContent = s.score; if (livesEl) livesEl.textContent = '♥'.repeat(Math.max(0, s.lives)) + '♡'.repeat(Math.max(0, 3 - s.lives)); }
  reset();

  function spawn() {
    var bad = Math.random() < Math.min(0.5, 0.28 + s.time / 160);
    s.items.push({ x: 40 + Math.random() * (W - 80), y: -30, vy: 80 + s.time * 3 + Math.random() * 50, bad: bad, w: bad ? 58 : 104, txt: bad ? '404' : HEADS[(Math.random() * HEADS.length) | 0], rot: (Math.random() - 0.5) * 0.25 });
  }
  function burst(x, y, c, n) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, sp = 40 + Math.random() * 140; s.parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 0.5 + Math.random() * 0.4, c: c }); } }
  function end() {
    mode = 'over'; s.flash = 0;
    if (s.score > best) { best = s.score; bestEl.textContent = best; try { localStorage.setItem('spark-404-best', String(best)); } catch (e) {} s.newBest = true; }
    document.getElementById('gmsg').textContent = 'Game over. You caught ' + s.score + ' headline' + (s.score === 1 ? '' : 's') + (s.newBest ? ' (new best!)' : '') + '.';
  }
  function step(dt) {
    s.time += dt;
    var sp = 320 * dt;
    if (keys.ArrowLeft || keys.a) { s.x -= sp; tx = null; } if (keys.ArrowRight || keys.d) { s.x += sp; tx = null; }
    if (tx !== null) s.x += (tx - s.x) * Math.min(1, dt * 16);
    s.x = Math.max(26, Math.min(W - 26, s.x));
    s.spawn -= dt; if (s.spawn <= 0) { spawn(); s.spawn = Math.max(0.32, 0.85 - s.time / 110); }
    for (var i = s.items.length - 1; i >= 0; i--) {
      var it = s.items[i]; it.y += it.vy * dt;
      var hit = Math.abs(it.x - s.x) < it.w / 2 + 16 && it.y > H - 84 && it.y < H - 26;
      if (hit) {
        s.items.splice(i, 1);
        if (it.bad) { s.lives--; s.combo = 0; s.shake = 0.35; s.flash = 0.25; burst(it.x, it.y, '#ff4d4d', 18); s.pops.push({ x: it.x, y: it.y, t: 'Ouch!', c: '#ff7a7a', a: 1 }); paintHud(); if (s.lives <= 0) end(); }
        else { s.combo++; var pts = 1 + (s.combo >= 5 ? 1 : 0) + (s.combo >= 10 ? 1 : 0); s.score += pts; burst(it.x, it.y, PINK, 10); s.pops.push({ x: it.x, y: it.y, t: '+' + pts + (s.combo >= 5 ? ' combo' : ''), c: '#fff', a: 1 }); paintHud(); }
      } else if (it.y > H + 40) { s.items.splice(i, 1); if (!it.bad) s.combo = 0; }
    }
    s.parts.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.life -= dt; }); s.parts = s.parts.filter(function (p) { return p.life > 0; });
    s.pops.forEach(function (p) { p.y -= 34 * dt; p.a -= dt * 1.2; }); s.pops = s.pops.filter(function (p) { return p.a > 0; });
    if (s.shake > 0) s.shake -= dt; if (s.flash > 0) s.flash -= dt;
  }
  function atom(x, y, t) {
    g.save(); g.translate(x, y);
    g.shadowColor = PINK; g.shadowBlur = 18; g.strokeStyle = PINK; g.lineWidth = 2.6;
    for (var k = 0; k < 3; k++) { g.save(); g.rotate(k * Math.PI / 3 + t * 0.8); g.beginPath(); g.ellipse(0, 0, 24, 9.5, 0, 0, 6.283); g.stroke(); g.restore(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 5.5, 0, 6.283); g.fill(); g.restore();
  }
  function draw(now) {
    var sh = s.shake > 0 ? (Math.random() - 0.5) * 9 : 0;
    g.save(); g.translate(sh, sh);
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0c0836'); gr.addColorStop(1, '#2a1b78'); g.fillStyle = gr; g.fillRect(-10, -10, W + 20, H + 20);
    stars.forEach(function (st) { if (mode === 'play') { st.y += st.z * 24 * 0.016; if (st.y > H) { st.y = 0; st.x = Math.random() * W; } } g.globalAlpha = 0.25 + st.z * 0.35; g.fillStyle = '#fff'; g.fillRect(st.x, st.y, st.z * 1.8, st.z * 1.8); }); g.globalAlpha = 1;
    s.items.forEach(function (it) {
      g.save(); g.translate(it.x, it.y); g.rotate(it.rot);
      if (it.bad) { g.fillStyle = '#e8003d'; g.shadowColor = '#e8003d'; g.shadowBlur = 14; g.fillRect(-it.w / 2, -20, it.w, 40); g.shadowBlur = 0; g.fillStyle = '#fff'; g.font = '800 22px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('404', 0, 1); }
      else { g.fillStyle = '#fff'; g.fillRect(-it.w / 2, -16, it.w, 32); g.fillStyle = PINK; g.fillRect(-it.w / 2, -16, 5, 32); g.fillStyle = NAVY; g.font = '700 11px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(it.txt, 2, 1, it.w - 14); }
      g.restore();
    });
    s.parts.forEach(function (p) { g.globalAlpha = Math.max(0, p.life * 1.6); g.fillStyle = p.c; g.fillRect(p.x, p.y, 3, 3); }); g.globalAlpha = 1;
    atom(s.x, H - 50, now / 1000);
    s.pops.forEach(function (p) { g.globalAlpha = Math.max(0, p.a); g.fillStyle = p.c; g.font = '800 15px Inter,system-ui,sans-serif'; g.textAlign = 'center'; g.fillText(p.t, p.x, p.y); }); g.globalAlpha = 1;
    if (s.flash > 0) { g.fillStyle = 'rgba(232,0,61,' + s.flash * 0.8 + ')'; g.fillRect(-10, -10, W + 20, H + 20); }
    g.restore();
    if (mode !== 'play') {
      g.fillStyle = 'rgba(12,8,54,.72)'; g.fillRect(0, 0, W, H); g.textAlign = 'center'; g.fillStyle = '#fff';
      g.font = '900 34px Inter,system-ui,sans-serif'; g.fillText(mode === 'over' ? 'Game over' : (mode === 'pause' ? 'Paused' : 'Catch the news'), W / 2, H / 2 - 40);
      g.font = '600 15px Inter,system-ui,sans-serif'; g.fillStyle = '#c9c6f0';
      g.fillText(mode === 'over' ? 'Score ' + s.score + (s.newBest ? '  ·  new best!' : '') : 'Collect headlines. Dodge the 404s.', W / 2, H / 2 - 8);
      g.fillStyle = PINK; g.fillRect(W / 2 - 78, H / 2 + 20, 156, 44); g.fillStyle = '#fff'; g.font = '800 16px Inter,system-ui,sans-serif';
      g.fillText(mode === 'over' ? 'Play again' : (mode === 'pause' ? 'Resume' : 'Play'), W / 2, H / 2 + 48);
    }
  }
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    if (mode === 'play') step(dt);
    draw(now);
    if (mode === 'play' || mode === 'over' || mode === 'idle' || mode === 'pause') raf = requestAnimationFrame(frame);
  }
  function start() { if (mode === 'over' || mode === 'idle') reset(); mode = 'play'; document.getElementById('gmsg').textContent = ''; cv.focus({ preventScroll: true }); last = performance.now(); }
  function pause() { if (mode === 'play') mode = 'pause'; }
  function toGame(e) { var r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
  cv.addEventListener('pointerdown', function (e) { if (mode !== 'play') { start(); } tx = toGame(e).x; try { cv.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
  cv.addEventListener('pointermove', function (e) { if (mode === 'play' && (e.buttons || e.pointerType === 'mouse')) tx = toGame(e).x; });
  window.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') { keys[k] = true; if (mode === 'play') e.preventDefault(); if (mode !== 'play' && document.activeElement === cv) start(); }
    else if ((k === ' ' || k === 'Enter') && document.activeElement === cv) { e.preventDefault(); if (mode === 'play') pause(); else start(); }
    else if (k === 'p' || k === 'Escape') pause();
  });
  window.addEventListener('keyup', function (e) { var k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = false; });
  window.addEventListener('blur', pause); document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });
  raf = requestAnimationFrame(frame);
  window.__game404 = { state: function () { return { mode: mode, score: s.score, lives: s.lives, x: s.x }; } };
})();
