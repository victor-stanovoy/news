/* Small motion touches: scroll reveals, reading progress, button ripples, back-to-top. Only transforms and opacity, off for reduced motion. */
(function () {
  'use strict';
  var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) return;
  var root = document.documentElement;
  root.classList.add('fx');

  /* scroll reveal, only for things below the first screen so the first paint is never delayed */
  var SEL = '.card, .rowc, .sec, .spotlight, .nlbox .nlin, .rel, .share, .pollcard, .lvcard, .catband .grid4, .aboutpage > *';
  var els = [].slice.call(document.querySelectorAll(SEL)).filter(function (e) { return e.getBoundingClientRect().top > innerHeight * 0.92; });
  if ('IntersectionObserver' in window && els.length) {
    var seen = new Map();
    els.forEach(function (e) {
      var sib = e.parentNode ? [].indexOf.call(e.parentNode.children, e) : 0;
      e.style.setProperty('--i', Math.min(sib, 5));
      e.classList.add('rv');
    });
    var io = new IntersectionObserver(function (list) {
      list.forEach(function (x) { if (x.isIntersecting || x.boundingClientRect.top < 0) { x.target.classList.add('in'); io.unobserve(x.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(function () { els.forEach(function (e) { e.classList.add('in'); }); }, 6000);   /* never leave anything hidden */
  }

  /* reading progress on articles, and back to top */
  var art = document.querySelector('main[data-page=article] article');
  var bar = null;
  if (art) { bar = document.createElement('div'); bar.className = 'rprog'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar); }
  var up = document.createElement('button');
  up.type = 'button'; up.className = 'totop'; up.setAttribute('aria-label', 'Back to top'); up.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V6m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>';
  document.body.appendChild(up);
  up.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  var tick = false, pending = typeof els !== 'undefined' ? els.slice() : [];
  function frame() {
    tick = false;
    var y = window.scrollY || 0;
    up.classList.toggle('show', y > 700);
    if (pending.length) pending = pending.filter(function (e) {      /* a fast jump can skip past items without the observer ever seeing them */
      if (e.classList.contains('in')) return false;
      if (e.getBoundingClientRect().top < innerHeight * 0.92) { e.classList.add('in'); return false; }
      return true;
    });
    if (bar && art) {
      var r = art.getBoundingClientRect(), total = Math.max(1, r.height - innerHeight * 0.6);
      bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, (-r.top + innerHeight * 0.2) / total)) + ')';
    }
  }
  addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(frame); } }, { passive: true });
  frame();

  /* ripple on buttons */
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('button, .btn, .spmore, .share a, .cc-btn');
    if (!b || b.disabled || b.classList.contains('totop')) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, d = document.createElement('span');
    d.className = 'rip'; d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden'; b.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 650);
  }, { passive: true });
})();
