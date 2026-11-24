/* SparkNews editor: Settings panels for the About page, official languages and the Portfolio page. Loaded on demand by editor.js. */
(function () {
  'use strict';
  window.SparkPages = { panels: panels };

  function panels(ctx) {
    var h = ctx.h, field = ctx.field, check = ctx.check, V = ctx.V, mark = ctx.mark;

    function input(obj, key, o) {
      o = o || {};
      var i = h(o.area ? 'textarea' : 'input', { type: o.type || 'text', maxlength: String(o.max || 200), placeholder: o.ph || '', 'aria-label': o.label || key });
      if (o.area) i.rows = o.rows || 4;
      i.value = obj[key] == null ? '' : obj[key];
      i.addEventListener('input', function () { obj[key] = o.type === 'number' ? (i.value === '' ? 0 : Number(i.value)) : i.value; mark(); });
      return i;
    }

    /* a list of small forms with move / remove buttons */
    function repeater(list, rowFn, blank, addText, max) {
      var box = h('div', { class: 'rep' });
      function draw() {
        box.replaceChildren.apply(box, list.map(function (item, i) {
          return h('div', { class: 'reprow' }, h('div', { class: 'repbody' }, rowFn(item)),
            h('div', { class: 'repbtn' },
              h('button', { class: 'btn', type: 'button', text: '▲', title: 'Move up', disabled: i === 0, onclick: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); mark(); draw(); } }),
              h('button', { class: 'btn', type: 'button', text: '▼', title: 'Move down', disabled: i === list.length - 1, onclick: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); mark(); draw(); } }),
              h('button', { class: 'btn', type: 'button', text: 'Remove', onclick: function () { list.splice(i, 1); mark(); draw(); } })));
        }));
        if (list.length < (max || 20)) box.appendChild(h('button', { class: 'btn', type: 'button', text: addText, onclick: function () { list.push(JSON.parse(JSON.stringify(blank))); mark(); draw(); } }));
      }
      draw(); return box;
    }

    /* ---------------- About */
    var A = V.about_page = V.about_page || { lead: '', body: '', image: '' };
    var about = h('section', { class: 'panel' }, h('h3', { text: 'About page' }),
      h('p', { class: 'hint', text: 'Write your own About page. Leave the big text box empty to keep the standard text. The page is also translated automatically for visitors in other languages.' }),
      field('Headline under the title', input(A, 'lead', { max: 300, ph: 'Independent Journalism. Real Opportunities.' })),
      field('Picture (https address, optional)', input(A, 'image', { max: 400, ph: 'https://…' })),
      field('Text', input(A, 'body', { area: true, rows: 14, max: 12000, ph: 'Write normally. A blank line starts a new paragraph.\n\n## A heading\n\n- a list item\n- another one\n\n**bold**, and a [link](https://example.com)' }),
        'A blank line = new paragraph. "## " at the start of a line = heading. "- " = list. **bold**. [words](https://address) = link.'));

    /* ---------------- Official languages */
    var L = V.official_languages = Array.isArray(V.official_languages) ? V.official_languages : [];
    var langRep = null;
    function langPanel() {
      langRep = repeater(L, function (x) {
        return h('div', { class: 'row2' }, field('Language', input(x, 'name', { max: 40, ph: 'German' })), field('Written in that language (optional)', input(x, 'native', { max: 40, ph: 'Deutsch' })));
      }, { name: '', native: '' }, '+ Add a language', 40);
      var quick = [['English', 'English'], ['German', 'Deutsch'], ['French', 'Français'], ['Spanish', 'Español'], ['Arabic', 'العربية'], ['Chinese', '中文'], ['Russian', 'Русский']];
      var qb = h('div', { class: 'tools' }, quick.map(function (q) {
        return h('button', { class: 'btn', type: 'button', text: '+ ' + q[0], onclick: function () {
          if (L.some(function (x) { return x.name === q[0]; })) return;
          L.push({ name: q[0], native: q[1] }); mark(); var n = langPanel(); sec.replaceWith(n); sec = n; } });
      }));
      return h('section', { class: 'panel' }, h('h3', { text: 'Our official languages' }),
        h('p', { class: 'hint', text: 'The languages your organisation officially works in. They are shown on the About page and, as a moving band, on the Portfolio page.' }), qb, langRep);
    }
    var sec = langPanel();

    /* ---------------- Portfolio */
    var P = V.portfolio = V.portfolio || {};
    ['stats', 'highlights', 'milestones'].forEach(function (k) { if (!Array.isArray(P[k])) P[k] = []; });
    var en = check('Show the Portfolio page on the website (adds a link in the footer)', !!P.enabled, function () { P.enabled = en.input.checked; mark(); });
    var srcSel = [['fixed', 'A number I type'], ['articles', 'Articles published (automatic)'], ['sections', 'Sections (automatic)'], ['series', 'Series (automatic)'], ['languages', 'Official languages (automatic)'], ['archive', 'Public archive items (automatic)']];
    var portfolio = h('section', { class: 'panel' }, h('h3', { text: 'Portfolio page' }),
      h('p', { class: 'hint', text: 'A bold showcase page with animated numbers. Everything on it is editable here; the website updates after you save.' }), en.box,
      field('Title', input(P, 'title', { max: 100, ph: 'Our portfolio' })), field('Short line under the title', input(P, 'tagline', { max: 200, ph: 'What we do, in one sentence' })),
      field('Introduction', input(P, 'intro', { area: true, rows: 5, max: 4000 }), 'Same writing rules as the About page text.'),
      h('h4', { text: 'Numbers (they count up when someone scrolls to them)' }),
      repeater(P.stats, function (x) {
        var sel = h('select', { 'aria-label': 'Where the number comes from', onchange: function () { x.source = sel.value; mark(); } }, srcSel.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
        sel.value = x.source || 'fixed';
        return h('div', {}, h('div', { class: 'row2' }, field('Label', input(x, 'label', { max: 60, ph: 'Stories published' })), field('Number from', sel)),
          h('div', { class: 'row3' }, field('Number (if typed)', input(x, 'value', { type: 'number', max: 12 })), field('Before it (e.g. €)', input(x, 'prefix', { max: 6 })), field('After it (e.g. + or %)', input(x, 'suffix', { max: 8, ph: '+' }))));
      }, { source: 'fixed', value: 0, prefix: '', suffix: '+', label: '' }, '+ Add a number', 8),
      h('h4', { text: 'Highlights (cards)' }),
      repeater(P.highlights, function (x) {
        return h('div', {}, field('Title', input(x, 'title', { max: 100 })), field('Text', input(x, 'text', { max: 400 })),
          h('div', { class: 'row2' }, field('Picture (https address)', input(x, 'image', { max: 400, ph: 'https://…' })), field('Link (optional)', input(x, 'link', { max: 400, ph: 'https://…' }))));
      }, { title: '', text: '', image: '', link: '' }, '+ Add a card', 12),
      h('h4', { text: 'Milestones (timeline)' }),
      repeater(P.milestones, function (x) {
        return h('div', { class: 'row2' }, field('Year or date', input(x, 'year', { max: 12, ph: '2024' })), field('What happened', input(x, 'text', { max: 240 })));
      }, { year: '', text: '' }, '+ Add a milestone', 16),
      h('h4', { text: 'Button at the bottom (optional)' }),
      h('div', { class: 'row2' }, field('Button text', input(P, 'cta_text', { max: 40, ph: 'Get in touch' })), field('Button address', input(P, 'cta_link', { max: 400, ph: 'https://… or /newsletter/' }))));

    return [about, sec, portfolio];
  }
})();
