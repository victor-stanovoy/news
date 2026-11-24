/* SparkNews editor: the Archive window. Two archives in one place:
   STAFF archive: only people with archive access can read it (enforced by the database, never part of the website).
   PUBLIC archive: shown to everyone on the website at /library/. Loaded on demand by editor.js. */
(function () {
  'use strict';
  window.SparkArchive = { mount: mount };
  var KINDS = [['document', 'Document'], ['issue', 'Issue / edition'], ['photo', 'Photo'], ['video', 'Video'], ['audio', 'Audio'], ['other', 'Other']];

  function mount(ctx) {
    var h = ctx.h, field = ctx.field, toast = ctx.toast, sb = ctx.sb, errText = ctx.errText, me = ctx.me;
    var canEdit = me.role === 'admin' || me.role === 'editor', isAdmin = me.role === 'admin';
    var root = h('div', { class: 'dash archive' }), items = [], scope = 'staff', q = '', kindF = '', editing = null, denied = false;

    function load() {
      return sb.from('archive_items').select('*').order('year', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(3000).then(function (r) {
        if (r.error) throw r.error;
        items = r.data || [];
        /* the database only returns staff items to people with access: if there are none and we are not allowed, say so */
        return sb.rpc('archive_allowed').then(function (a) { denied = a && a.data === false; draw(); });
      }).catch(function (e) {
        root.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache/i.test((e && e.message) || '') ? 'The archive is not set up yet. Run supabase/archive.sql in the Supabase SQL Editor once, then reload.' : errText(e) }));
      });
    }

    function form() {
      var it = editing || { scope: scope, kind: 'document' };
      var t = h('input', { type: 'text', maxlength: '200', placeholder: 'Title' }), u = h('input', { type: 'text', maxlength: '800', placeholder: 'https://… (link to the file: Google Drive, Dropbox, Cloudinary, your own site)' });
      var d = h('textarea', { rows: 3, maxlength: '2000', placeholder: 'What is it? (optional)' }), y = h('input', { type: 'number', min: '1900', max: '2200', placeholder: String(new Date().getFullYear()) });
      var tg = h('input', { type: 'text', maxlength: '200', placeholder: 'tags, separated by commas' });
      var kd = h('select', {}, KINDS.map(function (k) { return h('option', { value: k[0], text: k[1] }); })), sc = h('select', {}, [h('option', { value: 'staff', text: 'Staff archive (private)' }), h('option', { value: 'public', text: 'Public archive (everyone)' })]);
      t.value = it.title || ''; u.value = it.url || ''; d.value = it.description || ''; y.value = it.year || ''; tg.value = it.tags || ''; kd.value = it.kind || 'document'; sc.value = it.scope || scope;
      var msg = h('p', { class: 'hint' });
      return h('div', { class: 'panel' }, h('h3', { text: editing ? 'Edit item' : 'Add to the archive' }),
        h('div', { class: 'row2' }, field('Title', t), field('Where it goes', sc, 'Public items are visible to anyone on the website. Be sure before you choose Public.')),
        field('Link to the file', u, 'Upload the file somewhere (Google Drive, Dropbox, Cloudinary…) and paste its link here. For the staff archive use a link that only your team can open.'),
        h('div', { class: 'row3' }, field('Type', kd), field('Year', y), field('Tags', tg)), field('Description', d), msg,
        h('div', { class: 'tools' },
          h('button', { class: 'btn primary', type: 'button', text: editing ? 'Save changes' : 'Add', onclick: function () {
            var row = { scope: sc.value, title: t.value.trim(), url: u.value.trim() || null, kind: kd.value, year: y.value ? Number(y.value) : null, tags: tg.value.trim() || null, description: d.value.trim() || null, updated_at: new Date().toISOString() };
            if (row.title.length < 2) { msg.textContent = 'Give it a title.'; return; }
            if (row.url && !/^https?:\/\//i.test(row.url)) { msg.textContent = 'The link must start with https://'; return; }
            if (row.scope === 'public' && !window.confirm('This will be visible to everyone on the website. Continue?')) return;
            var op = editing ? sb.from('archive_items').update(row).eq('id', editing.id) : sb.from('archive_items').insert(row);
            op.then(function (r) { if (r.error) return toast(errText(r.error), true); toast(row.scope === 'public' ? 'Saved. It shows on the website after the next rebuild.' : 'Saved'); scope = row.scope; editing = null; load(); });
          } }),
          editing ? h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { editing = null; draw(); } }) : null));
    }

    function list() {
      var shown = items.filter(function (i) { return i.scope === scope && (!kindF || i.kind === kindF) && (!q || (i.title + ' ' + (i.tags || '') + ' ' + (i.description || '')).toLowerCase().indexOf(q) >= 0); });
      return shown.length ? h('ul', { class: 'arclist' }, shown.map(function (i) {
        return h('li', {},
          h('div', { class: 'arcmain' }, i.url ? h('a', { href: i.url, target: '_blank', rel: 'noopener', text: i.title }) : h('b', { text: i.title }),
            h('small', { text: (KINDS.filter(function (k) { return k[0] === i.kind; })[0] || [0, 'Other'])[1] + (i.year ? ' · ' + i.year : '') + (i.tags ? ' · ' + i.tags : '') }),
            i.description ? h('p', { text: i.description }) : null),
          canEdit ? h('div', { class: 'arcbtn' },
            h('button', { class: 'btn', type: 'button', text: 'Edit', onclick: function () { editing = i; draw(); window.scrollTo(0, 0); } }),
            h('button', { class: 'btn', type: 'button', text: i.scope === 'staff' ? 'Make public' : 'Make private', onclick: function () {
              if (i.scope === 'staff' && !window.confirm('Make this visible to everyone on the website?')) return;
              sb.from('archive_items').update({ scope: i.scope === 'staff' ? 'public' : 'staff', updated_at: new Date().toISOString() }).eq('id', i.id).then(function (r) { if (r.error) return toast(errText(r.error), true); load(); }); } }),
            h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: function () {
              if (!window.confirm('Delete "' + i.title + '" from the archive?')) return;
              sb.from('archive_items').delete().eq('id', i.id).then(function (r) { if (r.error) return toast(errText(r.error), true); load(); }); } })) : null);
      })) : h('div', { class: 'empty', text: items.length ? 'Nothing matches.' : (scope === 'staff' ? 'The staff archive is empty. Add the first item below.' : 'The public archive is empty.') });
    }

    function access() {
      var box = h('div', { class: 'panel' }, h('h3', { text: 'Who can open the staff archive' }),
        h('p', { class: 'hint', text: 'Only the people ticked here can read the staff archive. Writers and editors without a tick cannot see it at all: the database does not send them the items. Only editors and admins can add or change items.' }));
      sb.rpc('archive_team').then(function (r) {
        if (r.error) { box.appendChild(h('div', { class: 'msg err', text: errText(r.error) })); return; }
        box.appendChild(h('ul', { class: 'splist' }, (r.data || []).map(function (p) {
          var c = h('input', { type: 'checkbox' }); c.checked = !!p.archive_access;
          c.addEventListener('change', function () { sb.rpc('archive_access_set', { p_user: p.user_id, p_on: c.checked }).then(function (x) { if (x.error) { c.checked = !c.checked; return toast(errText(x.error), true); } toast(c.checked ? 'Access given' : 'Access removed'); }); });
          return h('li', {}, h('label', { class: 'stt' }, c, ' ' + (p.name || p.email) + '  (' + p.role + ')'));
        })));
      });
      return box;
    }

    function draw() {
      if (denied) { root.replaceChildren(h('div', { class: 'msg err', text: 'You do not have access to the archive. Ask an admin to give you access.' })); return; }
      var tabs = h('div', { class: 'afilter' }, [['staff', 'Staff archive (private)'], ['public', 'Public archive']].map(function (s) {
        return h('button', { type: 'button', class: scope === s[0] ? 'on' : '', text: s[1] + ' · ' + items.filter(function (i) { return i.scope === s[0]; }).length, onclick: function () { scope = s[0]; draw(); } });
      }));
      var search = h('input', { type: 'text', placeholder: 'Search the archive', 'aria-label': 'Search', value: q }); search.addEventListener('input', function () { q = search.value.toLowerCase(); redraw(); });
      var kf = h('select', { 'aria-label': 'Type' }, [h('option', { value: '', text: 'All types' })].concat(KINDS.map(function (k) { return h('option', { value: k[0], text: k[1] }); }))); kf.value = kindF; kf.addEventListener('change', function () { kindF = kf.value; redraw(); });
      var lwrap = h('div', {}, list());
      function redraw() { lwrap.replaceChildren(list()); }
      root.replaceChildren(h('div', { class: 'msg info', text: scope === 'staff' ? 'Private: only people with archive access can see these items. They never appear on the website.' : 'Public: these items are listed for everyone at /library/ on the website.' }),
        tabs, h('div', { class: 'tools' }, search, kf), lwrap, canEdit ? form() : null, isAdmin ? access() : null);
    }
    root.appendChild(h('div', { class: 'empty', text: 'Loading…' }));
    load();
    return root;
  }
})();
