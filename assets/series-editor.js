/* SparkNews editor: the Series window (playlists of articles). Loaded on demand by editor.js. */
(function () {
  'use strict';
  window.SparkSeries = { mount: mount };

  function slugify(t) { return String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }

  function mount(ctx) {
    var h = ctx.h, field = ctx.field, toast = ctx.toast, sb = ctx.sb, errText = ctx.errText;
    var root = h('div', { class: 'dash series' }), series = [], arts = [], sel = null;

    function load() {
      return Promise.all([
        sb.from('article_series').select('*').order('position').order('created_at'),
        sb.from('articles').select('id,title,status,series_id,series_order,published_at,created_at').order('created_at', { ascending: false }).limit(1000)
      ]).then(function (r) {
        if (r[0].error) throw r[0].error;
        series = r[0].data || []; arts = (r[1].data || []);
        if (sel && !series.some(function (s) { return s.slug === sel; })) sel = null;
        draw();
      }, fail).catch(fail);
    }
    function fail(e) {
      root.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission/i.test((e && e.message) || '') ? 'Series are not set up yet. Run supabase/series.sql in the Supabase SQL Editor once, then reload.' : errText(e) }));
    }
    function members(slug) {
      return arts.filter(function (a) { return a.series_id === slug; }).sort(function (a, b) {
        return (a.series_order == null ? 1e6 : a.series_order) - (b.series_order == null ? 1e6 : b.series_order);
      });
    }
    function saveOrder(slug, list) {
      return Promise.all(list.map(function (a, i) { a.series_order = i + 1; return sb.from('articles').update({ series_order: i + 1 }).eq('id', a.id); }))
        .then(function (rs) { var bad = rs.filter(function (x) { return x.error; })[0]; if (bad) throw bad.error; });
    }

    function newForm() {
      var t = h('input', { type: 'text', maxlength: '120', placeholder: 'For example: The Wagrain trip, day by day' });
      var d = h('input', { type: 'text', maxlength: '600', placeholder: 'One or two sentences about the series (optional)' });
      var msg = h('p', { class: 'hint' });
      return h('div', { class: 'panel' }, h('h3', { text: 'New series' }), field('Title', t), field('Description', d), msg,
        h('button', { class: 'btn primary', type: 'button', text: 'Create series', onclick: function () {
          var title = t.value.trim(), slug = slugify(title);
          if (title.length < 2 || slug.length < 2) { msg.textContent = 'Give the series a title first.'; return; }
          if (series.some(function (s) { return s.slug === slug; })) { msg.textContent = 'A series with this name exists already.'; return; }
          sb.from('article_series').insert({ slug: slug, title: title, description: d.value.trim() || null, position: series.length + 1 }).then(function (r) {
            if (r.error) return toast(errText(r.error), true);
            sel = slug; toast('Series created'); load();
          });
        } }));
    }

    function detail(s) {
      var t = h('input', { type: 'text', maxlength: '120', value: s.title }), d = h('input', { type: 'text', maxlength: '600', value: s.description || '' });
      var list = members(s.slug);
      var ul = h('ol', { class: 'splist' });
      function paintList() {
        ul.replaceChildren.apply(ul, list.map(function (a, i) {
          return h('li', {},
            h('span', { class: 'sn', text: String(i + 1) }),
            h('span', { class: 'stt', text: a.title + (a.status && a.status !== 'published' ? '  (' + a.status + ')' : '') }),
            h('button', { class: 'btn', type: 'button', text: '▲', title: 'Move up', disabled: i === 0, onclick: function () { move(i, -1); } }),
            h('button', { class: 'btn', type: 'button', text: '▼', title: 'Move down', disabled: i === list.length - 1, onclick: function () { move(i, 1); } }),
            h('button', { class: 'btn', type: 'button', text: 'Remove', onclick: function () { remove(i); } }));
        }));
        if (!list.length) ul.appendChild(h('li', { class: 'hint', text: 'No articles yet. Add the first one below.' }));
      }
      function move(i, dir) {
        var j = i + dir; if (j < 0 || j >= list.length) return;
        var x = list[i]; list[i] = list[j]; list[j] = x; paintList();
        saveOrder(s.slug, list).then(function () { toast('Order saved'); }, function (e) { toast(errText(e), true); });
      }
      function remove(i) {
        var a = list[i];
        sb.from('articles').update({ series_id: null, series_order: null }).eq('id', a.id).then(function (r) {
          if (r.error) return toast(errText(r.error), true);
          a.series_id = null; a.series_order = null; list.splice(i, 1); paintList(); saveOrder(s.slug, list);
        });
      }
      var free = arts.filter(function (a) { return !a.series_id; });
      var pick = h('select', {}, [h('option', { value: '', text: 'Choose an article to add…' })].concat(free.map(function (a) { return h('option', { value: a.id, text: a.title }); })));
      var add = h('button', { class: 'btn', type: 'button', text: '+ Add to series', onclick: function () {
        var a = free.filter(function (x) { return String(x.id) === pick.value; })[0]; if (!a) return;
        sb.from('articles').update({ series_id: s.slug, series_order: list.length + 1 }).eq('id', a.id).then(function (r) {
          if (r.error) return toast(errText(r.error), true);
          toast('Added'); load();
        });
      } });
      paintList();
      return h('div', { class: 'panel' }, h('h3', { text: s.title }),
        h('p', { class: 'hint', text: 'Address of this series on the website: /series/' + s.slug + '.html' }),
        field('Title', t), field('Description', d),
        h('div', { class: 'tools' },
          h('button', { class: 'btn primary', type: 'button', text: 'Save details', onclick: function () {
            sb.from('article_series').update({ title: t.value.trim() || s.title, description: d.value.trim() || null }).eq('slug', s.slug).then(function (r) {
              if (r.error) return toast(errText(r.error), true); toast('Saved. It shows on the site after the next rebuild.'); load();
            });
          } }),
          h('button', { class: 'btn danger', type: 'button', text: 'Delete series', onclick: function () {
            if (!window.confirm('Delete this series? The articles stay, they just leave the series.')) return;
            sb.from('articles').update({ series_id: null, series_order: null }).eq('series_id', s.slug).then(function () {
              sb.from('article_series').delete().eq('slug', s.slug).then(function (r) { if (r.error) return toast(errText(r.error), true); sel = null; toast('Series deleted'); load(); });
            });
          } })),
        h('h4', { text: 'Playlist (reading order)' }), ul, h('div', { class: 'tools' }, pick, add));
    }

    function draw() {
      var side = h('div', { class: 'panel' }, h('h3', { text: 'Series' }),
        h('button', { class: 'btn primary', type: 'button', text: '+ New series', onclick: function () { sel = '__new'; draw(); } }),
        h('ul', { class: 'splist' }, series.map(function (s, i) {
          return h('li', { class: sel === s.slug ? 'on' : '' },
            h('button', { class: 'lnk', type: 'button', text: s.title + '  (' + members(s.slug).length + ')', onclick: function () { sel = s.slug; draw(); } }),
            h('button', { class: 'btn', type: 'button', text: '▲', title: 'Show earlier on the website', disabled: i === 0, onclick: function () { swap(i, -1); } }),
            h('button', { class: 'btn', type: 'button', text: '▼', title: 'Show later on the website', disabled: i === series.length - 1, onclick: function () { swap(i, 1); } }));
        })), series.length ? null : h('p', { class: 'hint', text: 'No series yet. A series is a playlist: articles that belong together and are read in order.' }));
      var known = {}; series.forEach(function (x) { known[x.slug] = 1; });
      var orphans = {}; arts.forEach(function (x) { if (x.series_id && !known[x.series_id]) orphans[x.series_id] = (orphans[x.series_id] || 0) + 1; });
      var ok = Object.keys(orphans);
      if (ok.length) side.appendChild(h('div', {}, h('h4', { text: 'Older series without a name' }),
        h('p', { class: 'hint', text: 'These groups already exist on articles. Give each a title to manage it here.' }),
        h('ul', { class: 'splist' }, ok.map(function (sl) {
          return h('li', {}, h('span', { class: 'stt', text: sl.slice(0, 14) + ' (' + orphans[sl] + ' articles)' }),
            h('button', { class: 'btn', type: 'button', text: 'Name it', onclick: function () {
              var t = window.prompt('Title for this series:'); if (!t || t.trim().length < 2) return;
              sb.from('article_series').insert({ slug: sl, title: t.trim(), position: series.length + 1 }).then(function (r) { if (r.error) return toast(errText(r.error), true); sel = sl; load(); });
            } }));
        }))));
      var main = sel === '__new' || !sel ? newForm() : detail(series.filter(function (s) { return s.slug === sel; })[0] || {});
      root.replaceChildren(h('div', { class: 'cols2' }, side, main));
    }
    function swap(i, dir) {
      var j = i + dir, a = series[i], b = series[j]; if (!b) return;
      Promise.all([sb.from('article_series').update({ position: j + 1 }).eq('slug', a.slug), sb.from('article_series').update({ position: i + 1 }).eq('slug', b.slug)]).then(load);
    }
    root.appendChild(h('div', { class: 'empty', text: 'Loading…' }));
    load();
    return root;
  }
})();
