/* Read aloud: uses the best voice your device has for the article's language. Nothing is sent anywhere. */
(function () {
  'use strict';
  var synth = window.speechSynthesis;
  var art = document.querySelector('main article'); if (!art) return;
  var h1 = art.querySelector('h1'); if (!h1) return;
  var cfgL = {}; try { cfgL = (JSON.parse((document.getElementById('spark-ticker-data') || {}).textContent || '{}') || {}).listen || {}; } catch (e) {}
  if (cfgL.on === false) return;                                              /* switched off for the whole site in the editor */
  try { if (localStorage.getItem('spark-listen-off') === '1') return; } catch (e) {}   /* or by this visitor, in Settings */
  var lang = (art.getAttribute('lang') || document.documentElement.lang || 'en').toLowerCase();
  var base = lang.split('-')[0];

  function el(tag, attrs, kids) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }); (kids || []).forEach(function (c) { c && e.appendChild(c); }); return e; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('spark-listen-' + k); localStorage.setItem('spark-listen-' + k, v); } catch (e) { return null; } }

  var T = { en: ['Listen', 'Pause', 'Resume', 'Stop', 'Back', 'Next', 'Voice', 'Speed', 'min listen', 'Your device has no voice for this language.'],
            de: ['Anhören', 'Pause', 'Weiter', 'Stopp', 'Zurück', 'Weiter', 'Stimme', 'Tempo', 'Min. Hören', 'Dein Gerät hat keine Stimme für diese Sprache.'],
            fr: ['Écouter', 'Pause', 'Reprendre', 'Arrêter', 'Précédent', 'Suivant', 'Voix', 'Vitesse', 'min d’écoute', 'Votre appareil n’a pas de voix pour cette langue.'],
            es: ['Escuchar', 'Pausa', 'Reanudar', 'Detener', 'Anterior', 'Siguiente', 'Voz', 'Velocidad', 'min de audio', 'Tu dispositivo no tiene voz para este idioma.'],
            ru: ['Слушать', 'Пауза', 'Продолжить', 'Стоп', 'Назад', 'Вперёд', 'Голос', 'Скорость', 'мин', 'На устройстве нет голоса для этого языка.'],
            ar: ['استمع', 'إيقاف مؤقت', 'متابعة', 'إيقاف', 'السابق', 'التالي', 'الصوت', 'السرعة', 'دقيقة', 'لا يوجد صوت لهذه اللغة على جهازك.'],
            zh: ['收听', '暂停', '继续', '停止', '上一段', '下一段', '声音', '语速', '分钟', '你的设备没有这种语言的语音。'] };
  var L = T[base] || T.en;

  var HIDE = { en: 'Hide this button (turn it back on in Settings)', de: 'Button ausblenden (in den Einstellungen wieder einschaltbar)', fr: 'Masquer ce bouton (réactivable dans Réglages)', es: 'Ocultar este botón (se reactiva en Ajustes)' };
  var HINT = { en: 'Tip: for a more natural voice open this page in Edge or Chrome, or on iPhone add an Enhanced voice under Settings → Accessibility → Spoken Content → Voices.',
               de: 'Tipp: Für eine natürlichere Stimme diese Seite in Edge oder Chrome öffnen, oder am iPhone unter Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen eine erweiterte Stimme laden.',
               fr: 'Astuce : pour une voix plus naturelle, ouvrez la page dans Edge ou Chrome, ou sur iPhone ajoutez une voix améliorée dans Réglages → Accessibilité → Contenu énoncé → Voix.',
               es: 'Consejo: para una voz más natural abre la página en Edge o Chrome, o en iPhone añade una voz mejorada en Ajustes → Accesibilidad → Contenido leído → Voces.' };
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;

  /* what to read: the headline, then the text blocks in order */
  var blocks = [];
  function collect() {
    blocks = [{ node: h1, text: h1.textContent.trim() }];
    [].slice.call(art.querySelectorAll('p, h2, h3, li, blockquote')).forEach(function (n) {
      if (n.closest('.vwrap, .share, .ad, .rel, .listen, figure, nav, aside, script, style') || n.querySelector('p, li')) return;
      var t = n.textContent.replace(/\s+/g, ' ').trim(); if (t.length > 1) blocks.push({ node: n, text: t });
    });
    blocks.forEach(function (b) { b.parts = (b.text.match(/[^.!?。؟]+[.!?。؟]*\s*/g) || [b.text]).reduce(function (acc, s) {
      if (acc.length && (acc[acc.length - 1] + s).length < 160) acc[acc.length - 1] += s; else acc.push(s); return acc; }, []); });
  }
  collect();
  var words = blocks.reduce(function (n, b) { return n + b.text.split(/\s+/).length; }, 0), mins = Math.max(1, Math.round(words / 150));

  /* voices: natural / neural / network voices first */
  var voices = [], chosen = null;
  function score(v) {
    var n = v.name, s = 0;
    if (/natural|neural|online|multilingual/i.test(n)) s += 70;          /* Edge / Windows natural voices, Apple multilingual */
    if (/premium|enhanced|siri|studio|wavenet/i.test(n)) s += 55;
    if (/^google/i.test(n)) s += 38;                                      /* Chrome network voices sound far better than the local ones */
    if (/samantha|ava|allison|serena|zoe|tessa|daniel|karen|moira|anna|petra|markus|viktor|thomas|amelie|jacques|marie|monica|paulina|jorge|milena|yuri|tarik|laila|ting-ting|mei-jia|sin-ji|xiaoxiao|yunxi/i.test(n)) s += 20;
    if (!v.localService) s += 10;
    if (/albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley/i.test(n) && !/premium|enhanced|siri/i.test(n)) s -= 60;
    if (/espeak|compact|festival|mbrola/i.test(n)) s -= 50;
    var vl = v.lang.toLowerCase().replace('_', '-');
    if (vl === lang) s += 8; else if (vl.split('-')[0] === base && lang.indexOf('-') < 0 && /-(us|gb|de|at|fr|es|ru|cn)$/.test(vl)) s += 3;
    if (v['default']) s += 2;
    return s;
  }
  function loadVoices() {
    var all = synth.getVoices() || [];
    voices = all.filter(function (v) { return v.lang.toLowerCase().split(/[-_]/)[0] === base; }).sort(function (a, b) { return score(b) - score(a); });
    if (!voices.length) voices = [];     /* no voice for this language: say so instead of reading it with the wrong accent */
    var saved = store('voice'); chosen = voices.filter(function (v) { return v.name === saved; })[0] || voices[0] || null;
    if (sel) fillSel();
  }

  /* interface */
  var wrap = el('div', { 'class': 'listen', role: 'group', 'aria-label': L[0] });
  var main = el('button', { type: 'button', 'class': 'listen-btn' }, [
    el('span', { 'class': 'listen-ico', 'aria-hidden': 'true' }),
    el('span', { 'class': 'listen-lab', text: L[0] }), el('small', { text: ' · ' + mins + ' ' + L[8] })]);
  var ICON = { idle: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 10v4h4l5 4V6L7 10H3z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    playing: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
    paused: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>' };
  main.title = L[0] + ' · ' + mins + ' ' + L[8]; main.setAttribute('aria-label', main.title);
  var gear = el('button', { type: 'button', 'class': 'lbtn lgear', 'aria-label': L[6] + ' / ' + L[7], 'aria-expanded': 'false', text: '⋯' });
  var panel = el('div', { 'class': 'listen-panel', hidden: '' });
  var prev = el('button', { type: 'button', 'class': 'lbtn', 'aria-label': L[4], text: '⏮' });
  var next = el('button', { type: 'button', 'class': 'lbtn', 'aria-label': L[5], text: '⏭' });
  var stop = el('button', { type: 'button', 'class': 'lbtn', 'aria-label': L[3], text: '■' });
  var bar = el('div', { 'class': 'listen-bar', 'aria-hidden': 'true' }, [el('i')]);
  var sel = el('select', { 'aria-label': L[6] });
  var spd = el('select', { 'aria-label': L[7] });
  [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75].forEach(function (x) { var o = el('option', { value: x, text: x + '×' }); spd.appendChild(o); });
  spd.value = store('speed') || '1'; if (spd.value !== (store('speed') || '1')) spd.value = '1';
  var hideBtn = el('button', { type: 'button', 'class': 'lbtn lhide', text: HIDE[base] || HIDE.en });
  hideBtn.addEventListener('click', function () { try { localStorage.setItem('spark-listen-off', '1'); } catch (e) {} finish && finish(); wrap.remove(); });
  var tip = el('p', { 'class': 'listen-note listen-tip' });
  var note = el('p', { 'class': 'listen-note', role: 'status', 'aria-live': 'polite' });
  panel.appendChild(el('div', { 'class': 'listen-row lmain' }, [prev, next, bar, gear, stop]));
  var setrow = el('div', { 'class': 'listen-row lset', hidden: '' }, [el('label', {}, [el('span', { text: L[6] }), sel]), el('label', {}, [el('span', { text: L[7] }), spd]), hideBtn, tip]);
  panel.appendChild(setrow);
  gear.addEventListener('click', function () { var o = setrow.hidden; setrow.hidden = !o; gear.setAttribute('aria-expanded', o ? 'true' : 'false'); });
  panel.appendChild(note);
  wrap.appendChild(main); wrap.appendChild(panel);
  if (cfgL.pos === 'right') wrap.classList.add('pos-right');
  document.body.appendChild(wrap);
  /* a small dock that follows the reader down the article and steps aside when the article is out of view */
  if ('IntersectionObserver' in window) new IntersectionObserver(function (l) { wrap.classList.toggle('away', !l[0].isIntersecting && state === 'idle'); }, { threshold: 0 }).observe(art);

  function fillSel() {
    sel.textContent = '';
    voices.forEach(function (v) { var q = score(v) >= 40 ? '★ ' : ''; var o = el('option', { value: v.name, text: q + v.name.replace(/^(Microsoft|Google)\s+/, '$1 ') + ' (' + v.lang + ')' }); sel.appendChild(o); });
    if (chosen) sel.value = chosen.name;
    note.textContent = !voices.length ? L[9] : ''; tip.textContent = voices.length && score(voices[0]) < 40 ? (HINT[base] || HINT.en) : '';
  }
  loadVoices(); synth.addEventListener && synth.addEventListener('voiceschanged', loadVoices); if ('onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
  fillSel();

  /* playback: one sentence at a time (browsers cut off long texts) */
  var bi = 0, pi = 0, state = 'idle', token = 0, cur = null;
  function mark(i) { if (cur) cur.node.classList.remove('lis-now'); cur = blocks[i] || null; if (cur) { cur.node.classList.add('lis-now'); var r = cur.node.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 80) cur.node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } }
  function progress() { var done = 0, tot = 0; blocks.forEach(function (b, i) { tot += b.text.length; if (i < bi) done += b.text.length; }); bar.firstChild.style.width = (tot ? Math.round(done / tot * 100) : 0) + '%'; }
  function ui() {
    var playing = state === 'playing';
    var lab = state === 'idle' ? L[0] : playing ? L[1] : L[2];
    main.querySelector('.listen-lab').textContent = lab; main.querySelector('.listen-ico').innerHTML = ICON[state] || ICON.idle;
    main.title = lab; main.setAttribute('aria-label', lab); wrap.classList.toggle('open', state !== 'idle');
    main.classList.toggle('on', state !== 'idle'); panel.hidden = state === 'idle';
    main.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }
  function say() {
    var my = ++token;
    if (bi >= blocks.length) return finish();
    var b = blocks[bi]; if (pi >= b.parts.length) { bi++; pi = 0; return say(); }
    mark(bi); progress();
    var u = new SpeechSynthesisUtterance(b.parts[pi]);
    if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else u.lang = lang;
    u.rate = parseFloat(spd.value) || 1;
    u.onend = function () { if (my !== token || state !== 'playing') return; pi++; say(); };
    u.onerror = function (e) { if (my !== token) return; if (e.error === 'interrupted' || e.error === 'canceled') return; state = 'paused'; ui(); note.textContent = e.error || ''; };
    synth.speak(u);
  }
  function play() { if (state === 'idle') { collect(); bi = 0; pi = 0; } synth.cancel(); state = 'playing'; ui(); say(); }
  function pause() { token++; synth.cancel(); state = 'paused'; ui(); }
  function finish() { token++; synth.cancel(); state = 'idle'; bi = 0; pi = 0; mark(-1); progress(); ui(); }
  function jump(d) { var was = state === 'playing'; token++; synth.cancel(); bi = Math.max(0, Math.min(blocks.length - 1, bi + d)); pi = 0; mark(bi); progress(); if (was) { state = 'playing'; say(); } else { if (state === 'idle') state = 'paused'; ui(); } }
  main.addEventListener('click', function () { if (state === 'playing') pause(); else play(); });
  stop.addEventListener('click', finish);
  prev.addEventListener('click', function () { jump(-1); });
  next.addEventListener('click', function () { jump(1); });
  sel.addEventListener('change', function () { chosen = voices.filter(function (v) { return v.name === sel.value; })[0] || chosen; store('voice', sel.value); if (state === 'playing') { token++; synth.cancel(); say(); } });
  spd.addEventListener('change', function () { store('speed', spd.value); if (state === 'playing') { token++; synth.cancel(); say(); } });
  addEventListener('pagehide', function () { synth.cancel(); });
  document.addEventListener('visibilitychange', function () { /* keep playing in the background, like audio */ });
  ui();
})();
