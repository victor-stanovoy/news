/* SparkNews Live page: shows what is on air and plays it with LiveKit. Anyone may watch; no login. */
(function () {
  var conf = {};
  try { conf = JSON.parse(document.getElementById('spark-live-config').textContent); } catch (e) {}
  var base = (conf.url || '').replace(/\/+$/, '');
  var KINDS = ['tv', 'radio'], rooms = {}, rows = {}, lkLoading = null, retry = {}, timers = {};
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

  function ui(kind) {
    var c = card(kind), row = rows[kind], live = !!rooms[kind], btn = q(kind, '.lbtn');
    c.classList.toggle('off', !row && !live);
    c.classList.toggle('playing', live);
    btn.hidden = !row && !live;
    btn.classList.toggle('stop', live);
    btn.querySelector('.ic').textContent = live ? '❚❚' : '▶';
    btn.querySelector('.tx').textContent = live ? 'Stop' : (kind === 'radio' ? 'Listen live' : 'Watch live');
    btn.setAttribute('aria-label', live ? 'Stop' : (kind === 'radio' ? 'Listen live' : 'Watch live'));
    ['.lmute', '.lvol', '.lfs'].forEach(function (s) { var e = c.querySelector(s); if (e) e.hidden = !live; });
    var st = q(kind, '.lstate'); st.className = 'lstate ' + (row ? 'on' : 'off'); st.textContent = row ? 'On air' : 'Off air';
    var tt = q(kind, '.ltitle'); tt.textContent = row && row.title ? row.title : (kind === 'radio' ? 'Live radio' : 'Live TV');
    var sub = q(kind, '.lsub'); sub.textContent = row ? (kind === 'radio' ? 'Live now. Press play to listen.' : 'Live now. Press play to watch.') : (kind === 'radio' ? 'Live radio is not broadcasting right now.' : '');
    if (live) sub.textContent = kind === 'radio' ? 'You are listening live.' : 'You are watching live.';
    var np = c.querySelector('.lnow'); if (np) { np.hidden = !(row && row.now_playing); np.textContent = row && row.now_playing ? row.now_playing : ''; }
    var pm = c.querySelector('.pm'); if (pm) pm.textContent = row ? 'Live now. Press "Watch live" to start.' : 'Live TV is not broadcasting right now.';
    var ps = c.querySelector('.ps'); if (ps) ps.textContent = row ? 'Live' : 'Off air';
    tick();
    var n = KINDS.filter(function (k) { return rows[k]; });
    grid.setAttribute('data-live', n.length === 1 ? n[0] : (n.length ? 'both' : 'none'));
    var h = document.getElementById('lvmoreh'); if (h) h.textContent = n.length ? 'More stories' : 'Nothing is live right now. Meanwhile, the latest stories';
  }

  function tick() {
    KINDS.forEach(function (k) {
      var t = q(k, '.ltime'), row = rows[k];
      if (!row || !row.started_at) { t.hidden = true; return; }
      var s = Math.max(0, Math.floor((Date.now() - new Date(row.started_at).getTime()) / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
      t.hidden = false; t.textContent = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
    });
  }

  function stop(kind, keepMsg) {
    var r = rooms[kind]; delete rooms[kind]; clearTimeout(timers[kind]);
    if (r) { try { r.disconnect(); } catch (e) {} }
    var m = q(kind, '.lmedia'); try { m.pause(); } catch (e) {} m.srcObject = null; m.classList.remove('on');
    if (!keepMsg) setMsg(kind, '');
    ui(kind);
  }

  function play(kind) {
    var btn = q(kind, '.lbtn'), media = q(kind, '.lmedia');
    if (rooms[kind]) { retry[kind] = 99; stop(kind); return; }
    retry[kind] = 0; btn.disabled = true; setMsg(kind, 'Connecting…');
    loadLiveKit().then(function () {
      return fetch(base + '/functions/v1/livekit-token', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: conf.anon_key }, body: JSON.stringify({ kind: kind, mode: 'watch' }) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not connect'); return j; });
    }).then(function (t) {
      var LK = window.LivekitClient, room = new LK.Room();
      rooms[kind] = room;
      room.on(LK.RoomEvent.TrackSubscribed, function (track) { track.attach(media); media.classList.add('on'); applyAudio(kind); setMsg(kind, ''); });
      room.on(LK.RoomEvent.Reconnecting, function () { setMsg(kind, 'Connection is weak. Reconnecting…'); });
      room.on(LK.RoomEvent.Reconnected, function () { setMsg(kind, ''); });
      room.on(LK.RoomEvent.Disconnected, function () {
        if (rooms[kind] !== room) return;
        stop(kind, true);
        if (rows[kind] && (retry[kind] || 0) < 3) { retry[kind]++; setMsg(kind, 'Connection lost. Reconnecting…'); timers[kind] = setTimeout(function () { play(kind); }, 2500 * retry[kind]); }
        else setMsg(kind, rows[kind] ? 'The connection was lost. Press play to try again.' : 'The broadcast has ended. Thanks for listening.');
      });
      return room.connect(t.url, t.token).then(function () {
        btn.disabled = false; ui(kind); applyAudio(kind);
        setMsg(kind, 'Connected. Waiting for sound…');
        return media.play().catch(function () { setMsg(kind, 'Press play on the player if you hear nothing.'); });
      });
    }).catch(function (e) { stop(kind, true); btn.disabled = false; setMsg(kind, e.message || 'Could not connect'); });
  }

  function paint(list) {
    var prev = rows; rows = {};
    (list || []).forEach(function (r) { if (r && (r.kind === 'tv' || r.kind === 'radio')) rows[r.kind] = r; });
    KINDS.forEach(function (k) {
      if (prev[k] && !rows[k] && rooms[k]) { stop(k, true); setMsg(k, 'The broadcast has ended. Thanks for listening.'); }
      ui(k);
    });
  }

  function refresh() {
    fetch(base + '/rest/v1/live_now?select=*', { headers: { apikey: conf.anon_key } })
      .then(function (r) { return r.ok ? r.json() : []; }).then(paint).catch(function () { paint([]); });
  }

  KINDS.forEach(function (k) {
    var c = card(k);
    c.querySelector('.lbtn').addEventListener('click', function () { play(k); });
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
  });
  setInterval(tick, 1000);
  refresh(); setInterval(refresh, 10000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
