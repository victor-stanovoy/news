/* SparkNews Live page: shows what is on air and plays it with LiveKit. Anyone may watch; no login. */
(function () {
  var conf = {};
  try { conf = JSON.parse(document.getElementById('spark-live-config').textContent); } catch (e) {}
  var base = (conf.url || '').replace(/\/+$/, '');
  var rooms = {}, lkLoading = null;

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
  function setMsg(kind, t) { card(kind).querySelector('.lmsg').textContent = t || ''; }

  function stop(kind) {
    var r = rooms[kind]; delete rooms[kind];
    if (r) { try { r.disconnect(); } catch (e) {} }
    var c = card(kind), m = c.querySelector('.lmedia'); m.pause && m.pause(); m.srcObject = null; m.hidden = true;
    var b = c.querySelector('.lbtn'); b.disabled = false; b.innerHTML = b.dataset.label;
  }

  function play(kind) {
    var c = card(kind), btn = c.querySelector('.lbtn'), media = c.querySelector('.lmedia');
    if (rooms[kind]) { stop(kind); return; }
    btn.disabled = true; setMsg(kind, 'Connecting…');
    loadLiveKit().then(function () {
      return fetch(base + '/functions/v1/livekit-token', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: conf.anon_key },
        body: JSON.stringify({ kind: kind, mode: 'watch' })
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not connect'); return j; });
    }).then(function (t) {
      var LK = window.LivekitClient, room = new LK.Room();
      rooms[kind] = room;
      room.on(LK.RoomEvent.TrackSubscribed, function (track) { media.hidden = false; track.attach(media); setMsg(kind, ''); });
      room.on(LK.RoomEvent.Disconnected, function () { if (rooms[kind] === room) { stop(kind); setMsg(kind, 'The broadcast has ended.'); } });
      return room.connect(t.url, t.token).then(function () {
        media.hidden = false; btn.disabled = false; btn.textContent = 'Stop';
        setMsg(kind, 'Connected. Waiting for sound…');
        return media.play().catch(function () {});
      });
    }).catch(function (e) { stop(kind); setMsg(kind, e.message || 'Could not connect'); });
  }

  function paint(rows) {
    ['radio', 'tv'].forEach(function (kind) {
      var row = (rows || []).filter(function (r) { return r.kind === kind; })[0];
      var c = card(kind), st = c.querySelector('.lstate'), btn = c.querySelector('.lbtn');
      if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
      st.className = 'lstate ' + (row ? 'on' : 'off'); st.textContent = row ? 'On air' : 'Off air';
      c.querySelector('.ltitle').textContent = row ? (row.title || (kind === 'radio' ? 'Live radio' : 'Live TV')) : 'Not broadcasting right now.';
      btn.hidden = !row && !rooms[kind];
      if (!row && rooms[kind]) { stop(kind); setMsg(kind, 'The broadcast has ended.'); }
    });
  }

  function refresh() {
    fetch(base + '/rest/v1/live_now?select=kind,title', { headers: { apikey: conf.anon_key } })
      .then(function (r) { return r.ok ? r.json() : []; }).then(paint).catch(function () { paint([]); });
  }
  ['radio', 'tv'].forEach(function (k) { card(k).querySelector('.lbtn').addEventListener('click', function () { play(k); }); });
  refresh(); setInterval(refresh, 15000);
})();
