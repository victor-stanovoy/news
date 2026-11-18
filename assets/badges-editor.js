/* SparkNews editor: the Badges window (staff ID badges with QR codes). Loaded on demand by editor.js. Admins only. */
(function () {
  'use strict';
  window.SparkBadges = { mount: mount };

  function mount(ctx) {
    var h = ctx.h, field = ctx.field, check = ctx.check, toast = ctx.toast, sb = ctx.sb, errText = ctx.errText, site = ctx.site || {};
    var root = h('div', { class: 'dash badges' }), rows = [], editing = null;

    function base() {
      var b = (site.base_url || '').replace(/\/+$/, '');
      return b || (location.origin + location.pathname.replace(/\/editor\/[^\/]*$/, '').replace(/\/+$/, ''));
    }
    function linkOf(b) { return base() + '/badge/?t=' + b.token; }
    function newToken() { var u = new Uint8Array(16), s = ''; crypto.getRandomValues(u); for (var i = 0; i < u.length; i++) s += ('0' + u[i].toString(16)).slice(-2); return s; }

    function qrCanvas(text, px) {
      var q = window.qrcode(0, 'M'); q.addData(text); q.make();
      var n = q.getModuleCount(), quiet = 2, cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
      var c = document.createElement('canvas'); c.width = c.height = cell * (n + quiet * 2);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
      for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
      return c;
    }
    function card(b) {
      var photo = b.photo_url && /^https:\/\//.test(b.photo_url)
        ? h('img', { class: 'bphoto', src: b.photo_url, alt: '' })
        : h('div', { class: 'bphoto ini', text: (b.name || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() });
      var qc = qrCanvas(linkOf(b), 220); qc.className = 'bqr';
      return h('div', { class: 'bcard' + (b.active ? '' : ' off') },
        h('div', { class: 'bhead', text: site.site_name || 'Staff' }),
        h('div', { class: 'bbody' }, photo,
          h('div', { class: 'binfo' }, h('b', { class: 'bname', text: b.name }), h('span', { class: 'brole', text: b.role || '' }), h('span', { class: 'bno', text: b.employee_no ? 'ID ' + b.employee_no : '' })),
          qc),
        h('div', { class: 'bfoot', text: 'Scan to verify' }));
    }
    function copyText(t, ok) {
      var done = function () { toast(ok); }, fail = function () { window.prompt('Copy this link:', t); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fail); else fail();
    }
    function qrBlob(b) { return new Promise(function (res) { qrCanvas(linkOf(b), 800).toBlob(res, 'image/png'); }); }
    function download(blob, name) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    function fname(b) { return 'badge-qr-' + (b.employee_no || b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png'; }
    function copyQr(b) {
      qrBlob(b).then(function (blob) {
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () { toast('QR code copied. Paste it into your design or label software.'); });
        }
        download(blob, fname(b)); toast('This browser cannot copy images, so the QR code was downloaded instead');
      }).catch(function () { qrBlob(b).then(function (blob) { download(blob, fname(b)); toast('Copying was blocked, so the QR code was downloaded instead'); }); });
    }
    function printCards(list) {
      if (!list.length) return toast('No active badges to print', true);
      var sheet = h('div', { class: 'bsheet' }, list.map(card));
      document.body.appendChild(sheet); document.body.classList.add('printing-badges');
      var clean = function () { document.body.classList.remove('printing-badges'); sheet.remove(); window.removeEventListener('afterprint', clean); };
      window.addEventListener('afterprint', clean);
      setTimeout(function () { window.print(); setTimeout(function () { if (document.body.contains(sheet)) clean(); }, 1500); }, 120);
    }

    function load() {
      return sb.from('badges').select('*').order('created_at', { ascending: false }).then(function (r) {
        if (r.error) throw r.error; rows = r.data || []; draw();
      }, function (e) { fail(e); }).catch(fail);
    }
    function fail(e) {
      root.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission/i.test((e && e.message) || '') ? 'Badges are not set up yet. Run supabase/badges.sql in the Supabase SQL Editor, then reload this page.' : errText(e) }));
    }
    function patch(b, d, msg) { sb.from('badges').update(d).eq('id', b.id).then(function (r) { if (r.error) return toast(errText(r.error), true); toast(msg); load(); }); }
    function del(b) {
      if (!window.confirm('Delete the badge for ' + b.name + '? Printed copies will stop verifying.')) return;
      sb.from('badges').delete().eq('id', b.id).then(function (r) { if (r.error) return toast(errText(r.error), true); toast('Badge deleted'); load(); });
    }

    function form(b) {
      b = b || { name: '', role: '', employee_no: '', photo_url: '', active: true };
      var name = h('input', { type: 'text', maxlength: '120', value: b.name || '' });
      var role = h('input', { type: 'text', maxlength: '120', value: b.role || '', placeholder: 'e.g. Reporter' });
      var no = h('input', { type: 'text', maxlength: '40', value: b.employee_no || '', placeholder: 'e.g. 0042' });
      var photo = h('input', { type: 'text', maxlength: '600', value: b.photo_url || '', placeholder: 'https://… (or upload below)' });
      var file = h('input', { type: 'file', accept: 'image/*', onchange: function () {
        if (!file.files[0]) return;
        ctx.upload(file.files[0]).then(function (u) { photo.value = u; toast('Photo uploaded'); }, function (e) { toast(errText(e), true); });
      } });
      var act = check('Badge is valid (switch off if it is lost or the person has left)', b.active !== false);
      var box = h('div', { class: 'panel' }, h('h3', { text: b.id ? 'Edit badge' : 'New badge' }),
        field('Full name', name), field('Job title', role), field('Employee ID', no, 'Printed on the badge. Leave empty if you do not use numbers.'),
        field('Photo', photo, 'Optional. Paste an https address or upload a picture.'), h('div', { class: 'field' }, file), act.box,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', text: 'Save', onclick: function () {
            if (!name.value.trim()) return toast('Please enter a name', true);
            var p = photo.value.trim();
            if (p && !/^https:\/\//.test(p)) return toast('The photo address must start with https://', true);
            var d = { name: name.value.trim(), role: role.value.trim() || null, employee_no: no.value.trim() || null, photo_url: p || null, active: act.input.checked };
            var q = b.id ? sb.from('badges').update(d).eq('id', b.id) : sb.from('badges').insert(d);
            q.then(function (r) { if (r.error) return toast(errText(r.error), true); editing = null; toast('Badge saved'); load(); });
          } }),
          h('button', { class: 'btn', text: 'Cancel', onclick: function () { editing = null; draw(); } })));
      return box;
    }

    function draw() {
      var act = rows.filter(function (b) { return b.active; });
      var list = rows.map(function (b) {
        return h('div', { class: 'brow' }, card(b),
          h('div', { class: 'bact' },
            h('button', { class: 'btn', text: 'Copy QR code', onclick: function () { copyQr(b); } }),
            h('button', { class: 'btn', text: 'Download QR', onclick: function () { qrBlob(b).then(function (x) { download(x, fname(b)); }); } }),
            h('button', { class: 'btn', text: 'Copy link', onclick: function () { copyText(linkOf(b), 'Link copied'); } }),
            h('button', { class: 'btn', text: 'Print this badge', onclick: function () { printCards([b]); } }),
            h('button', { class: 'btn', text: 'Edit', onclick: function () { editing = b; draw(); } }),
            h('button', { class: 'btn', text: b.active ? 'Switch off' : 'Switch on', onclick: function () { patch(b, { active: !b.active }, b.active ? 'Badge switched off' : 'Badge switched on'); } }),
            h('button', { class: 'btn', text: 'New link', title: 'Makes a new secret link. The old printed QR code stops working.', onclick: function () {
              if (window.confirm('Make a new QR link for ' + b.name + '? Old printed copies will stop verifying.')) patch(b, { token: newToken() }, 'New link made. Print the badge again.');
            } }),
            h('button', { class: 'btn danger', text: 'Delete', onclick: function () { del(b); } }),
            h('small', { class: 'hint', text: linkOf(b) })));
      });
      root.replaceChildren(
        h('div', { class: 'dashhead' }, h('h2', { text: 'Staff badges' }),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', text: 'New badge', onclick: function () { editing = {}; draw(); } }),
            h('button', { class: 'btn', text: 'Print all (' + act.length + ')', onclick: function () { printCards(act); } }))),
        h('p', { class: 'hint', text: 'Each badge has a secret QR code. Scanning it opens a page on your website that confirms the person works here. Print on credit-card size (85.6 × 54 mm) cards, two per row. Anyone who scans a code sees that person’s name, title, ID and photo, so switch off lost badges.' }),
        editing ? form(editing.id ? editing : null) : h('span'),
        rows.length ? h('div', { class: 'blist' }, list) : h('div', { class: 'empty', text: 'No badges yet. Press New badge.' }));
    }

    if (!window.qrcode) { root.appendChild(h('div', { class: 'msg err', text: 'The QR code library did not load. Reload the page.' })); return root; }
    root.appendChild(h('div', { class: 'empty', text: 'Loading…' })); load();
    return root;
  }
})();
