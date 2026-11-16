/* SparkNews visitor polls: a card inside the page, or a full-screen banner. Polls are made in the editor (Polls tab). */
(function () {
  var el = document.getElementById('spark-ticker-data'), cfg = null;
  try { cfg = JSON.parse(el.textContent).polls; } catch (e) {}
  if (!cfg || !cfg.url || !cfg.key) return;
  var main = document.getElementById('main');
  var page = (main && main.getAttribute('data-page')) || 'other';

  function store(k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem(k); return s ? JSON.parse(s) : null; }
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function voter() {
    var v = store('spark-voter');
    if (typeof v === 'string' && v.length >= 16) return v;
    var a = '';
    try { var u = new Uint8Array(16); crypto.getRandomValues(u); for (var i = 0; i < u.length; i++) a += ('0' + u[i].toString(16)).slice(-2); }
    catch (e) { for (var j = 0; j < 32; j++) a += Math.floor(Math.random() * 16).toString(16); }
    store('spark-voter', a);
    return a;
  }
  function rpc(name, body) {
    return fetch(cfg.url + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!r.ok) { var err = new Error((j && (j.message || j.error)) || 'Request failed'); throw err; }
        return j;
      });
    });
  }
  function h(tag, attrs) {
    var n = document.createElement(tag), i, c;
    for (var k in (attrs || {})) { if (k === 'text') n.textContent = attrs[k]; else if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
    for (i = 2; i < arguments.length; i++) { c = arguments[i]; if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return n;
  }

  function votedFor(id) { var v = store('spark-votes'); return v && v[id] ? v[id] : null; }
  function markVoted(id, opts) { var v = store('spark-votes') || {}; v[id] = opts; store('spark-votes', v); }

  /* the body of a poll: the question, then either the answers to pick or the results */
  function build(p, host, onDone) {
    var mine = votedFor(p.id), body = h('div', { class: 'pbody' });
    function results(res, note) {
      body.replaceChildren();
      if (!res) { body.appendChild(h('p', { class: 'pthanks', text: note || 'Thank you for voting. The results will be shown once the poll closes.' })); return; }
      var total = res.total || 0;
      p.options.forEach(function (o) {
        var n = (res.options && res.options[o.id]) || 0, pct = total ? Math.round(n * 100 / total) : 0;
        var row = h('div', { class: 'pres' + (mine && mine.indexOf(o.id) >= 0 ? ' mine' : '') },
          h('div', { class: 'plabel' }, h('span', { text: o.label }), h('b', { text: pct + '%' })),
          h('div', { class: 'pbar', role: 'img', 'aria-label': o.label + ' ' + pct + ' percent' }, h('i', { style: 'width:' + pct + '%' })));
        body.appendChild(row);
      });
      body.appendChild(h('p', { class: 'pmeta', text: total + (total === 1 ? ' vote' : ' votes') }));
    }
    function showResults(note) {
      body.replaceChildren(h('p', { class: 'pmeta', text: 'Loading results…' }));
      rpc('poll_results', { p_poll: p.id, p_voter: voter() }).then(function (r) { results(r, note); }, function () { results(null, 'Thank you for voting.'); });
    }
    function form() {
      var multi = !!p.multiple, msg = h('p', { class: 'pmsg', role: 'status' });
      var f = h('form', { class: 'pform', novalidate: '' });
      p.options.forEach(function (o, i) {
        f.appendChild(h('label', { class: 'popt' }, h('input', { type: multi ? 'checkbox' : 'radio', name: 'o-' + p.id, value: o.id }), h('span', { text: o.label })));
      });
      var btn = h('button', { type: 'submit', class: 'pgo', text: 'Vote' });
      f.appendChild(h('div', { class: 'prow' }, btn, h('button', { type: 'button', class: 'pskip', text: 'Show results' })));
      f.appendChild(msg);
      f.querySelector('.pskip').addEventListener('click', function () {
        rpc('poll_results', { p_poll: p.id, p_voter: voter() }).then(function (r) {
          if (r) results(r); else { msg.textContent = 'Results are shown after you vote.'; }
        }, function () { msg.textContent = 'Could not load the results.'; });
      });
      if (multi) f.insertBefore(h('p', { class: 'pmeta', text: 'Pick all that apply.' }), f.firstChild);
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var picked = [].map.call(f.querySelectorAll('input:checked'), function (i) { return i.value; });
        if (!picked.length) { msg.textContent = 'Pick an answer first.'; return; }
        btn.disabled = true; msg.textContent = '';
        rpc('poll_vote', { p_poll: p.id, p_options: picked, p_voter: voter() }).then(function () {
          mine = picked; markVoted(p.id, picked); showResults();
        }, function (err) {
          btn.disabled = false;
          if (/already voted/i.test(err.message)) { mine = mine || []; markVoted(p.id, mine); showResults(); return; }
          msg.textContent = /not open/i.test(err.message) ? 'This poll has just closed.' : 'Sorry, your vote could not be saved. Please try again.';
        });
      });
      body.replaceChildren(f);
    }
    host.appendChild(h('h2', { class: 'pq', id: 'pq-' + p.id, text: p.question }));
    if (p.description) host.appendChild(h('p', { class: 'pdesc', text: p.description }));
    host.appendChild(body);
    if (mine) showResults(); else form();
    if (onDone) onDone();
  }

  function widget(p) {
    var box = h('section', { class: 'pollcard', 'aria-labelledby': 'pq-' + p.id, 'data-poll': p.id }, h('span', { class: 'ptag', text: 'Poll' }));
    build(p, box);
    var wrap = h('div', { class: 'wrap pollwrap' }, box);
    if (page === 'article') main.appendChild(wrap); else main.insertBefore(wrap, main.firstChild);
  }

  function banner(p) {
    var seen = store('spark-poll-seen') || {};
    if (seen[p.id] || votedFor(p.id)) return;
    var prev = document.activeElement;
    var card = h('section', { class: 'pollcard', 'aria-labelledby': 'pq-' + p.id }, h('span', { class: 'ptag', text: 'Poll' }));
    var shade = h('div', { class: 'pollshade', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pq-' + p.id }, card);
    function close() {
      seen[p.id] = Date.now(); store('spark-poll-seen', seen);
      document.removeEventListener('keydown', key); shade.remove(); document.body.classList.remove('poll-open');
      if (prev && prev.focus) try { prev.focus(); } catch (e) {}
    }
    function key(e) { if (e.key === 'Escape') close(); }
    var x = h('button', { type: 'button', class: 'pclose', 'aria-label': 'Close poll', text: '×' });
    x.addEventListener('click', close);
    card.appendChild(x);
    build(p, card);
    card.appendChild(h('p', { class: 'pnot' }, (function () { var b = h('button', { type: 'button', class: 'pskip', text: 'No thanks' }); b.addEventListener('click', close); return b; })()));
    shade.addEventListener('click', function (e) { if (e.target === shade) close(); });
    document.addEventListener('keydown', key);
    document.body.appendChild(shade); document.body.classList.add('poll-open');
    var first = card.querySelector('input,button'); if (first) first.focus();
  }

  function fits(p) { return p.placement === 'all' || (p.placement === 'home' && page === 'home') || (p.placement === 'articles' && page === 'article'); }

  rpc('polls_active').then(function (list) {
    if (!Array.isArray(list) || !main) return;
    list = list.filter(function (p) { return p && p.options && p.options.length > 1 && fits(p); });
    var w = list.filter(function (p) { return p.display === 'widget'; })[0];
    var b = list.filter(function (p) { return p.display === 'banner'; })[0];
    if (w) widget(w);
    if (b) setTimeout(function () { banner(b); }, 1200);
  }, function () { /* polls are optional: stay silent if the database is unreachable */ });
})();
