/* SparkNews editor: the Polls window. Loaded on demand by editor.js. */
(function () {
  'use strict';
  window.SparkPolls = { mount: mount };

  function mount(ctx) {
    var h = ctx.h, field = ctx.field, check = ctx.check, toast = ctx.toast, sb = ctx.sb, errText = ctx.errText;
    var root = h('div', { class: 'dash polls' }), polls = [], counts = {}, editing = null;

    function load() {
      return sb.from('polls').select('*, poll_options(id,label,position)').order('created_at', { ascending: false }).then(function (r) {
        if (r.error) throw r.error;
        polls = r.data || [];
        return Promise.all(polls.map(function (p) {
          return sb.rpc('poll_results', { p_poll: p.id }).then(function (x) { counts[p.id] = x.data; });
        }));
      }).then(draw, function (e) {
        root.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission/i.test(e.message || '') ? 'Polls are not set up yet. Run supabase/polls.sql in the Supabase SQL Editor (see the README).' : errText(e) }));
      });
    }
    function setStatus(p, st) {
      sb.from('polls').update({ status: st }).eq('id', p.id).then(function (r) { if (r.error) return toast(errText(r.error), true); toast(st === 'live' ? 'Poll is live' : st === 'closed' ? 'Poll closed' : 'Poll saved'); load(); });
    }
    function del(p) {
      if (!window.confirm('Delete this poll and all its votes?')) return;
      sb.from('polls').delete().eq('id', p.id).then(function (r) { if (r.error) return toast(errText(r.error), true); toast('Poll deleted'); load(); });
    }
    function iso(v) { return v ? new Date(v).toISOString() : null; }
    function local(v) { if (!v) return ''; var d = new Date(v); d = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }

    function form(p) {
      p = p || { question: '', description: '', display: 'widget', placement: 'home', show_results: 'after_vote', allow_multiple: false, poll_options: [] };
      var q = h('input', { type: 'text', maxlength: '300', value: p.question || '' });
      var d = h('input', { type: 'text', maxlength: '600', value: p.description || '' });
      var opts = h('textarea', { rows: '5', placeholder: 'One answer per line (2 to 8)' });
      opts.value = (p.poll_options || []).slice().sort(function (a, b) { return a.position - b.position; }).map(function (o) { return o.label; }).join('\n');
      var sel = function (items, val) { var s = h('select', {}, items.map(function (i) { return h('option', { value: i[0], text: i[1] }); })); s.value = val; return s; };
      var disp = sel([['widget', 'Card inside the page'], ['banner', 'Full-screen banner']], p.display);
      var where = sel([['home', 'Home page'], ['articles', 'Article pages'], ['all', 'Every page']], p.placement);
      var res = sel([['after_vote', 'After the visitor has voted'], ['always', 'Always visible'], ['after_close', 'Only when the poll is closed']], p.show_results);
      var multi = check('Visitors may pick more than one answer', p.allow_multiple, function () {});
      var s = h('input', { type: 'datetime-local', value: local(p.starts_at) }), e = h('input', { type: 'datetime-local', value: local(p.ends_at) });
      var msg = h('p', { class: 'hint' });
      var locked = p.id && p.status !== 'draft';
      if (locked) opts.disabled = true;
      var save = h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: function () {
        var labels = opts.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        if (q.value.trim().length < 3) { msg.textContent = 'Write the question first.'; return; }
        if (!locked && (labels.length < 2 || labels.length > 8)) { msg.textContent = 'Give 2 to 8 answers, one per line.'; return; }
        var row = { question: q.value.trim(), description: d.value.trim() || null, display: disp.value, placement: where.value, show_results: res.value,
                    allow_multiple: multi.input.checked, starts_at: iso(s.value), ends_at: iso(e.value) };
        save.disabled = true;
        var op = p.id ? sb.from('polls').update(row).eq('id', p.id).select('id') : sb.from('polls').insert(row).select('id');
        op.then(function (r) {
          if (r.error) throw r.error;
          var id = p.id || (r.data && r.data[0] && r.data[0].id);
          if (locked) return;
          return Promise.resolve(p.id ? sb.from('poll_options').delete().eq('poll_id', id) : { error: null }).then(function (x) {
            if (x.error) throw x.error;
            return sb.from('poll_options').insert(labels.map(function (l, i) { return { poll_id: id, label: l, position: i }; }));
          }).then(function (x) { if (x.error) throw x.error; });
        }).then(function () { toast('Poll saved'); editing = null; return load(); }, function (er) { save.disabled = false; msg.textContent = errText(er); });
      } });
      root.replaceChildren(h('div', { class: 'dashhead' }, h('h2', { text: p.id ? 'Edit poll' : 'New poll' })),
        h('section', { class: 'panel' }, field('Question', q), field('Short explanation (optional)', d),
          field('Answers', opts, locked ? 'Answers cannot change once a poll has started, so the votes stay meaningful.' : null),
          h('div', { class: 'row2' }, field('Shown as', disp), field('Where', where)),
          field('Results', res), multi.box,
          h('div', { class: 'row2' }, field('Start (optional)', s), field('End (optional)', e)),
          msg, h('div', { class: 'btnrow' }, save, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { editing = null; draw(); } }))));
    }

    function draw() {
      if (editing) return form(editing === true ? null : editing);
      var list = polls.map(function (p) {
        var c = counts[p.id], opts = (p.poll_options || []).slice().sort(function (a, b) { return a.position - b.position; });
        var bars = c ? opts.map(function (o) {
          var n = (c.options && c.options[o.id]) || 0, pc = c.total ? Math.round(n * 100 / c.total) : 0;
          return h('div', { class: 'pres' }, h('div', { class: 'plabel' }, h('span', { text: o.label }), h('b', { text: n + ' (' + pc + '%)' })), h('div', { class: 'pbar' }, h('i', { style: 'width:' + pc + '%' })));
        }) : [];
        return h('section', { class: 'panel pollrow', 'data-id': p.id },
          h('h3', {}, p.question, ' ', h('small', { class: 'badge ' + p.status, text: p.status })),
          h('p', { class: 'hint', text: (p.display === 'banner' ? 'Full-screen banner' : 'Card') + ' on ' + (p.placement === 'all' ? 'every page' : p.placement === 'home' ? 'the home page' : 'article pages') + ' · ' + (c ? c.total : 0) + ' voters' }),
          bars,
          h('div', { class: 'btnrow' },
            p.status !== 'live' ? h('button', { class: 'btn primary', type: 'button', text: p.status === 'closed' ? 'Reopen' : 'Go live', onclick: function () { setStatus(p, 'live'); } }) : null,
            p.status === 'live' ? h('button', { class: 'btn', type: 'button', text: 'Close poll', onclick: function () { setStatus(p, 'closed'); } }) : null,
            h('button', { class: 'btn', type: 'button', text: 'Edit', onclick: function () { editing = p; draw(); } }),
            h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: function () { del(p); } })));
      });
      root.replaceChildren(h('div', { class: 'dashhead' }, h('h2', { text: 'Polls' }), h('span', { class: 'sp' }),
        h('button', { class: 'btn primary', type: 'button', text: 'New poll', onclick: function () { editing = true; draw(); } })),
        polls.length ? h('div', {}, list) : h('div', { class: 'empty', text: 'No polls yet. Make one and press Go live: it appears on the website at once, no update needed.' }));
    }
    load();
    return root;
  }
})();
