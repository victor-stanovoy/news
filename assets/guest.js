/* TV guest page: a guest opens the invite link (or scans the QR code), shares camera, microphone and/or screen with the studio.
   Nothing goes on air until the studio puts it there. Several devices can use the same invite. */
(function () {
  'use strict';
  var root = document.getElementById('guest-app'); if (!root) return;
  var conf = {}; try { conf = JSON.parse(document.getElementById('guest-data').textContent); } catch (e) {}
  var qs = new URLSearchParams(location.search), code = (qs.get('c') || '').toLowerCase(), kind = qs.get('k') || 'tv';
  var base = (conf.url || '').replace(/\/+$/, '');
  var room = null, wake = null;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  var name = el('input', { type: 'text', maxlength: '40', placeholder: 'Your name, as it should appear', autocomplete: 'name', 'aria-label': 'Your name' });
  try { name.value = sessionStorage.getItem('spark-guest-name') || ''; } catch (e) {}
  var msg = el('p', { 'class': 'gmsg', role: 'status', 'aria-live': 'polite' });
  var preview = el('video', { 'class': 'gpreview', playsinline: '', muted: '', autoplay: '' }); preview.muted = true; preview.hidden = true;
  var joinBtn = el('button', { type: 'button', 'class': 'gbtn main', text: 'Join with camera and microphone' });
  var micBtn = el('button', { type: 'button', 'class': 'gbtn', text: 'Mute microphone', hidden: '' });
  var camBtn = el('button', { type: 'button', 'class': 'gbtn', text: 'Turn camera off', hidden: '' });
  var scrBtn = el('button', { type: 'button', 'class': 'gbtn', text: 'Share my screen' });
  var leave = el('button', { type: 'button', 'class': 'gbtn quiet', text: 'Leave', hidden: '' });
  var live = el('div', { 'class': 'glive', hidden: '' }, [el('span', { 'class': 'gdot' }), el('span', { text: 'You are in the studio’s waiting room. You are not on air until the studio puts you on.' })]);
  var h1 = el('h1', { text: 'Join the show' });
  var who = el('p', { 'class': 'lead', text: 'The studio invited you to appear on SparkNews TV.' });
  var tips = el('ul', { 'class': 'gtips' }, ['Use headphones so the show does not hear itself.', 'Allow the camera and microphone when your browser asks.', 'Phone: hold it sideways. Keep the screen on and this page open.'].map(function (t) { return el('li', { text: t }); }));
  root.appendChild(h1); root.appendChild(who); root.appendChild(el('label', { 'class': 'gname' }, [el('span', { text: 'Your name' }), name]));
  root.appendChild(preview); root.appendChild(el('div', { 'class': 'gbtns' }, [joinBtn, scrBtn, micBtn, camBtn, leave])); root.appendChild(live); root.appendChild(msg); root.appendChild(tips);

  function say(t, bad) { msg.textContent = t || ''; msg.className = 'gmsg' + (bad ? ' err' : ''); }
  if (!/^[a-f0-9]{32}$/.test(code) || !base) { say('This invite link is not complete. Ask the studio for a new link or QR code.', true); joinBtn.disabled = scrBtn.disabled = true; return; }

  function loadLK() {
    if (window.LivekitClient) return Promise.resolve();
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '../assets/vendor/livekit-client.umd.js'; s.onload = ok; s.onerror = function () { no(new Error('Could not load the video library. Check your connection.')); }; document.head.appendChild(s); });
  }
  function token() {
    return fetch(base + '/functions/v1/livekit-token', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: conf.anon_key }, body: JSON.stringify({ kind: kind, mode: 'guest', code: code, name: name.value.trim() || 'Guest' }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not join (error ' + r.status + ')'); return j; }); });
  }
  function connect() {
    if (room) return Promise.resolve(room);
    if (!name.value.trim()) { name.focus(); return Promise.reject(new Error('Please type your name first.')); }
    try { sessionStorage.setItem('spark-guest-name', name.value.trim()); } catch (e) {}
    say('Connecting…');
    return Promise.all([loadLK(), token()]).then(function (a) {
      var LK = window.LivekitClient, t = a[1], r = new LK.Room({ adaptiveStream: false, dynacast: true });
      /* guests only listen: they hear the studio and the other guests, but do not download their video */
      r.on(LK.RoomEvent.TrackPublished, function (pub) { if (pub.kind === 'audio') pub.setSubscribed(true); });
      r.on(LK.RoomEvent.TrackSubscribed, function (track) { if (track.kind === 'audio') { var a2 = track.attach(); a2.hidden = true; document.body.appendChild(a2); } });
      r.on(LK.RoomEvent.TrackUnsubscribed, function (track) { track.detach().forEach(function (n) { n.remove(); }); });
      r.on(LK.RoomEvent.Disconnected, function () { room = null; ui(false); say('You left the studio. Press the button to join again.'); });
      return r.connect(t.url, t.token, { autoSubscribe: false }).then(function () {
        room = r; if (t.label) who.textContent = 'You are invited to: ' + t.label;
        r.remoteParticipants.forEach(function (p) { p.trackPublications.forEach(function (pub) { if (pub.kind === 'audio') pub.setSubscribed(true); }); });
        ui(true); say('');
        try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () {}); } catch (e) {}
        return r;
      });
    });
  }
  function ui(on) {
    live.hidden = !on; leave.hidden = !on; micBtn.hidden = !on; camBtn.hidden = !on; name.disabled = on;
    joinBtn.textContent = on ? 'Camera and microphone are on' : 'Join with camera and microphone'; joinBtn.disabled = on; joinBtn.classList.toggle('on', on);
    if (!on) { preview.hidden = true; preview.srcObject = null; scrBtn.textContent = 'Share my screen'; }
  }
  function fail(e) { say(e && e.message ? e.message : String(e), true); }
  joinBtn.onclick = function () {
    joinBtn.disabled = true;
    connect().then(function (r) {
      return r.localParticipant.setCameraEnabled(true, { resolution: { width: 1280, height: 720, frameRate: 30 } })
        .then(function () { return r.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true }); })
        .then(function () {
          var pub = r.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Camera);
          if (pub && pub.track) { pub.track.attach(preview); preview.hidden = false; }
        });
    }).catch(function (e) { fail(e); if (!room) joinBtn.disabled = false; else ui(true); });
  };
  scrBtn.onclick = function () {
    connect().then(function (r) {
      var on = scrBtn.textContent.indexOf('Stop') === 0;
      return r.localParticipant.setScreenShareEnabled(!on).then(function () { scrBtn.textContent = on ? 'Share my screen' : 'Stop sharing my screen'; });
    }).catch(fail);
  };
  micBtn.onclick = function () { if (!room) return; var m = micBtn.textContent.indexOf('Unmute') === 0; room.localParticipant.setMicrophoneEnabled(m).then(function () { micBtn.textContent = m ? 'Mute microphone' : 'Unmute microphone'; }).catch(fail); };
  camBtn.onclick = function () { if (!room) return; var on = camBtn.textContent.indexOf('Turn camera on') === 0; room.localParticipant.setCameraEnabled(on).then(function () { camBtn.textContent = on ? 'Turn camera off' : 'Turn camera on'; preview.hidden = !on; }).catch(fail); };
  leave.onclick = function () { if (room) room.disconnect(); if (wake) { try { wake.release(); } catch (e) {} } };
  window.addEventListener('beforeunload', function () { if (room) try { room.disconnect(); } catch (e) {} });
})();
