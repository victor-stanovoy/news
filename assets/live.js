/* SparkNews Live page: shows what is on air and plays it with LiveKit. Anyone may watch; no login. */
(function () {
  var conf = {};
  try { conf = JSON.parse(document.getElementById('spark-live-config').textContent); } catch (e) {}
  var base = (conf.url || '').replace(/\/+$/, '');
  var KINDS = ['tv', 'radio'], rooms = {}, rows = {}, lkLoading = null, retry = {}, timers = {};
  var types = { tv: 'tv', radio: 'radio' }, names = {}, topics = {}, descs = {}, sched = {}, spl = {}, skew = 0;
  var grid = document.querySelector('.livegrid');

  var vol = 80, muted = false;
  try { var sv = localStorage.getItem('spark_live_vol'); if (sv !== null && !isNaN(+sv)) vol = Math.max(0, Math.min(100, +sv)); muted = localStorage.getItem('spark_live_muted') === '1'; } catch (e) {}
  function remember() { try { localStorage.setItem('spark_live_vol', String(vol)); localStorage.setItem('spark_live_muted', muted ? '1' : '0'); } catch (e) {} }

  function loadLiveKit() {
    if (window.LivekitClient) return Promise.resolve();
    if (!lkLoading) lkLoading = new Promise(function (ok, no) {
      var el = document.createElement('script'); el.src = '../assets/vendor/livekit-client.umd.js';
      el.onload = ok; el.onerror = function () { lkLoading = null; no(new Error('Could not load the player')); };
      document.head.appendChild(el);
    });
    return lkLoading;
  }

  function card(kind) { return document.querySelector('.livecard[data-kind="' + kind + '"]'); }
  function q(kind, sel) { return card(kind).querySelector(sel); }
  function setMsg(kind, t) { q(kind, '.lmsg').textContent = t || ''; }
  function applyAudio(kind) { var m = q(kind, '.lmedia'); m.volume = vol / 100; m.muted = muted; var b = q(kind, '.lmute'); b.setAttribute('aria-pressed', muted ? 'true' : 'false'); b.setAttribute('aria-label', muted ? 'Unmute' : 'Mute'); b.textContent = muted || vol === 0 ? '🔇' : '🔊'; q(kind, '.lvol').value = vol; }

  function isRadio(k) { return types[k] === 'radio'; }
  function fmtT(ms) { var d = new Date(ms), t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return new Date().toDateString() === d.toDateString() ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t; }
  function nowItem(k) { var t = Date.now() + skew, a = sched[k] || []; for (var i = 0; i < a.length; i++) if (a[i].s <= t && t < a[i].e) return a[i]; return null; }
  function upNext(k, n) { var t = Date.now() + skew; return (sched[k] || []).filter(function (x) { return x.s > t; }).slice(0, n); }

  function ui(kind) {
    var c = card(kind); if (!c) return;
    var row = rows[kind], live = !!rooms[kind], sp = spl[kind], cur = nowItem(kind), radio = isRadio(kind), btn = q(kind, '.lbtn'), active = live || !!sp;
    var verb = radio ? 'Listen' : 'Watch', label = active ? 'Stop' : (row ? verb + ' live' : verb);
    c.classList.toggle('off', !row && !active && !cur);
    c.classList.toggle('playing', active);
    btn.hidden = !row && !active && !cur;
    btn.classList.toggle('stop', active);
    btn.querySelector('.ic').textContent = active ? '❚❚' : '▶';
    btn.querySelector('.tx').textContent = label;
    btn.setAttribute('aria-label', label);
    ['.lmute', '.lvol', '.lfs'].forEach(function (x) { var e = c.querySelector(x); if (e) e.hidden = !active || !!(sp && sp.yt); });
    var st = q(kind, '.lstate'); st.className = 'lstate ' + (row ? 'on' : (cur ? 'prog' : 'off')); st.textContent = row ? 'On air' : (cur ? 'On now' : 'Off air');
    var tp = c.querySelector('.ltopic'); if (tp) { tp.hidden = !topics[kind]; tp.textContent = topics[kind] || ''; }
    var tt = q(kind, '.ltitle'); tt.textContent = row && row.title ? row.title : (cur ? cur.title : (names[kind] || (radio ? 'Live radio' : 'Live TV')));
    var sub = q(kind, '.lsub');
    if (live) sub.textContent = radio ? 'You are listening live.' : 'You are watching live.';
    else if (row) sub.textContent = radio ? 'Live now. Press play to listen.' : 'Live now. Press play to watch.';
    else if (sp) sub.textContent = 'Programme until ' + fmtT(sp.it.e);
    else if (cur) sub.textContent = [cur.topic, 'until ' + fmtT(cur.e)].filter(Boolean).join(' · ');
    else sub.textContent = descs[kind] || (radio ? 'Not broadcasting right now.' : '');
    var np = c.querySelector('.lnow'); if (np) { np.hidden = !(row && row.now_playing); np.textContent = row && row.now_playing ? row.now_playing : ''; }
    var pm = c.querySelector('.pm'); if (pm) pm.textContent = row ? 'Live now. Press "Watch live" to start.' : (cur ? 'On now: ' + cur.title + '. Press Watch to join in.' : 'Nothing is on right now.');
    var ps = c.querySelector('.ps'); if (ps) ps.textContent = row ? 'Live' : (cur ? 'On now' : 'Off air');
    var nx = c.querySelector('.lnext'); if (nx) {
      var list = upNext(kind, 3); nx.hidden = !list.length;
      nx.replaceChildren.apply(nx, [Object.assign(document.createElement('li'), { className: 'lnexth', textContent: 'Up next' })].concat(list.map(function (x) {
        var li = document.createElement('li'), b = document.createElement('b'); b.textContent = fmtT(x.s); li.appendChild(b); li.appendChild(document.createTextNode(' ' + x.title + (x.topic ? ' · ' + x.topic : ''))); return li; })));
    }
    tick();
    var n = KINDS.filter(function (k) { return rows[k]; });
    grid.setAttribute('data-live', KINDS.length > 2 || KINDS.some(function (k) { return k !== 'tv' && k !== 'radio'; }) ? 'multi' : (n.length === 1 ? n[0] : (n.length ? 'both' : 'none')));
    var hh = document.getElementById('lvmoreh'); if (hh) hh.textContent = n.length ? 'More stories' : 'Nothing is live right now. Meanwhile, the latest stories';
  }

  function tick() {
    if (document.hidden) return;
    KINDS.forEach(function (k) {
      var t = q(k, '.ltime'), row = rows[k];
      if (!row || !row.started_at) { t.hidden = true; return; }
      var s = Math.max(0, Math.floor((Date.now() - new Date(row.started_at).getTime()) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      t.hidden = false; t.textContent = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
    });
  }

  /* a YouTube video the presenter plays on air: shown with YouTube's official player over the picture, started at the right second */
  function clearYT(kind) {
    var c = card(kind); if (!c) return;
    c.querySelectorAll('.lyt-live,.lcredit-live').forEach(function (n) { n.remove(); });
  }
  function syncYT(kind) {
    var c = card(kind), row = rows[kind]; if (!c) return;
    var want = rooms[kind] && row && row.yt_id && row.yt_started_at ? row.yt_id + '@' + row.yt_started_at : '';
    var cur = c.querySelector('.lyt-live');
    if (!want) { if (cur) clearYT(kind); return; }
    if (cur && cur.getAttribute('data-k') === want) return;
    clearYT(kind);
    var t0 = Date.parse(row.yt_started_at), now = row.server_now ? Date.parse(row.server_now) : Date.now();
    var off = isFinite(t0) && isFinite(now) ? Math.max(0, Math.floor((now - t0) / 1000)) : 0;
    var f = document.createElement('iframe'); f.className = 'lyt lyt-live'; f.setAttribute('data-k', want); f.title = 'Video shown on air'; f.setAttribute('allowfullscreen', '');
    f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(row.yt_id) + '?autoplay=1&start=' + off + '&rel=0&playsinline=1&modestbranding=1';
    var st = c.querySelector('.stage'); if (st) st.appendChild(f); else c.insertBefore(f, c.querySelector('.ctl'));
    var cr = document.createElement('p'); cr.className = 'vnote lcredit-live'; cr.textContent = 'Video from YouTube. We do not own it: it belongs to its creator and is shown with YouTube\u2019s official embed player, as its terms allow.';
    (st || f).insertAdjacentElement('afterend', cr);
  }

  function stop(kind, keepMsg) {
    clearYT(kind);
    stopSched(kind, true);
    var r = rooms[kind]; delete rooms[kind]; clearTimeout(timers[kind]);
    if (r) { try { r.disconnect(); } catch (e) {} }
    var m = q(kind, '.lmedia'); try { m.pause(); } catch (e) {} m.srcObject = null; m.classList.remove('on');
    if (!keepMsg) setMsg(kind, '');
    ui(kind);
  }

  function play(kind, again) {
    var btn = q(kind, '.lbtn'), media = q(kind, '.lmedia');
    stopSched(kind, true);
    if (rooms[kind]) { retry[kind] = 99; stop(kind); return; }
    if (!again) retry[kind] = 0;
    btn.disabled = true; setMsg(kind, 'Connecting…');
    loadLiveKit().then(function () {
      return fetch(base + '/functions/v1/livekit-token', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: conf.anon_key }, body: JSON.stringify({ kind: kind, mode: 'watch' }) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not connect'); return j; });
    }).then(function (t) {
      var LK = window.LivekitClient, room = new LK.Room();
      rooms[kind] = room;
      room.on(LK.RoomEvent.TrackSubscribed, function (track) { track.attach(media); media.classList.add('on'); applyAudio(kind); setMsg(kind, ''); retry[kind] = 0; });
      room.on(LK.RoomEvent.Reconnecting, function () { setMsg(kind, 'Connection is weak. Reconnecting…'); });
      room.on(LK.RoomEvent.Reconnected, function () { setMsg(kind, ''); });
      room.on(LK.RoomEvent.Disconnected, function () {
        if (rooms[kind] !== room) return;
        stop(kind, true);
        if (rows[kind] && (retry[kind] || 0) < 6) { retry[kind] = (retry[kind] || 0) + 1; setMsg(kind, 'Connection lost. Reconnecting…'); timers[kind] = setTimeout(function () { play(kind, true); }, Math.min(2000 * retry[kind], 10000)); }
        else setMsg(kind, rows[kind] ? 'The connection was lost. Press play to try again.' : 'The broadcast has ended. Thanks for listening.');
      });
      return room.connect(t.url, t.token).then(function () {
        btn.disabled = false; ui(kind); applyAudio(kind); syncYT(kind);
        setMsg(kind, 'Connected. Waiting for sound…');
        return media.play().catch(function () { setMsg(kind, 'Press play on the player if you hear nothing.'); });
      });
    }).catch(function (e) { stop(kind, true); btn.disabled = false; setMsg(kind, e.message || 'Could not connect'); });
  }

  function paint(list) {
    var prev = rows, away = {}; rows = {};
    (list || []).forEach(function (r) {
      if (!r || !types[r.kind]) return;
      var info = r.label && r.label !== conf.embed && conf.labels && conf.labels[r.label];
      if (info) { if (info.main !== 'hide') away[r.kind] = info; return; }      /* a partner's broadcast: not played here */
      rows[r.kind] = r;
    });
    KINDS.forEach(function (k) {
      if (rows[k]) misses[k] = 0;
      else if (prev[k] && rooms[k] && (misses[k] = (misses[k] || 0) + 1) < 12) { rows[k] = prev[k]; }     /* a few empty answers: while the picture is still arriving, keep playing */
      else if (prev[k] && rooms[k]) { misses[k] = 0; stop(k, true); setMsg(k, 'The broadcast has ended. Thanks for listening.'); }
      if (rows[k] && spl[k]) { stopSched(k, true); play(k); }       /* a live broadcast starts: join it */
      ui(k); syncYT(k);
      if (away[k]) {
        var m = q(k, '.lmsg'); m.textContent = 'Live now on ' + away[k].name + '. ';
        var a = document.createElement('a'); a.href = away[k].url.replace('{slug}', '').replace('{id}', ''); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Watch or listen there';
        m.appendChild(a);
      }
    });
  }

  /* A failed or slow status check (network blip, rate limit) must never stop a stream that is playing:
     on error we keep the last known state, and a stream is only ended after two clean checks in a row say it is over. */
  var misses = {};
  function refresh() {
    fetch(base + '/rest/v1/live_now?select=*', { headers: { apikey: conf.anon_key } })
      .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
      .then(function (list) { if (Array.isArray(list)) paint(list); })
      .catch(function () { /* keep playing */ });
  }

  function toggle(k) { if (rooms[k] || spl[k]) { retry[k] = 99; stop(k); } else if (rows[k]) play(k); else startSched(k); }
  function wire(k) {
    var c = card(k);
    c.querySelector('.lbtn').addEventListener('click', function () { toggle(k); });
    c.querySelector('.lmute').addEventListener('click', function () { muted = !muted; remember(); KINDS.forEach(applyAudio); });
    c.querySelector('.lvol').addEventListener('input', function (e) { vol = +e.target.value; muted = vol === 0; remember(); KINDS.forEach(applyAudio); });
    var fs = c.querySelector('.lfs');
    if (fs) fs.addEventListener('click', function () {
      var el = c.querySelector('.stage'), on = document.fullscreenElement || document.webkitFullscreenElement;
      if (on) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (el.requestFullscreen) el.requestFullscreen(); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else { var v = c.querySelector('.lmedia'); if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
    });
    /* keyboard shortcuts while the player has focus: space = play/stop, m = mute, f = full screen */
    c.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'm' || e.key === 'M') { muted = !muted; remember(); KINDS.forEach(applyAudio); }
      else if ((e.key === 'f' || e.key === 'F') && fs && rooms[k]) fs.click();
    });
    applyAudio(k);
  }
  /* ---- scheduled programmes: when nobody is live, a channel plays what the schedule says, in sync for everyone ---- */
  function fileUrl(path) { return base + '/storage/v1/object/public/programs/' + String(path).split('/').map(encodeURIComponent).join('/'); }
  function stopSched(kind, keepMsg) {
    var sp = spl[kind]; if (!sp) return;
    clearTimeout(sp.timer); delete spl[kind];
    var c = card(kind); if (!c) return;
    c.querySelectorAll('.lyt').forEach(function (f) { f.remove(); }); c.querySelectorAll('.lcredit').forEach(function (n) { n.remove(); });
    var st = c.querySelector('.stage'); if (st) st.classList.remove('sched-on');
    var m = c.querySelector('.lmedia'); if (m && !rooms[kind]) { try { m.pause(); } catch (e) {} m.onloadedmetadata = null; m.removeAttribute('src'); try { m.load(); } catch (e) {} m.classList.remove('on'); }
    if (!keepMsg) setMsg(kind, '');
    ui(kind);
  }
  function startSched(kind) {
    var it = nowItem(kind); if (!it) return;
    stopSched(kind, true);
    var c = card(kind), off = Math.max(0, Math.floor((Date.now() + skew - it.s) / 1000)), sp = spl[kind] = { it: it, yt: it.source === 'youtube' };
    if (sp.yt) {
      var f = document.createElement('iframe'); f.className = 'lyt'; f.title = it.title; f.setAttribute('allowfullscreen', '');
      f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
      f.src = 'https://www.youtube-nocookie.com/embed/' + it.yt_id + '?autoplay=1&start=' + off + '&rel=0&modestbranding=1&playsinline=1';
      var st = c.querySelector('.stage'); if (st) { st.appendChild(f); st.classList.add('sched-on'); } else c.insertBefore(f, c.querySelector('.ctl'));
      if (!c.querySelector('.lcredit')) { var cr = document.createElement('p'); cr.className = 'vnote lcredit'; cr.textContent = 'Programme video from YouTube. We do not own it: it belongs to its creator and is shown with YouTube\u2019s official embed player, as its terms allow.'; (st || f).insertAdjacentElement('afterend', cr); }
    } else {
      var m = q(kind, '.lmedia'); m.srcObject = null; m.src = fileUrl(it.path);
      m.onloadedmetadata = function () { if (isFinite(m.duration) && off < m.duration - 2) { try { m.currentTime = off; } catch (e) {} } };
      m.classList.add('on'); applyAudio(kind);
      var pr = m.play(); if (pr && pr.catch) pr.catch(function () { setMsg(kind, 'Press play on the player if you see or hear nothing.'); });
    }
    sp.timer = setTimeout(function () { advance(kind); }, Math.max(1000, it.e - (Date.now() + skew)) + 400);
    setMsg(kind, ''); ui(kind);
  }
  function advance(kind) {
    var sp = spl[kind]; if (!sp) return; clearTimeout(sp.timer);
    if (nowItem(kind)) startSched(kind); else { stopSched(kind, true); setMsg(kind, 'That was the last programme for now. Check back soon.'); }
  }
  function loadSched() {
    fetch(base + '/rest/v1/schedule_public?select=*&order=start_at', { headers: { apikey: conf.anon_key } })
      .then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
        var m = {}; (list || []).forEach(function (x) {
          var s0 = Date.parse(x.start_at), e0 = Date.parse(x.end_at); if (!isFinite(s0) || !isFinite(e0)) return;
          if (x.server_now && isFinite(Date.parse(x.server_now))) skew = Date.parse(x.server_now) - Date.now();
          (m[x.channel] = m[x.channel] || []).push({ s: s0, e: e0, title: x.title, topic: x.topic, source: x.source, yt_id: x.yt_id, path: x.path, media: x.media });
        });
        sched = m; KINDS.forEach(ui);
      }).catch(function () {});
  }

  /* ---- channels: any number of TV and radio channels, each with a name and a topic ---- */
  function buildChannels(list) {
    var ok = list.filter(function (c) { return c && /^[a-z0-9-]{2,31}$/.test(c.slug) && (c.type === 'tv' || c.type === 'radio'); });
    if (!ok.length) return;
    ok.forEach(function (c) { types[c.slug] = c.type; names[c.slug] = c.name; topics[c.slug] = c.topic || ''; descs[c.slug] = c.description || ''; });
    var plain = ok.length === 2 && ok.every(function (c) { return (c.slug === 'tv' || c.slug === 'radio') && !c.topic && !c.description; });
    if (plain) { KINDS.forEach(ui); return; }
    var tp = { tv: document.getElementById('tpl-tv'), radio: document.getElementById('tpl-radio') };
    if (!tp.tv || !tp.radio) return;
    KINDS.forEach(function (k) { stopSched(k, true); stop(k, true); });
    grid.replaceChildren(); KINDS = [];
    ['tv', 'radio'].forEach(function (t) {
      var mine = ok.filter(function (c) { return c.type === t; }); if (!mine.length) return;
      var hd = document.createElement('h2'); hd.className = 'lgroup'; hd.textContent = t === 'tv' ? 'TV channels' : 'Radio channels'; grid.appendChild(hd);
      mine.forEach(function (c) {
        var el = tp[t].content.firstElementChild.cloneNode(true); el.setAttribute('data-kind', c.slug); el.setAttribute('aria-label', c.name);
        grid.appendChild(el); KINDS.push(c.slug);
      });
    });
    KINDS.forEach(function (k) { wire(k); applyAudio(k); ui(k); });
    refresh();
  }
  function loadChannels() {
    fetch(base + '/rest/v1/live_channel_list?select=*&order=position,name', { headers: { apikey: conf.anon_key } })
      .then(function (r) { return r.ok ? r.json() : []; }).then(function (l) { if (Array.isArray(l)) buildChannels(l); }).catch(function () {});
  }

  KINDS.forEach(wire);
  setInterval(tick, 1000);
  refresh(); setInterval(function () { if (!document.hidden) refresh(); }, 10000);
  loadChannels(); loadSched(); setInterval(function () { if (!document.hidden) { loadSched(); } }, 60000);
  setInterval(function () { if (!document.hidden) KINDS.forEach(ui); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { refresh(); loadSched(); } });
})();
