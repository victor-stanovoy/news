/* SparkNews editor: the Newsletter window (compose, subscribers, design, sent). Loaded on demand by editor.js. */
(function () {
  'use strict';
  var SE = window.SparkEmail;

  function newState() {
    return { template: 'top', subject: '', preheader: '', heading: '', intro: '', outro: '', signoff: '', label: '', buttonText: '', buttonUrl: '',
             showImages: true, showSummaries: true, items: [], html: '', wrap: 'branded' };
  }

  window.SparkNL = { mount: function (ctx) { return mount(ctx); } };

  function mount(ctx) {
    var h = ctx.h, field = ctx.field, check = ctx.check, toast = ctx.toast, sb = ctx.sb, cfg = ctx.cfg, me = ctx.me, errText = ctx.errText;
    var isAdmin = me.role === 'admin';
    var site = cfg.site || {};
    var base = String(site.base_url || '').replace(/\/+$/, '');
    var view = 'compose';
    var design = SE.mergeDesign({});
    var cur = { id: null, status: 'draft', state: newState() };
    var subs = [], subFilter = 'all', subQuery = '', subNote = { text: '', cls: '' };
    var root = h('div', { class: 'nl' });
    var body = h('div', { class: 'nlbody' });
    var tabs = h('nav', { class: 'subtabs' });
    var refreshPreview = function () {};

    /* ---------------------------------------------------------------- helpers */
    function opts() { return { site_name: site.site_name || 'SparkNews', date: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }; }
    function imgOf(raw) {
      raw = String(raw || '').trim();
      if (!raw || /^\/9j\//.test(raw) || /^data:/i.test(raw)) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      if (/^\/\//.test(raw)) return 'https:' + raw;
      return base + '/images/' + raw.replace(/^[./]+/, '').replace(/^images\//, '');
    }
    function artItem(a) {
      return { id: a.id, title: a.title || '', summary: a.subtitle || '', url: a.slug ? base + '/a/' + a.slug + '.html' : base, image: imgOf(a.image_url), category: a.category || '' };
    }
    function mark() { ctx.setDirty(true); refreshPreview(); }
    function html() { return SE.render(cur.state, design, opts()); }
    function copyText(text, okMsg) {
      if (!text) return toast('There is nothing to copy yet.', true);
      var done = function () { toast(okMsg); }, fallback = function () {
        var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(t); t.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(t); ok ? done() : toast('Copying was blocked by the browser. Use the download button instead.', true);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    }
    function loadDesign() {
      return sb.from('site_settings').select('data').eq('id', 1).maybeSingle().then(function (r) {
        var n = r.data && r.data.data && r.data.data.newsletter;
        design = SE.mergeDesign(n || {});
        if (!design.from_name) design.from_name = site.site_name || '';
      });
    }
    function saveDesign() {
      return sb.from('site_settings').select('data').eq('id', 1).maybeSingle().then(function (r) {
        var data = (r.data && r.data.data) || {};
        var old = data.newsletter || {}, keep = {};
        ['from_name', 'from_email', 'reply_to', 'address'].forEach(function (k) { if (old[k] !== undefined) keep[k] = old[k]; });   /* these are edited in Settings, never overwritten from here */
        data.newsletter = Object.assign({}, old, design, keep);
        Object.assign(design, keep);
        return sb.rpc('settings_save', { p_data: data });
      });
    }
    function iframe(cls) {
      var f = h('iframe', { class: cls || 'nlframe', title: 'Email preview', sandbox: '', referrerpolicy: 'no-referrer' });
      return f;
    }
    function setDoc(f, doc) { f.srcdoc = doc; }
    function download(name, text, type) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    function bindText(obj, key, type, extra, after) {
      var i = h('input', { type: type || 'text', value: obj[key] == null ? '' : obj[key], oninput: function () { obj[key] = type === 'number' ? (i.value === '' ? '' : i.value * 1) : i.value; (after || mark)(); } });
      Object.keys(extra || {}).forEach(function (k) { i.setAttribute(k, extra[k]); });
      return i;
    }

    /* ---------------------------------------------------------------- compose */
    function pickStories() {
      var all = ctx.getArticles().filter(function (a) { return a.status === 'published' && !a.taken_down; });
      var picked = {}, q = '';
      var list = h('div', { class: 'pickerlist' });
      var dlg = h('dialog', { class: 'small' });
      function paint() {
        var rows = all.filter(function (a) { return !q || (a.title + ' ' + (a.category || '')).toLowerCase().indexOf(q) >= 0; }).slice(0, 80);
        list.replaceChildren.apply(list, rows.length ? rows.map(function (a) {
          var c = check(a.title || '(untitled)', !!picked[a.id], function () { if (c.input.checked) picked[a.id] = a; else delete picked[a.id]; add.textContent = 'Add ' + Object.keys(picked).length; add.disabled = !Object.keys(picked).length; });
          return h('div', { class: 'pickrow' }, c.box, h('small', { text: (a.category || '') + ' · ' + ctx.fmtDate(a.published_at || a.updated_at) }));
        }) : [h('div', { class: 'empty', text: 'No published articles match.' })]);
      }
      var add = h('button', { class: 'btn primary', type: 'button', text: 'Add 0', disabled: true, onclick: function () {
        var ids = Object.keys(picked); add.disabled = true;
        Promise.all(ids.map(function (id) { return sb.from('articles').select('id,slug,title,subtitle,image_url,category').eq('id', id).maybeSingle(); })).then(function (res) {
          res.forEach(function (r) { if (r.data && !cur.state.items.some(function (x) { return x.id === r.data.id; })) cur.state.items.push(artItem(r.data)); });
          dlg.close(); dlg.remove(); mark(); drawItems();
        });
      } });
      var search = h('input', { type: 'text', placeholder: 'Search published articles', oninput: function () { q = search.value.toLowerCase(); paint(); } });
      dlg.append(h('header', {}, h('b', { text: 'Add stories' }), h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { dlg.close(); dlg.remove(); } })),
        h('div', { class: 'pickerbody' }, search, list, h('div', { class: 'btnrow' }, add)));
      document.body.appendChild(dlg); dlg.showModal(); paint();
    }

    var itemsBox = h('div', { class: 'nlitems' });
    function drawItems() {
      var items = cur.state.items;
      if (!items.length) { itemsBox.replaceChildren(h('div', { class: 'empty', text: 'No stories yet. Add published articles, or a custom story.' })); refreshPreview(); return; }
      itemsBox.replaceChildren.apply(itemsBox, items.map(function (it, i) {
        function move(d) { var j = i + d; if (j < 0 || j >= items.length) return; var t = items[i]; items[i] = items[j]; items[j] = t; mark(); drawItems(); }
        return h('details', { class: 'nlitem' },
          h('summary', {}, h('span', { class: 'n', text: String(i + 1) }), h('b', { text: it.title || '(no title)' }),
            h('span', { class: 'sp' }),
            h('button', { class: 'mini', type: 'button', text: '↑', title: 'Move up', onclick: function (e) { e.preventDefault(); move(-1); } }),
            h('button', { class: 'mini', type: 'button', text: '↓', title: 'Move down', onclick: function (e) { e.preventDefault(); move(1); } }),
            h('button', { class: 'mini danger', type: 'button', text: '✕', title: 'Remove', onclick: function (e) { e.preventDefault(); items.splice(i, 1); mark(); drawItems(); } })),
          h('div', { class: 'nlitembody' }, field('Headline', bindText(it, 'title', 'text', { maxlength: 300 })), field('Short text', bindText(it, 'summary', 'text', { maxlength: 400 })),
            field('Link', bindText(it, 'url', 'url')), field('Picture address', bindText(it, 'image', 'url')), field('Label (section)', bindText(it, 'category', 'text', { maxlength: 60 }))));
      }));
      refreshPreview();
    }

    function composeView() {
      var st = cur.state, ro = cur.status === 'sent';
      var gallery = h('div', { class: 'tplgrid' }, SE.TEMPLATES.map(function (t) {
        return h('button', { class: 'tpl' + (st.template === t.id ? ' on' : ''), type: 'button', 'data-t': t.id, disabled: ro, onclick: function () {
          st.template = t.id; mark(); composeView(); } }, h('b', { text: t.name }), h('small', { text: t.about }));
      }));
      var subject = bindText(st, 'subject', 'text', { maxlength: 200, placeholder: 'e.g. Your Friday briefing' });
      var pre = bindText(st, 'preheader', 'text', { maxlength: 200, placeholder: 'The grey line shown next to the subject in the inbox' });
      var isHtml = st.template === 'html';
      var form = [h('h3', { text: '1. Choose a look' }), gallery,
        h('h3', { text: '2. Subject' }), field('Subject line', subject), field('Preview text (optional)', pre)];

      if (isHtml) {
        var ta = h('textarea', { class: 'code nlhtml', spellcheck: 'false', placeholder: '<h1>Hello {{name}}</h1>\n<p>Your email code here…</p>', oninput: function () { st.html = ta.value; mark(); } });
        ta.value = st.html || '';
        var wrap = h('select', { onchange: function () { st.wrap = wrap.value; mark(); } },
          h('option', { value: 'branded', text: 'Inside my branded header and footer' }), h('option', { value: 'exact', text: 'Exactly as I wrote it' }));
        wrap.value = st.wrap || 'branded';
        form.push(h('h3', { text: '3. Your HTML' }),
          h('p', { class: 'hint', text: 'Paste a full email or just the body. You can use {{name}}, {{email}} and {{unsubscribe_url}}. Scripts, forms and unsafe links are removed when sending. If there is no unsubscribe link, one is added automatically.' }),
          ta, field('Layout', wrap));
      } else {
        var showRow = h('div', { class: 'row2' }, (function () { var c = check('Show pictures', st.showImages !== false, function () { st.showImages = c.input.checked; mark(); }); return c.box; })(),
          (function () { var c = check('Show short texts', st.showSummaries !== false, function () { st.showSummaries = c.input.checked; mark(); }); return c.box; })());
        var heading = bindText(st, 'heading', 'text', { maxlength: 120, placeholder: st.template === 'alert' ? 'Leave empty to use the story headline' : 'Optional big title' });
        var intro = h('textarea', { placeholder: 'Say hello. A blank line starts a new paragraph.', oninput: function () { st.intro = intro.value; mark(); } }); intro.value = st.intro || '';
        var outro = h('textarea', { placeholder: 'Optional closing text', oninput: function () { st.outro = outro.value; mark(); } }); outro.value = st.outro || '';
        form.push(h('h3', { text: '3. Content' }), field(st.template === 'alert' ? 'Headline' : 'Title', heading), field(st.template === 'alert' ? 'Message' : 'Opening text', intro));
        if (st.template === 'alert') form.push(field('Red tag text', bindText(st, 'label', 'text', { maxlength: 40, placeholder: 'Breaking news' })));
        if (st.template === 'top' || st.template === 'alert') form.push(h('div', { class: 'row2' }, field('Button text', bindText(st, 'buttonText', 'text', { maxlength: 40, placeholder: 'Read the story' })), field('Button link', bindText(st, 'buttonUrl', 'url', { placeholder: 'Defaults to the first story' }))));
        form.push(h('h3', { text: 'Stories' }), showRow, itemsBox,
          h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', disabled: ro, text: '+ Add published articles', onclick: pickStories }),
            h('button', { class: 'btn', type: 'button', disabled: ro, text: '+ Custom story', onclick: function () { st.items.push({ title: '', summary: '', url: '', image: '', category: '' }); mark(); drawItems(); itemsBox.lastChild.open = true; } })),
          field('Closing text', outro));
        if (st.template === 'letter') { var sg = h('textarea', { placeholder: 'Warm regards,\nThe editors', oninput: function () { st.signoff = sg.value; mark(); } }); sg.value = st.signoff || ''; form.push(field('Signature', sg)); }
      }

      var testTo = h('input', { type: 'email', value: me.email || '', 'aria-label': 'Test email address' });
      var msg = h('p', { class: 'hint' });
      var count = h('span', { class: 'hint' });
      var save = h('button', { class: 'btn', type: 'button', disabled: ro, text: 'Save draft', onclick: function () { saveDraft().then(function (ok) { if (ok) toast('Draft saved'); }); } });
      var test = h('button', { class: 'btn', type: 'button', text: 'Send test', onclick: function () {
        if (!st.subject.trim()) return toast('Write a subject line first', true);
        test.disabled = true; msg.className = 'hint'; msg.textContent = 'Sending test…';
        ctx.callFn('newsletter', { mode: 'test', subject: st.subject, preheader: st.preheader, html: html(), to: testTo.value }).then(function (j) {
          test.disabled = false;
          if (j.ok) { msg.className = 'hint ok'; msg.textContent = 'Test sent to ' + testTo.value + '. Check the inbox (and spam folder).'; }
          else { msg.className = 'hint err'; msg.textContent = j.error || 'The test email could not be sent.'; }
        });
      } });
      var copyHtml = h('button', { class: 'btn', type: 'button', text: 'Copy HTML', title: 'Copy the finished email code', onclick: function () { copyText(html(), 'Email HTML copied (' + Math.round(html().length / 1024) + ' KB)'); } });
      var send = h('button', { class: 'btn primary', type: 'button', disabled: ro, text: ro ? 'Already sent' : 'Send to subscribers…', onclick: sendDialog });
      form.push(h('h3', { text: '4. Send' }), h('div', { class: 'sendrow' }, field('Test address', testTo), test), msg,
        h('div', { class: 'btnrow' }, save, copyHtml, send, count));
      if (ro) form.unshift(h('div', { class: 'msg info', text: 'This newsletter was sent' + (cur.sentAt ? ' on ' + ctx.fmtDate(cur.sentAt) : '') + '. It is shown read-only. Use "Duplicate" in the Sent list to reuse it.' }));

      var frame = iframe(), device = 'desktop';
      var devs = h('div', { class: 'devs' }, ['desktop', 'mobile'].map(function (d) {
        return h('button', { class: 'chip' + (d === device ? ' on' : ''), type: 'button', text: d === 'desktop' ? 'Desktop' : 'Phone', 'data-d': d, onclick: function () {
          device = d; frame.className = 'nlframe ' + d; devs.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.d === d); }); } });
      }));
      frame.className = 'nlframe desktop';
      var t;
      refreshPreview = function () { clearTimeout(t); t = setTimeout(function () { setDoc(frame, SE.preview(cur.state, design, opts())); }, 120); };
      body.replaceChildren(h('div', { class: 'nlgrid' }, h('div', { class: 'nlform' }, form), h('div', { class: 'nlprev' }, h('div', { class: 'prevhead' }, h('b', { text: 'Preview' }), devs), frame)));
      drawItems(); setDoc(frame, SE.preview(cur.state, design, opts()));
      ro && body.querySelectorAll('input,textarea,select').forEach(function (x) { if (x !== testTo) x.disabled = true; });
      sb.from('subscribers').select('id', { count: 'exact', head: true }).eq('status', 'confirmed').then(function (r) { count.textContent = r.error ? '' : (r.count != null ? r.count : 0) + ' confirmed subscribers'; });
    }

    function saveDraft() {
      var st = cur.state;
      var row = { subject: st.subject, preheader: st.preheader || null, mode: st.template === 'html' ? 'html' : 'template', state: st, html: html(), updated_at: new Date().toISOString() };
      var p = cur.id ? sb.from('newsletters').update(row).eq('id', cur.id) : sb.from('newsletters').insert(row).select('id').single();
      return p.then(function (r) {
        if (r.error) { toast(errText(r.error), true); return false; }
        if (!cur.id && r.data) cur.id = r.data.id;
        ctx.setDirty(false); return true;
      });
    }

    function sendDialog() {
      var st = cur.state;
      if (!st.subject.trim()) return toast('Write a subject line first', true);
      if (st.template !== 'html' && !st.items.length && !(st.intro || '').trim()) return toast('The newsletter is empty. Add some content first.', true);
      if (st.template === 'html' && (st.html || '').trim().length < 20) return toast('Paste your HTML first', true);
      sb.from('subscribers').select('id', { count: 'exact', head: true }).eq('status', 'confirmed').then(function (r) {
        var n = r.count || 0;
        if (!n) return toast('There are no confirmed subscribers yet. Use "Send test" to send it to yourself.', true);
        var status = h('p', { class: 'hint' });
        var go = h('button', { class: 'btn primary', type: 'button', text: 'Send now to ' + n + (n === 1 ? ' person' : ' people') });
        var cancel = h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { dlg.close(); dlg.remove(); } });
        var dlg = h('dialog', { class: 'small' }, h('header', {}, h('b', { text: 'Send newsletter' })),
          h('div', { class: 'pickerbody' }, h('p', {}, 'Subject: ', h('b', { text: st.subject })),
            h('p', { text: 'It goes to ' + n + ' confirmed subscriber' + (n === 1 ? '' : 's') + '. This cannot be undone.' }),
            n > 90 ? h('p', { class: 'hint err', text: 'Free email plans usually send only 100 to 500 emails per day. If sending stops with an error, press the send button again later: nobody gets it twice.' }) : null,
            status, h('div', { class: 'btnrow' }, go, cancel)));
        go.onclick = function () {
          go.disabled = cancel.disabled = true; status.className = 'hint'; status.textContent = 'Saving…';
          saveDraft().then(function (ok) {
            if (!ok) { go.disabled = cancel.disabled = false; return; }
            (function step() {
              ctx.callFn('newsletter', { mode: 'send', newsletter_id: cur.id, subject: st.subject, preheader: st.preheader, html: html() }).then(function (j) {
                if (j.total_sent != null) status.textContent = 'Sent ' + j.total_sent + ' of ' + (j.total_sent + (j.remaining || 0)) + '…';
                if (j.error) { status.className = 'hint err'; status.textContent = j.error + (j.total_sent ? ' (' + j.total_sent + ' already sent; press the button again to continue.)' : ''); go.disabled = cancel.disabled = false; go.textContent = 'Try again'; return; }
                if (j.remaining > 0) return step();
                cur.status = 'sent'; cur.sentAt = new Date().toISOString();
                status.className = 'hint ok'; status.textContent = 'Done. Sent to ' + j.total_sent + '.'; toast('Newsletter sent to ' + j.total_sent);
                setTimeout(function () { dlg.close(); dlg.remove(); composeView(); }, 900);
              });
            })();
          });
        };
        document.body.appendChild(dlg); dlg.showModal();
      });
    }

    /* ---------------------------------------------------------------- subscribers */
    function subsView() {
      var counts = { confirmed: 0, pending: 0, unsubscribed: 0 };
      subs.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });
      var list = h('div', { class: 'sublist' });
      function paint() {
        var rows = subs.filter(function (s) { return (subFilter === 'all' || s.status === subFilter) && (!subQuery || ((s.email || '') + ' ' + (s.name || '')).toLowerCase().indexOf(subQuery) >= 0); }).slice(0, 300);
        list.replaceChildren.apply(list, rows.length ? rows.map(function (s) {
          return h('div', { class: 'subrow' }, h('span', { class: 'e' }, h('b', { text: s.email }), h('small', { text: (s.name ? s.name + ' · ' : '') + ctx.fmtDate(s.created_at) })),
            h('i', { class: 'badge ' + (s.status === 'confirmed' ? 'published' : s.status === 'pending' ? 'scheduled' : 'draft'), text: s.status }),
            h('button', { class: 'btn danger mini', type: 'button', text: 'Delete', onclick: function () {
              if (!confirm('Delete ' + s.email + ' for good?')) return;
              sb.from('subscribers').delete().eq('id', s.id).then(function (r) { if (r.error) return toast(errText(r.error), true); loadSubs(); }); } }));
        }) : [h('div', { class: 'empty', text: subs.length ? 'Nobody matches.' : 'No subscribers yet. Turn on the sign-up box in Settings, or add people below.' })]);
      }
      var chips = h('div', { class: 'chips' }, [['all', 'All (' + subs.length + ')'], ['confirmed', 'Confirmed (' + counts.confirmed + ')'], ['pending', 'Waiting (' + counts.pending + ')'], ['unsubscribed', 'Left (' + counts.unsubscribed + ')']].map(function (c) {
        return h('button', { class: 'chip' + (subFilter === c[0] ? ' on' : ''), type: 'button', text: c[1], 'data-f': c[0], onclick: function () { subFilter = c[0]; chips.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x.dataset.f === subFilter); }); paint(); } });
      }));
      var search = h('input', { type: 'text', placeholder: 'Search subscribers', value: subQuery, oninput: function () { subQuery = search.value.toLowerCase(); paint(); } });

      var addMail = h('textarea', { placeholder: 'one per line:\nanna@example.com\nben@example.com, Ben Miller', rows: 4 });
      var consent = check('These people agreed to receive the newsletter', false, function () {});
      var addMsg = h('p', { class: 'hint ' + subNote.cls, text: subNote.text });
      var addBtn = h('button', { class: 'btn primary', type: 'button', text: 'Add subscribers', onclick: function () {
        if (!consent.input.checked) { addMsg.className = 'hint err'; addMsg.textContent = 'Please confirm that they agreed to receive it.'; return; }
        subNote = { text: '', cls: '' };
        var seen = {}, rows = [], bad = 0;
        addMail.value.split('\n').forEach(function (line) {
          var p = line.split(/[,;\t]/), e = (p[0] || '').trim().toLowerCase(); if (!e) return;
          if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/.test(e)) { bad++; return; }
          if (seen[e] || subs.some(function (s) { return (s.email || '').toLowerCase() === e; })) return; seen[e] = 1;
          rows.push({ email: e, name: (p[1] || '').trim() || null, status: 'confirmed', source: 'added in editor', confirmed_at: new Date().toISOString() });
        });
        if (!rows.length) { addMsg.className = 'hint err'; addMsg.textContent = bad ? 'No valid new addresses found.' : 'Nothing new to add.'; return; }
        sb.from('subscribers').insert(rows).then(function (r) {
          if (r.error) { addMsg.className = 'hint err'; addMsg.textContent = errText(r.error); return; }
          subNote = { text: 'Added ' + rows.length + (bad ? ' (' + bad + ' invalid skipped)' : '') + '.', cls: 'ok' }; loadSubs();
        });
      } });
      body.replaceChildren(h('div', { class: 'subs' },
        h('div', { class: 'subhead' }, h('h3', { text: 'Subscribers' }), h('span', { class: 'sp' }),
          h('button', { class: 'btn', type: 'button', text: 'Copy confirmed emails', onclick: function () {
            var l = subs.filter(function (x) { return x.status === 'confirmed'; }).map(function (x) { return x.email; }); copyText(l.join(', '), l.length + ' confirmed emails copied'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Copy all emails', onclick: function () {
            var l = subs.map(function (x) { return x.email; }); copyText(l.join(', '), l.length + ' emails copied (all statuses)'); } }),
          h('button', { class: 'btn', type: 'button', text: 'Download list (CSV)', onclick: function () {
            download('subscribers.csv', 'email,name,status,joined\n' + subs.map(function (s) { return [s.email, s.name || '', s.status, (s.created_at || '').slice(0, 10)].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'), 'text/csv'); } })),
        chips, search, list,
        h('div', { class: 'panel' }, h('h3', { text: 'Add people' }), addMail, consent.box, addMsg, addBtn,
          h('p', { class: 'hint', text: 'Only add people who asked for your newsletter (the law requires it). New visitors who sign up on the website confirm by email themselves.' }))));
      paint();
    }
    function loadSubs() {
      sb.from('subscribers').select('*').order('created_at', { ascending: false }).limit(5000).then(function (r) {
        if (r.error) return body.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission/i.test(r.error.message || '') ? 'The newsletter is not set up yet. Run supabase/newsletter.sql in the Supabase SQL Editor (see the README).' : errText(r.error) }));
        subs = r.data || []; if (view === 'subs') subsView();
      });
    }

    /* ---------------------------------------------------------------- design */
    function designView() {
      var D = design, sample = { template: 'top', subject: 'Sample', preheader: 'Preview', intro: 'This is how your newsletters will look.', buttonText: 'Read the story', showImages: false, showSummaries: true,
        items: [{ title: 'A sample headline for the lead story', summary: 'A short summary of the story shows up here.', url: 'https://example.com', category: 'World' },
                { title: 'Another story worth reading', summary: 'More text.', url: 'https://example.com', category: 'Business' },
                { title: 'A third, shorter headline', summary: '', url: 'https://example.com', category: 'Sport' }] };
      var frame = iframe(); frame.className = 'nlframe desktop';
      var t; var redraw = function () { clearTimeout(t); t = setTimeout(function () { setDoc(frame, SE.preview(sample, D, opts())); }, 100); };
      var dis = !isAdmin;
      function col(key, label) {
        var i = h('input', { type: 'color', value: SE.mergeDesign(D)[key], disabled: dis, oninput: function () { D[key] = i.value; redraw(); } });
        return h('label', { class: 'colorfield' }, i, h('span', { text: label }));
      }
      function sel(key, label, options) {
        var s = h('select', { disabled: dis, onchange: function () { D[key] = s.value; redraw(); } }, options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
        s.value = SE.mergeDesign(D)[key]; return field(label, s);
      }
      function txt(key, label, hint, type, ph) { var i = bindText(D, key, type || 'text', { placeholder: ph || '' }, redraw); i.disabled = dis; return field(label, i, hint); }
      function area(key, label, hint) { var a = h('textarea', { rows: 2, disabled: dis, oninput: function () { D[key] = a.value; redraw(); } }); a.value = D[key] || ''; return field(label, a, hint); }
      D.social = D.social || {};
      var soc = ['website', 'x', 'facebook', 'instagram', 'youtube'].map(function (k) {
        var i = h('input', { type: 'url', value: D.social[k] || '', disabled: dis, placeholder: 'https://…', oninput: function () { D.social[k] = i.value; redraw(); } });
        return field(k === 'x' ? 'X (Twitter)' : k.charAt(0).toUpperCase() + k.slice(1), i);
      });
      var msg = h('p', { class: 'hint' });
      var saveBtn = h('button', { class: 'btn primary', type: 'button', text: 'Save design', disabled: dis, onclick: function () {
        saveBtn.disabled = true;
        saveDesign().then(function (r) { saveBtn.disabled = false; if (r.error) { msg.className = 'hint err'; msg.textContent = errText(r.error); } else { msg.className = 'hint ok'; msg.textContent = 'Saved. New newsletters use this design.'; toast('Design saved'); refreshPreview(); } });
      } });
      body.replaceChildren(h('div', { class: 'nlgrid' },
        h('div', { class: 'nlform' },
          dis ? h('div', { class: 'msg info', text: 'Only admins can change the design. You can look at it here.' }) : null,
          h('h3', { text: 'Colours' }), h('div', { class: 'colors' }, col('brand', 'Buttons and accents'), col('header_bg', 'Header background'), col('header_text', 'Header text'), col('page_bg', 'Page background'), col('card_bg', 'Email background'), col('text', 'Text'), col('muted', 'Small text'), col('link', 'Links')),
          h('h3', { text: 'Layout' }),
          sel('font', 'Fonts', Object.keys(SE.FONTS).map(function (k) { return [k, SE.FONTS[k].label]; })),
          sel('header_style', 'Header', [['banner', 'Colour banner'], ['centered', 'Centred with accent line'], ['minimal', 'Minimal']]),
          sel('button', 'Buttons', [['pill', 'Round (pill)'], ['rounded', 'Slightly rounded'], ['square', 'Square']]),
          h('div', { class: 'row2' }, txt('width', 'Email width (480 to 700 px)', '', 'number'), txt('radius', 'Corner roundness (0 to 28)', '', 'number')),
          h('h3', { text: 'Header' }), txt('logo_url', 'Logo picture address', 'A web address of a PNG or JPG, about 40 px tall. Leave empty to show only the name.', 'url'),
          (function () { var c = check('Show the site name next to the logo', D.show_name !== false, function () { D.show_name = c.input.checked; redraw(); }); c.input.disabled = dis; return c.box; })(), txt('tagline', 'Line under the name'),
          h('h3', { text: 'Footer' }), area('footer_text', 'Footer text', 'For example a short sentence about you.'), txt('unsub_text', 'Unsubscribe link wording'), h('div', { class: 'socials' }, soc),
          h('p', { class: 'hint', text: 'The sender name, sender email and postal address are in Settings > Newsletter, together with the email service.' }), h('a', { class: 'btn', href: '#/settings', text: 'Open sender settings' }),
          msg, h('div', { class: 'btnrow' }, saveBtn)),
        h('div', { class: 'nlprev' }, h('div', { class: 'prevhead' }, h('b', { text: 'Live preview' })), frame)));
      setDoc(frame, SE.preview(sample, D, opts()));
    }

    /* ---------------------------------------------------------------- sent / drafts */
    function sentView() {
      var list = h('div', { class: 'sublist' }, h('div', { class: 'empty', text: 'Loading…' }));
      body.replaceChildren(h('div', { class: 'subs' }, h('div', { class: 'subhead' }, h('h3', { text: 'Drafts and sent newsletters' }), h('span', { class: 'sp' }),
        h('button', { class: 'btn primary', type: 'button', text: '+ New newsletter', onclick: function () { cur = { id: null, status: 'draft', state: newState() }; ctx.setDirty(false); go('compose'); } })), list));
      sb.from('newsletters').select('id,subject,status,sent_at,sent_count,updated_at,state').order('updated_at', { ascending: false }).limit(200).then(function (r) {
        if (r.error) return list.replaceChildren(h('div', { class: 'msg err', text: errText(r.error) }));
        var rows = r.data || [];
        list.replaceChildren.apply(list, rows.length ? rows.map(function (n) {
          return h('div', { class: 'subrow' }, h('span', { class: 'e' }, h('b', { text: n.subject || '(no subject)' }), h('small', { text: n.status === 'sent' ? 'Sent ' + ctx.fmtDate(n.sent_at) + ' to ' + n.sent_count : 'Edited ' + ctx.fmtDate(n.updated_at) })),
            h('i', { class: 'badge ' + (n.status === 'sent' ? 'published' : 'draft'), text: n.status }),
            h('button', { class: 'btn mini', type: 'button', text: n.status === 'sent' ? 'View' : 'Open', onclick: function () {
              cur = { id: n.id, status: n.status === 'sent' ? 'sent' : 'draft', sentAt: n.sent_at, state: Object.assign(newState(), n.state || {}) }; ctx.setDirty(false); go('compose'); } }),
            h('button', { class: 'btn mini', type: 'button', text: 'Duplicate', onclick: function () {
              var s = JSON.parse(JSON.stringify(Object.assign(newState(), n.state || {}))); s.subject = (s.subject || '') + ' (copy)';
              cur = { id: null, status: 'draft', state: s }; ctx.setDirty(true); go('compose'); } }),
            h('button', { class: 'btn danger mini', type: 'button', text: 'Delete', onclick: function () {
              if (!confirm('Delete "' + (n.subject || 'this newsletter') + '"?')) return;
              sb.from('newsletters').delete().eq('id', n.id).then(function (x) { if (x.error) return toast(errText(x.error), true); if (cur.id === n.id) cur = { id: null, status: 'draft', state: newState() }; sentView(); }); } }));
        }) : [h('div', { class: 'empty', text: 'Nothing here yet. Write your first newsletter in the Compose tab.' })]);
      });
    }

    /* ---------------------------------------------------------------- tabs */
    var TABS = [['compose', 'Compose'], ['subs', 'Subscribers'], ['design', 'Design'], ['sent', 'Drafts & sent']];
    function senderWarn() {
      if (design.from_email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(design.from_email)) return null;
      return h('div', { class: 'msg err' }, 'Before you can send: enter the sender email in ', h('a', { href: '#/settings', text: 'Settings > Newsletter' }), '.');
    }
    function go(v) {
      view = v;
      tabs.querySelectorAll('.stab').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
      var warn = senderWarn();
      if (v === 'compose') composeView(); else if (v === 'subs') { subsView(); loadSubs(); } else if (v === 'design') designView(); else sentView();
      if (warn && v !== 'design') body.insertBefore(warn, body.firstChild);
    }
    tabs.replaceChildren.apply(tabs, TABS.map(function (t) { return h('button', { class: 'stab', type: 'button', 'data-v': t[0], text: t[1], onclick: function () { go(t[0]); } }); }));
    root.replaceChildren(h('div', { class: 'dashhead' }, h('h2', { text: 'Newsletter' })), tabs, body);
    body.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
    loadDesign().then(function () { go('compose'); });
    return root;
  }
})();
