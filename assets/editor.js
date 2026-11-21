/* SparkNews editor: log in, write, publish. Talks to Supabase (see supabase/schema.sql). */
(function () {
  'use strict';

  var cfg = {};
  try { cfg = JSON.parse(document.getElementById('spark-editor-config').textContent); } catch (e) {}
  var app = document.getElementById('app');
  var LANGS = { ar: 'العربية', zh: '中文', fr: 'Français', ru: 'Русский', es: 'Español', de: 'Deutsch', it: 'Italiano',
    pt: 'Português', ja: '日本語', ko: '한국어', tr: 'Türkçe', pl: 'Polski', nl: 'Nederlands', uk: 'Українська', en: 'English' };
  /* Free automatic translation, no account or key. First choice: Google's public translate endpoint (better quality, no daily limit we know of,
     but unofficial so it can change). If it does not answer we fall back to MyMemory (about 5,000 characters a day per connection).
     Names you list stay untouched, and a paragraph with bold/italic/links is translated as one sentence so the grammar stays right.
     "Good enough to read": a person should still check it before it is published. */
  var MM = { zh: 'zh-CN', pt: 'pt-PT' };
  function mmCode(l) { return MM[l] || l; }
  var protectTerms = [], engine = { g: true };
  function decode(t) { var d = document.createElement('textarea'); d.innerHTML = t; return d.value; }
  function gOne(text, from, to) {
    return fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + encodeURIComponent(from) + '&tl=' + encodeURIComponent(mmCode(to)) + '&q=' + encodeURIComponent(text)).then(function (r) {
      if (!r.ok) throw new Error('g' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j[0]) throw new Error('gempty');
      return j[0].map(function (x) { return x && x[0] || ''; }).join('');
    });
  }
  function mmOne(text, from, to) {
    return fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(mmCode(from) + '|' + mmCode(to))).then(function (r) {
      if (!r.ok) throw new Error('The translation service is not answering (' + r.status + ').');
      return r.json();
    }).then(function (j) {
      var st = Number(j.responseStatus);
      if (st === 429 || /QUOTA|LIMIT/i.test(String(j.responseDetails || ''))) throw new Error('The free daily translation limit is used up. Try again tomorrow, or translate fewer languages at once.');
      if (st !== 200) throw new Error(String(j.responseDetails || 'The translation failed.'));
      return decode(String((j.responseData && j.responseData.translatedText) || '')) || text;
    });
  }
  function tOne(text, from, to) {
    var terms = protectTerms.filter(function (t) { return t && text.toLowerCase().indexOf(t.toLowerCase()) >= 0; }), safe = text;
    terms.forEach(function (t, i) { safe = safe.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'ZQ' + i + 'X'); });
    var run = engine.g ? gOne(safe, from, to).catch(function () { engine.g = false; return mmOne(safe, from, to); }) : mmOne(safe, from, to);
    return run.then(function (t) {
      terms.forEach(function (term, i) { t = t.replace(new RegExp('ZQ\\s*' + i + '\\s*X', 'gi'), term); });
      return t;
    });
  }
  function chunk(text) {         /* pieces cut at sentence ends: long for Google, short for MyMemory */
    var max = engine.g ? 1500 : 450, out = [], cur = '';
    (text.match(/[^.!?。]+[.!?。]*\s*/g) || [text]).forEach(function (sn) {
      if (sn.length > max) { if (cur) { out.push(cur); cur = ''; } for (var i = 0; i < sn.length; i += max) out.push(sn.slice(i, i + max)); return; }
      if ((cur + sn).length > max) { out.push(cur); cur = sn; } else cur += sn;
    });
    if (cur) out.push(cur); return out;
  }
  function mmText(text, from, to) {
    if (!text.trim()) return Promise.resolve(text);
    var lead = (text.match(/^\s*/) || [''])[0], tail = (text.match(/\s*$/) || [''])[0], parts = chunk(text.trim()), res = [];
    return parts.reduce(function (p, part, i) { return p.then(function () { return tOne(part, from, to).then(function (t) { res[i] = t; }); }); }, Promise.resolve())
      .then(function () { return lead + res.join(' ') + tail; });
  }
  var INLINE = /^(A|B|I|U|EM|STRONG|SPAN|MARK|SMALL|SUB|SUP)$/, BLOCK = /^(P|LI|H[1-6]|BLOCKQUOTE|FIGCAPTION|TD|TH)$/;
  function inlineOnly(el) { return [].every.call(el.querySelectorAll('*'), function (c) { return INLINE.test(c.nodeName); }); }
  function hasInline(el) { return !!el.querySelector('*'); }
  /* a paragraph with inline tags goes out as one sentence with markers [[1]]..[[/1]] where the tags were */
  function markBlock(el) {
    var tags = [], n = 0;
    function walk(node) {
      var o = '';
      [].forEach.call(node.childNodes, function (c) {
        if (c.nodeType === 3) o += c.nodeValue;
        else if (c.nodeType === 1) { var id = ++n, shell = c.cloneNode(false).outerHTML.replace(/<\/[^>]+>$/, ''); tags[id] = { open: shell, close: '</' + c.nodeName.toLowerCase() + '>' }; o += '[[' + id + ']]' + walk(c) + '[[/' + id + ']]'; }
      });
      return o;
    }
    return { text: walk(el), tags: tags, count: n };
  }
  function unmark(t, m) {
    for (var i = 1; i <= m.count; i++) { if (t.indexOf('[[' + i + ']]') < 0 || t.indexOf('[[/' + i + ']]') < 0) return null; }
    t = t.split(/(\[\[\s*\/?\s*\d+\s*\]\])/).map(function (seg, k) {
      if (k % 2 === 0) return mEsc(seg);
      var d = seg.match(/\d+/)[0], close = /\//.test(seg); return m.tags[d] ? (close ? m.tags[d].close : m.tags[d].open) : '';
    }).join('');
    return t;
  }
  function mEsc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mmHtml(html, from, to, progress) {      /* translate the text inside the tags, keep the tags */
    var plain = !/<[a-z][\s\S]*>/i.test(html);
    var doc = new DOMParser().parseFromString('<body>' + (plain ? html.split(/\n\s*\n/).map(function (p) { return '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>'; }).join('') : html) + '</body>', 'text/html');
    var jobs = [], seen = new Set();
    [].forEach.call(doc.body.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th'), function (el) {
      if (!BLOCK.test(el.nodeName) || !hasInline(el) || !inlineOnly(el) || el.querySelector('img,br')) return;
      jobs.push({ block: el }); el.querySelectorAll('*').forEach(function (c) { seen.add(c); }); seen.add(el);
    });
    var w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) {
      var par = n.parentNode && n.parentNode.nodeName; if (!n.nodeValue.trim() || /^(SCRIPT|STYLE|CODE|PRE)$/.test(par)) continue;
      var inBlock = jobs.some(function (j) { return j.block && j.block.contains(n); });
      if (!inBlock) jobs.push({ node: n });
    }
    var done = 0;
    function tick() { done++; if (progress) progress(done, jobs.length); }
    return jobs.reduce(function (p, job) {
      return p.then(function () {
        if (job.node) return mmText(job.node.nodeValue, from, to).then(function (t) { job.node.nodeValue = t; tick(); });
        var m = markBlock(job.block);
        return mmText(m.text, from, to).then(function (t) {
          var h = unmark(t, m);
          if (h != null) { job.block.innerHTML = h; return tick(); }
          var ns = [], tw = doc.createTreeWalker(job.block, NodeFilter.SHOW_TEXT, null), x;     /* markers got lost: the old way, piece by piece */
          while ((x = tw.nextNode())) if (x.nodeValue.trim()) ns.push(x);
          return ns.reduce(function (q, nd) { return q.then(function () { return mmText(nd.nodeValue, from, to).then(function (t2) { nd.nodeValue = t2; }); }); }, Promise.resolve()).then(tick);
        });
      });
    }, Promise.resolve())
      .then(function () { return plain ? [].map.call(doc.body.children, function (e) { return e.textContent; }).join('\n\n') : doc.body.innerHTML; });
  }
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
      Promise.all([loadArticles(), sb.rpc('rebuild_configured'), loadChannels(), loadEditorial()]).then(function (res) {
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
  function signOut() { Object.keys(onAir).forEach(stopLive); view = ''; nlRoot = null; nlDirty = false; sb.auth.signOut().then(function () { articles = []; current = null; renderLogin(); }); }

  /* ---------------------------------------------------------------- partners: where a story appears */
  var MAIN_ONLY = '_main';   /* stored as no partner label + partner_mode = 'main' */
  function partnerList() { return (cfg.site && cfg.site.partners) || []; }
  function partnerName(slug) { var p = partnerList().filter(function (x) { return x.slug === slug; })[0]; return p ? p.name : slug; }
  function whereMode(slug, mode) { var p = partnerList().filter(function (x) { return x.slug === slug; })[0]; return mode || (p && p.main) || 'redirect'; }
  function whereShort(slug, mode) {
    var m = whereMode(slug, mode), n = partnerName(slug);
    return m === 'show' ? 'here + ' + n : m === 'hide' ? 'only ' + n : '\u2192 ' + n;
  }
  /* one clear choice instead of a label plus a mode */
  function whereSelect(a, onchange) {
    var opts = [h('option', { value: '', text: 'Everywhere: main website and every partner embed' })];
    opts.push(h('option', { value: MAIN_ONLY, text: 'Only main website (not in any partner embed)' }));
    partnerList().forEach(function (p) {
      opts.push(h('optgroup', { label: p.name },
        h('option', { value: p.slug + ':show', text: 'Main website AND ' + p.name }),
        h('option', { value: p.slug + ':hide', text: 'Only in ' + p.name + ' (hidden on the main website)' }),
        h('option', { value: p.slug + ':redirect', text: 'Main website sends readers to ' + p.name })));
    });
    var sel = h('select', { onchange: onchange }, opts);
    sel.value = a.partner_label ? a.partner_label + ':' + whereMode(a.partner_label, a.partner_mode) : (a.partner_mode === 'main' ? MAIN_ONLY : '');
    if (a.partner_label && sel.value !== a.partner_label + ':' + whereMode(a.partner_label, a.partner_mode)) {   /* label of a partner that was removed */
      sel.appendChild(h('option', { value: a.partner_label + ':' + whereMode(a.partner_label, a.partner_mode), text: 'Removed partner: ' + a.partner_label }));
      sel.value = a.partner_label + ':' + whereMode(a.partner_label, a.partner_mode);
    }
    return sel;
  }

  /* ---------------------------------------------------------------- data */
  function loadArticles() {
    var cols = 'id,slug,title,category,status,published_at,scheduled_publish_at,updated_at,created_by,taken_down,author_name';
    function q(c) { return sb.from('articles').select(c).order('updated_at', { ascending: false }).limit(2000); }
    return q(cols + ',partner_label,partner_mode').then(function (r) { return r.error ? q(cols) : r; })
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

    var windows = [['articles', 'Articles', '#/']].concat(canPublish() ? [['radio', 'Radio studio', '#/radio'], ['tv', 'TV studio', '#/tv'], ['schedule', 'Schedule', '#/schedule'], ['newsletter', 'Newsletter', '#/newsletter'], ['polls', 'Polls', '#/polls']] : [], me.role === 'admin' ? [['badges', 'Badges', '#/badges'], ['settings', 'Settings', '#/settings']] : []);
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
      var d = t.querySelector('.dot'); if (d) d.classList.toggle('live', anyAir(t.dataset.v));
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
        h('span', {}, h('i', { class: 'badge ' + a.status, text: a.taken_down ? 'taken down' : a.status }), a.partner_label ? h('i', { class: 'badge ptag', title: 'Partner label', text: whereShort(a.partner_label, a.partner_mode) }) : (a.partner_mode === 'main' ? h('i', { class: 'badge ptag', title: 'Not shown in partner embeds', text: 'main site only' }) : null), (a.category || '') + ' · ' + fmtDate(a.updated_at)));
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
    if (location.hash === '#/badges') {
      if (me.role !== 'admin') { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = 'badges';
      stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'empty', text: 'Loading…' }))); paintTabs();
      Promise.all([loadScript('../assets/vendor/qrcode.js'), loadScript('../assets/badges-editor.js?v=' + ((cfg.ver || {}).badges || ''))]).then(function () {
        if (view !== 'badges') return;
        stage.replaceChildren(window.SparkBadges.mount({ h: h, field: field, check: check, toast: toast, sb: sb, errText: errText, upload: upload, site: cfg.site }));
      }).catch(function (e) { stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'msg err', text: errText(e) }))); });
      return;
    }
    if (location.hash === '#/polls') {
      if (!canPublish()) { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = 'polls';
      stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'empty', text: 'Loading…' }))); paintTabs();
      loadScript('../assets/polls-editor.js?v=' + ((cfg.ver || {}).polls || '')).then(function () {
        if (view !== 'polls') return;
        stage.replaceChildren(window.SparkPolls.mount({ h: h, field: field, check: check, toast: toast, sb: sb, errText: errText }));
      }).catch(function (e) { stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'msg err', text: errText(e) }))); });
      return;
    }
    if (location.hash === '#/newsletter') {
      if (!canPublish()) { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = 'newsletter';
      stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'empty', text: 'Loading…' }))); paintTabs();
      showNewsletter().then(function (el) { if (view === 'newsletter') stage.replaceChildren(el); }).catch(function (e) { stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'msg err', text: errText(e) }))); });
      return;
    }
    var dm = location.hash.match(/^#\/(radio|tv)(?:\/([a-z0-9-]+))?$/);
    if (dm) {
      if (!canPublish()) { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = dm[1];
      var want = dm[2]; if (!want) { try { want = localStorage.getItem('spark-chan-' + dm[1]); } catch (e) {} }
      var mineCh = channels.filter(function (c) { return c.type === dm[1]; });
      var pick = (mineCh.filter(function (c) { return c.slug === want; })[0] || mineCh[0] || { slug: dm[1] }).slug;
      stage.replaceChildren(showDash(dm[1], pick)); paintTabs(); return;
    }
    var sm = location.hash.match(/^#\/schedule(?:\/([a-z0-9-]+))?$/);
    if (sm) {
      if (!canPublish()) { location.hash = ''; return; }
      if (dashCleanup) { dashCleanup(); dashCleanup = null; }
      current = null; dirty = false; view = 'schedule';
      stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'empty', text: 'Loading…' }))); paintTabs();
      Promise.all([loadScript('../assets/schedule-editor.js?v=' + ((cfg.ver || {}).schedule || '')), loadChannels()]).then(function () {
        if (view !== 'schedule') return;
        var sc = window.SparkSchedule.mount({ h: h, field: field, check: check, toast: toast, sb: sb, errText: errText, me: me, channels: channels, getChannels: function () { return channels; }, reload: loadChannels, start: sm[1] || '', onAir: function () { return Object.keys(onAir).filter(function (k) { return onAir[k]; }); } });
        stage.replaceChildren(sc.el); dashCleanup = sc.stop;
      }).catch(function (e) { stage.replaceChildren(h('div', { class: 'dash' }, h('div', { class: 'msg err', text: errText(e) }))); });
      return;
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
  var editorial = { min_words: 0, admin_override: true };   /* the minimum article length set in Settings */
  function loadEditorial() {
    return sb.from('site_settings').select('data').eq('id', 1).maybeSingle().then(function (r) {
      var e = r && r.data && r.data.data && r.data.data.editorial;
      if (e) editorial = { min_words: Math.max(0, parseInt(e.min_words, 10) || 0), admin_override: e.admin_override !== false };
    }, function () {});
  }
  function wordsIn(text) { var m = String(text || '').match(/[^\s]+/g); return m ? m.length : 0; }
  var channels = [{ slug: 'tv', type: 'tv', name: 'Live TV' }, { slug: 'radio', type: 'radio', name: 'Live radio' }];   /* every channel the visitors can see; reloaded after sign-in */
  function typeOf(k) { var c = channels.filter(function (x) { return x.slug === k; })[0]; return c ? c.type : (k === 'radio' ? 'radio' : 'tv'); }
  function anyAir(type) { return Object.keys(onAir).some(function (k) { return onAir[k] && (!type || typeOf(k) === type); }); }
  function loadChannels() {
    return sb.from('live_channel_list').select('*').order('position').order('name').then(function (r) {
      if (!r.error && r.data && r.data.length) channels = r.data;
    }, function () {});
  }
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
  function liveToken(kind, mode) {
    return sb.auth.getSession().then(function (s) {
      var tok = s.data && s.data.session && s.data.session.access_token;
      return fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/livekit-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anon_key, Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ kind: kind, mode: mode || 'publish' })
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
    if (typeOf(kind) === 'tv' && tvComp && view !== 'tv' && !anyAir('tv')) { tvComp.stop(); }   /* nobody is looking at the studio any more: release camera and screen */
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
      var anM = ctx.createAnalyser(), anP = ctx.createAnalyser(), padGain = ctx.createGain(), bufM = new Uint8Array(512), bufP = new Uint8Array(512);
      anM.fftSize = 512; anP.fftSize = 512; musicGain.connect(anM); padGain.connect(dest); padGain.connect(ctx.destination); padGain.connect(anP);
      var micSrc = ctx.createMediaStreamSource(stream), musicSrc = ctx.createMediaElementSource(d.el);
      an.fftSize = 512; var buf = new Uint8Array(an.fftSize);
      micSrc.connect(micGain); micGain.connect(dest); micSrc.connect(an);
      musicSrc.connect(musicGain); musicGain.connect(dest); musicGain.connect(ctx.destination);   /* you hear the music too, never your own voice */
      var m = { track: dest.stream.getAudioTracks()[0], muted: false, micVol: 100, musicVol: 80, duck: true, talking: false, musicMuted: false, padMuted: false, padVol: 100 };
      function apply() {
        micGain.gain.setTargetAtTime(m.muted ? 0 : m.micVol / 100, ctx.currentTime, 0.03);
        musicGain.gain.setTargetAtTime(m.musicMuted ? 0 : m.musicVol / 100 * (m.duck && m.talking && !m.muted ? 0.2 : 1), ctx.currentTime, 0.2);
        padGain.gain.setTargetAtTime(m.padMuted ? 0 : m.padVol / 100, ctx.currentTime, 0.03);
      }
      var timer = setInterval(function () {
        an.getByteTimeDomainData(buf);
        var peak = 0; for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
        var talking = peak > 14; if (talking !== m.talking) { m.talking = talking; apply(); }
      }, 90);
      m.addElement = function (el) {       /* sound of a video shown to the audience: heard by the audience and by you */
        try { var src = ctx.createMediaElementSource(el); src.connect(dest); src.connect(ctx.destination); } catch (e) { /* already connected */ }
      };
      function peakOf(node, b) { node.getByteTimeDomainData(b); var pk = 0; for (var i = 0; i < b.length; i++) pk = Math.max(pk, Math.abs(b[i] - 128)); return Math.min(1, pk / 128 * 1.4); }
      m.levels = function () { return { mic: m.muted ? 0 : peakOf(an, buf), music: peakOf(anM, bufM), pads: peakOf(anP, bufP) }; };
      m.addPad = function (el) { try { ctx.createMediaElementSource(el).connect(padGain); } catch (e) { /* ignore */ } };   /* a jingle pad: its own channel, plays over the music */
      m.addTrack = function (tr) { try { ctx.createMediaStreamSource(new MediaStream([tr])).connect(dest); } catch (e) { /* ignore */ } };   /* the guests' voices */
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
        if (mixer && window.SparkGreen) window.SparkGreen.feed(mixer);
        if (mixer) { var dk = deckFor(kind); mixer.musicMuted = !!dk.musMuted; mixer.padMuted = !!dk.padMuted; mixer.padVol = S.padVol == null ? 100 : S.padVol; mixer.micVol = S.micVol == null ? 100 : S.micVol; mixer.musicVol = S.musicVol == null ? 80 : S.musicVol; mixer.duck = S.duck !== false; mixer.set('muted', !!hooks.muted); }
        var steps = [mixer ? lp.publishTrack(new LK.LocalAudioTrack(mixer.track), { source: LK.Track.Source.Microphone }) : lp.setMicrophoneEnabled(true, mic)];
        if (typeOf(kind) === 'tv') {
          var r = RES[S.res] || RES['720'];
          steps.push(S.source === 'studio' && hooks.studio ? lp.publishTrack(new LK.LocalVideoTrack(hooks.studio.track()), { source: LK.Track.Source.Camera }) : S.source === 'screen' ? lp.setScreenShareEnabled(true) : lp.setCameraEnabled(true, { deviceId: S.cam || undefined, resolution: { width: r[0], height: r[1], frameRate: 30 } }));
        }
        return Promise.all(steps).then(function () {
          return sb.rpc('live_set', S.label ? { p_kind: kind, p_title: S.title || '', p_on: true, p_label: S.label } : { p_kind: kind, p_title: S.title || '', p_on: true });
        }).then(function (r) {
          if (r.error) throw r.error;
          onAir[kind] = { room: room, since: Date.now(), video: got.video, mixer: mixer,
            timer: setInterval(function () { sb.rpc('live_beat', { p_kind: kind }); }, 30000) };
          paintTabs();
        }).catch(function (e) { try { room.disconnect(); } catch (x) { /* ignore */ } if (mixer) mixer.stop(); throw e; });
      }).then(function () { return got; });
    });
  }
  window.addEventListener('beforeunload', function (e) { if (anyAir() || nlDirty) { e.preventDefault(); e.returnValue = ''; } });


  /* ---------------------------------------------------------------- jingle pads + channel strips (radio and TV) */
  var PAD_KEYS = ['q', 'w', 'e', 'r', 'a', 's', 'd', 'f'];
  function padsPanel(kind, S, save, stops) {
    var d = deckFor(kind), grid = h('div', { class: 'pads', role: 'group', 'aria-label': 'Jingle pads' }), urls = {}, playing = [];
    var mixer = function () { return onAir[kind] && onAir[kind].mixer; };
    var padVol = h('input', { type: 'range', min: 0, max: 150, value: S.padVol == null ? 100 : S.padVol, 'aria-label': 'Jingle pad volume', oninput: function () { S.padVol = padVol.value * 1; save(); setVol(); } });
    function setVol() { var m = mixer(); if (m) m.set('padVol', padVol.value * 1); playing.forEach(function (a) { try { a.volume = Math.min(1, padVol.value / 100); } catch (e) { /* ignore */ } }); }
    function padTracks() {
      var j = d.tracks.filter(function (t) { return t.kind === 'jingle'; }), rest = d.tracks.filter(function (t) { return t.kind !== 'jingle'; });
      return j.concat(rest).slice(0, 8);
    }
    function fire(t, btn) {
      var go = urls[t.id] ? Promise.resolve(urls[t.id]) : sb.storage.from('audio').createSignedUrl(t.path, 3600).then(function (r) { if (r.error) throw r.error; return (urls[t.id] = r.data.signedUrl); });
      return go.then(function (u) {
        var a = new Audio(); a.crossOrigin = 'anonymous'; a.src = u; a.volume = mixer() ? 1 : Math.min(1, padVol.value / 100);
        if (mixer()) mixer().addPad(a);
        playing.push(a); btn.classList.add('hit');
        a.addEventListener('ended', function () { playing = playing.filter(function (x) { return x !== a; }); btn.classList.remove('hit'); });
        return a.play();
      }).catch(function (e) { toast('Could not play "' + t.title + '": ' + errText(e), true); });
    }
    function draw() {
      var list = padTracks();
      if (!list.length) { grid.replaceChildren(h('div', { class: 'empty', text: 'Upload jingles in "Music & jingles" and they appear here as pads.' })); return; }
      grid.replaceChildren.apply(grid, list.map(function (t, i) {
        return h('button', { class: 'pad', type: 'button', 'data-pad': String(i), title: 'Key ' + PAD_KEYS[i].toUpperCase(), onclick: function (ev) { fire(t, ev.currentTarget); } },
          h('kbd', { text: PAD_KEYS[i].toUpperCase() }), h('span', { text: t.title }));
      }));
    }
    function key(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName)) return;
      var i = PAD_KEYS.indexOf(String(e.key).toLowerCase()); if (i < 0) return;
      var b = grid.querySelector('[data-pad="' + i + '"]'); if (b) { e.preventDefault(); b.click(); }
    }
    document.addEventListener('keydown', key);
    var prevTracks = d.padsUi; d.padsUi = draw;
    var stopAll = h('button', { class: 'btn', type: 'button', text: 'Stop pads', onclick: function () { playing.forEach(function (a) { try { a.pause(); } catch (e) { /* ignore */ } }); playing = []; grid.querySelectorAll('.hit').forEach(function (b) { b.classList.remove('hit'); }); } });
    /* channel strips: level meter and mute for each source */
    function strip(label, key, mute) {
      var fill = h('i'), vu = h('div', { class: 'meter', role: 'img', 'aria-label': label + ' level' }, fill);
      var btn = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', text: 'Mute', onclick: function () { mute(btn); } });
      return { el: h('div', { class: 'strip', 'data-strip': key }, h('b', { text: label }), vu, btn), fill: fill, btn: btn };
    }
    var sMic = strip('Mic', 'mic', function (b) { micMuted[kind] = !micMuted[kind]; if (mixer()) mixer().set('muted', micMuted[kind]); d.ui(); sync(); });
    var sMus = strip('Music', 'music', function () { d.musMuted = !d.musMuted; if (mixer()) mixer().set('musicMuted', d.musMuted); else d.el.muted = d.musMuted; sync(); });
    var sPad = strip('Pads', 'pads', function () { d.padMuted = !d.padMuted; if (mixer()) mixer().set('padMuted', d.padMuted); sync(); });
    function sync() {
      [[sMic, micMuted[kind]], [sMus, d.musMuted], [sPad, d.padMuted]].forEach(function (x) { x[0].btn.setAttribute('aria-pressed', x[1] ? 'true' : 'false'); x[0].btn.classList.toggle('danger', !!x[1]); x[0].btn.textContent = x[1] ? 'Muted' : 'Mute'; });
    }
    var vu = setInterval(function () {
      var m = mixer(), L = m && m.levels ? m.levels() : { mic: 0, music: 0, pads: 0 };
      sMic.fill.style.width = L.mic * 100 + '%'; sMus.fill.style.width = L.music * 100 + '%'; sPad.fill.style.width = L.pads * 100 + '%';
    }, 70);
    stops.push(function () { clearInterval(vu); document.removeEventListener('keydown', key); d.padsUi = prevTracks; playing.forEach(function (a) { try { a.pause(); } catch (e) { /* ignore */ } }); });
    d.ui = (function (old) { return function () { old(); sync(); }; })(d.ui);
    draw(); sync();
    return h('section', { class: 'panel wide board' }, h('h3', { text: 'Jingle pads and mixer' }),
      h('div', { class: 'strips' }, sMic.el, sMus.el, sPad.el),
      grid, h('div', { class: 'btnrow' }, stopAll, h('label', { class: 'inl' }, 'Pad volume ', padVol)),
      h('p', { class: 'hint', text: 'Keys Q W E R / A S D F fire the pads. Pads play on top of the music and are heard on air. Meters move while you are on air.' }));
  }

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
        renderTracks(); if (d.padsUi) d.padsUi();
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
  var STUDIO_SCENES = [['cam', 'Camera', '1'], ['media', 'Picture / video', '2'], ['pip', 'Picture + me', '3'], ['screen', 'Screen', '4'], ['screenpip', 'Screen + me', '5'], ['black', 'Black', '6'], ['slate', 'Starting soon', '7'], ['guest', 'Guest', '8'], ['guestme', 'Guest + me', '9'], ['grid', 'Guests grid', '0']];
  function makeCompositor(res) {
    var W = res[0], H = res[1];
    var cv = h('canvas', { class: 'livepreview program', width: W, height: H, 'aria-label': 'What the audience sees' });
    var g = cv.getContext('2d');
    function vid(muted) { var v = document.createElement('video'); v.playsInline = true; v.muted = muted; v.setAttribute('playsinline', ''); return v; }
    var cam = vid(true), scr = vid(true), med = vid(false), img = null;
    var C = { cv: cv, scene: 'cam', caption: '', capOn: false, media: null, loop: true, camStream: null, scrStream: null, timer: null, track: null, onScreenEnd: null,
      fade: true, bug: false, tick: '', tickOn: false, slateTitle: 'Starting soon', slateEnd: 0, fadeAt: 0 };
    var snap = document.createElement('canvas'); snap.width = W; snap.height = H;
    C.mediaEl = function () { return med; };
    C.resize = function (r) { W = r[0]; H = r[1]; cv.width = W; cv.height = H; if (C.stream) { C.stream.getTracks().forEach(function (t) { t.stop(); }); C.stream = null; } draw(); };
    function fit(src, sw, sh, x, y, w, h2, cover) {
      if (!sw || !sh) return;
      var k = cover ? Math.max(w / sw, h2 / sh) : Math.min(w / sw, h2 / sh), dw = sw * k, dh = sh * k;
      g.save(); g.beginPath(); g.rect(x, y, w, h2); g.clip(); g.drawImage(src, x + (w - dw) / 2, y + (h2 - dh) / 2, dw, dh); g.restore();
    }
    function roundRect(x, y, w, h2, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    /* change scene, with a short cross-fade when it is switched on */
    C.go = function (k) {
      if (k !== C.scene && C.fade) { snap.width = W; snap.height = H; snap.getContext('2d').drawImage(cv, 0, 0); C.fadeAt = Date.now(); }
      C.scene = k;
    };
    C.countdown = function (min) { C.slateEnd = min > 0 ? Date.now() + min * 60000 : 0; };
    function drawSlate() {
      var gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#110c4a'); gr.addColorStop(1, '#2a1c8f'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fe2c55'; g.fillRect(W / 2 - W * 0.04, H * 0.3, W * 0.08, 6);
      g.fillStyle = '#fff'; g.font = '800 ' + Math.round(H * 0.09) + 'px system-ui, Arial, sans-serif'; g.fillText(C.slateTitle || 'Starting soon', W / 2, H * 0.42, W * 0.86);
      if (C.slateEnd) {
        var left = Math.max(0, Math.ceil((C.slateEnd - Date.now()) / 1000)), m = Math.floor(left / 60), sec = left % 60;
        g.font = '700 ' + Math.round(H * 0.2) + 'px system-ui, Arial, sans-serif'; g.fillText((m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec, W / 2, H * 0.64);
      }
      g.textAlign = 'start';
    }
    function overlays() {
      if (C.bug) {
        var fs = Math.round(H * 0.04), d = new Date(), t = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
        g.font = '800 ' + fs + 'px system-ui, Arial, sans-serif'; g.textBaseline = 'middle';
        var bw = g.measureText('LIVE').width + fs * 0.9, cw = g.measureText(t).width + fs * 0.9, x = W - bw - cw - Math.round(W * 0.03), y = Math.round(H * 0.04), bh = Math.round(fs * 1.5);
        g.fillStyle = '#fe2c55'; g.fillRect(x, y, bw, bh); g.fillStyle = 'rgba(14,17,22,.88)'; g.fillRect(x + bw, y, cw, bh);
        g.fillStyle = '#fff'; g.fillText('LIVE', x + fs * 0.45, y + bh / 2); g.fillText(t, x + bw + fs * 0.45, y + bh / 2);
      }
      if (C.tickOn && C.tick) {
        var th = Math.round(H * 0.055), ty = H - th, f2 = Math.round(th * 0.58), gap = '      \u25cf      ';
        g.fillStyle = '#110c4a'; g.fillRect(0, ty, W, th); g.fillStyle = '#fe2c55'; g.fillRect(0, ty, 8, th);
        g.font = '700 ' + f2 + 'px system-ui, Arial, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
        var unit = C.tick + gap, uw = Math.max(1, g.measureText(unit).width), off = (Date.now() / 1000 * W * 0.07) % uw;
        g.save(); g.beginPath(); g.rect(12, ty, W - 12, th); g.clip();
        for (var x2 = -off + 20; x2 < W; x2 += uw) g.fillText(unit, x2, ty + th / 2);
        g.restore();
      }
      if (C.fadeAt) {
        var a = 1 - (Date.now() - C.fadeAt) / 450;
        if (a <= 0) C.fadeAt = 0; else { g.save(); g.globalAlpha = a; g.drawImage(snap, 0, 0, W, H); g.restore(); }
      }
    }
    function gName(t, x, y, w) {
      var fs = Math.round(H * 0.034), pad = Math.round(fs * 0.5); g.font = '700 ' + fs + 'px system-ui, Arial, sans-serif'; g.textBaseline = 'middle';
      var tw = Math.min(g.measureText(t).width, w * 0.8), bh = fs + pad;
      g.fillStyle = 'rgba(14,17,22,.82)'; g.fillRect(x, y - bh, tw + pad * 2 + 6, bh); g.fillStyle = '#fe2c55'; g.fillRect(x, y - bh, 6, bh); g.fillStyle = '#fff'; g.fillText(t, x + pad + 6, y - bh / 2, w * 0.8);
    }
    function drawGuests(sc, camOk) {
      var all = C.guests || [], sel = (C.guestSel || []).map(function (id) { return all.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean);
      if (!sel.length) sel = all.slice(0, 1);
      function tile(gu, x, y, w, h2) { if (gu.v.videoWidth) fit(gu.v, gu.v.videoWidth, gu.v.videoHeight, x, y, w, h2, !gu.screen); gName(gu.name, x + 10, y + h2 - 10, w); }
      if (!sel.length) { g.fillStyle = '#fff'; g.font = '700 ' + Math.round(H * 0.04) + 'px system-ui, Arial, sans-serif'; g.textAlign = 'center'; g.fillText('Waiting for a guest\u2026', W / 2, H / 2); g.textAlign = 'start'; return; }
      if (sc === 'guest') tile(sel[0], 0, 0, W, H);
      else if (sc === 'guestme') {
        var half = Math.round(W / 2);
        if (camOk) fit(cam, cam.videoWidth, cam.videoHeight, 0, 0, half, H, true);
        tile(sel[0], half, 0, W - half, H); g.fillStyle = '#fe2c55'; g.fillRect(half - 3, 0, 6, H);
      } else {
        var n = Math.min(4, sel.length), cols = n === 1 ? 1 : 2, rows = Math.ceil(n / cols), tw2 = Math.floor(W / cols), th2 = Math.floor(H / rows);
        for (var i = 0; i < n; i++) tile(sel[i], (i % cols) * tw2, Math.floor(i / cols) * th2, tw2, th2);
        g.fillStyle = '#110c4a'; if (cols > 1) g.fillRect(tw2 - 2, 0, 4, H); if (rows > 1) g.fillRect(0, th2 - 2, W, 4);
      }
    }
    function draw() { drawScene(); overlays(); }
    function drawScene() {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      var sc = C.scene, camOk = cam.videoWidth > 0;
      var mediaSrc = img && C.media && C.media.kind === 'image' ? img : (C.media && C.media.kind === 'video' ? med : null);
      var mw = mediaSrc === img && img ? img.naturalWidth : med.videoWidth, mh = mediaSrc === img && img ? img.naturalHeight : med.videoHeight;
      if (sc === 'guest' || sc === 'guestme' || sc === 'grid') drawGuests(sc, camOk);
      else if (sc === 'slate') drawSlate();
      else if (sc === 'cam' && camOk) fit(cam, cam.videoWidth, cam.videoHeight, 0, 0, W, H, true);
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

  /* a YouTube video on air: visitors get YouTube's official player (with sound) over the picture; your microphone keeps playing */
  function ytPanel(kind, stops) {
    var url = h('input', { type: 'url', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube link' });
    var msg = h('p', { class: 'hint' }), box = h('div', { class: 'ytprev' }), playing = '';
    function idOf(u) {
      u = String(u || '').trim();
      var m = u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/) || u.match(/^([A-Za-z0-9_-]{11})$/);
      return m ? m[1] : '';
    }
    function say(t, cls) { msg.className = 'hint' + (cls ? ' ' + cls : ''); msg.textContent = t; }
    function missing(e) { return /live_youtube|function|schema cache/i.test(errText(e)) && !/not on air|not a YouTube/i.test(errText(e)) ? 'Run supabase/live-youtube.sql in Supabase first (see the README).' : errText(e); }
    function preview(id) {
      box.replaceChildren();
      if (!id) return;
      box.appendChild(h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1', title: 'YouTube video playing on air', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true' }));
    }
    function start() {
      var id = idOf(url.value);
      if (!onAir[kind]) { say('Go on air first (press Start in the Broadcast panel), then play the video.', 'err'); return; }
      if (!id) { say('That does not look like a YouTube link.', 'err'); return; }
      sb.rpc('live_youtube', { p_kind: kind, p_id: id }).then(function (r) {
        if (r.error) throw r.error;
        playing = id; preview(id); say('Playing for your viewers now. They hear it together with your microphone. Use headphones so it does not echo.', 'ok');
      }).catch(function (e) { say(missing(e), 'err'); });
    }
    function stop() {
      sb.rpc('live_youtube', { p_kind: kind, p_id: '' }).then(function (r) {
        if (r.error) throw r.error;
        playing = ''; preview(''); say('Video stopped. Viewers see the broadcast again.', 'ok');
      }).catch(function (e) { say(missing(e), 'err'); });
    }
    stops.push(function () { box.replaceChildren(); });
    return h('section', { class: 'panel' }, h('h3', { text: 'YouTube on air' }),
      h('p', { class: 'hint', text: 'Viewers see the video with sound, shown with YouTube\u2019s official player. Start the broadcast first.' }),
      h('div', { class: 'uprow' }, url, h('button', { class: 'btn primary', type: 'button', text: 'Play for viewers', onclick: start }), h('button', { class: 'btn', type: 'button', text: 'Stop video', onclick: stop })),
      msg, box);
  }

  /* one studio window per channel: radio and TV have their own settings (saved in this browser) */
  function showDash(type, kind) {
    var isTv = typeOf(kind) === 'tv', S = loadSet(kind), stops = [];
    var save = function () { saveSet(kind, S); };
    var parts = (cfg.site && cfg.site.partners) || [];
    var partnerSel = parts.length ? h('select', { onchange: function () { S.label = partnerSel.value; save(); } }, h('option', { value: '', text: 'Everywhere: main website and every partner embed' }), parts.map(function (p) { return h('option', { value: p.slug, text: 'Belongs to ' + p.name + ' (others see a link to it)' }); })) : null;
    if (partnerSel) partnerSel.value = S.label || '';
    var title = h('input', { type: 'text', value: S.title || '', placeholder: isTv ? 'e.g. Evening news' : 'e.g. Morning bulletin', maxlength: '120', oninput: function () { S.title = title.value; save(); } });
    var mic = h('select', { onchange: function () { S.mic = mic.value; save(); } }, h('option', { value: '', text: 'Default microphone' }));
    var cam = isTv ? h('select', { onchange: function () { S.cam = cam.value; save(); } }, h('option', { value: '', text: 'Default camera' })) : null;
    var source = isTv ? h('select', { onchange: function () { S.source = source.value; save(); sync(); } }, h('option', { value: 'camera', text: 'Camera and microphone' }), h('option', { value: 'screen', text: 'Screen share and microphone' }), h('option', { value: 'studio', text: 'Studio: camera, pictures, videos and screen' })) : null;
    if (source) { if (!S.source) S.source = 'studio'; source.value = S.source; }   /* the studio (scenes, slate, ticker) is the first thing a TV presenter sees */
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
      if (isTv && anyAir('tv')) { toast('Another TV channel is on air from this browser. Stop it first (one camera feed per browser).', true); go.disabled = false; return; }
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
      window.__tvComp = tvComp;     /* lets tests drive the studio picture */
      var comp = tvComp, sceneBtns = {}, camMsg = h('p', { class: 'hint' });
      comp.ensureLoop();
      function setScene(k) {
        if ((k === 'guest' || k === 'guestme' || k === 'grid') && !(comp.guests || []).length) { toast('Open the guest room below and wait for a guest to join first', true); return; }
        var need = k.indexOf('screen') === 0 && !comp.scrStream ? comp.useScreen() : Promise.resolve();
        need.then(function () {
          if ((k === 'media' || k === 'pip') && !comp.media) { toast('Pick a picture or video below first', true); return; }
          comp.go(k); paintScenes();
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
      function toggle(label, key, hotkey) {
        var b = h('button', { class: 'btn', type: 'button', 'aria-pressed': comp[key] ? 'true' : 'false', title: 'Key ' + hotkey, text: label, onclick: function () { comp[key] = !comp[key]; b.setAttribute('aria-pressed', comp[key] ? 'true' : 'false'); b.classList.toggle('primary', comp[key]); } });
        b.classList.toggle('primary', !!comp[key]); b.dataset.toggle = key; return b;
      }
      var tickIn = h('input', { type: 'text', maxlength: '300', placeholder: 'Scrolling ticker text along the bottom', 'aria-label': 'Ticker text', value: comp.tick, oninput: function () { comp.tick = tickIn.value; } });
      var slateIn = h('input', { type: 'text', maxlength: '60', placeholder: 'Starting soon slate title', 'aria-label': 'Slate title', value: comp.slateTitle, oninput: function () { comp.slateTitle = slateIn.value; } });
      var minIn = h('input', { type: 'number', min: '0', max: '120', value: '5', 'aria-label': 'Countdown minutes', style: 'width:70px' });
      var more = h('div', { class: 'tvmore' },
        h('div', { class: 'btnrow' }, toggle('Cross-fade scenes', 'fade', 'F'), toggle('LIVE bug + clock', 'bug', 'L'), toggle('Ticker', 'tickOn', 'T')),
        h('div', { class: 'uprow' }, tickIn),
        h('div', { class: 'uprow' }, slateIn, minIn, h('span', { text: 'min' }),
          h('button', { class: 'btn', type: 'button', text: 'Start countdown', onclick: function () { comp.countdown(parseInt(minIn.value, 10) || 0); setScene('slate'); } }),
          h('button', { class: 'btn', type: 'button', text: 'No countdown', onclick: function () { comp.countdown(0); } })));
      var camBtn = h('button', { class: 'btn', type: 'button', text: comp.camStream ? 'Camera is on' : 'Turn on camera preview', onclick: function () {
        comp.start(S.cam).then(function () { camBtn.textContent = 'Camera is on'; camMsg.textContent = ''; fillDevices(); }).catch(function (e) { camMsg.className = 'hint err'; camMsg.textContent = 'Could not open the camera: ' + errText(e); });
      } });
      if (res) res.addEventListener('change', function () { if (!anyAir('tv')) comp.resize(RES[res.value] || RES['720']); });
      function key(e) {
        if (S.source !== 'studio' || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName)) return;
        var tg = { f: 'fade', l: 'bug', t: 'tickOn' }[String(e.key).toLowerCase()];
        if (tg) { e.preventDefault(); var tb = box.querySelector('[data-toggle=' + tg + ']'); if (tb) tb.click(); return; }
        var sc = STUDIO_SCENES.filter(function (x) { return x[2] === e.key; })[0]; if (sc) { e.preventDefault(); setScene(sc[0]); }
      }
      document.addEventListener('keydown', key); stops.push(function () { document.removeEventListener('keydown', key); if (!anyAir('tv')) comp.stop(); });
      paintScenes();
      var box = h('section', { class: 'panel wide studio' }, h('h3', { text: 'Studio: what the audience sees' }),
        h('div', { class: 'studiogrid' },
          h('div', {}, comp.cv, bar, h('p', { class: 'hint', text: 'Keys 1 to 7 switch scenes; F fade, L live bug, T ticker. The picture above is exactly what is broadcast.' }), more,
            h('div', { class: 'uprow' }, cap, capBtn), h('div', { class: 'btnrow' }, camBtn), camMsg),
          h('div', {}, h('h3', { text: 'Pictures and videos' }), mediaPanel(comp, stops, setScene))));
      var gHost = h('div', { class: 'guesthost' });
      Promise.all([loadScript('../assets/vendor/qrcode.js'), loadScript('../assets/greenroom.js?v=' + ((cfg.ver || {}).green || ''))]).then(function () {
        gHost.replaceChildren(window.SparkGreen.mount({ h: h, sb: sb, comp: comp, kind: kind, toast: toast, errText: errText, site: cfg.site || {}, loadScript: loadScript, loadLiveKit: loadLiveKit, token: liveToken, micId: function () { return S.mic; }, getMixer: function () { return onAir[kind] && onAir[kind].mixer; }, showGuest: function (scene, id) { comp.guestSel = [id].concat(comp.guestSel.filter(function (x) { return x !== id; })); setScene(scene); } }).el);
      }).catch(function () { gHost.replaceChildren(h('p', { class: 'hint err', text: 'The guest tools could not load. Reload the page.' })); });
      return h('div', {}, box, gHost);
    }

    /* come back to a running broadcast after visiting another window */
    if (onAir[kind] && onAir[kind].video && preview) onAir[kind].video.attach(preview);
    fillDevices(); sync(); paint();
    dashCleanup = function () { stops.forEach(function (f) { f(); }); };

    var mine = channels.filter(function (c) { return c.type === type; });
    var chanSel = h('select', { 'aria-label': 'Channel', onchange: function () { try { localStorage.setItem('spark-chan-' + type, chanSel.value); } catch (e) {} location.hash = '#/' + type + '/' + chanSel.value; } },
      mine.map(function (c) { return h('option', { value: c.slug, text: c.name + (c.topic ? ' (' + c.topic + ')' : '') + (onAir[c.slug] ? '  ● ON AIR' : '') }); }));
    chanSel.value = kind;
    var chanBar = h('div', { class: 'chanbar' }, h('label', { text: 'Channel' }), chanSel,
      me.role === 'admin' ? h('a', { class: 'btn', href: '#/schedule', text: 'Add or edit channels' }) : null,
      h('a', { class: 'btn', href: '#/schedule/' + kind, text: 'Open this channel’s schedule' }));
    return h('div', { class: 'dash' },
      h('div', { class: 'dashhead' }, h('h2', { text: isTv ? 'TV studio' : 'Radio studio' }), badge, timer),
      chanBar,
      h('div', { class: 'dashgrid' },
        h('section', { class: 'panel' }, h('h3', { text: 'Broadcast' }),
          field('Title shown to visitors', title), partnerSel ? field('Where it plays', partnerSel, 'Visitors outside that partner see \u201cLive now on \u2026\u201d with a link instead of the player.') : null, source ? field('Source', source) : null,
          preview, h('div', { class: 'metrow' }, h('span', { text: 'Mic level' }), meter), status, h('div', { class: 'btnrow' }, go, test)),
        h('section', { class: 'panel' }, h('h3', { text: 'Settings (saved in this browser)' }),
          field('Microphone', mic), camField, res ? field('Video quality', res) : null,
          opt('echo', 'Echo cancellation'), opt('noise', 'Noise suppression'), opt('agc', 'Automatic volume levelling'),
          h('p', { class: 'hint', text: 'Use headphones when you test so the radio does not echo into your microphone.' })),
        studio, isTv ? ytPanel(kind, stops) : null, musicPanel(kind, S, save, stops), padsPanel(kind, S, save, stops)));
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

  /* partners: white-label copies of the whole site, plus the label that sends stories and broadcasts to them */
  function partnersPanel(V) {
    V.partners = V.partners || [];
    var list = h('div', { class: 'partners' }), PP = {};
    sb.rpc('partner_password_status').then(function (r) { (r.data || []).forEach(function (x) { PP[x] = true; }); draw(); }, function () {});
    var base = (V.base_url || '').replace(/\/+$/, '');
    function draw() {
      list.replaceChildren.apply(list, V.partners.map(function (p, i) {
        var embed = (base || 'https://YOUR-SITE') + '/p/' + (p.slug || 'label') + '/index.html';
        var snippet = '<iframe src="' + embed + '" width="100%" height="900" style="border:0" loading="lazy" allow="autoplay; fullscreen" title="' + (p.name || '').replace(/"/g, '') + '"></iframe>';
        var copy = h('button', { class: 'btn', type: 'button', text: 'Copy embed code', onclick: function () { (navigator.clipboard ? navigator.clipboard.writeText(snippet) : Promise.reject()).then(function () { toast('Embed code copied'); }, function () { window.prompt('Copy this embed code', snippet); }); } });
        var nm = h('input', { type: 'text', maxlength: '80', value: p.name || '', 'aria-label': 'Website name', oninput: function () { p.name = nm.value; } });
        var sl = h('input', { type: 'text', maxlength: '40', value: p.slug || '', 'aria-label': 'Label', oninput: function () { p.slug = sl.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'); } });
        var ur = h('input', { type: 'url', maxlength: '300', value: p.url || '', placeholder: 'empty = hosted here, or https://partner.com/news/{slug}', 'aria-label': 'Partner website address', oninput: function () { p.url = ur.value.trim(); } });
        var mn = h('select', { 'aria-label': 'On the main site' }, h('option', { value: 'redirect', text: 'Send visitors to the partner (their copy or website)' }), h('option', { value: 'hide', text: 'Show only in the partner embed (hide everywhere else)' }));
        mn.value = p.main === 'hide' ? 'hide' : 'redirect'; mn.addEventListener('change', function () { p.main = mn.value; });
        var lg = h('input', { type: 'url', maxlength: '400', value: p.logo || '', placeholder: 'https://\u2026/logo.png', 'aria-label': 'Logo address', oninput: function () { p.logo = lg.value.trim(); preview(); } });
        var pv = h('img', { class: 'plogo-prev', alt: '', style: 'max-height:44px;max-width:180px;display:none' });
        function preview() { if (lg.value) { pv.src = lg.value; pv.style.display = ''; } else pv.style.display = 'none'; }
        var file = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: function () {
          var f = file.files && file.files[0]; if (!f) return;
          upload(f).then(function (u) { p.logo = u; lg.value = u; preview(); toast('Logo uploaded. Save settings to keep it.'); }, function (e) { toast(errText(e), true); });
        } });
        preview();
        var pr = h('select', { 'aria-label': 'Who can open this copy' }, h('option', { value: '', text: 'Anyone with the link (hidden from Google)' }), h('option', { value: 'password', text: 'Password protected (encrypted)' }));
        pr.value = p.protect === 'password' ? 'password' : ''; pr.addEventListener('change', function () { p.protect = pr.value; draw(); });
        var pwIn = h('input', { type: 'password', autocomplete: 'new-password', maxlength: '100', placeholder: PP[p.slug] ? 'A password is set. Type a new one to change it.' : 'Choose a long password (10+ characters)', 'aria-label': 'Password for ' + (p.name || p.slug) });
        var pwMsg = h('p', { class: 'hint ' + (PP[p.slug] ? 'ok' : ''), text: PP[p.slug] ? 'A password is set (it cannot be shown again).' : 'No password yet: this copy is not published until you set one.' });
        function pwDo(v) {
          if (!p.slug) { pwMsg.className = 'hint err'; pwMsg.textContent = 'Give this partner a label first.'; return; }
          if (v && v.length < 10) { pwMsg.className = 'hint err'; pwMsg.textContent = 'Use at least 10 characters.'; return; }
          sb.rpc('partner_password_set', { p_slug: p.slug, p_password: v }).then(function (r) {
            if (r.error) { pwMsg.className = 'hint err'; pwMsg.textContent = /does not exist|schema cache|function/i.test(r.error.message || '') ? 'Not set up yet: run supabase/settings.sql in the Supabase SQL Editor, then reload.' : errText(r.error); return; }
            PP[p.slug] = !!v; pwIn.value = ''; pwIn.placeholder = v ? 'A password is set. Type a new one to change it.' : 'Choose a long password (10+ characters)';
            pwMsg.className = 'hint ok'; pwMsg.textContent = v ? 'Password saved. Press "Update website" for it to take effect.' : 'Password removed.';
          });
        }
        var prHint = p.protect === 'password' ? h('div', {},
          field('Password for this copy', pwIn, 'Saved where only the website build can read it, never shown again. Anyone you give it to can open the copy.'),
          h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Save password', onclick: function () { pwDo(pwIn.value); } }), PP[p.slug] ? h('button', { class: 'btn danger', type: 'button', text: 'Remove password', onclick: function () { pwDo(''); } }) : null),
          pwMsg,
          h('p', { class: 'hint', html: 'One-time setup so the website build can read it: in GitHub add the Actions secret <code>SUPABASE_SERVICE_KEY</code> (Supabase \u2192 Project Settings \u2192 API Keys \u2192 <b>service_role</b> key). Until it is there, this copy is not published and its stories stay hidden on the public site.' })) : null;
        var ac = h('input', { type: 'text', maxlength: '7', value: p.accent || '', placeholder: '#1a73e8', 'aria-label': 'Accent colour', oninput: function () { p.accent = ac.value.trim(); } });
        return h('div', { class: 'partner', 'data-i': String(i) },
          h('div', { class: 'row2' }, field('Website name in the embed', nm), field('Label (letters, numbers, dashes)', sl)),
          field('Partner\u2019s own website address (optional)', ur, 'Leave empty if the partner lives on this website: stories then go to their copy at the embed link below. Otherwise use {slug} for the story name.'),
          h('div', { class: 'row2' }, field('Labelled stories and broadcasts', mn), field('Accent colour (optional)', ac)),
          field('Logo (replaces the name in the header; transparent PNG or SVG works best)', h('div', { class: 'uprow' }, lg, h('button', { class: 'btn', type: 'button', text: 'Upload logo', onclick: function () { file.click(); } }), file, pv)),
          field('Access', pr, 'Every school copy is already kept out of Google. A password goes further: the pages are encrypted, so nobody can read them without it.'), prHint,
          h('p', { class: 'hint', text: 'Embed link: ' + embed }),
          h('div', { class: 'btnrow' }, copy, h('button', { class: 'btn danger', type: 'button', text: 'Remove', onclick: function () { V.partners.splice(i, 1); draw(); } })));
      }));
    }
    draw();
    return h('section', { class: 'panel' }, h('h3', { text: 'Partners and embeds' }),
      h('p', { class: 'hint', text: 'Each partner gets a full copy of this website (articles, Live, polls, newsletter, search) under its own name that they can embed in an iframe. Put the partner\u2019s label on a story or a broadcast to send it to them. Save settings, then wait for the website to update.' }),
      list, h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Add partner', onclick: function () { V.partners.push({ name: '', slug: '', url: '', main: 'redirect', accent: '', logo: '', protect: '' }); draw(); } })));
  }

  function showSettings() {
    var box = h('div', { class: 'dash settings' }, h('div', { class: 'empty', text: 'Loading settings…' }));
    Promise.all([sb.from('site_settings').select('data').eq('id', 1).maybeSingle(), sb.rpc('secret_status')]).then(function (res) {
      if (res[0].error) {
        return box.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission/i.test(res[0].error.message || '') ? 'Settings are not set up yet. Run supabase/settings.sql in the Supabase SQL Editor (see the README), then reload.' : errText(res[0].error) }));
      }
      var V = deepMerge(cfg.site || {}, (res[0].data && res[0].data.data) || {});
      V.ticker = V.ticker || {}; V.ticker.tab = V.ticker.tab || {}; V.live = V.live || {}; V.newsletter = V.newsletter || {}; V.seo = V.seo || {}; V.partners = V.partners || []; V.privacy = V.privacy || {}; V.polls = V.polls || {}; V.editorial = V.editorial || {}; V.announcements = V.announcements || []; V.maintenance = V.maintenance || {}; V.security = V.security || {};
      var st = {}; (res[1].data || []).forEach(function (x) { st[x.key] = x; });
      var mark = function () { dirty = true; dirtyEl.textContent = 'Unsaved changes'; };
      var dirtyEl = h('span', { class: 'dirty' });
      function bind(obj, key, type, extra) {
        var i = h('input', { type: type || 'text', value: obj[key] == null ? '' : obj[key], oninput: function () { obj[key] = type === 'number' ? (i.value === '' ? '' : i.value * 1) : i.value; mark(); } });
        Object.keys(extra || {}).forEach(function (k) { i.setAttribute(k, extra[k]); });
        return i;
      }
      function tick(obj, key, label) { var c = check(label, !!obj[key], function () { obj[key] = c.input.checked; mark(); }); return c.box; }

      function toLocalDT(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return ''; var z = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()); }
      function fromLocalDT(v) { if (!v) return ''; var d = new Date(v); return isNaN(d) ? '' : d.toISOString(); }
      function annPanel() {
        var list = h('div', { class: 'annlist' }), box = h('section', { class: 'panel annpanel' }, h('h3', { text: 'Announcements' }),
          h('p', { class: 'hint', text: 'A short notice for every visitor: a coloured bar above the header or a pop-up. Set when it starts and ends and it appears and disappears by itself (after "Update website").' }), list);
        function draw() {
          list.replaceChildren.apply(list, V.announcements.map(function (a, i) {
            var text = h('input', { type: 'text', maxlength: '300', value: a.text || '', placeholder: 'e.g. School is closed on Monday', oninput: function () { a.text = text.value; mark(); } });
            var style = h('select', { onchange: function () { a.style = style.value; mark(); } }, [['info', 'Information (blue)'], ['good', 'Good news (green)'], ['warn', 'Warning (yellow)'], ['urgent', 'Urgent (red)']].map(function (o) { return h('option', { value: o[0], text: o[1] }); })); style.value = a.style || 'info';
            var mode = h('select', { onchange: function () { a.mode = mode.value; mark(); } }, [['bar', 'Bar above the header'], ['popup', 'Pop-up window']].map(function (o) { return h('option', { value: o[0], text: o[1] }); })); mode.value = a.mode || 'bar';
            var where = h('select', { onchange: function () { a.where = where.value; mark(); } }, [['all', 'On every page'], ['home', 'Only on the home page']].map(function (o) { return h('option', { value: o[0], text: o[1] }); })); where.value = a.where || 'all';
            var link = h('input', { type: 'text', maxlength: '300', value: a.link || '', placeholder: 'https://… or a/some-article.html (optional)', oninput: function () { a.link = link.value; mark(); } });
            var label = h('input', { type: 'text', maxlength: '40', value: a.link_label || '', placeholder: 'Read more', oninput: function () { a.link_label = label.value; mark(); } });
            var st = h('input', { type: 'datetime-local', value: toLocalDT(a.start), onchange: function () { a.start = fromLocalDT(st.value); mark(); } });
            var en = h('input', { type: 'datetime-local', value: toLocalDT(a.end), onchange: function () { a.end = fromLocalDT(en.value); mark(); } });
            var on = check('Switched on', a.enabled !== false, function () { a.enabled = on.input.checked; mark(); });
            var dis = check('Visitors can close it', a.dismissible !== false, function () { a.dismissible = dis.input.checked; mark(); });
            return h('div', { class: 'annitem' }, field('Message', text),
              h('div', { class: 'row2' }, field('Look', style), field('Shown as', mode)), field('Where', where),
              h('div', { class: 'row2' }, field('Link (optional)', link), field('Link text', label)),
              h('div', { class: 'row2' }, field('Starts (empty = right away)', st), field('Ends (empty = until you remove it)', en)),
              on.box, dis.box, h('div', { class: 'btnrow' }, h('button', { class: 'btn danger', type: 'button', text: 'Delete announcement', onclick: function () { V.announcements.splice(i, 1); mark(); draw(); } })));
          }));
          if (!V.announcements.length) list.appendChild(h('p', { class: 'hint', text: 'No announcements yet.' }));
        }
        draw();
        box.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'New announcement', onclick: function () {
          V.announcements.push({ id: Math.random().toString(36).slice(2, 10), text: '', style: 'info', mode: 'bar', where: 'all', enabled: true, dismissible: true }); mark(); draw(); } })));
        return box;
      }
      function pbkdf(pw, saltHex, iter) {
        var salt = new Uint8Array((saltHex.match(/../g) || []).map(function (x) { return parseInt(x, 16); }));
        return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']).then(function (k) {
          return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, k, 256);
        }).then(function (b) { return [].map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); });
      }
      function lookPanel() {
        var ul = h('select', { onchange: function () { V.ui_language = ul.value; mark(); } }, [['auto', 'Automatic: the visitor\u2019s browser language'], ['en', 'English'], ['ar', '\u0627\u0644\u0639\u0631\u0628\u064a\u0629 (Arabic, right to left)'], ['zh', '\u4e2d\u6587 (Chinese)'], ['fr', 'Fran\u00e7ais (French)'], ['ru', '\u0420\u0443\u0441\u0441\u043a\u0438\u0439 (Russian)'], ['es', 'Espa\u00f1ol (Spanish)'], ['de', 'Deutsch (German)'], ['off', 'Off: no interface translation']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
        ul.value = V.ui_language || 'auto';
        var th = h('select', { onchange: function () { V.theme = th.value; mark(); } }, [['auto', 'Match the visitor\u2019s device'], ['light', 'Light'], ['dark', 'Dark'], ['sepia', 'Sepia (warm paper)'], ['midnight', 'Midnight (pure black)'], ['contrast', 'High contrast'], ['forest', 'Forest']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
        th.value = V.theme || 'auto';
        return h('section', { class: 'panel' }, h('h3', { text: 'Language and look' }),
          field('Language of buttons and labels', ul, 'The six UN languages plus German. Visitors can change it in the footer and on the Settings page. Articles are not affected: use the translation box in each article for those.'),
          field('Look for new visitors', th, 'Visitors can still pick their own on the Settings page.'),
          h('h4', { text: 'Read-aloud button' }),
          (function () {
            var L = V.listen = V.listen || {}; if (L.enabled === undefined) L.enabled = true; if (!L.position) L.position = 'left';
            var on = check('Offer read aloud on articles', L.enabled, function () { L.enabled = on.input.checked; mark(); });
            var pos = h('select', { onchange: function () { L.position = pos.value; mark(); } }, [['left', 'Bottom left'], ['right', 'Bottom right']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
            pos.value = L.position;
            return h('div', {}, on.box, field('Where it sits', pos, 'Visitors can hide it for themselves, and turn it back on in their Settings.'));
          })());
      }
      function securityPanel() {
        var G = V.security = V.security || {}; if (!G.geo_mode) G.geo_mode = 'off'; if (!G.geo_countries) G.geo_countries = [];
        var mode = h('select', { onchange: function () { G.geo_mode = mode.value; mark(); } }, [['off', 'Open to every country'], ['only', 'Only these countries'], ['except', 'Every country except these']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
        mode.value = G.geo_mode;
        var list = h('input', { type: 'text', placeholder: 'Two-letter codes, e.g. AT, DE, CH', oninput: function () { G.geo_countries = list.value.split(/[\s,;]+/).map(function (x) { return x.toUpperCase(); }).filter(function (x) { return /^[A-Z]{2}$/.test(x); }); mark(); } });
        list.value = (G.geo_countries || []).join(', ');
        return h('section', { class: 'panel' }, h('h3', { text: 'Security: country' }),
          field('Who may open the website', mode), field('Countries', list, 'ISO codes: AT Austria, DE Germany, CH Switzerland, US United States, GB United Kingdom \u2026'),
          h('p', { class: 'hint', text: 'Honest limits: this website is a set of public files, so the check runs in the visitor\u2019s browser using a free country lookup (api.country.is, which sees the visitor\u2019s IP address). It keeps out ordinary visitors but a VPN or someone who reads the files gets round it, and search engines and link previews are always let through. If the lookup fails, the visitor is let in. For a hard lock put the site behind Cloudflare (free) and use its country rules. School copies can be locked with a password instead (see Partners).' }));
      }
      function maintPanel() {
        var M = V.maintenance; if (M.title === undefined) M.title = ''; 
        var pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: M.hash ? 'A password is set. Type a new one to change it.' : 'Choose a long password', 'aria-label': 'Bypass password' });
        var pwMsg = h('p', { class: 'hint', text: M.hash ? 'A bypass password is set.' : 'No bypass password yet. Without one nobody can get past the maintenance page (you can still use the editor).' });
        pw.addEventListener('change', function () {
          var v = pw.value; if (!v) return;
          if (v.length < 8) { pwMsg.className = 'hint err'; pwMsg.textContent = 'Please use at least 8 characters.'; return; }
          var u = new Uint8Array(16); crypto.getRandomValues(u); var salt = [].map.call(u, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
          pbkdf(v, salt, 150000).then(function (hex) { M.salt = salt; M.hash = hex; M.iter = 150000; pw.value = ''; pw.placeholder = 'A password is set. Type a new one to change it.'; pwMsg.className = 'hint ok'; pwMsg.textContent = 'Password ready. Press "Save settings", then "Update website".'; mark(); });
        });
        return h('section', { class: 'panel' }, h('h3', { text: 'Maintenance mode' }),
          tick(M, 'enabled', 'Turn maintenance mode on (visitors see a "be right back" page instead of the website)'),
          field('Title', bind(M, 'title', 'text', { maxlength: 100, placeholder: 'We will be right back' })),
          field('Message', bind(M, 'message', 'text', { maxlength: 400, placeholder: 'We are making improvements. Please check back soon.' })),
          field('Back at (optional)', bind(M, 'eta', 'text', { maxlength: 80, placeholder: 'e.g. Tomorrow at 9:00' })),
          field('Bypass password for your team', pw, 'On the maintenance page there is a "Team access" box. Enter this password and you see the normal website on that device.'), pwMsg,
          h('p', { class: 'hint', text: 'It takes effect after "Save settings" and "Update website". The editor stays open. This hides the site from visitors, it is not a security lock: the pages are still public files.' }));
      }
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
          if (V.editorial) editorial = { min_words: Math.max(0, parseInt(V.editorial.min_words, 10) || 0), admin_override: V.editorial.admin_override !== false };
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

          h('section', { class: 'panel' }, h('h3', { text: 'Articles' }),
            field('Minimum words to publish', bind(V.editorial, 'min_words', 'number', { min: 0, max: 5000, step: 10 }), '0 = no minimum. Writers see a live word count; articles below the minimum can be saved as drafts but not published.'),
            tick(V.editorial, 'admin_override', 'Admins may publish a shorter article anyway (they get a confirmation)'),
            tick(V.editorial, 'show_wordcount', 'Show the word count next to "min read" on published articles')),
          lookPanel(), securityPanel(),
          annPanel(), maintPanel(),
          h('section', { class: 'panel' }, h('h3', { text: 'Tickers' }),
            tick(V.ticker, 'enabled', 'Show the headline bar under the menu'),
            h('div', { class: 'row2' }, field('Tag text', bind(V.ticker, 'label', 'text', { maxlength: 30 })), field('Headlines shown', bind(V.ticker, 'count', 'number', { min: 1, max: 30 }))),
            field('Speed (pixels per second)', bind(V.ticker, 'speed', 'number', { min: 10, max: 300 })),
            field('Own headlines instead of the newest articles', custom),
            tick(V.ticker.tab, 'enabled', 'Browser tab title becomes a ticker when a visitor leaves the page'),
            h('div', { class: 'row2' }, field('Tab ticker style', mode), field('Symbol before headlines', bind(V.ticker.tab, 'prefix', 'text', { maxlength: 10 })))),
          h('section', { class: 'panel' }, h('h3', { text: 'Live radio and TV' }),
            tick(V.live, 'enabled', 'Show the Live page and menu link'),
            tick(V.live, 'banner', 'Show a red "We are live" banner at the top of every page while radio or TV is on air'),
            h('p', { class: 'hint', text: 'Connection to LiveKit (the service that carries the broadcast).' }),
            lk.map(function (k) { return k.field; }), lkMsg,
            h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Save LiveKit details', onclick: function () { saveKeys(lk, lkMsg, 'LiveKit details'); } }), testBtn)),
          partnersPanel(V),
          h('section', { class: 'panel' }, h('h3', { text: 'Search engines (SEO)' }),
            tick(V.seo, 'indexing', 'Let search engines list the website (turn off to hide the whole site)'),
            field('Page title ending', bind(V.seo, 'title_suffix', 'text', { maxlength: 60, placeholder: ' | SparkNews  (empty = site name)' })),
            field('Default share picture (https address)', bind(V.seo, 'default_image', 'text', { maxlength: 300, placeholder: 'https://…/share.png' })),
            tick(V.seo, 'news_sitemap', 'Write a Google News sitemap (articles of the last 2 days)'),
            field('Default search description', bind(V.seo, 'default_description', 'text', { maxlength: 200, placeholder: 'Used when a page has no summary' })),
            field('Site keywords', bind(V.seo, 'keywords', 'text', { maxlength: 600, placeholder: 'student journalism, Vienna, international school news' }),
              'Separate with commas. Added to every page (meta keywords and structured data). Each article adds its own keywords and its section name. Google ignores the keywords tag itself, but Bing and others read it, and the structured data helps everywhere.'),
            h('div', { class: 'row2' }, field('Publisher logo (https address)', bind(V.seo, 'logo', 'text', { maxlength: 300, placeholder: 'empty = the SparkNews logo' })),
              field('Language / region', bind(V.seo, 'locale', 'text', { maxlength: 10, placeholder: 'en_GB or de_AT' }))),
            h('div', { class: 'field' }, h('label', { text: 'Official profiles (Instagram, LinkedIn, X, ...)' }),
              (function () { var ta = h('textarea', { rows: '3', placeholder: 'One https:// address per line', 'aria-label': 'Official profiles' }); ta.value = (V.seo.same_as || []).join('\n');
                ta.addEventListener('input', function () { V.seo.same_as = ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); mark(); }); return ta; })(),
              h('small', { class: 'hint', text: 'Tells search engines these accounts belong to the same publisher (structured data, sameAs).' })),
            h('div', { class: 'row2' }, field('X / Twitter handle', bind(V.seo, 'twitter_site', 'text', { maxlength: 40, placeholder: '@yourname' })),
              field('Google Search Console code', bind(V.seo, 'google_verification', 'text', { maxlength: 120 }))),
            field('Bing Webmaster code', bind(V.seo, 'bing_verification', 'text', { maxlength: 120 })),
            tick(V.seo, 'block_ai_crawlers', 'Ask AI training crawlers (GPTBot, CCBot, ClaudeBot, ...) not to read the site'),
            h('p', { class: 'hint', text: 'robots.txt and sitemap.xml are created automatically. The sitemap needs the Website address set above.' })),
          h('section', { class: 'panel' }, h('h3', { text: 'Privacy and GDPR' }),
            tick(V.privacy, 'hide_authors', 'Hide author and editor names on everything published (articles, search data, structured data)'),
            field('Name to show instead', bind(V.privacy, 'byline', 'text', { maxlength: 60, placeholder: 'e.g. SparkNews Newsroom (empty = site name)' }), 'Authors still see their own names inside the editor. Run supabase/privacy.sql once so the names are also hidden from the public database.'),
            h('div', { class: 'field' }, h('label', { text: 'Names to remove from article text too' }),
              (function () { var ta = h('textarea', { rows: '3', placeholder: 'One name per line, e.g. a sign-off or a photo credit', 'aria-label': 'Names to remove' }); ta.value = (V.privacy.redact || []).join('\n');
                ta.addEventListener('input', function () { V.privacy.redact = ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }); return ta; })(),
              h('small', { class: 'hint', text: 'While names are hidden, these are replaced by the name above everywhere on the website (articles, translations, search).' })),
            tick(V.privacy, 'lockdown', 'Visitor lockdown: also collect no visitor data at all (turns off polls, newsletter box and Live page, blocks outside requests, replaces embeds with links). Also hides author names.'),
            field('Privacy contact email', bind(V.privacy, 'contact', 'text', { maxlength: 120, placeholder: 'privacy@example.com' }), 'Shown on the automatic Privacy page.'),
            tick(V.polls, 'enabled', 'Allow visitor polls (made in the Polls tab)')),
          h('section', { class: 'panel' }, h('h3', { text: 'Newsletter' }),
            tick(V.newsletter, 'enabled', 'Show the sign-up box on the website (turn on after the email service is connected)'),
            field('Box title', bind(V.newsletter, 'title', 'text', { maxlength: 80, placeholder: 'Get the newsletter' })), field('Box text', bind(V.newsletter, 'blurb', 'text', { maxlength: 240 })),
            field('Email service', provSel, 'The service that actually delivers your newsletters. Pick one and fill in its details.'),
            mailBoxes.resend, mailBoxes.mailjet, mailBoxes.smtp, mailNote,
            h('h4', { text: 'Who the emails come from' }),
            h('div', { class: 'row2' }, field('Sender name', bind(V.newsletter, 'from_name', 'text', { maxlength: 80, placeholder: V.site_name || 'Your site name' })),
              field('Sender email', bind(V.newsletter, 'from_email', 'email', { maxlength: 160, placeholder: 'news@yourdomain.com' }), 'Must be an address your email service lets you send from.')),
            field('Replies go to (optional)', bind(V.newsletter, 'reply_to', 'email', { maxlength: 160 })),
            field('Your postal address', bind(V.newsletter, 'address', 'text', { maxlength: 300, placeholder: 'Street, city, country' }), 'Printed in the footer of every email. Many countries require it.'),
            mailMsg, h('div', { class: 'btnrow' }, mailTest),
            h('p', { class: 'hint', text: 'Press "Save and test connection" to save everything above in one go. Write and send newsletters in the Newsletter tab; colours and layout are under Newsletter > Design.' })),
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
    var bodyBox = h('div'), wcBar = h('p', { class: 'wcbar', role: 'status' });
    function bodyText() {
      if (quill) return quill.getText();
      if (f.rawHtml) return f.rawHtml.value.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
      return String(a.content || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
    }
    function updateWc() {
      var n = wordsIn(bodyText()), min = editorial.min_words || 0, mins = Math.max(1, Math.round(n / 220));
      wcBar.className = 'wcbar' + (min && n < min ? ' short' : (min ? ' ok' : ''));
      wcBar.textContent = n + (n === 1 ? ' word' : ' words') + ' · about ' + mins + ' min read' + (min ? (n < min ? ' · ' + (min - n) + ' more needed to publish (minimum ' + min + ')' : ' · minimum ' + min + ' reached ✓') : '');
    }
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
        quill.on('text-change', function (d, o, src) { if (src === 'user') mark(); updateWc(); });
      } else if (me.role === 'admin') {
        f.rawHtml = h('textarea', { class: 'code', style: 'min-height:420px', spellcheck: 'false', oninput: function () { mark(); updateWc(); } }); f.rawHtml.value = contentHtml;
        bodyBox.replaceChildren(h('div', { class: 'msg info', text: 'This article is shown as its own full page. Paste a complete HTML document.' }), f.rawHtml);
      } else {
        bodyBox.replaceChildren(h('div', { class: 'msg info', text: 'This is a full-HTML page. Only admins can change its content. You can still edit everything else.' }));
      }
      updateWc(); loadEditorial().then(updateWc);
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
    function counter(input, max) { var c = h('small', { class: 'hint' }); function u() { var n = input.value.length; c.textContent = n + ' / ' + max + (n > max ? ' (may be cut off in search results)' : ''); }
      input.addEventListener('input', u); u(); return c; }
    f.seoTitle = h('input', { type: 'text', value: a.seo_title || '', maxlength: 70, placeholder: 'Empty = the headline', oninput: mark });
    f.seoDesc = h('textarea', { rows: '3', maxlength: 300, placeholder: 'Empty = the standfirst or the first lines of the article', oninput: mark }); f.seoDesc.value = a.seo_description || '';
    f.seoKw = h('input', { type: 'text', value: a.seo_keywords || '', maxlength: 300, placeholder: 'e.g. climate march, Vienna, student council', oninput: mark });
    var seoPanel = h('div', { class: 'panel' }, h('h3', { text: 'Search engines (SEO)' }),
      field('Search title', f.seoTitle), counter(f.seoTitle, 60),
      field('Search description', f.seoDesc), counter(f.seoDesc, 160),
      field('Keywords', f.seoKw), h('small', { class: 'hint', text: 'Separate with commas. The section name is added automatically.' }));
    f.seriesId = h('input', { type: 'text', value: a.series_id || '', oninput: mark }); f.seriesOrder = h('input', { type: 'number', value: a.series_order == null ? '' : a.series_order, oninput: mark });
    var aiT = check('Translations were made automatically', a.is_ai_translated, mark); f.aiTr = aiT.input;
    f.where = whereSelect(a, mark);

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
    f.srcLang = h('select', { 'aria-label': 'Language of this article' }); Object.keys(LANGS).forEach(function (l) { f.srcLang.appendChild(h('option', { value: l, text: LANGS[l] + ' (' + l + ')' })); }); f.srcLang.value = 'en';
    var keepIn = h('input', { type: 'text', placeholder: 'Names to keep as they are, separated by commas (people, places, brands)', 'aria-label': 'Names to keep untranslated' });
    var allBtn = h('button', { class: 'btn', type: 'button', text: 'Translate into every UN language', onclick: function () {
      var src = f.srcLang.value || 'en'; allBtn.disabled = true;
      ['ar', 'zh', 'fr', 'ru', 'es', 'de'].filter(function (l) { return l !== src; }).reduce(function (p, l) {
        return p.then(function () { if (!trData[l]) addTr(l, {}); return trData[l].run(true); });
      }, Promise.resolve()).then(function () { allBtn.disabled = false; toast('All languages translated. Please have someone read them before you publish.'); });
    } });
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
      var go = h('button', { class: 'btn', type: 'button', text: 'Translate for me' }), st = h('small', { class: 'hint', text: '' });
      go.onclick = function () {
        return doTr();
      };
      function doTr(quiet) {
        var src = { t: f.title.value.trim(), s: f.subtitle.value.trim(), c: (f.rawHtml ? f.rawHtml.value : (quill && quill.getLength() > 1 ? quill.root.innerHTML : '')).trim() };
        if (!src.t && !src.c) { toast('Write the headline or the article first.', true); return Promise.resolve(); }
        if (!quiet && (t.value || s.value || c.value) && !confirm('Replace the text in this ' + (LANGS[l] || l) + ' translation?')) return Promise.resolve();
        go.disabled = true; st.className = 'hint'; st.textContent = 'Translating\u2026';
        var from = f.srcLang.value || 'en';
        protectTerms = String(keepIn.value || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean).concat([cfg.site && cfg.site.site_name, f.author && f.author.value].filter(function (x) { return x && x.length > 2; }));
        return mmText(src.t, from, l).then(function (x) { t.value = x; return mmText(src.s, from, l); }).then(function (x) { s.value = x; return mmHtml(src.c, from, l, function (d, n) { st.textContent = 'Translating\u2026 ' + d + ' of ' + n + ' paragraphs'; }); })
          .then(function (x) { c.value = x; aiT.input.checked = true; mark(); st.className = 'hint ok'; st.textContent = 'Done. This is an automatic translation: please read it through. "Translations were made automatically" has been ticked.'; })
          .catch(function (e) { st.className = 'hint err'; st.textContent = e.message || String(e); })
          .then(function () { go.disabled = false; });
      }
      trData[l].run = doTr;
      box.querySelector('header').insertBefore(go, box.querySelector('header .btn.danger'));
      box.appendChild(st);
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
        h('div', {}, h('div', { class: 'panel' }, f.title, f.subtitle), h('div', { class: 'panel' }, bodyBox, wcBar)),
        h('div', {},
          h('div', { class: 'panel' }, h('h3', { text: 'Publishing' }), field('Status', f.status, canPublish() ? '' : 'Writers save drafts. An editor will publish them.'), schedField, pubField, (partnerList().length || a.partner_label || a.partner_mode === 'main') ? field('Where it appears', f.where, 'Pick a partner to share this story with their embed, or to keep it out of the main website.') : null, tk.box, ft.box, br.box, f.breakingText),
          h('div', { class: 'panel' }, h('h3', { text: 'Details' }), field('Section', f.category), catList, field('Author', f.author), av.box),
          h('div', { class: 'panel' }, h('h3', { text: 'Cover image' }), prev, field('Image address', f.image),
            h('div', { class: 'up' }, h('button', { class: 'btn', type: 'button', text: 'Upload image', onclick: function () { pickImage(function (u) { f.image.value = u; mark(); showCover(); }); } })),
            h('div', { class: 'row2', style: 'margin-top:12px' }, field('Focus left–right', f.fx), field('Focus top–bottom', f.fy))),
          h('div', { class: 'panel' }, h('details', { class: 'adv' }, h('summary', { text: 'More options' }),
            field('Article type', f.contentType), field('Extra images', f.extra),
            h('div', { class: 'up', style: 'margin:-6px 0 12px' }, h('button', { class: 'btn', type: 'button', text: 'Upload & add', onclick: function () { pickImage(function (u) { f.extra.value = (f.extra.value.trim() ? f.extra.value.trim() + '\n' : '') + u; mark(); }); } })),
            field('Extra images layout', f.layout), field('Video', f.video), field('Sources & credits', f.citations),
            h('div', { class: 'row2' }, field('Series ID', f.seriesId), field('Series order', f.seriesOrder)), live.box, liveBox)),
          seoPanel,
          h('div', { class: 'panel' }, h('h3', { text: 'Translations' }), h('p', { class: 'hint', text: 'Add a language, then press "Translate for me": it translates the headline, the summary and the whole article with free services (no account needed; if the first is unavailable it uses a second one with a small daily limit). Names you list below stay as they are. It is good enough to read but not perfect, so have someone check it before you publish.' }), field('This article is written in', f.srcLang), field('Keep these names untranslated', keepIn, 'The author and the site name are always kept.'), aiT.box, trBox, trSel, h('div', { class: 'btnrow' }, allBtn)),
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
      /* SEO columns come from supabase/seo.sql; older databases do not have them, so only send them when they exist or are used */
      var seoUsed = f.seoTitle.value.trim() || f.seoDesc.value.trim() || f.seoKw.value.trim();
      if (seoUsed || 'seo_title' in a) {
        d.seo_title = f.seoTitle.value.trim() || null; d.seo_description = f.seoDesc.value.trim() || null; d.seo_keywords = f.seoKw.value.trim() || null;
      }
      var tr = {};
      Object.keys(trData).forEach(function (l) {
        var v = trData[l], o = { title: v.t.value.trim(), subtitle: v.s.value.trim(), content: v.c.value.trim() };
        if (o.title || o.content) tr[l] = o;
      });
      d.translations = tr;
      if (f.where.value || a.partner_label || a.partner_mode === 'main') {
        if (f.where.value === MAIN_ONLY) { d.partner_label = null; d.partner_mode = 'main'; }
        else { var wv = f.where.value.split(':'); d.partner_label = wv[0] || null; d.partner_mode = wv[0] ? wv[1] : null; }
      }   /* only touched when used, so it works before partners.sql is run */
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
      if ((d.status === 'published' || d.status === 'scheduled') && editorial.min_words > 0 && !d.is_live_update) {
        var wn = wordsIn(bodyText());
        if (wn < editorial.min_words) {
          var gap = editorial.min_words - wn, msgW = 'This article has ' + wn + ' words. The minimum is ' + editorial.min_words + ' (' + gap + ' more).';
          if (!(me.role === 'admin' && editorial.admin_override !== false && window.confirm(msgW + '\n\nAs an admin you can publish it anyway. Publish it anyway?'))) {
            return toast(msgW + ' Save it as a draft or keep writing.', true);
          }
        }
      }
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
