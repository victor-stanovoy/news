/* Cookie and storage choices + click-to-play videos. No trackers here: this only decides what the site may keep in your browser. */
(function () {
  'use strict';
  var KEY = 'spark-consent', VERSION = 1;
  var ROOT = document.currentScript ? document.currentScript.src.replace(/assets\/consent\.js.*$/, '') : '';
  var listeners = [];

  function read() { try { var v = JSON.parse(localStorage.getItem(KEY)); return v && v.v === VERSION ? v : null; } catch (e) { return null; } }
  function write(c) { c.v = VERSION; c.t = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  var state = read();
  function allowed(cat) { return cat === 'necessary' ? true : !!(state && state[cat]); }

  /* Preferences off: the site may still use the choice for this visit, but nothing is written to the browser.
     Necessary keys stay: this choice, the maintenance bypass and the poll vote memory (so nobody votes twice). */
  var nativeSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (this === window.localStorage && /^spark[-_]/.test(k) && !/^spark-(consent|bypass|vot)/.test(k) && !allowed('prefs')) return;
    return nativeSet.call(this, k, v);
  };
  function wipePrefs() {
    try { Object.keys(localStorage).forEach(function (k) { if (/^spark[-_]/.test(k) && !/^spark-(consent|bypass|vot)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
  }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }
  function save(c) {
    state = c; write(c);
    if (!c.prefs) wipePrefs();
    if (c.media) openGates();
    emit();
  }

  /* ---------- banner ---------- */
  var box = null;

  function toggleRow(id, title, text, on, locked) {
    var inp = h('input', { type: 'checkbox', id: 'cc-' + id });
    inp.checked = on; if (locked) { inp.disabled = true; inp.checked = true; }
    var lab = h('label', { 'for': 'cc-' + id, 'class': 'cc-row' }, [
      h('span', { 'class': 'cc-rt' }, [h('b', { text: title }), h('small', { text: text })]),
      inp, h('span', { 'class': 'cc-sw', 'aria-hidden': 'true' })]);
    return { el: lab, input: inp };
  }

  function close() {
    if (!box) return;
    var b = box; box = null; b.classList.add('out');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 450);
  }

  function open(openPanel) {
    if (box) { box.querySelector('.cc-card').focus(); return; }
    var prefs = toggleRow('prefs', 'Preferences', 'Remember display settings such as dark mode, ticker options, volume and dismissed notices on this device.', allowed('prefs'));
    var media = toggleRow('media', 'Embedded videos', 'Play YouTube videos without asking each time. YouTube then receives your visit data.', allowed('media'));
    var nec = toggleRow('nec', 'Strictly necessary', 'Stores this choice and prevents duplicate poll votes. Always on.', true, true);
    var panel = h('div', { 'class': 'cc-panel', id: 'cc-panel' }, [h('div', { 'class': 'cc-pin' }, [nec.el, prefs.el, media.el,
      h('div', { 'class': 'cc-actions' }, [
        h('button', { type: 'button', 'class': 'cc-btn cc-main', 'data-a': 'save', text: 'Save choices' })])])]);
    var card = h('div', { 'class': 'cc-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'cc-t', 'aria-describedby': 'cc-d', tabindex: '-1' }, [
      h('p', { 'class': 'cc-eyebrow', text: 'Privacy' }),
      h('h2', { id: 'cc-t', text: 'Your privacy choices' }),
      h('p', { id: 'cc-d', html: 'We use no analytics and show no ads. With your permission, we store display preferences on this device and load embedded YouTube videos. <a href="' + ROOT + 'privacy/index.html">Privacy policy</a>' }),
      h('div', { 'class': 'cc-actions' }, [
        h('button', { type: 'button', 'class': 'cc-btn', 'data-a': 'none', text: 'Only necessary' }),
        h('button', { type: 'button', 'class': 'cc-btn cc-main', 'data-a': 'all', text: 'Accept all' }),
        h('button', { type: 'button', 'class': 'cc-link', 'data-a': 'custom', 'aria-expanded': 'false', 'aria-controls': 'cc-panel', text: 'Customise' })]),
      panel]);
    box = h('div', { 'class': 'cc' }, [card]);
    document.body.appendChild(box);
    requestAnimationFrame(function () { requestAnimationFrame(function () { box && box.classList.add('in'); }); });
    function setPanel(on) { card.classList.toggle('open', on); var c = card.querySelector('[data-a=custom]'); c.setAttribute('aria-expanded', on ? 'true' : 'false'); c.textContent = on ? 'Hide options' : 'Customise'; }
    card.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
      var k = a.getAttribute('data-a');
      if (k === 'all') { save({ prefs: true, media: true }); close(); }
      else if (k === 'none') { save({ prefs: false, media: false }); close(); }
      else if (k === 'custom') setPanel(!card.classList.contains('open'));
      else if (k === 'save') { save({ prefs: prefs.input.checked, media: media.input.checked }); close(); }
    });
    if (openPanel) setPanel(true);
    if (state) card.focus({ preventScroll: true });
  }

  /* ---------- click-to-play videos ---------- */
  function play(g) {
    var src = g.getAttribute('data-src'); if (!src) return;
    var f = document.createElement('iframe');
    f.src = src + (src.indexOf('?') < 0 ? '?' : '&') + 'autoplay=' + (g._user ? 1 : 0) + '&rel=0';
    f.allowFullscreen = true; f.title = g.getAttribute('data-title') || 'Video';
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    g.replaceWith(f);
    f.parentNode && f.parentNode.classList.add('vplaying');
  }
  function openGates() { [].slice.call(document.querySelectorAll('.vgate')).forEach(play); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.vplay'); if (b) { var g = b.closest('.vgate'); if (g) { g._user = true; play(g); } return; }
    var al = e.target.closest && e.target.closest('.valways');
    if (al) { e.preventDefault(); var c = state || { prefs: false }; c.media = true; save({ prefs: !!c.prefs, media: true }); }
    var cs = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (cs) { e.preventDefault(); open(true); }
  });

  window.SparkConsent = { allowed: allowed, open: function () { open(true); }, onChange: function (f) { listeners.push(f); } };

  function start() {
    if (allowed('media')) openGates();
    if (!state) setTimeout(function () { open(false); }, 700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
