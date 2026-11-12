/* SparkNews editor: log in, write, publish. Talks to Supabase (see supabase/schema.sql). */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('spark-editor-config').textContent); } catch (e) {}
  var app = document.getElementById('app');
  var LANGS = { ar: 'العربية', zh: '中文', fr: 'Français', ru: 'Русский', es: 'Español', de: 'Deutsch', it: 'Italiano',
    pt: 'Português', ja: '日本語', ko: '한국어', tr: 'Türkçe', pl: 'Polski', nl: 'Nederlands', uk: 'Українська', en: 'English' };
  var SPARK = 'M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z';

  var sb = null, me = { id: '', email: '', role: '', name: '' };
  var articles = [], current = null, form = null, quill = null;
  var dirty = false, filter = 'all', query = '', saving = false, rebuildReady = false, view = '', stage = null, tabsEl = null, dashCleanup = null;

  /* ---------------------------------------------------------------- tiny helpers */
  function h(tag, attrs) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'value') e.value = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null || c === false) continue;
        if (Array.isArray(c)) add(c);
        else e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    })([].slice.call(arguments, 2));
    return e;
  }
  var toastTimer;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, bad ? 6000 : 2600);
  }
  function slugify(s) {
    s = String(s || '').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, 80) || 'article';
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fromLocal(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function errText(e) { return (e && (e.message || e.error_description || e.msg)) || String(e); }
  function canPublish() { return me.role === 'admin' || me.role === 'editor'; }

  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
  }
  function check(label, checked, onchange) {
    var i = h('input', { type: 'checkbox', onchange: onchange }); i.checked = !!checked;
    return { box: h('label', { class: 'check' }, i, label), input: i };
  }

  /* ---------------------------------------------------------------- start */
  function start() {
    if (!cfg.url || !cfg.anon_key) return renderSetup();
    sb = window.supabase.createClient(cfg.url, cfg.anon_key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange(function (ev, session) {
      if (ev === 'PASSWORD_RECOVERY') renderPassword(true);
      else if (ev === 'SIGNED_OUT') renderLogin();
    });
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) afterLogin(r.data.session.user);
      else renderLogin();
    });
  }

  function renderSetup() {
    app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card' },
      h('h1', { text: 'Editor not connected yet' }),
      h('p', { text: 'The database details are missing. Open site.json and fill in "supabase": { "url": ..., "anon_key": ... }, then push. The README has the step-by-step guide.' }))));
  }

  /* ---------------------------------------------------------------- login */
  function renderLogin(note) {
    var email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.com' });
    var pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    var msg = h('div');
    function say(t, kind) { msg.replaceChildren(t ? h('div', { class: 'msg ' + kind, text: t }) : ''); }
    var go = h('button', { class: 'btn primary wide', type: 'submit', text: 'Sign in' });
    var formEl = h('form', {
      onsubmit: function (ev) {
        ev.preventDefault(); say('');
        if (!pass.value) return say('Enter your password, or use the email link below.', 'err');
        go.disabled = true;
        sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value }).then(function (r) {
          go.disabled = false;
          if (r.error) return say(r.error.message, 'err');
          afterLogin(r.data.user);
        });
      }
    },
      field('Email', email), field('Password', pass), go,
      h('div', { class: 'or', text: 'or' }),
      h('button', {
        class: 'btn wide', type: 'button', text: 'Email me a login link',
        onclick: function () {
          if (!email.value.trim()) return say('Enter your email first.', 'err');
          sb.auth.signInWithOtp({ email: email.value.trim(), options: { shouldCreateUser: true, emailRedirectTo: location.href.split('#')[0] } })
            .then(function (r) { r.error ? say(r.error.message, 'err') : say('Check your inbox for the login link.', 'ok'); });
        }
      }),
      h('p', { style: 'margin:14px 0 0;text-align:center' }, h('button', {
        class: 'link', type: 'button', text: 'Forgot password?',
        onclick: function () {
          if (!email.value.trim()) return say('Enter your email first.', 'err');
          sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.href.split('#')[0] })
            .then(function (r) { r.error ? say(r.error.message, 'err') : say('Password reset email sent.', 'ok'); });
        }
      })));
    app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card' },
      h('h1', { text: 'SparkNews editor' }), h('p', { text: 'Sign in to write and publish articles. New here? Enter your email and ask for a login link; an admin will then give you access.' }),
      note ? h('div', { class: 'msg info', text: note }) : null, msg, formEl)));
  }

  function renderPassword(recovery) {
    var p1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
    var msg = h('div');
    app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card' },
      h('h1', { text: recovery ? 'Choose a new password' : 'Set a password' }),
      h('p', { text: 'At least 8 characters. You can then sign in with email and password.' }), msg,
      h('form', {
        onsubmit: function (ev) {
          ev.preventDefault();
          sb.auth.updateUser({ password: p1.value }).then(function (r) {
            if (r.error) return msg.replaceChildren(h('div', { class: 'msg err', text: r.error.message }));
            toast('Password saved'); sb.auth.getSession().then(function (s) { afterLogin(s.data.session.user); });
          });
        }
      }, field('New password', p1), h('button', { class: 'btn primary wide', type: 'submit', text: 'Save password' }),
        h('p', { style: 'text-align:center;margin:12px 0 0' }, h('button', { class: 'link', type: 'button', text: 'Cancel', onclick: function () { sb.auth.getSession().then(function (s) { s.data.session ? afterLogin(s.data.session.user) : renderLogin(); }); } }))))));
  }

  function afterLogin(user) {
    me.id = user.id; me.email = user.email || '';
    sb.from('editors').select('role,name').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error) return renderLogin('Could not check your access: ' + r.error.message);
      if (!r.data) return renderNoAccess();
      me.role = r.data.role; me.name = r.data.name || '';
      Promise.all([loadArticles(), sb.rpc('rebuild_configured')]).then(function (res) {
        rebuildReady = !res[1].error && res[1].data === true;   /* false when instant updates are not set up */
        renderWork();
      });
    });
  }

  function renderNoAccess() {
    app.replaceChildren(h('div', { class: 'center' }, h('div', { class: 'card' },
      h('h1', { text: 'No editor access yet' }),
      h('p', { text: 'You are signed in as ' + me.email + ', but this account has not been given a role yet. Ask an admin to add this email in the Team panel, then reload this page.' }),
      h('button', { class: 'btn wide', text: 'Sign out', onclick: signOut }))));
  }
  function signOut() { stopLive('radio'); stopLive('tv'); view = ''; sb.auth.signOut().then(function () { articles = []; current = null; renderLogin(); }); }

  /* ---------------------------------------------------------------- data */
  function loadArticles() {
    return sb.from('articles').select('id,slug,title,category,status,published_at,scheduled_publish_at,updated_at,created_by,taken_down,author_name')
      .order('updated_at', { ascending: false }).limit(2000)
      .then(function (r) { if (r.error) toast(r.error.message, true); articles = r.data || []; });
  }

  function uniqueSlug(title) {
    var base = slugify(title), used = {};
    articles.forEach(function (a) { if (a.slug) used[a.slug] = 1; });
    var s = base, n = 2;
    while (used[s]) s = base + '-' + n++;
    return s;
  }

  function upload(file) {
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('Image is larger than 10 MB'));
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
    var d = new Date();
    var path = d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.' + ext;
    return sb.storage.from('images').upload(path, file, { contentType: file.type || 'image/jpeg', cacheControl: '31536000' }).then(function (r) {
      if (r.error) throw r.error;
      return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
    });
  }
  function pickImage(cb) {
    var i = h('input', { type: 'file', accept: 'image/*' });
    i.onchange = function () {
      if (!i.files[0]) return;
      toast('Uploading…');
      upload(i.files[0]).then(function (url) { cb(url); toast('Image uploaded'); }, function (e) { toast(errText(e), true); });
    };
    i.click();
  }

  /* ---------------------------------------------------------------- workspace */
  var listEl, mainEl;

  function renderWork() {
    var bar = h('div', { class: 'bar' },
      h('a', { class: 'brand', href: '../index.html' },
        (function () { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', SPARK); s.appendChild(p); return s; })(),
        'SparkNews', h('small', { text: 'Editor' })),
      h('span', { class: 'sp' }),
      h('span', { class: 'who' }, me.name || me.email, h('b', { text: me.role })),
      canPublish() ? h('button', { class: 'lnk', type: 'button', text: 'Update website', onclick: updateSite }) : null,
      me.role === 'admin' ? h('button', { class: 'lnk', type: 'button', text: 'Team', onclick: openTeam }) : null,
      h('a', { class: 'lnk', href: '../index.html', target: '_blank', text: 'View site' }),
      h('button', { class: 'lnk', type: 'button', text: 'Password', onclick: function () { guard(function () { renderPassword(false); }); } }),
      h('button', { class: 'lnk', type: 'button', text: 'Sign out', onclick: function () { guard(signOut); } }));

    var windows = [['articles', 'Articles', '#/']].concat(canPublish() ? [['radio', 'Radio studio', '#/radio'], ['tv', 'TV studio', '#/tv']] : []);
    tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Workspaces' }, windows.map(function (w) {
      return h('button', { class: 'tab', type: 'button', 'data-v': w[0], onclick: function () { guard(function () { if (location.hash === w[2] || (w[0] === 'articles' && !location.hash)) route(); else location.hash = w[2]; }); } },
        w[1], w[0] === 'radio' || w[0] === 'tv' ? h('i', { class: 'dot', title: 'On air' }) : null);
    }));
    stage = h('div', { class: 'stage' });
    app.replaceChildren(h('div', { class: 'chrome' }, bar, tabsEl), stage);
    view = '';
    route();
  }

  function paintTabs() {
    if (!tabsEl) return;
    tabsEl.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.v === view);
      var d = t.querySelector('.dot'); if (d) d.classList.toggle('live', !!onAir[t.dataset.v]);
    });
  }

  function mountArticles() {
    if (dashCleanup) { dashCleanup(); dashCleanup = null; }
    var search = h('input', { type: 'text', placeholder: 'Search articles', 'aria-label': 'Search articles', value: query, oninput: function () { query = search.value.toLowerCase(); renderList(); } });
    var chips = h('div', { class: 'chips' });
    [['all', 'All'], ['draft', 'Drafts'], ['published', 'Published'], ['scheduled', 'Scheduled']].forEach(function (f) {
      chips.appendChild(h('button', { class: 'chip' + (filter === f[0] ? ' on' : ''), type: 'button', text: f[1], 'data-f': f[0],
        onclick: function () { filter = f[0]; chips.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.f === filter); }); renderList(); } }));
    });
    listEl = h('div', { class: 'list' });
    var side = h('aside', { class: 'side' },
      h('div', { class: 'tools' }, h('button', { class: 'btn primary', type: 'button', text: '+ New article', onclick: function () { guard(function () { location.hash = '#/new'; }); } }), search, chips), listEl);
    mainEl = h('main', { class: 'main' });
    stage.replaceChildren(h('div', { class: 'work' }, side, mainEl));
    view = 'articles';
    renderList();
  }

  function renderList() {
    var rows = articles.filter(function (a) {
      if (filter !== 'all' && a.status !== filter) return false;
      return !query || (a.title + ' ' + (a.category || '') + ' ' + (a.author_name || '')).toLowerCase().indexOf(query) >= 0;
    });
    if (!rows.length) { listEl.replaceChildren(h('div', { class: 'empty', text: articles.length ? 'Nothing matches.' : 'No articles yet. Create the first one!' })); return; }
    listEl.replaceChildren.apply(listEl, rows.map(function (a) {
      return h('button', { class: 'item' + (current && current.id === a.id ? ' on' : ''), type: 'button', onclick: function () { guard(function () { location.hash = '#/edit/' + a.id; }); } },
        h('b', { text: a.title || '(untitled)' }),
        h('span', {}, h('i', { class: 'badge ' + a.status, text: a.taken_down ? 'taken down' : a.status }), (a.category || '') + ' · ' + fmtDate(a.updated_at)));
    }));
  }

  function guard(fn) {
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    dirty = false; fn();
  }
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('hashchange', function () { if (me.role) route(); });

  function route() {
    var dm = location.hash.match(/^#\/(radio|tv)$/);
    if (dm) {
      if (!canPublish()) { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = dm[1];
      stage.replaceChildren(showDash(dm[1])); paintTabs(); return;
    }
    if (view !== 'articles') mountArticles();
    paintTabs();
    var m = location.hash.match(/^#\/edit\/(.+)$/);
    if (m) return openArticle(decodeURIComponent(m[1]));
    if (location.hash === '#/new') return showForm({ status: 'draft', content_type: 'rich', category: '', author_name: me.name || '' });
    current = null; dirty = false;
    mainEl.replaceChildren(h('div', { class: 'empty' }, h('p', { text: 'Pick an article on the left, or start a new one.' })));
    renderList();
  }

  function openArticle(id) {
    mainEl.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
    sb.from('articles').select('*').eq('id', id).maybeSingle().then(function (r) {
      if (r.error) return toast(r.error.message, true);
      if (!r.data) { toast('Article not found, or you are not allowed to open it', true); location.hash = ''; return; }
      showForm(r.data);
    });
  }

  /* ---------------------------------------------------------------- update the website */
  function updateSite() {
    sb.rpc('rebuild_site').then(function (r) {
      if (r.error) return toast(errText(r.error), true);
      if (r.data === 'started') { rebuildReady = true; toast('Website update started. It is online in about a minute; then refresh the page.'); }
      else toast('Instant updates are not set up yet, so the website cannot be told to update. See "Update the website right after publishing" in the README.', true);
    });
  }

  /* ---------------------------------------------------------------- live radio and TV (LiveKit) */
  var onAir = { radio: null, tv: null };          /* kind -> { room, timer } while broadcasting */
  var lkLoading = null;
  function loadLiveKit() {
    if (window.LivekitClient) return Promise.resolve();
    if (!lkLoading) lkLoading = new Promise(function (ok, no) {
      var el = document.createElement('script'); el.src = '../assets/vendor/livekit-client.umd.js';
      el.onload = ok; el.onerror = function () { lkLoading = null; no(new Error('Could not load the live video library')); };
      document.head.appendChild(el);
    });
    return lkLoading;
  }
  function liveToken(kind) {
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token;
      return fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/livekit-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anon_key, Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ kind: kind, mode: 'publish' })
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'The live function is not set up yet. See "Live radio and TV" in the README.' : 'Could not start (error ' + r.status + ')'));
        return j;
      });
    });
  }
  function stopLive(kind) {
    var cur = onAir[kind]; if (!cur) return Promise.resolve();
    onAir[kind] = null; clearInterval(cur.timer); clearInterval(cur.clock);
    if (cur.stopMeter) cur.stopMeter();
    try { cur.room.disconnect(); } catch (e) { /* already gone */ }
    if (cur.mixer) { stopDeck(kind); cur.mixer.stop(); newDeckEl(kind); deckState[kind].ui(); }   /* the old player is tied to the closed mixer */
    paintTabs();
    return sb.rpc('live_set', { p_kind: kind, p_title: null, p_on: false });
  }
  var RES = { '360': [640, 360], '720': [1280, 720], '1080': [1920, 1080] };
  function startMeter(stream, el) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !stream || !el) return function () {};
    var ctx, src, an, on = true, raf, buf;
    try { ctx = new AC(); src = ctx.createMediaStreamSource(stream); an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); buf = new Uint8Array(an.fftSize); } catch (e) { return function () {}; }
    (function tick() {
      if (!on) return;
      an.getByteTimeDomainData(buf);
      var peak = 0; for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      el.firstChild.style.width = Math.min(100, peak / 128 * 140) + '%';
      raf = requestAnimationFrame(tick);
    })();
    return function () { on = false; cancelAnimationFrame(raf); try { src.disconnect(); ctx.close(); } catch (e) { /* closed */ } el.firstChild.style.width = '0'; };
  }
  function loadSet(kind) { try { return JSON.parse(localStorage.getItem('spark-live-' + kind)) || {}; } catch (e) { return {}; } }
  function saveSet(kind, v) { try { localStorage.setItem('spark-live-' + kind, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function clock(ms) { var t = Math.floor(ms / 1000); return pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t / 60) % 60) + ':' + pad(t % 60); }

  /* ---- music library + mixer: the deck plays songs, the mixer blends them with the microphone into one broadcast track */
  var deckState = { radio: null, tv: null };
  function deckFor(kind) {
    var d = deckState[kind];
    if (!d) { d = deckState[kind] = { el: null, tracks: [], idx: -1, autoNext: true, ui: function () {} }; newDeckEl(kind); }
    return d;
  }
  function nextMusic(d, from) { for (var i = from; i < d.tracks.length; i++) if (d.tracks[i].kind !== 'jingle') return i; return -1; }
  function newDeckEl(kind) {
    var d = deckState[kind], el = new Audio();
    el.crossOrigin = 'anonymous'; el.preload = 'auto';
    el.addEventListener('ended', function () {
      var t = d.tracks[d.idx], n = d.autoNext && t && t.kind !== 'jingle' ? nextMusic(d, d.idx + 1) : -1;
      if (n >= 0) playTrack(kind, n); else { d.idx = -1; d.ui(); }
    });
    el.addEventListener('play', function () { d.ui(); }); el.addEventListener('pause', function () { d.ui(); });
    d.el = el;
  }
  function playTrack(kind, i) {
    var d = deckFor(kind), t = d.tracks[i];
    if (!t) { d.idx = -1; d.ui(); return; }
    d.idx = i; d.ui();
    sb.storage.from('audio').createSignedUrl(t.path, 3600).then(function (r) {
      if (r.error) throw r.error;
      d.el.src = r.data.signedUrl; return d.el.play();
    }).catch(function (e) { toast('Could not play "' + t.title + '": ' + errText(e), true); d.idx = -1; d.ui(); });
  }
  function stopDeck(kind) {
    var d = deckState[kind]; if (!d) return;
    try { d.el.pause(); } catch (e) { /* ignore */ }
    d.idx = -1; d.ui();
  }
  function buildMixer(S, d) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices) return Promise.reject(new Error('this browser cannot mix audio'));
    var ctx = new AC();
    var audio = { echoCancellation: S.echo !== false, noiseSuppression: S.noise !== false, autoGainControl: S.agc !== false };
    if (S.mic) audio.deviceId = S.mic;
    return navigator.mediaDevices.getUserMedia({ audio: audio }).then(function (stream) {
      var dest = ctx.createMediaStreamDestination(), micGain = ctx.createGain(), musicGain = ctx.createGain(), an = ctx.createAnalyser();
      var micSrc = ctx.createMediaStreamSource(stream), musicSrc = ctx.createMediaElementSource(d.el);
      an.fftSize = 512; var buf = new Uint8Array(an.fftSize);
      micSrc.connect(micGain); micGain.connect(dest); micSrc.connect(an);
      musicSrc.connect(musicGain); musicGain.connect(dest); musicGain.connect(ctx.destination);   /* you hear the music too, never your own voice */
      var m = { track: dest.stream.getAudioTracks()[0], muted: false, micVol: 100, musicVol: 80, duck: true, talking: false };
      function apply() {
        micGain.gain.setTargetAtTime(m.muted ? 0 : m.micVol / 100, ctx.currentTime, 0.03);
        musicGain.gain.setTargetAtTime(m.musicVol / 100 * (m.duck && m.talking && !m.muted ? 0.2 : 1), ctx.currentTime, 0.2);
      }
      var timer = setInterval(function () {
        an.getByteTimeDomainData(buf);
        var peak = 0; for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        var talking = peak > 14; if (talking !== m.talking) { m.talking = talking; apply(); }
      }, 90);
      m.set = function (k, v) { m[k] = v; apply(); };
      m.stop = function () { clearInterval(timer); stream.getTracks().forEach(function (t) { t.stop(); }); try { musicSrc.disconnect(); ctx.close(); } catch (e) { /* closed */ } };
      if (ctx.state === 'suspended') ctx.resume();
      apply();
      return m;
    }).catch(function (e) { try { ctx.close(); } catch (x) { /* ignore */ } throw e; });
  }

  function startLive(kind, S, hooks) {
    var LK = window.LivekitClient;
    var d = deckFor(kind);
    var mixP = LK.LocalAudioTrack ? buildMixer(S, d).catch(function (e) {
      toast('Music mixer unavailable (' + errText(e) + '). Broadcasting the microphone only.', true); return null;
    }) : Promise.resolve(null);
    return Promise.all([liveToken(kind), mixP]).then(function (pair) {
      var t = pair[0], mixer = pair[1];
      var room = new LK.Room(), got = {};
      return room.connect(t.url, t.token).then(function () {
        room.on(LK.RoomEvent.LocalTrackPublished, function (pub) {
          var tr = pub.track; if (!tr) return;
          if (tr.kind === 'video') { got.video = tr; if (hooks.preview) tr.attach(hooks.preview); }
          else if (tr.kind === 'audio' && tr.mediaStreamTrack) got.audio = tr.mediaStreamTrack;
        });
        room.on(LK.RoomEvent.Disconnected, function () { if (onAir[kind] && onAir[kind].room === room) stopLive(kind).then(function () { toast('The ' + kind + ' broadcast lost its connection and went off air', true); if (hooks.onEnd) hooks.onEnd(); }); });
        var lp = room.localParticipant;
        var mic = { echoCancellation: S.echo !== false, noiseSuppression: S.noise !== false, autoGainControl: S.agc !== false };
        if (S.mic) mic.deviceId = S.mic;
        if (mixer) { mixer.micVol = S.micVol == null ? 100 : S.micVol; mixer.musicVol = S.musicVol == null ? 80 : S.musicVol; mixer.duck = S.duck !== false; mixer.set('muted', !!hooks.muted); }
        var steps = [mixer ? lp.publishTrack(new LK.LocalAudioTrack(mixer.track), { source: LK.Track.Source.Microphone }) : lp.setMicrophoneEnabled(true, mic)];
        if (kind === 'tv') {
          var r = RES[S.res] || RES['720'];
          steps.push(S.source === 'screen' ? lp.setScreenShareEnabled(true) : lp.setCameraEnabled(true, { deviceId: S.cam || undefined, resolution: { width: r[0], height: r[1], frameRate: 30 } }));
        }
        return Promise.all(steps).then(function () {
          return sb.rpc('live_set', { p_kind: kind, p_title: S.title || '', p_on: true });
        }).then(function (r) {
          if (r.error) throw r.error;
          onAir[kind] = { room: room, since: Date.now(), video: got.video, mixer: mixer,
            timer: setInterval(function () { sb.rpc('live_beat', { p_kind: kind }); }, 30000) };
          paintTabs();
        }).catch(function (e) { try { room.disconnect(); } catch (x) { /* ignore */ } if (mixer) mixer.stop(); throw e; });
      }).then(function () { return got; });
    });
  }
  window.addEventListener('beforeunload', function (e) { if (onAir.radio || onAir.tv) { e.preventDefault(); e.returnValue = ''; } });

  /* the "Music & jingles" panel of a studio */
  var micMuted = { radio: false, tv: false };
  function musicPanel(kind, S, save, stops) {
    var d = deckFor(kind), list = h('div', { class: 'tracks' }), now = h('div', { class: 'nowplaying' });
    var fileIn = h('input', { type: 'file', accept: 'audio/*', multiple: true });
    var kindSel = h('select', {}, h('option', { value: 'music', text: 'Music' }), h('option', { value: 'jingle', text: 'Jingle (plays once)' }));
    var upMsg = h('span', { class: 'hint' });
    var playBtn = h('button', { class: 'btn', type: 'button' }), nextBtn = h('button', { class: 'btn', type: 'button', text: 'Next' });
    var stopBtn = h('button', { class: 'btn', type: 'button', text: 'Stop' });
    var muteBtn = h('button', { class: 'btn', type: 'button' });
    var mixer = function () { return onAir[kind] && onAir[kind].mixer; };

    function applyVol() {
      var m = mixer();
      if (m) { m.set('micVol', micV.value * 1); m.set('musicVol', musV.value * 1); m.set('duck', duck.input.checked); }
      else d.el.volume = Math.min(1, musV.value / 100);   /* before going on air: plain preview on your speakers */
    }
    var micV = h('input', { type: 'range', min: 0, max: 150, value: S.micVol == null ? 100 : S.micVol, 'aria-label': 'Microphone volume', oninput: function () { S.micVol = micV.value * 1; save(); applyVol(); } });
    var musV = h('input', { type: 'range', min: 0, max: 100, value: S.musicVol == null ? 80 : S.musicVol, 'aria-label': 'Music volume', oninput: function () { S.musicVol = musV.value * 1; save(); applyVol(); } });
    var duck = check('Lower the music while I speak', S.duck !== false, function () { S.duck = duck.input.checked; save(); applyVol(); });
    var auto = check('Play the next song automatically', d.autoNext, function () { d.autoNext = auto.input.checked; });

    function ui() {
      var t = d.tracks[d.idx], playing = !d.el.paused && d.idx >= 0;
      now.textContent = t ? (playing ? '▶ ' : '❚❚ ') + t.title : 'Nothing playing';
      playBtn.textContent = playing ? 'Pause' : 'Play'; playBtn.disabled = !d.tracks.length;
      muteBtn.textContent = micMuted[kind] ? 'Unmute microphone' : 'Mute microphone'; muteBtn.className = 'btn' + (micMuted[kind] ? ' danger' : '');
      list.querySelectorAll('.track').forEach(function (r, i) { r.classList.toggle('on', i === d.idx); });
    }
    d.ui = ui; stops.push(function () { d.ui = function () {}; });
    playBtn.onclick = function () {
      if (d.idx >= 0) { d.el.paused ? d.el.play() : d.el.pause(); return; }
      var first = nextMusic(d, 0); playTrack(kind, first >= 0 ? first : 0);
    };
    nextBtn.onclick = function () { var n = nextMusic(d, d.idx + 1); if (n >= 0) playTrack(kind, n); else stopDeck(kind); };
    stopBtn.onclick = function () { stopDeck(kind); };
    muteBtn.onclick = function () { micMuted[kind] = !micMuted[kind]; if (mixer()) mixer().set('muted', micMuted[kind]); ui(); };

    function renderTracks() {
      if (!d.tracks.length) { list.replaceChildren(h('div', { class: 'empty', text: 'No music yet. Upload songs and jingles above.' })); return ui(); }
      list.replaceChildren.apply(list, d.tracks.map(function (t, i) {
        return h('div', { class: 'track' },
          h('button', { class: 'btn', type: 'button', text: '▶', 'aria-label': 'Play ' + t.title, onclick: function () { playTrack(kind, i); } }),
          h('span', { class: 'tt' }, h('b', { text: t.title }), h('small', { text: (t.kind === 'jingle' ? 'Jingle' : 'Music') + (t.size ? ' · ' + (t.size / 1048576).toFixed(1) + ' MB' : '') })),
          h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: function () {
            if (!confirm('Delete "' + t.title + '" from the library?')) return;
            if (d.idx === i) stopDeck(kind);
            sb.storage.from('audio').remove([t.path]).then(function () { return sb.from('tracks').delete().eq('id', t.id); })
              .then(function (r) { if (r && r.error) toast(errText(r.error), true); load(); });
          } }));
      }));
      ui();
    }
    function load() {
      sb.from('tracks').select('*').order('title', { ascending: true }).then(function (r) {
        if (r.error) { list.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache/i.test(r.error.message || '') ? 'The music library is not set up yet. Run supabase/music.sql in Supabase (see the README).' : errText(r.error) })); return; }
        var playing = d.tracks[d.idx]; d.tracks = r.data || [];
        d.idx = playing ? d.tracks.findIndex(function (t) { return t.id === playing.id; }) : -1;
        renderTracks();
      });
    }
    var uploadBtn = h('button', { class: 'btn primary', type: 'button', text: 'Upload', onclick: function () {
      var files = [].slice.call(fileIn.files); if (!files.length) return fileIn.click();
      uploadBtn.disabled = true; var done = 0;
      (function next() {
        var f = files.shift();
        if (!f) { uploadBtn.disabled = false; fileIn.value = ''; upMsg.textContent = done ? 'Uploaded ' + done + ' file' + (done > 1 ? 's' : '') + '.' : ''; return load(); }
        if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|webm)$/i.test(f.name)) { toast(f.name + ' is not an audio file', true); return next(); }
        if (f.size > 50 * 1048576) { toast(f.name + ' is larger than 50 MB', true); return next(); }
        upMsg.textContent = 'Uploading ' + f.name + '…';
        var path = Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '-' + f.name.replace(/[^\w.-]+/g, '_').slice(-60);
        sb.storage.from('audio').upload(path, f, { contentType: f.type || 'audio/mpeg' }).then(function (r) {
          if (r.error) throw r.error;
          return sb.from('tracks').insert({ title: f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), path: path, kind: kindSel.value, size: f.size });
        }).then(function (r) { if (r.error) throw r.error; done++; })
          .catch(function (e) { toast('Upload failed: ' + errText(e) + (/bucket/i.test(errText(e)) ? ' (run supabase/music.sql)' : ''), true); })
          .then(next);
      })();
    } });
    fileIn.onchange = function () { if (fileIn.files.length) uploadBtn.click(); };

    applyVol(); load();
    return h('section', { class: 'panel wide' }, h('h3', { text: 'Music & jingles' }),
      h('div', { class: 'uprow' }, fileIn, kindSel, uploadBtn, upMsg),
      h('div', { class: 'player' }, now, h('div', { class: 'btnrow' }, playBtn, nextBtn, stopBtn, muteBtn)),
      h('div', { class: 'mixrow' },
        h('label', { class: 'vol' }, h('span', { text: 'Microphone' }), micV), h('label', { class: 'vol' }, h('span', { text: 'Music' }), musV), duck.box, auto.box),
      h('p', { class: 'hint', text: onAir[kind] ? 'On air: music is mixed into the broadcast.' : 'Off air: music plays on your speakers only, so you can try it. When you start the broadcast it is mixed with your microphone.' }),
      list);
  }

  /* one studio window per channel: radio and TV have their own settings (saved in this browser) */
  function showDash(kind) {
    var isTv = kind === 'tv', S = loadSet(kind), stops = [];
    var save = function () { saveSet(kind, S); };
    var title = h('input', { type: 'text', value: S.title || '', placeholder: isTv ? 'e.g. Evening news' : 'e.g. Morning bulletin', maxlength: '120', oninput: function () { S.title = title.value; save(); } });
    var mic = h('select', { onchange: function () { S.mic = mic.value; save(); } }, h('option', { value: '', text: 'Default microphone' }));
    var cam = isTv ? h('select', { onchange: function () { S.cam = cam.value; save(); } }, h('option', { value: '', text: 'Default camera' })) : null;
    var source = isTv ? h('select', { onchange: function () { S.source = source.value; save(); sync(); } }, h('option', { value: 'camera', text: 'Camera and microphone' }), h('option', { value: 'screen', text: 'Screen share and microphone' })) : null;
    if (source) source.value = S.source || 'camera';
    var res = isTv ? h('select', { onchange: function () { S.res = res.value; save(); } }, h('option', { value: '360', text: '360p (saves data)' }), h('option', { value: '720', text: '720p HD' }), h('option', { value: '1080', text: '1080p Full HD' })) : null;
    if (res) res.value = S.res || '720';
    var opt = function (key, label) { var c = check(label, S[key] !== false, function () { S[key] = c.input.checked; save(); }); return c.box; };
    var camField = cam ? field('Camera', cam) : null;
    var meter = h('div', { class: 'meter', 'aria-label': 'Microphone level' }, h('i'));
    var preview = isTv ? h('video', { class: 'livepreview', autoplay: true, playsinline: true }) : null;
    if (preview) preview.muted = true;
    var badge = h('span', { class: 'airbadge' }), timer = h('span', { class: 'airtime' });
    var status = h('p', { class: 'hint' });
    var go = h('button', { class: 'btn primary big', type: 'button' });
    var test = h('button', { class: 'btn', type: 'button', text: 'Test microphone' });

    function sync() { if (cam) camField.style.display = source.value === 'screen' ? 'none' : ''; if (preview && !onAir[kind]) preview.style.display = 'none'; }
    function fillDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      navigator.mediaDevices.enumerateDevices().then(function (list) {
        [['audioinput', mic, 'Default microphone', S.mic], ['videoinput', cam, 'Default camera', S.cam]].forEach(function (x) {
          if (!x[1]) return;
          x[1].replaceChildren(h('option', { value: '', text: x[2] }));
          list.filter(function (d) { return d.kind === x[0] && d.deviceId; }).forEach(function (d, i) { x[1].appendChild(h('option', { value: d.deviceId, text: d.label || (x[0] === 'audioinput' ? 'Microphone ' : 'Camera ') + (i + 1) })); });
          x[1].value = x[3] || '';
        });
      });
    }
    var testStop = null;
    test.onclick = function () {
      if (testStop) { testStop(); testStop = null; test.textContent = 'Test microphone'; return; }
      navigator.mediaDevices.getUserMedia({ audio: S.mic ? { deviceId: S.mic } : true }).then(function (stream) {
        fillDevices();
        var stopM = startMeter(stream, meter);
        testStop = function () { stopM(); stream.getTracks().forEach(function (t) { t.stop(); }); };
        test.textContent = 'Stop test';
      }).catch(function (e) { toast('Could not open the microphone: ' + errText(e), true); });
    };
    stops.push(function () { if (testStop) { testStop(); testStop = null; } });

    function paint() {
      var cur = onAir[kind], live = !!cur;
      go.textContent = live ? 'Stop broadcast' : 'Start broadcast'; go.className = 'btn big ' + (live ? 'danger' : 'primary');
      [title, mic, cam, source, res].forEach(function (x) { if (x) x.disabled = live; });
      badge.textContent = live ? 'ON AIR' : 'OFF AIR'; badge.className = 'airbadge' + (live ? ' on' : '');
      timer.textContent = live ? clock(Date.now() - cur.since) : '';
      status.textContent = live ? 'You are live. Keep this page open (you can switch windows) while you broadcast.' : 'Not broadcasting. Check your settings, then press Start.';
      if (preview) { preview.style.display = live || S.source !== 'screen' ? '' : 'none'; }
      paintTabs();
    }
    var tick = setInterval(function () { if (onAir[kind]) timer.textContent = clock(Date.now() - onAir[kind].since); }, 1000);
    stops.push(function () { clearInterval(tick); });

    go.onclick = function () {
      go.disabled = true;
      if (onAir[kind]) return stopLive(kind).then(function () { if (preview) preview.srcObject = null; toast('Off air'); paint(); go.disabled = false; });
      if (testStop) { testStop(); testStop = null; test.textContent = 'Test microphone'; }
      status.textContent = 'Starting… allow the microphone' + (isTv ? (source.value === 'screen' ? ' and pick a screen' : ' and camera') : '') + ' if your browser asks.';
      loadLiveKit().then(function () { return startLive(kind, S, { preview: preview, onEnd: paint }); })
        .then(function (got) {
          if (got.audio) onAir[kind].stopMeter = startMeter(new MediaStream([got.audio]), meter);
          toast('You are on air'); fillDevices();
        })
        .catch(function (e) { toast(errText(e), true); })
        .then(function () { paint(); go.disabled = false; });
    };

    /* come back to a running broadcast after visiting another window */
    if (onAir[kind] && onAir[kind].video && preview) onAir[kind].video.attach(preview);
    fillDevices(); sync(); paint();
    dashCleanup = function () { stops.forEach(function (f) { f(); }); };

    return h('div', { class: 'dash' },
      h('div', { class: 'dashhead' }, h('h2', { text: isTv ? 'TV studio' : 'Radio studio' }), badge, timer),
      h('div', { class: 'dashgrid' },
        h('section', { class: 'panel' }, h('h3', { text: 'Broadcast' }),
          field('Title shown to visitors', title), source ? field('Source', source) : null,
          preview, h('div', { class: 'metrow' }, h('span', { text: 'Mic level' }), meter), status, h('div', { class: 'btnrow' }, go, test)),
        h('section', { class: 'panel' }, h('h3', { text: 'Settings (saved in this browser)' }),
          field('Microphone', mic), camField, res ? field('Video quality', res) : null,
          opt('echo', 'Echo cancellation'), opt('noise', 'Noise suppression'), opt('agc', 'Automatic volume levelling'),
          h('p', { class: 'hint', text: 'Use headphones when you test so the radio does not echo into your microphone.' })),
        musicPanel(kind, S, save, stops)));
  }

  /* ---------------------------------------------------------------- team panel (admins) */
  var ROLE_HELP = { admin: 'Admin: everything, including deleting articles, full-HTML pages and the team.',
    editor: 'Editor: write, edit and publish any article.', writer: 'Writer: writes drafts; an editor publishes them.' };
  function roleSelect(value) {
    var sel = h('select', {}, h('option', { value: 'writer', text: 'Writer' }), h('option', { value: 'editor', text: 'Editor' }), h('option', { value: 'admin', text: 'Admin' }));
    sel.value = value; return sel;
  }
  function openTeam() {
    var body = h('div', { class: 'teambody' });
    var dlg = h('dialog', { class: 'small' }, h('header', {}, h('b', { text: 'Team' }),
      h('button', { class: 'btn', type: 'button', text: 'Close', onclick: function () { dlg.close(); dlg.remove(); } })), body);
    document.body.appendChild(dlg); dlg.showModal();

    function call(fn, args, mine) {
      return sb.rpc(fn, args).then(function (r) {
        if (r.error) { toast(errText(r.error), true); load(); return; }
        toast('Saved');
        if (mine) return location.reload();
        load();
      });
    }
    function load() {
      sb.rpc('team_list').then(function (r) {
        if (r.error) return body.replaceChildren(h('div', { class: 'msg err', text: errText(r.error) }));
        var rows = (r.data || []).map(function (m) {
          var sel = roleSelect(m.role);
          sel.onchange = function () { call('team_set', { p_email: m.email, p_role: sel.value, p_name: null }, m.user_id === me.id); };
          return h('div', { class: 'trow' },
            h('div', {}, h('b', { text: m.name || m.email }), h('small', { text: m.name ? m.email : '' })), sel,
            h('button', { class: 'btn danger', type: 'button', text: 'Remove', onclick: function () {
              if (confirm('Remove ' + (m.name || m.email) + ' from the team? They keep their account but can no longer edit.')) call('team_remove', { p_user: m.user_id }, m.user_id === me.id);
            } }));
        });
        var email = h('input', { type: 'email', placeholder: 'colleague@example.com', required: true });
        var name = h('input', { type: 'text', placeholder: 'Name (optional)' });
        var role = roleSelect('writer');
        var help = h('small', { text: ROLE_HELP.writer });
        role.onchange = function () { help.textContent = ROLE_HELP[role.value]; };
        var add = h('form', { class: 'tadd', onsubmit: function (ev) { ev.preventDefault(); call('team_set', { p_email: email.value.trim(), p_role: role.value, p_name: name.value.trim() || null }); } },
          h('h3', { text: 'Add a person' }),
          h('p', { class: 'hint', text: 'They must first open this editor page and ask for a login link, so that their account exists.' }),
          email, name, role, help, h('button', { class: 'btn primary', type: 'submit', text: 'Add to team' }));
        body.replaceChildren(h('h3', { text: 'Members (' + rows.length + ')' }), h('div', { class: 'tlist' }, rows), add);
      });
    }
    load();
  }

  /* ---------------------------------------------------------------- the article form */
  function showForm(a) {
    current = a; dirty = false;
    document.body.classList.remove('focusing');
    quill = null;   /* the previous article's editor must never leak into this one */
    var isNew = !a.id;
    var isHtml = a.content_type === 'html' || a.content_type === 'interactive';
    var f = form = {};
    var mark = function () { dirty = true; dirtyEl.textContent = 'Unsaved changes'; };
    var dirtyEl = h('span', { class: 'dirty' });

    f.title = h('input', { type: 'text', class: 'title-in', placeholder: 'Headline', value: a.title || '', maxlength: 300 });
    f.subtitle = h('input', { type: 'text', class: 'sub-in', placeholder: 'Standfirst (optional one-line summary)', value: a.subtitle || '', maxlength: 400 });

    /* body: rich text, or raw HTML for admins */
    var bodyBox = h('div');
    f.contentType = h('select', { onchange: function () { mark(); buildBody(); } },
      h('option', { value: 'rich', text: 'Normal article' }),
      me.role === 'admin' || isHtml ? h('option', { value: 'html', text: 'Full HTML page (admin only)' }) : null,
      me.role === 'admin' || isHtml ? h('option', { value: 'interactive', text: 'Interactive page (admin only)' }) : null);
    f.contentType.value = a.content_type || 'rich';
    f.contentType.disabled = me.role !== 'admin';
    var contentHtml = a.content || '';

    function buildBody() {
      if (focusOff) focusOff();
      if (quill) { contentHtml = quill.getLength() > 1 ? quill.root.innerHTML : ''; }
      quill = null; f.rawHtml = null;
      var type = f.contentType.value;
      if (type === 'rich') {
        var wrap = h('div', { id: 'quill-wrap' }, h('div', { id: 'quill-box' }));
        bodyBox.replaceChildren(wrap);
        quill = new window.Quill(wrap.firstChild, {
          theme: 'snow', placeholder: 'Write the article here…',
          modules: { toolbar: { container: [[{ header: [2, 3, false] }], ['bold', 'italic', 'underline', 'strike'], [{ list: 'ordered' }, { list: 'bullet' }],
            ['blockquote', 'link', 'image', 'video'], [{ align: [] }], ['clean']], handlers: { image: function () {
              pickImage(function (url) { var r = quill.getSelection(true); quill.insertEmbed(r.index, 'image', url, 'user'); quill.setSelection(r.index + 1); });
            } } } }
        });
        quill.clipboard.dangerouslyPasteHTML(contentHtml || '');
        quill.on('text-change', function (d, o, src) { if (src === 'user') mark(); });
      } else if (me.role === 'admin') {
        f.rawHtml = h('textarea', { class: 'code', style: 'min-height:420px', spellcheck: 'false', oninput: mark }); f.rawHtml.value = contentHtml;
        bodyBox.replaceChildren(h('div', { class: 'msg info', text: 'This article is shown as its own full page. Paste a complete HTML document.' }), f.rawHtml);
      } else {
        bodyBox.replaceChildren(h('div', { class: 'msg info', text: 'This is a full-HTML page. Only admins can change its content. You can still edit everything else.' }));
      }
    }

    /* focus window: full screen writing; everything except the line you are on is dimmed */
    var focusBtn = h('button', { class: 'btn', type: 'button', text: 'Focus', title: 'Distraction-free writing, one line at a time', onclick: function () { enterFocus(); } });
    var focusOff = null;
    function enterFocus() {
      if (!quill) return toast('Focus mode is for normal articles', true);
      var wrap = document.getElementById('quill-wrap'), root = quill.root, q = quill;
      var lineMode = true, typeMode = true;
      var dimTop = h('div', { class: 'fdim' }), dimBot = h('div', { class: 'fdim' });
      var words = h('span', { class: 'fwords' });
      var bar = h('div', { class: 'focusbar' },
        h('b', { text: 'Focus' }),
        (function () { var c = check('One line at a time', true, function () { lineMode = c.input.checked; place(); }); return c.box; })(),
        (function () { var c = check('Typewriter scrolling', true, function () { typeMode = c.input.checked; place(); }); return c.box; })(),
        words, h('span', { class: 'sp' }),
        h('button', { class: 'btn', type: 'button', text: 'Exit (Esc)', onclick: leave }));
      wrap.classList.add('focus'); wrap.insertBefore(bar, wrap.firstChild); wrap.appendChild(dimTop); wrap.appendChild(dimBot);
      document.body.classList.add('focusing');
      function place() {
        var r = q.getSelection(); var n = q.getText().trim();
        words.textContent = (n ? n.split(/\s+/).length : 0) + ' words';
        if (!r) return;
        var b = q.getBounds(r.index, 0), box = q.container.getBoundingClientRect();
        var top = box.top + b.top, bottom = top + b.height;
        if (typeMode) {
          var diff = top - window.innerHeight * 0.42;
          if (Math.abs(diff) > 2) root.scrollTop += diff, top -= diff, bottom -= diff;
        }
        dimTop.style.display = dimBot.style.display = lineMode ? '' : 'none';
        dimTop.style.height = Math.max(0, top - 3) + 'px'; dimBot.style.top = (bottom + 3) + 'px';
      }
      function key(e) { if (e.key === 'Escape') { e.preventDefault(); leave(); } }
      q.on('selection-change', place); q.on('text-change', place);
      root.addEventListener('scroll', place); window.addEventListener('resize', place); document.addEventListener('keydown', key);
      function leave() {
        q.off('selection-change', place); q.off('text-change', place);
        root.removeEventListener('scroll', place); window.removeEventListener('resize', place); document.removeEventListener('keydown', key);
        wrap.classList.remove('focus'); bar.remove(); dimTop.remove(); dimBot.remove(); document.body.classList.remove('focusing');
        focusOff = null; q.focus();
      }
      focusOff = leave;
      q.focus(); if (!q.getSelection()) q.setSelection(q.getLength() - 1, 0); place();
    }

    /* status panel */
    f.status = h('select', { disabled: !canPublish(), onchange: function () { mark(); sync(); } },
      h('option', { value: 'draft', text: 'Draft (hidden)' }), h('option', { value: 'published', text: 'Published' }), h('option', { value: 'scheduled', text: 'Scheduled' }));
    f.status.value = a.status || 'draft';
    f.scheduled = h('input', { type: 'datetime-local', value: toLocal(a.scheduled_publish_at), onchange: mark });
    f.published = h('input', { type: 'datetime-local', value: toLocal(a.published_at), onchange: mark });
    var tk = check('Taken down (hide from the website)', a.taken_down, mark); f.takenDown = tk.input;
    var ft = check('Featured: main story on the homepage', a.is_featured, mark); f.featured = ft.input;
    var br = check('Breaking news banner', a.is_breaking, function () { mark(); sync(); }); f.breaking = br.input;
    f.breakingText = h('input', { type: 'text', value: a.breaking_description || '', placeholder: 'Banner text (defaults to the headline)', oninput: mark });
    var schedField = field('Go live at', f.scheduled), pubField = field('Publish date', f.published, 'Leave empty to use the moment you publish.');
    function sync() {
      schedField.style.display = f.status.value === 'scheduled' ? '' : 'none';
      pubField.style.display = f.status.value === 'published' ? '' : 'none';
      f.breakingText.style.display = f.breaking.checked ? '' : 'none';
    }

    /* details */
    f.category = h('input', { type: 'text', list: 'cats', value: a.category || '', placeholder: 'e.g. Politics', oninput: mark, maxlength: 80 });
    var cats = {}; articles.forEach(function (x) { if (x.category) cats[x.category] = 1; });
    var catList = h('datalist', { id: 'cats' }); Object.keys(cats).sort().forEach(function (c) { catList.appendChild(h('option', { value: c })); });
    f.author = h('input', { type: 'text', value: a.author_name || '', oninput: mark, maxlength: 120 });
    var av = check('Verified author', a.author_verified, mark); f.verified = av.input;

    /* cover */
    var prev = h('div', { class: 'cover-prev' });
    f.image = h('input', { type: 'url', value: a.image_url || '', placeholder: 'https://… or upload', oninput: function () { mark(); showCover(); } });
    f.fx = h('input', { type: 'range', min: 0, max: 100, value: a.cover_focus_x == null ? 50 : a.cover_focus_x, oninput: function () { mark(); showCover(); } });
    f.fy = h('input', { type: 'range', min: 0, max: 100, value: a.cover_focus_y == null ? 50 : a.cover_focus_y, oninput: function () { mark(); showCover(); } });
    function showCover() {
      var u = f.image.value.trim();
      prev.style.backgroundImage = u ? 'url("' + u.replace(/"/g, '%22') + '")' : '';
      prev.style.backgroundPosition = f.fx.value + '% ' + f.fy.value + '%';
    }

    /* advanced */
    f.extra = h('textarea', { class: 'code', placeholder: 'One image address per line', oninput: mark }); f.extra.value = (a.additional_images || []).join('\n');
    f.layout = h('select', { onchange: mark }, h('option', { value: 'grid', text: 'Grid' }), h('option', { value: 'carousel', text: 'Carousel' })); f.layout.value = a.image_layout || 'grid';
    f.video = h('input', { type: 'url', value: a.reporter_video_url || '', placeholder: 'YouTube link', oninput: mark });
    f.citations = h('textarea', { class: 'code', placeholder: 'Sources and credits. Separate entries with a blank line.', oninput: mark }); f.citations.value = a.citations || '';
    f.seriesId = h('input', { type: 'text', value: a.series_id || '', oninput: mark }); f.seriesOrder = h('input', { type: 'number', value: a.series_order == null ? '' : a.series_order, oninput: mark });
    var aiT = check('Translations were made automatically', a.is_ai_translated, mark); f.aiTr = aiT.input;

    /* live updates */
    var liveRows = h('div');
    var live = check('This is a live page (timeline of updates)', a.is_live_update, function () { mark(); liveBox.style.display = f.live.checked ? '' : 'none'; }); f.live = live.input;
    f.liveLabel = h('input', { type: 'text', value: a.live_update_label || 'LIVE', oninput: mark });
    function addLive(u) {
      var ts = h('input', { type: 'datetime-local', value: toLocal(u.timestamp || new Date().toISOString()), onchange: mark });
      var tx = h('textarea', { oninput: mark }); tx.value = u.text || '';
      var row = h('div', { class: 'tr', 'data-live': '1' }, h('header', {}, h('strong', { text: 'Update' }), h('button', { class: 'btn danger', type: 'button', text: 'Remove', onclick: function () { row.remove(); mark(); } })), ts, tx);
      row._ts = ts; row._tx = tx; liveRows.appendChild(row);
    }
    (a.live_updates || []).forEach(addLive);
    var liveBox = h('div', { style: a.is_live_update ? '' : 'display:none' }, field('Label', f.liveLabel), liveRows, h('button', { class: 'btn', type: 'button', text: '+ Add update', onclick: function () { addLive({}); mark(); } }));

    /* translations */
    var trBox = h('div'), trData = {};
    Object.keys(a.translations || {}).forEach(function (l) { if (a.translations[l]) addTr(l, a.translations[l]); });
    var trSel = h('select', {}, h('option', { value: '', text: '+ Add a translation…' }));
    Object.keys(LANGS).forEach(function (l) { trSel.appendChild(h('option', { value: l, text: LANGS[l] + ' (' + l + ')' })); });
    trSel.onchange = function () { if (trSel.value) { addTr(trSel.value, {}); mark(); } trSel.value = ''; };
    function addTr(l, v) {
      if (trData[l]) return;
      var t = h('input', { type: 'text', value: v.title || '', placeholder: 'Translated headline', oninput: mark });
      var s = h('input', { type: 'text', value: v.subtitle || '', placeholder: 'Translated standfirst', oninput: mark });
      var c = h('textarea', { class: 'code', placeholder: 'Translated article (HTML, or plain text with blank lines between paragraphs)', oninput: mark }); c.value = v.content || '';
      var box = h('div', { class: 'tr' }, h('header', {}, h('strong', { text: (LANGS[l] || l) + ' (' + l + ')' }), h('button', { class: 'btn danger', type: 'button', text: 'Remove', onclick: function () { box.remove(); delete trData[l]; mark(); } })), t, s, c);
      trData[l] = { t: t, s: s, c: c }; trBox.appendChild(box);
    }

    /* buttons */
    var saveBtn = h('button', { class: 'btn dark', type: 'button', text: 'Save', onclick: function () { save(); } });
    var pubBtn = canPublish() ? h('button', { class: 'btn primary', type: 'button', text: a.status === 'published' ? 'Save & keep published' : 'Publish', onclick: function () { save('published'); } }) : null;
    var prevBtn = h('button', { class: 'btn', type: 'button', text: 'Preview', onclick: preview });
    var viewBtn = a.id && a.status === 'published' && a.slug ? h('a', { class: 'btn', href: '../a/' + encodeURIComponent(a.slug) + '.html', target: '_blank', text: 'View live' }) : null;
    var delBtn = me.role === 'admin' && a.id ? h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: remove }) : null;

    mainEl.replaceChildren(
      h('div', { class: 'head' }, h('h2', { text: isNew ? 'New article' : 'Edit article' }), dirtyEl, focusBtn, prevBtn, viewBtn, saveBtn, pubBtn),
      h('div', { class: 'cols' },
        h('div', {}, h('div', { class: 'panel' }, f.title, f.subtitle), h('div', { class: 'panel' }, bodyBox)),
        h('div', {},
          h('div', { class: 'panel' }, h('h3', { text: 'Publishing' }), field('Status', f.status, canPublish() ? '' : 'Writers save drafts. An editor will publish them.'), schedField, pubField, tk.box, ft.box, br.box, f.breakingText),
          h('div', { class: 'panel' }, h('h3', { text: 'Details' }), field('Section', f.category), catList, field('Author', f.author), av.box),
          h('div', { class: 'panel' }, h('h3', { text: 'Cover image' }), prev, field('Image address', f.image),
            h('div', { class: 'up' }, h('button', { class: 'btn', type: 'button', text: 'Upload image', onclick: function () { pickImage(function (u) { f.image.value = u; mark(); showCover(); }); } })),
            h('div', { class: 'row2', style: 'margin-top:12px' }, field('Focus left–right', f.fx), field('Focus top–bottom', f.fy))),
          h('div', { class: 'panel' }, h('details', { class: 'adv' }, h('summary', { text: 'More options' }),
            field('Article type', f.contentType), field('Extra images', f.extra),
            h('div', { class: 'up', style: 'margin:-6px 0 12px' }, h('button', { class: 'btn', type: 'button', text: 'Upload & add', onclick: function () { pickImage(function (u) { f.extra.value = (f.extra.value.trim() ? f.extra.value.trim() + '\n' : '') + u; mark(); }); } })),
            field('Extra images layout', f.layout), field('Video', f.video), field('Sources & credits', f.citations),
            h('div', { class: 'row2' }, field('Series ID', f.seriesId), field('Series order', f.seriesOrder)), live.box, liveBox)),
          h('div', { class: 'panel' }, h('h3', { text: 'Translations' }), aiT.box, trBox, trSel),
          delBtn ? h('div', { class: 'panel' }, delBtn) : null)));
    /* the datalist must live in the document for the Section field */
    sync(); showCover(); buildBody();
    [f.title, f.subtitle].forEach(function (i) { i.addEventListener('input', mark); });
    renderList();

    /* ---- collect + save ---- */
    function collect() {
      var d = {
        title: f.title.value.trim(), subtitle: f.subtitle.value.trim() || null,
        category: f.category.value.trim() || 'News', author_name: f.author.value.trim() || null, author_verified: f.verified.checked,
        image_url: f.image.value.trim() || null, cover_focus_x: +f.fx.value, cover_focus_y: +f.fy.value,
        additional_images: f.extra.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        image_layout: f.layout.value, reporter_video_url: f.video.value.trim() || null, citations: f.citations.value.trim() || null,
        series_id: f.seriesId.value.trim() || null, series_order: f.seriesOrder.value === '' ? null : parseInt(f.seriesOrder.value, 10),
        is_featured: f.featured.checked, is_breaking: f.breaking.checked, breaking_description: f.breakingText.value.trim() || null,
        taken_down: f.takenDown.checked, is_ai_translated: f.aiTr.checked,
        is_live_update: f.live.checked, live_update_label: f.liveLabel.value.trim() || 'LIVE',
        live_updates: [].slice.call(liveRows.children).map(function (r) { return { timestamp: fromLocal(r._ts.value) || new Date().toISOString(), text: r._tx.value.trim() }; }).filter(function (u) { return u.text; }),
        status: f.status.value, scheduled_publish_at: fromLocal(f.scheduled.value), published_at: fromLocal(f.published.value)
      };
      var tr = {};
      Object.keys(trData).forEach(function (l) {
        var v = trData[l], o = { title: v.t.value.trim(), subtitle: v.s.value.trim(), content: v.c.value.trim() };
        if (o.title || o.content) tr[l] = o;
      });
      d.translations = tr;
      if (me.role === 'admin') {
        d.content_type = f.contentType.value;
        d.content = f.rawHtml ? f.rawHtml.value : (quill && quill.getLength() > 1 ? quill.root.innerHTML : '');
      } else if (!isHtml) {
        d.content_type = 'rich';
        d.content = quill && quill.getLength() > 1 ? quill.root.innerHTML : '';
      }
      return d;
    }

    function save(forceStatus) {
      if (saving) return;
      var d = collect();
      if (!d.title) return toast('Please write a headline first', true);
      if (forceStatus && canPublish()) { d.status = forceStatus; f.status.value = forceStatus; sync(); }
      if (!canPublish()) d.status = 'draft';
      if (d.status === 'published' && !d.published_at) d.published_at = new Date().toISOString();
      if (d.status === 'scheduled' && !d.scheduled_publish_at) return toast('Pick the date and time it should go live', true);
      saving = true; saveBtn.disabled = true; if (pubBtn) pubBtn.disabled = true;
      var req;
      if (!a.id) { d.slug = uniqueSlug(d.title); req = sb.from('articles').insert(d).select().single(); }
      else req = sb.from('articles').update(d).eq('id', a.id).select().single();
      req.then(function (r) {
        saving = false; saveBtn.disabled = false; if (pubBtn) pubBtn.disabled = false;
        if (r.error) return toast(errText(r.error), true);
        dirty = false; dirtyEl.textContent = '';
        var row = r.data, i = articles.findIndex(function (x) { return x.id === row.id; });
        if (i >= 0) articles[i] = row; else articles.unshift(row);
        var live = d.status === 'published' || d.status === 'scheduled' || a.status === 'published';
        toast(!live ? 'Saved' : rebuildReady ? 'Saved. The website updates in about a minute.'
          : canPublish() ? 'Saved. It is not on the website yet: press "Update website" (top right).' : 'Saved');
        current = row;
        if (!a.id) history.replaceState(null, '', '#/edit/' + encodeURIComponent(row.id));
        showForm(row);
      });
    }

    function remove() {
      if (!confirm('Delete "' + (a.title || 'this article') + '" for good? This cannot be undone.')) return;
      sb.from('articles').delete().eq('id', a.id).then(function (r) {
        if (r.error) return toast(errText(r.error), true);
        articles = articles.filter(function (x) { return x.id !== a.id; }); dirty = false; toast('Deleted'); location.hash = '';
        renderList(); route();
      });
    }

    function preview() {
      var d = collect(), body = d.content || '';
      var doc;
      var sandbox = '';
      if (d.content_type === 'html' || d.content_type === 'interactive') { doc = body; sandbox = 'allow-scripts'; }
      else {
        var t = document.createElement('div'); t.textContent = d.title;
        var st = document.createElement('div'); st.textContent = d.subtitle || '';
        doc = '<!doctype html><meta charset="utf-8"><base href="../"><link rel="stylesheet" href="assets/style.css">' +
          '<body><article class="narrow"><p class="kicker"><a>' + esc(d.category) + '</a></p><header class="ah"><h1>' + t.innerHTML + '</h1>' +
          (d.subtitle ? '<p class="sub">' + st.innerHTML + '</p>' : '') + '</header>' +
          (d.image_url ? '<figure class="cover"><img src="' + esc(d.image_url) + '" style="object-position:' + d.cover_focus_x + '% ' + d.cover_focus_y + '%"></figure>' : '') +
          '<div class="body">' + body + '</div></article></body>';
      }
      var ifr = h('iframe', { sandbox: sandbox, title: 'Preview' }); ifr.srcdoc = doc;
      var dlg = h('dialog', {}, h('header', {}, h('b', { text: 'Preview (not saved)' }), h('button', { class: 'btn', type: 'button', text: 'Close', onclick: function () { dlg.close(); dlg.remove(); } })), ifr);
      document.body.appendChild(dlg); dlg.showModal();
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    document.onkeydown = function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  }

  start();
})();
