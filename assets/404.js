/* 404 page game: catch the headlines, dodge the 404s. Keys: arrows or A/D, or drag on touch. */
(function () {
  var cv = document.getElementById('game'); if (!cv) return;
  var g = cv.getContext('2d'), W = 360, H = 480, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; g.scale(dpr, dpr);
  var css = getComputedStyle(document.documentElement);
  var pink = (css.getPropertyValue('--spark') || '#fe2c55').trim() || '#fe2c55', ink = (css.getPropertyValue('--head') || '#110c4a').trim() || '#110c4a';
  var btn = document.getElementById('gstart'), scoreEl = document.getElementById('gscore'), bestEl = document.getElementById('gbest'), msg = document.getElementById('gmsg');
  var best = 0; try { best = parseInt(localStorage.getItem('spark-404-best'), 10) || 0; } catch (e) {}
  bestEl.textContent = best;
  var HEADS = ['Cat elected mayor', 'Local page found!', 'Coffee prices fall', 'Robot learns to knit', 'Moon gets new zip code', 'Sun rises again', 'Typo wins prize', 'Bus arrives early'];
  var s, raf, keys = {}, running = false, last = 0, tx = null;
  function reset() { s = { x: W / 2, score: 0, lives: 3, items: [], t: 0, spawn: 0, shake: 0, pops: [] }; }
  reset();
  function spawn() {
    var bad = Math.random() < Math.min(0.55, 0.3 + s.score / 120);
    s.items.push({ x: 30 + Math.random() * (W - 60), y: -30, v: 70 + s.score * 2.2 + Math.random() * 50, bad: bad, w: bad ? 54 : 92, txt: bad ? '404' : HEADS[(Math.random() * HEADS.length) | 0] });
  }
  function pop(x, y, t, c) { s.pops.push({ x: x, y: y, t: t, c: c, a: 1 }); }
  function step(dt) {
    var sp = 260 * dt;
    if (keys.ArrowLeft || keys.a) s.x -= sp; if (keys.ArrowRight || keys.d) s.x += sp;
    if (tx !== null) s.x += (tx - s.x) * Math.min(1, dt * 14);
    s.x = Math.max(24, Math.min(W - 24, s.x));
    s.spawn -= dt; if (s.spawn <= 0) { spawn(); s.spawn = Math.max(0.35, 0.9 - s.score / 90); }
    s.items.forEach(function (it) { it.y += it.v * dt; });
    s.items = s.items.filter(function (it) {
      var hit = Math.abs(it.x - s.x) < it.w / 2 + 14 && it.y > H - 74 && it.y < H - 20;
      if (hit) {
        if (it.bad) { s.lives--; s.shake = 0.35; pop(it.x, it.y, 'ouch', '#e03'); } else { s.score++; pop(it.x, it.y, '+1', pink); }
        scoreEl.textContent = s.score; return false;
      }
      return it.y < H + 30;
    });
    s.pops.forEach(function (p) { p.y -= 40 * dt; p.a -= dt * 1.4; }); s.pops = s.pops.filter(function (p) { return p.a > 0; });
    s.shake = Math.max(0, s.shake - dt);
    if (s.lives <= 0) over();
  }
  function atom(x, y) {
    g.save(); g.translate(x, y); g.strokeStyle = pink; g.lineWidth = 2.5;
    for (var i = 0; i < 3; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.ellipse(0, 0, 22, 8, 0, 0, 7); g.stroke(); }
    g.fillStyle = pink; g.beginPath(); g.arc(0, 0, 5.5, 0, 7); g.fill(); g.restore();
  }
  function draw() {
    var sh = s.shake ? (Math.random() - 0.5) * 8 : 0;
    g.save(); g.translate(sh, 0);
    var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, ink); gr.addColorStop(1, '#2a1c8f'); g.fillStyle = gr; g.fillRect(-10, 0, W + 20, H);
    g.fillStyle = 'rgba(255,255,255,.5)'; for (var i = 0; i < 24; i++) g.fillRect((i * 97) % W, (i * 53 + s.t * 18) % H, 2, 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    s.items.forEach(function (it) {
      g.save(); g.translate(it.x, it.y);
      if (it.bad) { g.fillStyle = '#e03'; g.fillRect(-27, -20, 54, 40); g.fillStyle = '#fff'; g.font = '800 22px system-ui,sans-serif'; g.fillText('404', 0, 1); }
      else { g.fillStyle = '#fff'; g.fillRect(-46, -17, 92, 34); g.fillStyle = pink; g.fillRect(-46, -17, 4, 34); g.fillStyle = ink; g.font = '700 10px system-ui,sans-serif'; g.fillText(it.txt, 2, 1, 80); }
      g.restore();
    });
    atom(s.x, H - 44);
    g.font = '800 16px system-ui,sans-serif';
    s.pops.forEach(function (p) { g.globalAlpha = Math.max(0, p.a); g.fillStyle = p.c; g.fillText(p.t, p.x, p.y); g.globalAlpha = 1; });
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = '700 14px system-ui,sans-serif'; g.fillText('♥'.repeat(Math.max(0, s.lives)), 12, 20);
    g.restore();
  }
  function loop(ts) {
    if (!running) return;
    var dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts; s.t += dt; step(dt); draw(); raf = requestAnimationFrame(loop);
  }
  function start() { reset(); scoreEl.textContent = '0'; msg.textContent = ''; btn.hidden = true; running = true; last = performance.now(); cv.focus(); raf = requestAnimationFrame(loop); }
  function over() {
    running = false; cancelAnimationFrame(raf); draw();
    if (s.score > best) { best = s.score; bestEl.textContent = best; try { localStorage.setItem('spark-404-best', best); } catch (e) {} msg.textContent = 'New best: ' + s.score + '! Not bad for a missing page.'; }
    else msg.textContent = s.score ? 'You caught ' + s.score + ' headline' + (s.score === 1 ? '' : 's') + '. The real page is still missing, though.' : 'Zero headlines. The 404s win this round.';
    btn.textContent = 'Play again'; btn.hidden = false; btn.focus();
  }
  btn.addEventListener('click', start);
  window.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd') { keys[k] = true; if (running) e.preventDefault(); }
    if (e.key === ' ' && !running && document.activeElement === cv) { e.preventDefault(); start(); }
  });
  window.addEventListener('keyup', function (e) { keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
  function pos(e) { var r = cv.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; return (t.clientX - r.left) / r.width * W; }
  ['pointerdown', 'pointermove'].forEach(function (n) { cv.addEventListener(n, function (e) { if (running && (n === 'pointerdown' || e.buttons || e.pointerType === 'touch')) { tx = pos(e); } }); });
  cv.addEventListener('pointerup', function () { tx = null; }); cv.addEventListener('pointerleave', function () { tx = null; });
  document.addEventListener('visibilitychange', function () { if (document.hidden && running) { running = false; cancelAnimationFrame(raf); msg.textContent = 'Paused. Press the button to carry on.'; btn.textContent = 'Resume'; btn.hidden = false; btn.onclick = function () { btn.onclick = null; msg.textContent = ''; btn.hidden = true; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }; } });
  draw();
})();
