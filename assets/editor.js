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
  var dirty = false, filter = 'all', query = '', saving = false, rebuildReady = false;

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
  function signOut() { sb.auth.signOut().then(function () { articles = []; current = null; renderLogin(); }); }

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

    var search = h('input', { type: 'text', placeholder: 'Search articles', 'aria-label': 'Search articles', oninput: function () { query = search.value.toLowerCase(); renderList(); } });
    var chips = h('div', { class: 'chips' });
    [['all', 'All'], ['draft', 'Drafts'], ['published', 'Published'], ['scheduled', 'Scheduled']].forEach(function (f) {
      chips.appendChild(h('button', { class: 'chip' + (filter === f[0] ? ' on' : ''), type: 'button', text: f[1], 'data-f': f[0],
        onclick: function () { filter = f[0]; chips.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.f === filter); }); renderList(); } }));
    });
    listEl = h('div', { class: 'list' });
    var side = h('aside', { class: 'side' },
      h('div', { class: 'tools' }, h('button', { class: 'btn primary', type: 'button', text: '+ New article', onclick: function () { guard(function () { location.hash = '#/new'; }); } }), search, chips), listEl);
    mainEl = h('main', { class: 'main' });
    app.replaceChildren(bar, h('div', { class: 'work' }, side, mainEl));
    renderList();
    route();
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
      h('div', { class: 'head' }, h('h2', { text: isNew ? 'New article' : 'Edit article' }), dirtyEl, prevBtn, viewBtn, saveBtn, pubBtn),
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
