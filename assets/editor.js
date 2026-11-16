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
  function signOut() { stopLive('radio'); stopLive('tv'); view = ''; nlRoot = null; nlDirty = false; sb.auth.signOut().then(function () { articles = []; current = null; renderLogin(); }); }

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
        h('img', { src: '../assets/logo.png', alt: '', width: '26', height: '26' }),
        'SparkNews', h('small', { text: 'Editor' })),
      h('span', { class: 'sp' }),
      h('span', { class: 'who' }, me.name || me.email, h('b', { text: me.role })),
      canPublish() ? h('button', { class: 'lnk', type: 'button', text: 'Update website', onclick: updateSite }) : null,
      me.role === 'admin' ? h('button', { class: 'lnk', type: 'button', text: 'Team', onclick: openTeam }) : null,
      h('a', { class: 'lnk', href: '../index.html', target: '_blank', text: 'View site' }),
      h('button', { class: 'lnk', type: 'button', text: 'Password', onclick: function () { guard(function () { renderPassword(false); }); } }),
      h('button', { class: 'lnk', type: 'button', text: 'Sign out', onclick: function () { guard(signOut); } }));

    var windows = [['articles', 'Articles', '#/']].concat(canPublish() ? [['radio', 'Radio studio', '#/radio'], ['tv', 'TV studio', '#/tv'], ['newsletter', 'Newsletter', '#/newsletter']] : [], me.role === 'admin' ? [['settings', 'Settings', '#/settings']] : []);
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


  /* ---------- import articles from a CSV export (admins) ---------- */
  var CSV_BOOL = ['author_verified', 'taken_down', 'is_breaking', 'is_ai_translated', 'is_featured', 'is_live_update'];
  var CSV_INT = ['cover_focus_x', 'cover_focus_y', 'views', 'series_order'];
  var CSV_TEXT = ['id', 'title', 'subtitle', 'content', 'content_type', 'category', 'image_url', 'image_layout', 'reporter_video_url', 'author_name', 'status', 'breaking_description', 'live_update_label', 'citations', 'series_id'];
  var CSV_JSON = { additional_images: [], live_updates: [], translations: {} };
  function parseCsv(text) {
    var rows = [], row = [], f = '', q = false, i = 0, c;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    if (!rows.length) return [];
    var head = rows[0].map(function (x) { return x.trim(); });
    return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (k, n) { o[k] = r[n] == null ? '' : r[n]; }); return o; });
  }
  function csvDate(v) { v = (v || '').trim(); if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function csvSlug(t) { return (t || '').toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article'; }
  function csvConvert(r) {
    var o = {};
    CSV_TEXT.forEach(function (c) { var v = r[c] || ''; o[c] = c === 'content' ? v : v.trim(); if (o[c] === '' && c !== 'content' && c !== 'title') o[c] = null; });
    o.title = (r.title || '').trim().replace(/^\*+|\*+$/g, '').trim();
    CSV_BOOL.forEach(function (c) { o[c] = (r[c] || '').trim().toLowerCase() === 'true'; });
    CSV_INT.forEach(function (c) { var n = parseFloat(r[c]); o[c] = isNaN(n) ? null : Math.trunc(n); });
    o.published_at = csvDate(r.published_at); o.scheduled_publish_at = csvDate(r.scheduled_publish_at);
    Object.keys(CSV_JSON).forEach(function (c) {
      var v; try { v = JSON.parse(r[c] || ''); } catch (e) { v = CSV_JSON[c]; }
      if (c === 'translations' && v && typeof v === 'object' && !Array.isArray(v)) { var t = {}; Object.keys(v).forEach(function (k) { if (v[k] && typeof v[k] === 'object') t[k] = v[k]; }); v = t; }
      o[c] = Array.isArray(CSV_JSON[c]) === Array.isArray(v) && v && typeof v === 'object' ? v : CSV_JSON[c];
    });
    var cd = csvDate(r.created_date); if (cd) o.created_at = cd;
    o.category = o.category || 'News';
    if (['draft', 'published', 'scheduled'].indexOf(o.status) < 0) o.status = 'draft';
    o.content_type = o.content_type || 'rich';
    return o;
  }
  function importCsvDialog() {
    var pick = h('input', { type: 'file', accept: '.csv,text/csv' }), msg = h('p', { class: 'hint', text: 'Choose a CSV export of articles. Articles that already exist are updated (matched by id), nothing is deleted.' });
    var go = h('button', { class: 'btn primary', type: 'button', text: 'Import', disabled: true });
    var close = h('button', { class: 'btn', type: 'button', text: 'Close', onclick: function () { dlg.close(); dlg.remove(); } });
    var dlg = h('dialog', { class: 'small' }, h('header', {}, h('b', { text: 'Import articles from CSV' })), h('div', { class: 'pickerbody' }, pick, msg, h('div', { class: 'btnrow' }, go, close)));
    var items = [];
    pick.addEventListener('change', function () {
      var f = pick.files[0]; go.disabled = true; items = []; if (!f) return;
      msg.className = 'hint'; msg.textContent = 'Reading…';
      f.text().then(function (txt) {
        items = parseCsv(txt).filter(function (r) { return (r.title || '').trim(); }).map(csvConvert);
        if (!items.length) { msg.className = 'hint err'; msg.textContent = 'No articles found in this file. It needs a header row with columns like title, content, status.'; return; }
        return sb.from('articles').select('id,slug,title').then(function (r) {
          if (r.error) throw r.error;
          var have = {}, slugs = {}, byTitle = {}; (r.data || []).forEach(function (x) { have[x.id] = x.slug; slugs[x.slug] = true; byTitle[(x.title || '').trim()] = x.id; });
          var fresh = 0;
          items.sort(function (a, b) { return (b.published_at || '') < (a.published_at || '') ? -1 : 1; });   /* same order as the website build, so slugs match */
          items.forEach(function (a) {
            if (!a.id && byTitle[a.title]) a.id = byTitle[a.title];      /* a file without ids: the same headline means the same article */
            if (a.id && have[a.id]) { a.slug = have[a.id]; return; }
            var base = csvSlug(a.title), s = base, n = 1; while (slugs[s]) s = base + '-' + (++n);
            slugs[s] = true; a.slug = s; fresh++;
            if (!a.id) delete a.id;
          });
          var live = items.filter(function (a) { return a.status === 'published'; }).length;
          msg.textContent = items.length + ' articles found (' + live + ' published): ' + fresh + ' new, ' + (items.length - fresh) + ' already in the editor and will be updated.';
          go.disabled = false;
        });
      }).catch(function (e) { msg.className = 'hint err'; msg.textContent = errText(e); });
    });
    go.onclick = function () {
      go.disabled = pick.disabled = true; var done = 0, chunks = [], withId = items.filter(function (a) { return a.id; }), noId = items.filter(function (a) { return !a.id; });
      [withId, noId].forEach(function (g) { for (var i = 0; i < g.length; i += 25) chunks.push({ rows: g.slice(i, i + 25), upsert: g === withId }); });
      chunks.reduce(function (p, c) {
        return p.then(function () {
          msg.className = 'hint'; msg.textContent = 'Importing… ' + done + ' of ' + items.length;
          var q = c.upsert ? sb.from('articles').upsert(c.rows, { onConflict: 'id' }) : sb.from('articles').insert(c.rows);
          return q.then(function (r) { if (r.error) throw r.error; done += c.rows.length; });
        });
      }, Promise.resolve()).then(function () {
        msg.className = 'hint ok'; msg.textContent = 'Imported ' + done + ' articles. They are in the list now. Press "Update website" when you want the site to refresh.';
        toast('Imported ' + done + ' articles'); return loadArticles().then(function () { if (view === 'articles' && listEl) renderList(); });
      }).catch(function (e) { msg.className = 'hint err'; msg.textContent = 'Stopped after ' + done + ' articles: ' + errText(e) + ' You can run the import again, it continues safely.'; go.disabled = pick.disabled = false; });
    };
    document.body.appendChild(dlg); dlg.showModal();
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
      h('div', { class: 'tools' }, h('button', { class: 'btn primary', type: 'button', text: '+ New article', onclick: function () { guard(function () { location.hash = '#/new'; }); } }), me.role === 'admin' ? h('button', { class: 'btn', type: 'button', text: 'Import CSV', onclick: importCsvDialog }) : null, search, chips), listEl);
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
    if (location.hash === '#/settings') {
      if (me.role !== 'admin') { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = 'settings';
      stage.replaceChildren(showSettings()); paintTabs(); return;
    }
    if (location.hash === '#/newsletter') {
      if (!canPublish()) { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = 'newsletter';
      stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'empty', text: 'Loading…' }))); paintTabs();
      showNewsletter().then(function (el) { if (view === 'newsletter') stage.replaceChildren(el); }).catch(function (e) { stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'msg err', text: errText(e) }))); });
      return;
    }
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
    if (kind === 'tv' && tvComp && view !== 'tv') { tvComp.stop(); }   /* nobody is looking at the studio any more: release camera and screen */
    paintTabs();
    return sb.rpc('live_set', { p_kind: kind, p_title: null, p_on: false });
  }
  var tvComp = null;
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
      if (n >= 0) playTrack(kind, n); else { d.idx = -1; d.ui(); announce(kind, null); }
    });
    el.addEventListener('play', function () { d.ui(); }); el.addEventListener('pause', function () { d.ui(); });
    d.el = el;
  }
  /* tell listeners what is playing (only while on air; jingles are not announced) */
  function announce(kind, t) {
    if (!onAir[kind]) return;
    sb.rpc('live_playing', { p_kind: kind, p_text: t && t.kind !== 'jingle' ? (t.credit || t.title) : '' }).then(function () {}, function () {});
  }
  function playTrack(kind, i) {
    var d = deckFor(kind), t = d.tracks[i];
    if (!t) { d.idx = -1; d.ui(); announce(kind, null); return; }
    d.idx = i; d.ui(); announce(kind, t);
    sb.storage.from('audio').createSignedUrl(t.path, 3600).then(function (r) {
      if (r.error) throw r.error;
      d.el.src = r.data.signedUrl; return d.el.play();
    }).catch(function (e) { toast('Could not play "' + t.title + '": ' + errText(e), true); d.idx = -1; d.ui(); });
  }
  function stopDeck(kind) {
    var d = deckState[kind]; if (!d) return;
    try { d.el.pause(); } catch (e) { /* ignore */ }
    d.idx = -1; d.ui(); announce(kind, null);
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
      m.addElement = function (el) {       /* sound of a video shown to the audience: heard by the audience and by you */
        try { var src = ctx.createMediaElementSource(el); src.connect(dest); src.connect(ctx.destination); } catch (e) { /* already connected */ }
      };
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
        if (mixer && hooks.studio) mixer.addElement(hooks.studio.mediaEl());
        if (mixer) { mixer.micVol = S.micVol == null ? 100 : S.micVol; mixer.musicVol = S.musicVol == null ? 80 : S.musicVol; mixer.duck = S.duck !== false; mixer.set('muted', !!hooks.muted); }
        var steps = [mixer ? lp.publishTrack(new LK.LocalAudioTrack(mixer.track), { source: LK.Track.Source.Microphone }) : lp.setMicrophoneEnabled(true, mic)];
        if (kind === 'tv') {
          var r = RES[S.res] || RES['720'];
          steps.push(S.source === 'studio' && hooks.studio ? lp.publishTrack(new LK.LocalVideoTrack(hooks.studio.track()), { source: LK.Track.Source.Camera }) : S.source === 'screen' ? lp.setScreenShareEnabled(true) : lp.setCameraEnabled(true, { deviceId: S.cam || undefined, resolution: { width: r[0], height: r[1], frameRate: 30 } }));
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
  window.addEventListener('beforeunload', function (e) { if (onAir.radio || onAir.tv || nlDirty) { e.preventDefault(); e.returnValue = ''; } });

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
          h('span', { class: 'tt' }, h('b', { text: t.title }), h('small', { text: (t.kind === 'jingle' ? 'Jingle' : 'Music') + (t.license ? ' · ' + t.license : '') + (t.size ? ' · ' + (t.size / 1048576).toFixed(1) + ' MB' : '') })),
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

    /* royalty-free finder (Openverse through the music-library function) */
    var qIn = h('input', { type: 'search', placeholder: 'Search free music: calm piano, jazz, news intro…', maxlength: '100', 'aria-label': 'Search free music' });
    var found = h('div', { class: 'found' }), foundMsg = h('p', { class: 'hint' }), pager = h('div', { class: 'btnrow' });
    var pv = new Audio(), pvBtn = null; pv.addEventListener('ended', function () { if (pvBtn) pvBtn.textContent = '▶'; });
    stops.push(function () { pv.pause(); });
    var lastQ = '', lastPage = 1;
    function search(page) {
      lastQ = qIn.value.trim(); lastPage = page || 1; foundMsg.className = 'hint'; foundMsg.textContent = 'Searching…';
      callFunction('music-library', { mode: 'search', q: lastQ, page: lastPage }).then(function (r) {
        if (!r.ok) { foundMsg.className = 'msg err'; foundMsg.textContent = r.error || 'Search failed'; found.replaceChildren(); pager.replaceChildren(); return; }
        foundMsg.className = 'hint';
        foundMsg.textContent = r.items.length ? 'All results are free to use on a website. Songs marked "credit" show their credit line to listeners automatically.' : 'Nothing found. Try another word.';
        found.replaceChildren.apply(found, r.items.map(function (it) {
          var play = h('button', { class: 'btn', type: 'button', text: '▶', 'aria-label': 'Preview ' + it.title, onclick: function () {
            if (pvBtn === play && !pv.paused) { pv.pause(); play.textContent = '▶'; return; }
            if (pvBtn) pvBtn.textContent = '▶'; pvBtn = play; pv.src = it.preview; pv.volume = 0.7; play.textContent = '❚❚';
            pv.play().catch(function () { play.textContent = '▶'; toast('Could not preview this track', true); });
          } });
          var add = h('button', { class: 'btn primary', type: 'button', text: 'Add', onclick: function () {
            add.disabled = true; add.textContent = 'Adding…';
            callFunction('music-library', { mode: 'import', id: it.id }).then(function (x) {
              if (!x.ok) { add.disabled = false; add.textContent = 'Add'; return toast(x.error || 'Could not add it', true); }
              add.textContent = x.already ? 'Already added' : 'Added ✓'; toast(x.already ? 'This track is already in your library' : '"' + it.title + '" added'); load();
            });
          } });
          var min = Math.floor((it.duration || 0) / 60), sec = String((it.duration || 0) % 60).padStart(2, '0');
          return h('div', { class: 'track' }, play,
            h('span', { class: 'tt' }, h('b', { text: it.title }), h('small', { text: [it.creator, it.license, it.duration ? min + ':' + sec : '', it.genre, it.needs_credit ? 'credit' : ''].filter(Boolean).join(' · ') })), add);
        }));
        pager.replaceChildren();
        if (lastPage > 1) pager.append(h('button', { class: 'btn', type: 'button', text: 'Previous', onclick: function () { search(lastPage - 1); } }));
        if (r.pages > lastPage) pager.append(h('button', { class: 'btn', type: 'button', text: 'More results', onclick: function () { search(lastPage + 1); } }));
      });
    }
    qIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(1); } });
    var finder = h('details', { class: 'finder' }, h('summary', { text: 'Find free, royalty-free music' }),
      h('div', { class: 'uprow' }, qIn, h('button', { class: 'btn primary', type: 'button', text: 'Search', onclick: function () { search(1); } })),
      foundMsg, found, pager);

    applyVol(); load();
    return h('section', { class: 'panel wide' }, h('h3', { text: 'Music & jingles' }), finder,
      h('div', { class: 'uprow' }, fileIn, kindSel, uploadBtn, upMsg),
      h('div', { class: 'player' }, now, h('div', { class: 'btnrow' }, playBtn, nextBtn, stopBtn, muteBtn)),
      h('div', { class: 'mixrow' },
        h('label', { class: 'vol' }, h('span', { text: 'Microphone' }), micV), h('label', { class: 'vol' }, h('span', { text: 'Music' }), musV), duck.box, auto.box),
      h('p', { class: 'hint', text: onAir[kind] ? 'On air: music is mixed into the broadcast.' : 'Off air: music plays on your speakers only, so you can try it. When you start the broadcast it is mixed with your microphone.' }),
      list);
  }


  /* ---------------------------------------------------------------- TV studio: program canvas (camera, screen, pictures, videos) */
  var STUDIO_SCENES = [['cam', 'Camera', '1'], ['media', 'Picture / video', '2'], ['pip', 'Picture + me', '3'], ['screen', 'Screen', '4'], ['screenpip', 'Screen + me', '5'], ['black', 'Black', '6']];
  function makeCompositor(res) {
    var W = res[0], H = res[1];
    var cv = h('canvas', { class: 'livepreview program', width: W, height: H, 'aria-label': 'What the audience sees' });
    var g = cv.getContext('2d');
    function vid(muted) { var v = document.createElement('video'); v.playsInline = true; v.muted = muted; v.setAttribute('playsinline', ''); return v; }
    var cam = vid(true), scr = vid(true), med = vid(false), img = null;
    var C = { cv: cv, scene: 'cam', caption: '', capOn: false, media: null, loop: true, camStream: null, scrStream: null, timer: null, track: null, onScreenEnd: null };
    C.mediaEl = function () { return med; };
    C.resize = function (r) { W = r[0]; H = r[1]; cv.width = W; cv.height = H; if (C.stream) { C.stream.getTracks().forEach(function (t) { t.stop(); }); C.stream = null; } draw(); };
    function fit(src, sw, sh, x, y, w, h2, cover) {
      if (!sw || !sh) return;
      var k = cover ? Math.max(w / sw, h2 / sh) : Math.min(w / sw, h2 / sh), dw = sw * k, dh = sh * k;
      g.save(); g.beginPath(); g.rect(x, y, w, h2); g.clip(); g.drawImage(src, x + (w - dw) / 2, y + (h2 - dh) / 2, dw, dh); g.restore();
    }
    function roundRect(x, y, w, h2, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function draw() {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      var sc = C.scene, camOk = cam.videoWidth > 0;
      var mediaSrc = img && C.media && C.media.kind === 'image' ? img : (C.media && C.media.kind === 'video' ? med : null);
      var mw = mediaSrc === img && img ? img.naturalWidth : med.videoWidth, mh = mediaSrc === img && img ? img.naturalHeight : med.videoHeight;
      if (sc === 'cam' && camOk) fit(cam, cam.videoWidth, cam.videoHeight, 0, 0, W, H, true);
      else if ((sc === 'media' || sc === 'pip') && mediaSrc) fit(mediaSrc, mw, mh, 0, 0, W, H, false);
      else if ((sc === 'screen' || sc === 'screenpip') && scr.videoWidth) fit(scr, scr.videoWidth, scr.videoHeight, 0, 0, W, H, false);
      if ((sc === 'pip' || sc === 'screenpip') && camOk) {
        var iw = Math.round(W * 0.26), ih = Math.round(iw * 9 / 16), ix = W - iw - Math.round(W * 0.02), iy = H - ih - Math.round(H * 0.04);
        g.save(); roundRect(ix, iy, iw, ih, 12); g.clip(); fit(cam, cam.videoWidth, cam.videoHeight, ix, iy, iw, ih, true); g.restore();
        g.lineWidth = 4; g.strokeStyle = '#fff'; roundRect(ix, iy, iw, ih, 12); g.stroke();
      }
      if (C.capOn && C.caption) {
        var fs = Math.round(H * 0.052), pad = Math.round(fs * 0.55), bh = fs + pad * 2, by = H - bh - Math.round(H * 0.07), bx = Math.round(W * 0.04);
        g.font = '700 ' + fs + 'px Georgia, "Times New Roman", serif';
        var tw = Math.min(g.measureText(C.caption).width, W * 0.78), bw = tw + pad * 2 + 10;
        g.fillStyle = 'rgba(14,17,22,.88)'; g.fillRect(bx, by, bw, bh); g.fillStyle = '#fe2c55'; g.fillRect(bx, by, 10, bh);
        g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(C.caption, bx + pad + 10, by + bh / 2, W * 0.78);
      }
    }
    C.start = function (deviceId) {
      if (C.camStream) return Promise.resolve();
      return navigator.mediaDevices.getUserMedia({ video: Object.assign({ width: { ideal: W }, height: { ideal: H } }, deviceId ? { deviceId: { exact: deviceId } } : {}) }).then(function (st) {
        C.camStream = st; cam.srcObject = st; cam.play().catch(function () {});
        if (!C.timer) C.timer = setInterval(draw, 33);   /* a timer keeps running while the tab is in the background (requestAnimationFrame would not) */
      });
    };
    C.ensureLoop = function () { if (!C.timer) C.timer = setInterval(draw, 33); };
    C.track = function () { if (!C.stream) C.stream = cv.captureStream(30); return C.stream.getVideoTracks()[0]; };
    C.useScreen = function () {
      if (C.scrStream) return Promise.resolve();
      if (!navigator.mediaDevices.getDisplayMedia) return Promise.reject(new Error('this browser cannot share a screen'));
      return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(function (st) {
        C.scrStream = st; scr.srcObject = st; scr.play().catch(function () {});
        st.getVideoTracks()[0].addEventListener('ended', function () { C.scrStream = null; scr.srcObject = null; if (C.scene.indexOf('screen') === 0) C.scene = 'cam'; if (C.onScreenEnd) C.onScreenEnd(); });
      });
    };
    C.showMedia = function (item, url) {
      C.media = item;
      if (item.kind === 'image') { img = new Image(); img.src = url; try { med.pause(); } catch (e) { /* ignore */ } return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }
      img = null; med.loop = C.loop; med.src = url; return med.play().catch(function () {});
    };
    C.setLoop = function (v) { C.loop = v; med.loop = v; };
    C.fresh = function () {          /* a broadcast needs its own video element: a finished one stays tied to the old audio mixer */
      var old = med, t = old.currentTime, src = old.src, was = !old.paused; old.pause();
      med = vid(false); med.loop = C.loop; if (src) { med.src = src; med.currentTime = t || 0; if (was) med.play().catch(function () {}); }
      return med;
    };
    C.stop = function () {
      clearInterval(C.timer); C.timer = null;
      [C.camStream, C.scrStream].forEach(function (st) { if (st) st.getTracks().forEach(function (t) { t.stop(); }); });
      C.camStream = C.scrStream = null; try { med.pause(); } catch (e) { /* ignore */ }
      if (C.stream) { C.stream.getTracks().forEach(function (t) { t.stop(); }); C.stream = null; }
    };
    draw(); return C;
  }

  /* pictures and videos for the TV studio */
  function mediaPanel(comp, stops, onPick) {
    var listEl = h('div', { class: 'tracks mediagrid' }), msg = h('p', { class: 'hint' }), cache = {};
    var up = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime', multiple: true, 'aria-label': 'Upload pictures or videos' });
    var loopBox = check('Repeat videos', true, function () { comp.setLoop(loopBox.input.checked); });
    function urlFor(it) {
      if (cache[it.id]) return Promise.resolve(cache[it.id]);
      return sb.storage.from('tvmedia').createSignedUrl(it.path, 3600).then(function (r) {
        if (r.error || !r.data) throw r.error || new Error('no link');
        return fetch(r.data.signedUrl).then(function (x) { if (!x.ok) throw new Error('download failed (' + x.status + ')'); return x.blob(); });   /* a local copy keeps the canvas "clean" so it can be broadcast */
      }).then(function (b) { cache[it.id] = URL.createObjectURL(b); return cache[it.id]; });
    }
    stops.push(function () { Object.keys(cache).forEach(function (k) { URL.revokeObjectURL(cache[k]); }); });
    function load() {
      sb.from('tv_media').select('*').order('created_at', { ascending: false }).then(function (r) {
        if (r.error) { listEl.replaceChildren(h('div', { class: 'empty', text: /relation|does not exist|schema cache/i.test(r.error.message) ? 'Run supabase/tvmedia.sql in Supabase first (see the README).' : r.error.message })); return; }
        var rows = r.data || [];
        if (!rows.length) { listEl.replaceChildren(h('div', { class: 'empty', text: 'No pictures or videos yet. Upload some above.' })); return; }
        listEl.replaceChildren.apply(listEl, rows.map(function (it) {
          var thumb = h('span', { class: 'mthumb', text: it.kind === 'video' ? '▶' : '' });
          if (it.kind === 'image') sb.storage.from('tvmedia').createSignedUrl(it.path, 3600).then(function (x) { if (x.data) thumb.style.backgroundImage = 'url("' + x.data.signedUrl + '")'; });
          var show = function (scene) {
            return function (ev) {
              var b = ev.currentTarget; b.disabled = true;
              urlFor(it).then(function (u) { return comp.showMedia(it, u); }).then(function () { onPick(scene); }).catch(function (e) { toast('Could not load "' + it.title + '": ' + errText(e), true); }).then(function () { b.disabled = false; });
            };
          };
          return h('div', { class: 'track' }, thumb, h('span', { class: 'tt' }, h('b', { text: it.title }), h('small', { text: (it.kind === 'video' ? 'Video' : 'Picture') + (it.size ? ' · ' + (it.size / 1048576).toFixed(1) + ' MB' : '') })),
            h('button', { class: 'btn primary', type: 'button', text: 'Show', onclick: show('media') }),
            h('button', { class: 'btn', type: 'button', text: '+ me', 'aria-label': 'Show ' + it.title + ' with me in the corner', onclick: show('pip') }),
            h('button', { class: 'btn', type: 'button', text: 'Delete', onclick: function () {
              if (!confirm('Delete "' + it.title + '"?')) return;
              sb.storage.from('tvmedia').remove([it.path]).then(function () { return sb.from('tv_media').delete().eq('id', it.id); }).then(function (x) { if (x && x.error) toast(x.error.message, true); if (comp.media && comp.media.id === it.id) comp.media = null; load(); });
            } }));
        }));
      });
    }
    up.addEventListener('change', function () {
      var files = Array.prototype.slice.call(up.files || []); up.value = ''; if (!files.length) return;
      var done = 0, bad = [];
      files.reduce(function (p, f) {
        return p.then(function () {
          var kind = /^image\//.test(f.type) ? 'image' : /^video\//.test(f.type) ? 'video' : '';
          if (!kind) { bad.push(f.name + ' (not a picture or video)'); return; }
          if (f.size > 52428800) { bad.push(f.name + ' (over 50 MB)'); return; }
          msg.className = 'hint'; msg.textContent = 'Uploading ' + f.name + '…';
          var path = Date.now() + '-' + f.name.replace(/[^\w.\-]+/g, '_').slice(-80);
          return sb.storage.from('tvmedia').upload(path, f, { contentType: f.type }).then(function (r) {
            if (r.error) throw r.error;
            return sb.from('tv_media').insert({ title: f.name.replace(/\.[^.]+$/, '').slice(0, 120), path: path, kind: kind, size: f.size });
          }).then(function (r) { if (r.error) throw r.error; done++; }).catch(function (e) { bad.push(f.name + ' (' + errText(e) + ')'); });
        });
      }, Promise.resolve()).then(function () {
        msg.className = bad.length ? 'hint err' : 'hint ok';
        msg.textContent = (done ? 'Added ' + done + '. ' : '') + (bad.length ? 'Not added: ' + bad.join('; ') : '');
        load();
      });
    });
    load();
    return h('div', {}, h('div', { class: 'uprow' }, up, loopBox.box), msg, listEl);
  }

  /* one studio window per channel: radio and TV have their own settings (saved in this browser) */
  function showDash(kind) {
    var isTv = kind === 'tv', S = loadSet(kind), stops = [];
    var save = function () { saveSet(kind, S); };
    var title = h('input', { type: 'text', value: S.title || '', placeholder: isTv ? 'e.g. Evening news' : 'e.g. Morning bulletin', maxlength: '120', oninput: function () { S.title = title.value; save(); } });
    var mic = h('select', { onchange: function () { S.mic = mic.value; save(); } }, h('option', { value: '', text: 'Default microphone' }));
    var cam = isTv ? h('select', { onchange: function () { S.cam = cam.value; save(); } }, h('option', { value: '', text: 'Default camera' })) : null;
    var source = isTv ? h('select', { onchange: function () { S.source = source.value; save(); sync(); } }, h('option', { value: 'camera', text: 'Camera and microphone' }), h('option', { value: 'screen', text: 'Screen share and microphone' }), h('option', { value: 'studio', text: 'Studio: camera, pictures, videos and screen' })) : null;
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

    var studio = isTv ? studioSection() : null;
    function sync() {
      if (cam) camField.style.display = source.value === 'screen' ? 'none' : '';
      if (preview && !onAir[kind]) preview.style.display = 'none';
      if (studio) { studio.hidden = source.value !== 'studio'; if (preview) preview.style.display = source.value === 'studio' ? 'none' : preview.style.display; }
    }
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
      if (preview) { preview.style.display = S.source === 'studio' ? 'none' : (live || S.source !== 'screen' ? '' : 'none'); }
      paintTabs();
    }
    var tick = setInterval(function () { if (onAir[kind]) timer.textContent = clock(Date.now() - onAir[kind].since); }, 1000);
    stops.push(function () { clearInterval(tick); });

    go.onclick = function () {
      go.disabled = true;
      if (onAir[kind]) return stopLive(kind).then(function () { if (preview) preview.srcObject = null; toast('Off air'); paint(); go.disabled = false; });
      if (testStop) { testStop(); testStop = null; test.textContent = 'Test microphone'; }
      status.textContent = 'Starting… allow the microphone' + (isTv ? (source.value === 'screen' ? ' and pick a screen' : ' and camera') : '') + ' if your browser asks.';
      var studioMode = isTv && S.source === 'studio', hooks = { preview: studioMode ? null : preview, onEnd: paint };
      var ready = Promise.resolve();
      if (studioMode) {
        status.textContent = 'Starting… allow the camera and microphone if your browser asks.';
        ready = tvComp.start(S.cam).then(function () { tvComp.fresh(); hooks.studio = { track: function () { return tvComp.track(); }, mediaEl: function () { return tvComp.mediaEl(); } }; });
      }
      ready.then(loadLiveKit).then(function () { return startLive(kind, S, hooks); })
        .then(function (got) {
          if (got.audio) onAir[kind].stopMeter = startMeter(new MediaStream([got.audio]), meter);
          toast('You are on air'); fillDevices();
        })
        .catch(function (e) { toast(errText(e), true); })
        .then(function () { paint(); go.disabled = false; });
    };

    function studioSection() {
      if (!tvComp) tvComp = makeCompositor(RES[S.res] || RES['720']);
      var comp = tvComp, sceneBtns = {}, camMsg = h('p', { class: 'hint' });
      comp.ensureLoop();
      function setScene(k) {
        var need = k.indexOf('screen') === 0 && !comp.scrStream ? comp.useScreen() : Promise.resolve();
        need.then(function () {
          if ((k === 'media' || k === 'pip') && !comp.media) { toast('Pick a picture or video below first', true); return; }
          comp.scene = k; paintScenes();
        }).catch(function (e) { toast('Could not share the screen: ' + errText(e), true); });
      }
      comp.onScreenEnd = function () { paintScenes(); toast('Screen sharing stopped'); };
      function paintScenes() { Object.keys(sceneBtns).forEach(function (k) { sceneBtns[k].setAttribute('aria-pressed', comp.scene === k ? 'true' : 'false'); sceneBtns[k].classList.toggle('primary', comp.scene === k); }); }
      var bar = h('div', { class: 'scenes', role: 'group', 'aria-label': 'Scenes' }, STUDIO_SCENES.map(function (sc) {
        var b = h('button', { class: 'btn', type: 'button', 'data-scene': sc[0], text: sc[1], title: 'Key ' + sc[2], onclick: function () { setScene(sc[0]); } });
        sceneBtns[sc[0]] = b; return b;
      }));
      var cap = h('input', { type: 'text', maxlength: '90', placeholder: 'On-screen caption, e.g. Breaking: city council votes', 'aria-label': 'On-screen caption', value: comp.caption, oninput: function () { comp.caption = cap.value; } });
      var capBtn = h('button', { class: 'btn', type: 'button', text: comp.capOn ? 'Hide caption' : 'Show caption', onclick: function () { comp.capOn = !comp.capOn; capBtn.textContent = comp.capOn ? 'Hide caption' : 'Show caption'; } });
      var camBtn = h('button', { class: 'btn', type: 'button', text: comp.camStream ? 'Camera is on' : 'Turn on camera preview', onclick: function () {
        comp.start(S.cam).then(function () { camBtn.textContent = 'Camera is on'; camMsg.textContent = ''; fillDevices(); }).catch(function (e) { camMsg.className = 'hint err'; camMsg.textContent = 'Could not open the camera: ' + errText(e); });
      } });
      if (res) res.addEventListener('change', function () { if (!onAir.tv) comp.resize(RES[res.value] || RES['720']); });
      function key(e) {
        if (S.source !== 'studio' || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName)) return;
        var sc = STUDIO_SCENES.filter(function (x) { return x[2] === e.key; })[0]; if (sc) { e.preventDefault(); setScene(sc[0]); }
      }
      document.addEventListener('keydown', key); stops.push(function () { document.removeEventListener('keydown', key); if (!onAir.tv) comp.stop(); });
      paintScenes();
      var box = h('section', { class: 'panel wide studio' }, h('h3', { text: 'Studio: what the audience sees' }),
        h('div', { class: 'studiogrid' },
          h('div', {}, comp.cv, bar, h('p', { class: 'hint', text: 'Keys 1 to 6 switch scenes. The picture above is exactly what is broadcast.' }),
            h('div', { class: 'uprow' }, cap, capBtn), h('div', { class: 'btnrow' }, camBtn), camMsg),
          h('div', {}, h('h3', { text: 'Pictures and videos' }), mediaPanel(comp, stops, setScene))));
      return box;
    }

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
        studio, musicPanel(kind, S, save, stops)));
  }

  /* ---------------------------------------------------------------- newsletter window */
  function callFunction(name, body) {
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token;
      return fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/' + name, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anon_key, Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j.status = r.status;
        if (r.status === 404 && !j.error) j.error = 'The "' + name + '" function is not deployed yet. See the README.';
        return j;
      });
    }).catch(function () { return { error: 'No connection to the function. Check your internet and the function setup.' }; });
  }
  var nlLoading = null, nlRoot = null, nlDirty = false;
  function loadScript(src) {
    return new Promise(function (ok, no) { var el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = function () { no(new Error('Could not load ' + src)); }; document.head.appendChild(el); });
  }
  function showNewsletter() {
    var v = cfg.ver || {};
    if (!nlLoading) nlLoading = loadScript('../assets/email-templates.js?v=' + (v.tpl || '')).then(function () { return loadScript('../assets/newsletter-editor.js?v=' + (v.nl || '')); }).catch(function (e) { nlLoading = null; throw e; });
    return nlLoading.then(function () {
      if (nlRoot) return nlRoot;                      /* keep a half-written newsletter when you visit another window and come back */
      nlRoot = window.SparkNL.mount({ h: h, field: field, check: check, toast: toast, sb: sb, cfg: cfg, me: me, errText: errText, fmtDate: fmtDate,
        getArticles: function () { return articles; }, callFn: callFunction, setDirty: function (d) { nlDirty = d; } });
      return nlRoot;
    });
  }

  /* ---------------------------------------------------------------- settings window (admins) */
  function callLiveFn(body) {
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token;
      return fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/livekit-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anon_key, Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  }
  function deepMerge(a, b) {
    var o = JSON.parse(JSON.stringify(a || {}));
    (function m(x, y) { Object.keys(y || {}).forEach(function (k) { if (y[k] && typeof y[k] === 'object' && !Array.isArray(y[k]) && x[k] && typeof x[k] === 'object') m(x[k], y[k]); else x[k] = y[k]; }); })(o, b || {});
    return o;
  }
  function showSettings() {
    var box = h('div', { class: 'dash settings' }, h('div', { class: 'empty', text: 'Loading settings…' }));
    Promise.all([sb.from('site_settings').select('data').eq('id', 1).maybeSingle(), sb.rpc('secret_status')]).then(function (res) {
      if (res[0].error) {
        return box.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission/i.test(res[0].error.message || '') ? 'Settings are not set up yet. Run supabase/settings.sql in the Supabase SQL Editor (see the README), then reload.' : errText(res[0].error) }));
      }
      var V = deepMerge(cfg.site || {}, (res[0].data && res[0].data.data) || {});
      V.ticker = V.ticker || {}; V.ticker.tab = V.ticker.tab || {}; V.live = V.live || {}; V.newsletter = V.newsletter || {};
      var st = {}; (res[1].data || []).forEach(function (x) { st[x.key] = x; });
      var mark = function () { dirty = true; dirtyEl.textContent = 'Unsaved changes'; };
      var dirtyEl = h('span', { class: 'dirty' });
      function bind(obj, key, type, extra) {
        var i = h('input', { type: type || 'text', value: obj[key] == null ? '' : obj[key], oninput: function () { obj[key] = type === 'number' ? (i.value === '' ? '' : i.value * 1) : i.value; mark(); } });
        Object.keys(extra || {}).forEach(function (k) { i.setAttribute(k, extra[k]); });
        return i;
      }
      function tick(obj, key, label) { var c = check(label, !!obj[key], function () { obj[key] = c.input.checked; mark(); }); return c.box; }
      var nav = h('input', { type: 'text', value: (V.nav_order || []).join(', '), placeholder: 'Politics, Business, Sport', oninput: function () { V.nav_order = nav.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); mark(); } });
      var custom = h('textarea', { placeholder: 'One headline per line. Optional link after a bar:\nPlain headline\nWith link | a/some-article.html',
        oninput: function () { V.ticker.custom = custom.value.split('\n').map(function (l) { var p = l.split('|'); var t = p[0].trim(); return !t ? null : p[1] && p[1].trim() ? { text: t, url: p.slice(1).join('|').trim() } : t; }).filter(Boolean); mark(); } });
      custom.value = (V.ticker.custom || []).map(function (c) { return typeof c === 'string' ? c : c.text + (c.url ? ' | ' + c.url : ''); }).join('\n');
      var mode = h('select', { onchange: function () { V.ticker.tab.mode = mode.value; mark(); } }, h('option', { value: 'scroll', text: 'Text slides along' }), h('option', { value: 'headline', text: 'One headline at a time' }));
      mode.value = V.ticker.tab.mode || 'scroll';

      var saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Save settings', onclick: function () {
        saveBtn.disabled = true;
        sb.rpc('settings_save', { p_data: V }).then(function (r) {
          saveBtn.disabled = false;
          if (r.error) return toast(errText(r.error), true);
          dirty = false; dirtyEl.textContent = '';
          toast(rebuildReady ? 'Saved. The website updates in about a minute.' : 'Saved. Press "Update website" (top right) to apply it to the website.');
        });
      } });

      /* keys: write-only; the saved secret is never sent back to the browser */
      function keyBox(name, label, type, hintText, isUrl) {
        var s = st[name] || {}, i = h('input', { type: type, autocomplete: 'off', spellcheck: 'false', value: isUrl || ['livekit_api_key', 'mailjet_api_key', 'smtp_host', 'smtp_port', 'smtp_user'].indexOf(name) >= 0 ? (s.hint || '') : '',
          placeholder: s.is_set ? 'Saved (' + (s.hint || '') + '). Type a new one to replace it.' : 'Not set' });
        i.dataset.orig = i.value;
        return { name: name, input: i, field: field(label, i, hintText), saved: !!s.is_set };
      }
      var lk = [keyBox('livekit_url', 'LiveKit address', 'text', 'Looks like wss://yourproject.livekit.cloud (LiveKit Cloud > Settings).', true),
                keyBox('livekit_api_key', 'API key', 'text', 'From LiveKit Cloud > Settings > Keys.'),
                keyBox('livekit_api_secret', 'API secret', 'password', 'Only shown once by LiveKit. It is stored where the website and the editor cannot read it.')];
      /* email service for the newsletter: pick one; only its fields are shown */
      var PROV = { resend: 'Resend', mailjet: 'Mailjet', smtp: 'My own mail server (SMTP)' };
      if (!PROV[V.newsletter.provider]) V.newsletter.provider = 'resend';
      var mailKeys = {
        resend: [keyBox('resend_api_key', 'Resend API key', 'password', 'From resend.com > API Keys (create it with "Sending access"). It is stored where the website and the editor pages cannot read it.')],
        mailjet: [keyBox('mailjet_api_key', 'Mailjet API key', 'text', 'From Mailjet > Account settings > API Key Management.'),
                  keyBox('mailjet_secret_key', 'Mailjet secret key', 'password', 'Shown next to the API key. Stored where the website cannot read it.')],
        smtp: [keyBox('smtp_host', 'Mail server', 'text', 'For example smtp.gmail.com or mail.yourhost.com.'),
               keyBox('smtp_port', 'Port', 'text', '587 is usual, 465 for secure connections. Empty means 587.'),
               keyBox('smtp_user', 'User name', 'text', 'Usually your full email address.'),
               keyBox('smtp_pass', 'Password', 'password', 'Gmail and others need an "app password", not your normal password.')]
      };
      var mailHelp = {
        resend: 'Resend: the free plan sends about 100 emails a day. Verify your own domain at resend.com/domains and use an address on it as the sender (Newsletter > Design).',
        mailjet: 'Mailjet: the free plan sends about 200 emails a day. Verify your sender address in Mailjet first (Account > Sender domains & addresses).',
        smtp: 'Your own mail server: Gmail allows about 500 emails a day, many hosts less. The sender address must belong to this mailbox. Not every host allows sending from outside, so use the test button.'
      };
      var mailMsg = h('p', { class: 'hint' }), mailNote = h('p', { class: 'hint' });
      var mailBoxes = {};
      Object.keys(mailKeys).forEach(function (k) { mailBoxes[k] = h('div', {}, mailKeys[k].map(function (x) { return x.field; })); });
      function showProv() { Object.keys(mailBoxes).forEach(function (k) { mailBoxes[k].hidden = k !== V.newsletter.provider; }); mailNote.textContent = mailHelp[V.newsletter.provider]; mailMsg.textContent = ''; }
      var provSel = h('select', { 'aria-label': 'Email service', onchange: function () { V.newsletter.provider = provSel.value; mark(); showProv(); } },
        Object.keys(PROV).map(function (k) { return h('option', { value: k, text: PROV[k] }); }));
      provSel.value = V.newsletter.provider; showProv();
      var mailTest = h('button', { class: 'btn', type: 'button', text: 'Save and test connection', onclick: function () {
        mailTest.disabled = true; mailMsg.className = 'hint'; mailMsg.textContent = 'Testing…';
        var cur = mailKeys[V.newsletter.provider];
        sb.rpc('settings_save', { p_data: V }).then(function (r) { if (r.error) throw r.error; dirty = false; dirtyEl.textContent = ''; return saveKeys(cur, mailMsg, 'Email details'); })
          .then(function () { return callFunction('newsletter', { mode: 'check' }); }).then(function (j) {
            mailTest.disabled = false;
            if (j.ok) { mailMsg.className = 'hint ok'; mailMsg.textContent = 'Connected to ' + j.service + (j.info ? ' (' + j.info + ')' : '') + (j.sender_ok ? '.' : '. Now set the sender in Newsletter > Design.'); }
            else { mailMsg.className = 'hint err'; mailMsg.textContent = j.error || 'The connection test failed.'; }
          }).catch(function (e) { mailTest.disabled = false; mailMsg.className = 'hint err'; mailMsg.textContent = errText(e); });
      } });
      var gh = keyBox('github_token', 'GitHub token', 'password', 'A fine-grained token for the repository "news" with Actions: Read and write. See the README.');
      var lkMsg = h('p', { class: 'hint' }), ghMsg = h('p', { class: 'hint' });
      function saveKeys(list, msgEl, label) {
        var jobs = list.filter(function (k) { var v = k.input.value.trim(); return v !== (k.input.dataset.orig || '') && (v || k.saved); });
        if (!jobs.length) { msgEl.textContent = 'Nothing to save.'; return Promise.resolve(false); }
        for (var n = 0; n < jobs.length; n++) if (jobs[n].name === 'livekit_url' && jobs[n].input.value.trim() && !/^(wss?|https?):\/\//i.test(jobs[n].input.value.trim())) { msgEl.textContent = 'The address must start with wss:// (or https://).'; return Promise.resolve(false); }
        return jobs.reduce(function (p, k) { return p.then(function () { return sb.rpc('secret_set', { p_key: k.name, p_value: k.input.value.trim() }).then(function (r) { if (r.error) throw r.error; }); }); }, Promise.resolve())
          .then(function () { msgEl.textContent = label + ' saved.'; toast(label + ' saved'); list.forEach(function (k) { if (k.input.type === 'password') k.input.value = ''; else k.input.dataset.orig = k.input.value.trim(); if (k.input.value || k.input.type !== 'password') k.saved = true; }); return true; })
          .catch(function (e) { msgEl.textContent = ''; toast(errText(e), true); return false; });
      }
      var testBtn = h('button', { class: 'btn', type: 'button', text: 'Test connection', onclick: function () {
        testBtn.disabled = true; lkMsg.textContent = 'Testing…'; lkMsg.className = 'hint';
        saveKeys(lk, lkMsg, 'LiveKit details').then(function () { return callLiveFn({ mode: 'check' }); }).then(function (j) {
          testBtn.disabled = false;
          if (j.status === 404) { lkMsg.textContent = 'The livekit-token function is not deployed yet (see the README).'; lkMsg.className = 'hint err'; }
          else if (j.ok) { lkMsg.textContent = 'Connected to LiveKit. Live radio and TV are ready.'; lkMsg.className = 'hint ok'; }
          else { lkMsg.textContent = j.error || 'The connection test failed.'; lkMsg.className = 'hint err'; }
        });
      } });

      box.replaceChildren(
        h('div', { class: 'dashhead' }, h('h2', { text: 'Settings' }), dirtyEl, h('span', { class: 'sp' }), saveBtn),
        h('p', { class: 'hint', text: 'Changes to the website settings go live after the next website update (automatic when instant updates are set up).' }),
        h('div', { class: 'setgrid' },
          h('section', { class: 'panel' }, h('h3', { text: 'Website' }),
            field('Site name', bind(V, 'site_name', 'text', { maxlength: 80 })),
            h('div', { class: 'row2' }, field('Logo, first part', bind(V, 'logo_left', 'text', { maxlength: 40 })), field('Logo, second part', bind(V, 'logo_right', 'text', { maxlength: 40 }))),
            field('Tagline', bind(V, 'tagline', 'text', { maxlength: 200 })), field('Footer text', bind(V, 'footer_text', 'text', { maxlength: 400 })),
            field('Public address of the website', bind(V, 'base_url', 'url'), 'Used for sharing previews, for example https://victor-stanovoy.github.io/news')),
          h('section', { class: 'panel' }, h('h3', { text: 'Homepage and menu' }),
            h('div', { class: 'row2' }, field('Sections in the menu', bind(V, 'nav_max', 'number', { min: 1, max: 20 })), field('Sections on the homepage', bind(V, 'home_category_sections', 'number', { min: 0, max: 20 }))),
            h('div', { class: 'row2' }, field('Items in "Most read"', bind(V, 'most_read_count', 'number', { min: 1, max: 20 })), field('Breaking banner hides after (days, 0 = never)', bind(V, 'breaking_max_age_days', 'number', { min: 0, max: 365 }))),
            field('Menu order', nav, 'Section names, separated by commas. Sections not listed follow after.')),
          h('section', { class: 'panel' }, h('h3', { text: 'Tickers' }),
            tick(V.ticker, 'enabled', 'Show the headline bar under the menu'),
            h('div', { class: 'row2' }, field('Tag text', bind(V.ticker, 'label', 'text', { maxlength: 30 })), field('Headlines shown', bind(V.ticker, 'count', 'number', { min: 1, max: 30 }))),
            field('Speed (pixels per second)', bind(V.ticker, 'speed', 'number', { min: 10, max: 300 })),
            field('Own headlines instead of the newest articles', custom),
            tick(V.ticker.tab, 'enabled', 'Browser tab title becomes a ticker when a visitor leaves the page'),
            h('div', { class: 'row2' }, field('Tab ticker style', mode), field('Symbol before headlines', bind(V.ticker.tab, 'prefix', 'text', { maxlength: 10 })))),
          h('section', { class: 'panel' }, h('h3', { text: 'Live radio and TV' }),
            tick(V.live, 'enabled', 'Show the Live page and menu link'),
            h('p', { class: 'hint', text: 'Connection to LiveKit (the service that carries the broadcast).' }),
            lk.map(function (k) { return k.field; }), lkMsg,
            h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Save LiveKit details', onclick: function () { saveKeys(lk, lkMsg, 'LiveKit details'); } }), testBtn)),
          h('section', { class: 'panel' }, h('h3', { text: 'Newsletter' }),
            tick(V.newsletter, 'enabled', 'Show the sign-up box on the website (turn on after the email service is connected)'),
            field('Box title', bind(V.newsletter, 'title', 'text', { maxlength: 80, placeholder: 'Get the newsletter' })), field('Box text', bind(V.newsletter, 'blurb', 'text', { maxlength: 240 })),
            field('Email service', provSel, 'The service that actually delivers your newsletters. Pick one and fill in its details.'),
            mailBoxes.resend, mailBoxes.mailjet, mailBoxes.smtp, mailNote, mailMsg, h('div', { class: 'btnrow' }, mailTest),
            h('p', { class: 'hint', text: 'Write and send newsletters in the Newsletter tab. Sender name, email and the look of the emails are set there under Design.' })),
          h('section', { class: 'panel' }, h('h3', { text: 'Instant website updates' }),
            h('p', { class: 'hint', text: gh.saved ? 'A token is saved. Publishing starts a website update by itself.' : 'No token saved yet, so the website only updates when you press "Update website" or at the next hourly rebuild.' }),
            gh.field, ghMsg,
            h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Save token', onclick: function () { saveKeys([gh], ghMsg, 'GitHub token').then(function (ok) { if (ok) rebuildReady = true; }); } }),
              h('button', { class: 'btn', type: 'button', text: 'Update website now', onclick: updateSite }))),
          h('section', { class: 'panel' }, h('h3', { text: 'Database connection' }),
            h('p', { class: 'hint', text: 'The address and public key of the Supabase database are kept in site.json on GitHub, because the editor needs them to log in at all.' }),
            h('div', { class: 'kv' }, h('span', { text: 'Address' }), h('code', { text: cfg.url })))));
    });
    return box;
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
