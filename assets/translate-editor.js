/* SparkNews editor: "Translate all site text" and "Translate all articles" (Settings). Loaded on demand by editor.js.
   Site text is stored in the settings as site_i18n = { "English text": [ar, zh, fr, ru, es, de] } and the website uses it for any exact match.
   Articles keep their translations in the article itself (articles.translations), one entry per language. */
(function () {
  'use strict';
  var LANGS = ['ar', 'zh', 'fr', 'ru', 'es', 'de'];
  var NAMES = { ar: 'Arabic', zh: 'Chinese', fr: 'French', ru: 'Russian', es: 'Spanish', de: 'German' };
  var SKIPKEY = /(^|_)(url|link|slug|color|colour|accent|key|hash|salt|iter|email|password|id|base|logo|image|theme|language|position|mode|source|icon|enabled|ui|def|count|max|min|order|ids|channel|tab|embed|main|protect|domain|address_url)$/i;
  var ROOTKEYS = ['tagline', 'footer_text', 'announcements', 'about_page', 'portfolio', 'newsletter', 'ticker', 'live', 'maintenance', 'privacy', 'impressum', 'polls', 'official_languages', 'seo'];

  function wanted(s) {
    s = String(s || '').trim();
    return s.length >= 3 && s.length <= 300 && /[A-Za-z]{2}/.test(s) && !/^(https?:|mailto:|#|\/|\.\.?\/)/i.test(s) && !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s) && !/^[#0-9a-f]{3,8}$/i.test(s);
  }
  function collect(V, extra) {
    var out = [], seen = {};
    function add(s) { s = String(s || '').trim(); if (wanted(s) && !seen[s]) { seen[s] = 1; out.push(s); } }
    function walk(v, key, depth) {
      if (depth > 6 || v == null) return;
      if (typeof v === 'string') { if (!SKIPKEY.test(key || '')) add(v); }
      else if (Array.isArray(v)) v.forEach(function (x) { walk(x, key, depth + 1); });
      else if (typeof v === 'object') Object.keys(v).forEach(function (k) { if (k !== 'site_i18n') walk(v[k], k, depth + 1); });
    }
    ROOTKEYS.forEach(function (k) { walk(V[k], k, 0); });
    (extra || []).forEach(add);
    return out;
  }

  function panel(ctx) {
    var h = ctx.h, V = ctx.V, sb = ctx.sb, toast = ctx.toast;
    var stop = false, busy = false;
    var bar = h('progress', { max: 1, value: 0, style: 'width:100%;display:none;height:10px' });
    var log = h('p', { class: 'hint', text: '' });
    var keep = h('input', { type: 'text', placeholder: 'Names to keep as they are, separated by commas (people, places, brands)', 'aria-label': 'Names to keep untranslated' });
    var redo = h('input', { type: 'checkbox' });
    var redoLab = h('label', { class: 'check' }, redo, 'Translate again even where a translation already exists');
    var stopBtn = h('button', { class: 'btn danger', type: 'button', text: 'Stop', style: 'display:none', onclick: function () { stop = true; stopBtn.disabled = true; log.textContent = 'Stopping after the current item…'; } });

    function begin() {
      if (busy) return false;
      busy = true; stop = false; stopBtn.disabled = false; stopBtn.style.display = ''; bar.style.display = ''; bar.value = 0;
      allSite.disabled = allArt.disabled = true;
      if (ctx.setNote) ctx.setNote(function (m) { log.className = 'hint'; log.textContent = m; });
      ctx.setProtect(String(keep.value || '').split(/[,\n]/).map(function (x) { return x.trim(); }).filter(Boolean).concat([(ctx.cfg.site || {}).site_name].filter(function (x) { return x && x.length > 2; })));
      return true;
    }
    function end() { busy = false; stopBtn.style.display = 'none'; allSite.disabled = allArt.disabled = false; }

    /* ---- site text ---- */
    var allSite = h('button', { class: 'btn primary', type: 'button', text: 'Translate all site text', onclick: function () {
      if (!begin()) return;
      var table = V.site_i18n = (V.site_i18n && typeof V.site_i18n === 'object' && !Array.isArray(V.site_i18n)) ? V.site_i18n : {};
      var strings = collect(V, ctx.categories());
      var jobs = [];
      strings.forEach(function (s) { LANGS.forEach(function (l, i) { if (redo.checked || !table[s] || !table[s][i]) jobs.push([s, i]); }); });
      if (!jobs.length) { log.textContent = 'Everything (' + strings.length + ' texts) is already translated.'; end(); return; }
      var done = 0, fail = 0, lastErr = '';
      bar.max = jobs.length;
      jobs.reduce(function (p, j) {
        return p.then(function () {
          if (stop) return;
          return ctx.mmText(j[0], 'en', LANGS[j[1]]).then(function (t) {
            var row = table[j[0]] = (Array.isArray(table[j[0]]) ? table[j[0]] : ['', '', '', '', '', '']);
            row[j[1]] = t; ctx.mark();
          }, function (e) { fail++; lastErr = (e && e.message) || String(e); if (fail > 8) { stop = true; } })
            .then(function () { done++; bar.value = done; log.textContent = 'Translating site text… ' + done + ' of ' + jobs.length; });
        });
      }, Promise.resolve()).then(function () {
        end();
        var n = Object.keys(table).length;
        log.className = fail ? 'hint err' : 'hint ok';
        log.textContent = (stop ? 'Stopped. ' : 'Done. ') + n + ' texts in ' + LANGS.length + ' languages' + (fail ? ' (' + fail + ' failed: ' + lastErr + ')' : '') + '.';
        if (ctx.saveSettings) { ctx.saveSettings(); }
        else toast('Press "Save settings" to keep the translations.');
      });
    } });

    /* ---- articles ---- */
    var allArt = h('button', { class: 'btn primary', type: 'button', text: 'Translate all articles', onclick: function () {
      if (!begin()) return;
      var src = String((ctx.cfg.site || {}).language || 'en').slice(0, 2).toLowerCase();
      sb.from('articles').select('id,title,subtitle,content,translations').order('updated_at', { ascending: false }).limit(2000).then(function (r) {
        if (r.error) throw r.error;
        var arts = (r.data || []).filter(function (a) { return a.title || a.content; });
        var jobs = [];
        arts.forEach(function (a) {
          var tr = (a.translations && typeof a.translations === 'object') ? a.translations : {};
          LANGS.forEach(function (l) { if (l === src) return; var x = tr[l]; if (redo.checked || !x || !x.title || !x.content) jobs.push({ a: a, l: l }); });
        });
        if (!jobs.length) { log.textContent = 'All ' + arts.length + ' articles are already translated.'; end(); return; }
        if (jobs.length > 12 && !confirm('This will translate ' + jobs.length + ' article versions (' + arts.length + ' articles). It can take a while: keep this tab open. Continue?')) { end(); log.textContent = ''; return; }
        var done = 0, fail = 0, lastErr = '';
        bar.max = jobs.length;
        return jobs.reduce(function (p, j) {
          return p.then(function () {
            if (stop) return;
            var a = j.a, tr = a.translations = (a.translations && typeof a.translations === 'object') ? a.translations : {};
            log.textContent = 'Translating “' + (a.title || '').slice(0, 50) + '” into ' + NAMES[j.l] + '… (' + (done + 1) + ' of ' + jobs.length + ')';
            return ctx.mmText(a.title || '', src, j.l).then(function (t) {
              return ctx.mmText(a.subtitle || '', src, j.l).then(function (s) {
                return ctx.mmHtml(a.content || '', src, j.l).then(function (c) {
                  tr[j.l] = { title: t, subtitle: s, content: c };
                  return sb.from('articles').update({ translations: tr, is_ai_translated: true }).eq('id', a.id).then(function (u) { if (u.error) throw u.error; });
                });
              });
            }).catch(function (e) { fail++; lastErr = (e && e.message) || String(e); if (fail > 5) stop = true; })
              .then(function () { done++; bar.value = done; });
          });
        }, Promise.resolve()).then(function () {
          end();
          log.className = fail ? 'hint err' : 'hint ok';
          log.textContent = (stop ? 'Stopped. ' : 'Done. ') + (done - fail) + ' translations saved' + (fail ? ', ' + fail + ' failed (' + lastErr + '). Press the button again to continue where it stopped' : '') + '. They are marked "made automatically": please have someone read them. Press "Update website" to publish them.';
        });
      }).catch(function (e) { end(); log.className = 'hint err'; log.textContent = (e && e.message) || String(e); });
    } });

    return h('section', { class: 'panel' }, h('h3', { text: 'Translate everything' }),
      h('p', { class: 'hint', text: 'Free automatic translation into Arabic, Chinese, French, Russian, Spanish and German (the languages visitors can choose). Good enough to read, but please have someone check important texts.' }),
      h('label', { class: 'field' }, h('span', { text: 'Names to keep as they are (optional)' }), keep), redoLab,
      h('div', { class: 'btnrow' }, allSite, allArt, stopBtn),
      h('p', { class: 'hint', text: '“Translate all site text” covers the tagline, footer, announcements, About, Portfolio, newsletter box, ticker text, section names and similar headings, and saves automatically. “Translate all articles” does the headline, standfirst and text of every article; run it again to continue if it stops.' }),
      bar, log);
  }
  window.SparkTranslate = { panel: panel, collect: collect };
})();
