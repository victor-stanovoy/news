/* TV guests, studio side: invite links with QR codes, the guest room (see and hear guests), and the guests' pictures and voices for the program. */
(function () {
  'use strict';
  var G = { room: null, kind: '', ctx: null, dest: null, srcs: {}, gains: {}, fed: null, listeners: [] };
  function ensureAudio() {
    if (G.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    G.ctx = new AC(); G.dest = G.ctx.createMediaStreamDestination();
  }
  /* the program mixer takes the guests' combined voices (called when going live, and when the room opens while on air) */
  function feed(mixer) {
    ensureAudio(); if (!G.dest || !mixer || !mixer.addTrack || G.fed === mixer) return;
    mixer.addTrack(G.dest.stream.getAudioTracks()[0]); G.fed = mixer;
  }

  function mount(o) {
    var h = o.h, comp = o.comp, kind = o.kind, toast = o.toast, root = h('section', { class: 'panel wide guests' });
    comp.guests = comp.guests || []; comp.guestSel = comp.guestSel || [];
    var inviteBox = h('div', { class: 'ginv' }), listBox = h('div', { class: 'glist' }), roomBox = h('div', { class: 'groom' });

    /* ---------- invites ---------- */
    function base() { var b = (o.site.base_url || '').replace(/\/+$/, ''); return b || (location.origin + location.pathname.replace(/\/editor\/[^\/]*$/, '').replace(/\/+$/, '')); }
    function linkOf(code) { return base() + '/guest/?k=' + encodeURIComponent(kind) + '&c=' + code; }
    function qrCanvas(text, px) {
      var q = window.qrcode(0, 'M'); q.addData(text); q.make();
      var n = q.getModuleCount(), quiet = 2, cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
      var c = document.createElement('canvas'); c.width = c.height = cell * (n + quiet * 2);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
      for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
      return c;
    }
    var shown = h('div', { class: 'gshown' });
    function show(code, label) {
      var url = linkOf(code), qc = window.qrcode ? qrCanvas(url, 260) : null;
      if (qc) qc.className = 'gqr';
      shown.replaceChildren(h('div', { class: 'gcard' }, qc,
        h('div', {}, h('strong', { text: label || 'Guest invite' }), h('p', { class: 'hint', text: 'Guests scan this with their phone camera, or you send them the link. Everyone who opens it joins the same waiting room.' }),
          h('input', { type: 'text', readonly: '', value: url, 'aria-label': 'Invite link', onclick: function (e) { e.target.select(); } }),
          h('div', { class: 'btnrow' },
            h('button', { class: 'btn', type: 'button', text: 'Copy link', onclick: function () { navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }, function () { toast('Press Ctrl+C on the selected link', true); }); } }),
            qc ? h('button', { class: 'btn', type: 'button', text: 'Download QR', onclick: function () { var a = document.createElement('a'); a.download = 'guest-qr.png'; a.href = qc.toDataURL('image/png'); a.click(); } }) : null,
            qc ? h('button', { class: 'btn', type: 'button', text: 'Copy QR', onclick: function () { qc.toBlob(function (b) { try { navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(function () { toast('QR copied'); }); } catch (e) { toast('Use Download QR instead', true); } }); } }) : null))));
    }
    var lab = h('input', { type: 'text', maxlength: '60', placeholder: 'What is the show or guest group? (optional)', 'aria-label': 'Invite label' });
    var hours = h('select', { 'aria-label': 'Valid for' }, [[1, '1 hour'], [4, '4 hours'], [24, '1 day'], [72, '3 days'], [168, '7 days']].map(function (x) { return h('option', { value: x[0], text: 'Valid ' + x[1] }); })); hours.value = '4';
    var dev = h('select', { 'aria-label': 'Devices' }, [1, 2, 3, 4, 6, 8, 12].map(function (x) { return h('option', { value: x, text: 'Up to ' + x + (x === 1 ? ' device' : ' devices') }); })); dev.value = '4';
    function loadInvites() {
      o.sb.rpc('guest_invite_list', { p_kind: kind }).then(function (r) {
        if (r.error) { listBox.replaceChildren(h('p', { class: 'hint err', text: /does not exist|schema cache/i.test(r.error.message || '') ? 'Not set up yet: run supabase/guests.sql in the Supabase SQL Editor.' : o.errText(r.error) })); return; }
        var rows = (r.data || []).filter(function (x) { return !x.revoked && new Date(x.expires_at) > new Date(); });
        listBox.replaceChildren.apply(listBox, rows.length ? rows.map(function (x) {
          return h('div', { class: 'grow' }, h('span', { text: (x.label || 'Invite') + ' · up to ' + x.max_devices + ' devices · until ' + new Date(x.expires_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }),
            h('button', { class: 'btn', type: 'button', text: 'Show QR', onclick: function () { show(x.code, x.label); } }),
            h('button', { class: 'btn danger', type: 'button', text: 'Switch off', onclick: function () { o.sb.rpc('guest_invite_revoke', { p_code: x.code }).then(function () { shown.replaceChildren(); loadInvites(); toast('Invite switched off. Guests already connected stay until they leave.'); }); } }));
        }) : [h('p', { class: 'hint', text: 'No active invites.' })]);
      });
    }
    var mk = h('button', { class: 'btn primary', type: 'button', text: 'Create invite', onclick: function () {
      mk.disabled = true;
      o.loadScript('../assets/vendor/qrcode.js').then(function () { return o.sb.rpc('guest_invite_create', { p_kind: kind, p_label: lab.value.trim(), p_hours: +hours.value, p_max: +dev.value }); }).then(function (r) {
        if (r.error) throw r.error; show(r.data, lab.value.trim()); loadInvites();
      }).catch(function (e) { toast(/does not exist|schema cache/i.test(String(e && e.message)) ? 'Run supabase/guests.sql in the Supabase SQL Editor first.' : o.errText(e), true); }).then(function () { mk.disabled = false; });
    } });
    inviteBox.appendChild(h('div', { class: 'uprow' }, lab)); inviteBox.appendChild(h('div', { class: 'uprow' }, hours, dev, mk));

    /* ---------- the guest room ---------- */
    var status = h('p', { class: 'hint', text: 'The guest room is closed. Open it to see and hear guests as they join.' }), tiles = h('div', { class: 'gtiles' });
    var hear = true;
    function srcId(p, s) { return p.identity + ':' + s; }
    function updateComp() { comp.guestSel = comp.guestSel.filter(function (id) { return comp.guests.some(function (g) { return g.id === id; }); }); paint(); }
    function paint() { (G.paint || draw)(); }
    function draw() {
      tiles.replaceChildren.apply(tiles, comp.guests.length ? comp.guests.map(function (g) {
        var sel = comp.guestSel.indexOf(g.id) >= 0;
        return h('div', { class: 'gtile' + (sel ? ' sel' : '') }, g.v,
          h('div', { class: 'gname2', text: g.name }),
          h('div', { class: 'btnrow' },
            h('button', { class: 'btn', type: 'button', text: 'Full screen', onclick: function () { o.showGuest('guest', g.id); } }),
            h('button', { class: 'btn', type: 'button', text: 'With me', onclick: function () { o.showGuest('guestme', g.id); } }),
            h('button', { class: 'btn' + (sel ? ' primary' : ''), type: 'button', 'aria-pressed': sel ? 'true' : 'false', text: sel ? 'In grid' : '+ Grid', onclick: function () { var i = comp.guestSel.indexOf(g.id); if (i >= 0) comp.guestSel.splice(i, 1); else comp.guestSel.push(g.id); paint(); } })));
      }).concat(audioRows()) : [h('p', { class: 'hint', text: G.room ? 'Waiting for guests to join with the link or QR code…' : '' })]);
    }
    function audioRows() {
      return Object.keys(G.gains).map(function (id) {
        var e = G.gains[id], rg = h('input', { type: 'range', min: '0', max: '100', value: String(e.vol), 'aria-label': 'Volume of ' + e.name, oninput: function () { e.vol = +rg.value; apply(e); } });
        var mu = h('button', { class: 'btn', type: 'button', 'aria-pressed': e.muted ? 'true' : 'false', text: e.muted ? 'Unmute ' + e.name : 'Mute ' + e.name, onclick: function () { e.muted = !e.muted; apply(e); paint(); } });
        return h('div', { class: 'grow' }, h('span', { text: '\u{1F50A} ' + e.name }), rg, mu);
      });
    }
    function apply(e) { e.gain.gain.setTargetAtTime(e.muted ? 0 : e.vol / 100, G.ctx.currentTime, 0.03); }
    function vidEl() { var v = document.createElement('video'); v.playsInline = true; v.muted = true; v.autoplay = true; v.setAttribute('playsinline', ''); return v; }

    function onTrack(track, pub, p) {
      if (!/^g-/.test(p.identity)) return;
      var LK = window.LivekitClient, nm = p.name || 'Guest';
      if (track.kind === 'video') {
        var scr = pub.source === LK.Track.Source.ScreenShare, id = srcId(p, scr ? 'screen' : 'camera'), v = vidEl(); track.attach(v); v.play().catch(function () {});
        comp.guests = comp.guests.filter(function (g) { return g.id !== id; }); comp.guests.push({ id: id, name: nm + (scr ? ' · screen' : ''), v: v, screen: scr, owner: p.identity });
        if (!comp.guestSel.length) comp.guestSel.push(id);
        updateComp(); status.textContent = comp.guests.length + ' picture' + (comp.guests.length === 1 ? '' : 's') + ' from guests.';
      } else if (track.kind === 'audio' && track.mediaStreamTrack) {
        ensureAudio(); if (!G.ctx) return; if (G.ctx.state === 'suspended') G.ctx.resume();
        var gain = G.ctx.createGain(), src = G.ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        src.connect(gain); gain.connect(G.dest); gain.connect(G.ctx.destination);        /* the studio hears the guests too; use headphones */
        var old = G.gains[p.identity]; if (old) { try { old.src.disconnect(); old.gain.disconnect(); } catch (e) { /* gone */ } }
        G.gains[p.identity] = { name: nm, gain: gain, src: src, vol: old ? old.vol : 100, muted: old ? old.muted : false };
        paint();
      }
    }
    function onGone(track, pub, p) {
      if (track.kind === 'video') { comp.guests = comp.guests.filter(function (g) { return g.owner !== p.identity || (pub.source === window.LivekitClient.Track.Source.ScreenShare) !== g.screen; }); updateComp(); }
      else if (G.gains[p.identity]) { try { G.gains[p.identity].src.disconnect(); G.gains[p.identity].gain.disconnect(); } catch (e) { /* gone */ } delete G.gains[p.identity]; paint(); }
    }
    function left(p) { comp.guests = comp.guests.filter(function (g) { return g.owner !== p.identity; }); if (G.gains[p.identity]) { try { G.gains[p.identity].src.disconnect(); } catch (e) { /* gone */ } delete G.gains[p.identity]; } updateComp(); }

    var openBtn = h('button', { class: 'btn primary', type: 'button', text: 'Open guest room' }), hearBtn = h('button', { class: 'btn', type: 'button', text: 'Guests can hear me: on', 'aria-pressed': 'true', hidden: '' });
    function closeRoom() {
      if (G.room) { try { G.room.disconnect(); } catch (e) { /* gone */ } }
      G.room = null; comp.guests = []; comp.guestSel = [];
      Object.keys(G.gains).forEach(function (k) { try { G.gains[k].src.disconnect(); } catch (e) { /* gone */ } delete G.gains[k]; });
      openBtn.textContent = 'Open guest room'; hearBtn.hidden = true; status.textContent = 'The guest room is closed. Open it to see and hear guests as they join.'; paint();
      if (comp.scene.indexOf('guest') === 0 || comp.scene === 'grid') comp.go('cam');
    }
    openBtn.onclick = function () {
      if (G.room) { closeRoom(); return; }
      openBtn.disabled = true; status.textContent = 'Opening…'; ensureAudio(); if (G.ctx && G.ctx.state === 'suspended') G.ctx.resume();
      Promise.all([o.loadLiveKit(), o.token(kind, 'green')]).then(function (a) {
        var LK = window.LivekitClient, t = a[1], r = new LK.Room();
        r.on(LK.RoomEvent.TrackSubscribed, onTrack); r.on(LK.RoomEvent.TrackUnsubscribed, onGone); r.on(LK.RoomEvent.ParticipantDisconnected, left);
        r.on(LK.RoomEvent.Disconnected, function () { if (G.room === r) closeRoom(); });
        return r.connect(t.url, t.token).then(function () {
          G.room = r; G.kind = kind; openBtn.textContent = 'Close guest room'; hearBtn.hidden = false; status.textContent = 'Guest room open. Waiting for guests…'; paint();
          feed(o.getMixer && o.getMixer());
          return r.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: o.micId ? o.micId() || undefined : undefined }).catch(function () { status.textContent += ' (Your microphone could not be shared with guests.)'; });
        });
      }).catch(function (e) { toast(o.errText(e), true); status.textContent = o.errText(e); }).then(function () { openBtn.disabled = false; });
    };
    hearBtn.onclick = function () { hear = !hear; if (G.room) G.room.localParticipant.setMicrophoneEnabled(hear).catch(function () {}); hearBtn.textContent = 'Guests can hear me: ' + (hear ? 'on' : 'off'); hearBtn.setAttribute('aria-pressed', hear ? 'true' : 'false'); };
    roomBox.appendChild(h('div', { class: 'btnrow' }, openBtn, hearBtn)); roomBox.appendChild(status); roomBox.appendChild(tiles);

    root.appendChild(h('h3', { text: 'Guests' }));
    root.appendChild(h('p', { class: 'hint', text: 'Invite people with a link or QR code. They join a private waiting room from their own phone or computer: camera, microphone and screen are separate sources, and one invite can be used on several devices. Nothing is broadcast until you pick it here. Use headphones.' }));
    root.appendChild(inviteBox); root.appendChild(shown); root.appendChild(listBox); root.appendChild(roomBox);
    G.paint = draw;
    if (G.room) { openBtn.textContent = 'Close guest room'; hearBtn.hidden = false; status.textContent = 'Guest room open.'; }
    loadInvites(); draw();
    return { el: root, stop: function () { /* keep the room open while you visit other windows */ } };
  }
  window.SparkGreen = { mount: mount, feed: feed, close: function () { if (G.room) try { G.room.disconnect(); } catch (e) { /* gone */ } } };
})();
