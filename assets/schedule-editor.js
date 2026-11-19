/* SparkNews editor: the Schedule window (channels, programme library and a drag-and-drop day planner for TV and radio).
   Loaded on demand by editor.js. Editors and admins can plan; only admins can add or change channels. */
(function () {
  'use strict';
  window.SparkSchedule = { mount: mount, ytId: ytId };

  var PX = 64;                 /* pixels per hour on the planner */
  var SNAP = 5;                /* minutes */
  var DAY = 86400000;

  function ytId(u) {
    u = String(u || '').trim();
    var m = u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/) || u.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : '';
  }
  function hue(s) { var n = 0; s = String(s || 'x'); for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 360; return n; }
  function color(topic) { return 'hsl(' + hue(topic) + ',55%,38%)'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dur(s) { var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? h + ' h ' + pad(m) + ' min' : (m ? m + ' min' + (x ? ' ' + x + ' s' : '') : x + ' s'); }
  function midnight(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dateVal(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function snap(ms) { var u = SNAP * 60000; return Math.round(ms / u) * u; }

  /* a hidden YouTube player, used only to learn how long a video is */
  var ytApi = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (!ytApi) ytApi = new Promise(function (ok, no) {
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); ok(); };
      var s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.onerror = function () { ytApi = null; no(new Error('Could not reach YouTube')); };
      document.head.appendChild(s);
    });
    return ytApi;
  }
  function ytLength(id) {
    return loadYT().then(function () {
      return new Promise(function (ok, no) {
        var box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:120px'; document.body.appendChild(box);
        var holder = document.createElement('div'); box.appendChild(holder);
        var done = false, tries = 0, pl;
        function end(err, val) { if (done) return; done = true; try { pl.destroy(); } catch (e) {} box.remove(); err ? no(err) : ok(val); }
        pl = new window.YT.Player(holder, { videoId: id, width: 200, height: 120, playerVars: { controls: 0, playsinline: 1 }, events: {
          onReady: function () { pl.mute(); try { pl.playVideo(); } catch (e) {} var t = setInterval(function () {
            var d = 0; try { d = pl.getDuration(); } catch (e) {}
            if (d > 0) { clearInterval(t); end(null, Math.round(d)); } else if (++tries > 30) { clearInterval(t); end(new Error('timeout')); }
          }, 300); },
          onError: function (e) { end(new Error(e && (e.data === 101 || e.data === 150) ? 'The owner of this video does not allow it to be embedded.' : 'YouTube cannot play this video (it may be private or removed).')); }
        } });
      });
    });
  }
  function ytTitle(id) {
    return fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id)).then(function (r) { return r.json(); }).then(function (j) { return (j && j.title) || ''; }).catch(function () { return ''; });
  }
  function fileLength(file) {
    return new Promise(function (ok) {
      var el = document.createElement(/^audio\//.test(file.type) ? 'audio' : 'video'), u = URL.createObjectURL(file);
      el.preload = 'metadata'; el.onloadedmetadata = function () { var d = el.duration; URL.revokeObjectURL(u); ok(isFinite(d) ? Math.round(d) : 0); };
      el.onerror = function () { URL.revokeObjectURL(u); ok(0); }; el.src = u;
    });
  }

  function mount(ctx) {
    var h = ctx.h, field = ctx.field, toast = ctx.toast, sb = ctx.sb, errText = ctx.errText, isAdmin = ctx.me.role === 'admin';
    var channels = ctx.channels.slice(), chan = '', day = midnight(new Date()), programs = [], items = [], selProg = '', selItem = '', slot = null, topicF = '', q = '', showChan = false;
    var el = h('div', { class: 'dash sched' }), timers = [];
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    var progById = function (id) { return programs.filter(function (p) { return p.id === id; })[0]; };
    var chanObj = function () { return channels.filter(function (c) { return c.slug === chan; })[0]; };
    var itemEnd = function (it) { var p = progById(it.program_id); return new Date(it.start_at).getTime() + (p ? p.duration_s : 0) * 1000; };

    /* ------------------------------------------------------------ data */
    function loadAll() {
      return sb.from('programs').select('*').order('created_at', { ascending: false }).then(function (r) {
        if (r.error) throw r.error; programs = r.data || []; return loadItems();
      });
    }
    function loadItems() {
      if (!chan) { items = []; return Promise.resolve(); }
      var from = new Date(day.getTime() - DAY).toISOString(), to = new Date(day.getTime() + 2 * DAY).toISOString();
      return sb.from('schedule_items').select('id,channel,program_id,start_at').eq('channel', chan).gte('start_at', from).lt('start_at', to).order('start_at').then(function (r) {
        if (r.error) throw r.error; items = r.data || [];
      });
    }
    function fail(e) {
      var m = (e && e.message) || '';
      el.replaceChildren(h('div', { class: 'msg err', text: /relation|does not exist|schema cache|permission denied/i.test(m) ? 'The schedule is not set up yet. Run supabase/channels.sql in the Supabase SQL Editor, then reload this page.' : errText(e) }));
    }
    function refresh() { return loadItems().then(draw, fail); }

    /* ------------------------------------------------------------ placing programmes */
    /* the first free time at or after "start" where the programme fits without touching another item */
    function freeSpot(startMs, lenMs, ignoreId) {
      var list = items.filter(function (i) { return i.id !== ignoreId; }).map(function (i) { return [new Date(i.start_at).getTime(), itemEnd(i)]; }).sort(function (a, b) { return a[0] - b[0]; });
      var s = startMs, moved = true, guard = 0;
      while (moved && guard++ < 500) { moved = false; for (var k = 0; k < list.length; k++) { if (s < list[k][1] && s + lenMs > list[k][0]) { s = snapUp(list[k][1]); moved = true; } } }
      return s;
    }
    function snapUp(ms) { var u = SNAP * 60000; return Math.ceil(ms / u) * u; }
    function place(prog, wantMs, quiet) {
      var s = freeSpot(snap(wantMs), prog.duration_s * 1000);
      return sb.from('schedule_items').insert({ channel: chan, program_id: prog.id, start_at: new Date(s).toISOString() }).select('id,channel,program_id,start_at').then(function (r) {
        if (r.error) throw r.error; items = items.concat(r.data || []).sort(function (a, b) { return new Date(a.start_at) - new Date(b.start_at); });
        if (!quiet) toast(s !== snap(wantMs) ? 'Placed at ' + hm(new Date(s)) + ' (' + hm(new Date(snap(wantMs))) + ' was taken)' : 'Added at ' + hm(new Date(s)));
        return s;
      });
    }
    function nextStart() {
      /* after the last programme that day, otherwise now (for today) or 08:00 */
      var dayEnd = day.getTime() + DAY, last = 0;
      items.forEach(function (i) { var e = itemEnd(i); if (e > day.getTime() && e <= dayEnd + DAY && new Date(i.start_at).getTime() < dayEnd) last = Math.max(last, e); });
      if (slot && slot >= day.getTime() && slot < dayEnd) return slot;
      if (last) return snapUp(last);
      var now = Date.now(); return now >= day.getTime() && now < dayEnd ? snapUp(now) : day.getTime() + 8 * 3600000;
    }
    function addTo(prog) { place(prog, nextStart()).then(function (s) { slot = null; selItem = ''; draw(); }).catch(function (e) { toast(errText(e), true); }); }
    function move(id, ms) {
      var it = items.filter(function (x) { return x.id === id; })[0], p = it && progById(it.program_id); if (!it || !p) return;
      var s = freeSpot(snap(ms), p.duration_s * 1000, id);
      sb.from('schedule_items').update({ start_at: new Date(s).toISOString() }).eq('id', id).then(function (r) {
        if (r.error) return toast(errText(r.error), true); it.start_at = new Date(s).toISOString(); items.sort(function (a, b) { return new Date(a.start_at) - new Date(b.start_at); });
        toast('Moved to ' + hm(new Date(s))); draw();
      });
    }
    function remove(id) { sb.from('schedule_items').delete().eq('id', id).then(function (r) { if (r.error) return toast(errText(r.error), true); items = items.filter(function (x) { return x.id !== id; }); selItem = ''; draw(); }); }

    /* ------------------------------------------------------------ channels (admin) */
    function chanPanel() {
      var list = channels.map(function (c) {
        return h('div', { class: 'chrow' }, h('b', { text: c.name }), h('span', { class: 'badge', text: c.type === 'tv' ? 'TV' : 'Radio' }), h('small', { text: c.topic || '' }),
          h('button', { class: 'btn', type: 'button', text: 'Edit', onclick: function () { edit(c); } }),
          (c.slug === 'tv' || c.slug === 'radio') ? null : h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: function () {
            if (!confirm('Delete the channel "' + c.name + '" and its whole schedule?')) return;
            sb.rpc('channel_delete', { p_slug: c.slug }).then(function (r) { if (r.error) return toast(errText(r.error), true); toast('Channel deleted'); reloadChannels(c.slug === chan ? '' : chan); });
          } }));
      });
      var box = h('div', { class: 'panel chpanel' }, h('h3', { text: 'Channels' }), h('div', { class: 'chlist' }, list), h('div', { class: 'chform' }));
      function edit(c) {
        var isNew = !c, name = h('input', { type: 'text', maxlength: '80', value: c ? c.name : '', placeholder: 'e.g. Sports Channel' });
        var type = h('select', {}, h('option', { value: 'tv', text: 'TV channel' }), h('option', { value: 'radio', text: 'Radio channel' })); type.value = c ? c.type : 'tv'; type.disabled = !isNew;
        var topic = h('input', { type: 'text', maxlength: '80', value: c && c.topic || '', placeholder: 'e.g. Sport, Music, Local news' });
        var desc = h('input', { type: 'text', maxlength: '300', value: c && c.description || '', placeholder: 'One line shown on the Live page' });
        var f = box.querySelector('.chform');
        f.replaceChildren(h('h4', { text: isNew ? 'New channel' : 'Edit ' + c.name }), h('div', { class: 'row2' }, field('Name', name), field('Type', type)), field('Topic', topic, 'What this channel is about.'), field('Description', desc),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'Save channel', onclick: function () {
            if (!name.value.trim()) return toast('Please give the channel a name', true);
            var slug = c ? c.slug : name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
            if (isNew) { slug = (type.value === 'tv' ? 'tv-' : 'radio-') + slug; slug = slug.slice(0, 31).replace(/-$/, ''); if (channels.some(function (x) { return x.slug === slug; })) slug += '-' + Math.random().toString(36).slice(2, 5); }
            sb.rpc('channel_save', { p_slug: slug, p_type: c ? c.type : type.value, p_name: name.value, p_topic: topic.value, p_description: desc.value, p_listed: true, p_position: c ? (c.position || 0) : channels.length }).then(function (r) {
              if (r.error) return toast(errText(r.error), true); toast('Channel saved'); reloadChannels(isNew ? slug : chan);
            });
          } }), h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: function () { f.replaceChildren(); } })));
      }
      box.appendChild(h('button', { class: 'btn', type: 'button', text: '+ New channel', onclick: function () { edit(null); } }));
      return box;
    }
    function reloadChannels(select) {
      ctx.reload().then(function () { channels = ctx.getChannels().slice(); if (select !== undefined) chan = select; if (!channels.some(function (c) { return c.slug === chan; })) chan = (channels[0] || {}).slug || ''; loadItems().then(draw, fail); });
    }

    /* ------------------------------------------------------------ add programmes */
    function addBox() {
      var tab = 'yt';
      var topics = []; programs.forEach(function (p) { if (p.topic && topics.indexOf(p.topic) < 0) topics.push(p.topic); });
      var dl = h('datalist', { id: 'topiclist' }, topics.map(function (t) { return h('option', { value: t }); }));
      var body = h('div', { class: 'addbody' }), msg = h('p', { class: 'hint' });
      var ytIn = h('input', { type: 'text', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube link' });
      var title = h('input', { type: 'text', maxlength: '140', placeholder: 'Title' }), topic = h('input', { type: 'text', maxlength: '60', list: 'topiclist', placeholder: 'Topic, e.g. Science' });
      var mins = h('input', { type: 'number', min: '1', max: '720', step: '1', placeholder: 'minutes' });
      var file = h('input', { type: 'file', accept: 'video/mp4,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/webm', 'aria-label': 'Video or audio file' });
      var curId = '', curFile = null, curSecs = 0, media = 'video';
      var save = h('button', { class: 'btn primary', type: 'button', text: 'Add to library', disabled: true });
      function ready() { save.disabled = !(title.value.trim() && +mins.value >= 1 && (tab === 'yt' ? curId : curFile)); }
      [title, mins].forEach(function (x) { x.addEventListener('input', ready); });
      ytIn.addEventListener('input', function () {
        var id = ytId(ytIn.value); curId = ''; ready(); if (!id) { msg.className = 'hint'; msg.textContent = ytIn.value ? 'That does not look like a YouTube link.' : ''; return; }
        msg.className = 'hint'; msg.textContent = 'Looking up the video…'; curId = id;
        Promise.all([ytTitle(id), ytLength(id).catch(function (e) { return e; })]).then(function (r) {
          if (curId !== id) return;
          if (!title.value) title.value = r[0] || '';
          if (r[1] instanceof Error) { msg.className = 'hint err'; msg.textContent = r[1].message + ' Enter the length yourself if you still want to add it.'; if (/embedded|cannot play/.test(r[1].message)) { curId = /embedded/.test(r[1].message) ? '' : id; } }
          else { mins.value = Math.max(1, Math.ceil(r[1] / 60)); curSecs = r[1]; msg.className = 'hint ok'; msg.textContent = 'Found: ' + dur(r[1]) + '.'; }
          ready();
        });
      });
      file.addEventListener('change', function () {
        curFile = file.files[0] || null; curSecs = 0; ready(); if (!curFile) return;
        if (curFile.size > 52428800) { msg.className = 'hint err'; msg.textContent = 'That file is over 50 MB (the free Supabase limit). Compress it first or use a YouTube link.'; curFile = null; ready(); return; }
        media = /^audio\//.test(curFile.type) ? 'audio' : 'video';
        if (!title.value) title.value = curFile.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 140);
        fileLength(curFile).then(function (s) { curSecs = s; if (s) { mins.value = Math.max(1, Math.ceil(s / 60)); msg.className = 'hint ok'; msg.textContent = 'Length: ' + dur(s) + '.'; } else { msg.className = 'hint err'; msg.textContent = 'Could not read the length. Please type it in.'; } ready(); });
      });
      save.addEventListener('click', function () {
        save.disabled = true; msg.className = 'hint'; msg.textContent = 'Saving…';
        var secs = Math.max(5, curSecs && Math.abs(curSecs - mins.value * 60) < 60 ? curSecs : Math.round(+mins.value * 60));
        var row = { title: title.value.trim(), topic: topic.value.trim() || null, duration_s: secs };
        var job;
        if (tab === 'yt') job = Promise.resolve(Object.assign(row, { source: 'youtube', yt_id: curId, media: 'video' }));
        else {
          var path = Date.now() + '-' + curFile.name.replace(/[^\w.\-]+/g, '_').slice(-80);
          job = sb.storage.from('programs').upload(path, curFile, { contentType: curFile.type }).then(function (r) { if (r.error) throw r.error; return Object.assign(row, { source: 'upload', path: path, media: media }); });
        }
        job.then(function (d) { return sb.from('programs').insert(d); }).then(function (r) {
          if (r.error) throw r.error; toast('Added to the library'); loadAll().then(draw, fail);
        }).catch(function (e) { msg.className = 'hint err'; msg.textContent = /bucket|not found/i.test(e.message || '') ? 'The upload storage is not set up. Run supabase/channels.sql first.' : errText(e); save.disabled = false; });
      });
      function drawBody() {
        body.replaceChildren(tab === 'yt' ? field('YouTube link', ytIn, 'Channel owners must allow embedding, otherwise visitors cannot play the video.') : field('Video or audio file', file, 'MP4 or WebM video, MP3 / AAC / OGG / WAV audio, up to 50 MB.'),
          field('Title', title), h('div', { class: 'row2' }, field('Topic', topic), field('Length (minutes)', mins)), h('div', { class: 'row' }, save), msg);
      }
      var tabs = h('div', { class: 'seg' }, [['yt', 'YouTube link'], ['up', 'Upload file']].map(function (t) {
        var b = h('button', { class: 'btn' + (t[0] === tab ? ' on' : ''), type: 'button', text: t[1], onclick: function () { tab = t[0]; tabs.querySelectorAll('button').forEach(function (x, i) { x.classList.toggle('on', i === (tab === 'yt' ? 0 : 1)); }); drawBody(); ready(); } });
        return b;
      }));
      drawBody();
      return h('details', { class: 'addprog', open: programs.length === 0 }, h('summary', { text: '+ Add a programme' }), tabs, body, dl);
    }

    /* ------------------------------------------------------------ the library */
    function library() {
      var topics = []; programs.forEach(function (p) { if (p.topic && topics.indexOf(p.topic) < 0) topics.push(p.topic); });
      var chips = h('div', { class: 'chips2' }, [''].concat(topics).map(function (t) {
        return h('button', { class: 'chip2' + (topicF === t ? ' on' : ''), type: 'button', text: t || 'All topics', onclick: function () { topicF = t; draw(); }, style: t ? 'border-color:' + color(t) : null });
      }));
      var search = h('input', { type: 'search', placeholder: 'Search programmes', value: q, 'aria-label': 'Search programmes', oninput: function () { q = search.value; fillList(); } });
      var listEl = h('div', { class: 'plist' });
      function fillList() {
        var ft = programs.filter(function (p) { return (!topicF || p.topic === topicF) && (!q || (p.title + ' ' + (p.topic || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0); });
        listEl.replaceChildren.apply(listEl, ft.length ? ft.map(function (p) {
          var d = h('div', { class: 'pcard' + (selProg === p.id ? ' on' : ''), draggable: 'true', style: 'border-left-color:' + color(p.topic) },
            h('div', { class: 'ptxt' }, h('b', { text: p.title }), h('small', { text: [p.topic, dur(p.duration_s), p.source === 'youtube' ? 'YouTube' : (p.media === 'audio' ? 'Audio file' : 'Video file')].filter(Boolean).join(' · ') })),
            h('div', { class: 'pbtn' }, h('button', { class: 'btn primary', type: 'button', text: 'Add', title: slot ? 'Add at ' + hm(new Date(slot)) : 'Add after the last programme of the day', onclick: function (e) { e.stopPropagation(); addTo(p); } }),
              h('button', { class: 'btn', type: 'button', text: '×', 'aria-label': 'Delete from library', title: 'Delete from library', onclick: function (e) {
                e.stopPropagation(); if (!confirm('Delete "' + p.title + '" from the library? It is also removed from every schedule.')) return;
                var job = p.source === 'upload' ? sb.storage.from('programs').remove([p.path]) : Promise.resolve();
                job.then(function () { return sb.from('programs').delete().eq('id', p.id); }).then(function (r) { if (r.error) return toast(errText(r.error), true); loadAll().then(draw, fail); });
              } })));
          d.addEventListener('click', function () { selProg = selProg === p.id ? '' : p.id; fillList(); drawTools(); });
          d.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', 'prog:' + p.id); e.dataTransfer.effectAllowed = 'copy'; selProg = p.id; });
          return d;
        }) : [h('div', { class: 'empty', text: programs.length ? 'Nothing matches.' : 'The library is empty. Add a YouTube link or upload a file above.' })]);
      }
      fillList();
      return h('section', { class: 'panel lib' }, h('h3', { text: 'Programme library' }), addBox(), programs.length ? h('div', {}, search, chips) : null, listEl,
        programs.length ? h('p', { class: 'hint', text: 'Drag a programme onto the day, or press Add.' }) : null);
    }

    /* ------------------------------------------------------------ the planner */
    var toolsEl = h('div', { class: 'schedtools' });
    function drawTools() {
      var sel = items.filter(function (i) { return i.id === selItem; })[0], p = sel && progById(sel.program_id), prog = progById(selProg);
      var bits = [];
      if (sel && p) {
        var st = new Date(sel.start_at), tm = h('input', { type: 'time', value: hm(st), step: '300', 'aria-label': 'Start time' });
        bits.push(h('div', { class: 'selbar' }, h('b', { text: p.title }), h('span', { text: 'starts' }), tm,
          h('button', { class: 'btn', type: 'button', text: 'Change time', onclick: function () { var t = tm.value.split(':'); var d = new Date(st); d.setHours(+t[0], +t[1], 0, 0); move(sel.id, d.getTime()); } }),
          h('button', { class: 'btn', type: 'button', text: 'Repeat tomorrow', onclick: function () { place(p, st.getTime() + DAY).then(function () { toast('Copied to tomorrow'); draw(); }); } }),
          h('button', { class: 'btn danger', type: 'button', text: 'Remove', onclick: function () { remove(sel.id); } })));
      } else if (prog) {
        bits.push(h('div', { class: 'selbar' }, h('b', { text: prog.title }), h('span', { text: slot ? 'at ' + hm(new Date(slot)) : 'next free time' }),
          h('button', { class: 'btn primary', type: 'button', text: 'Place it', onclick: function () { addTo(prog); } })));
      } else bits.push(h('p', { class: 'hint', text: 'Click an empty time to pick it, then press Add on a programme. Or drag programmes onto the day. Click a block to change or remove it.' }));
      var topicSel = h('select', { 'aria-label': 'Topic to fill with' }, h('option', { value: '', text: 'any topic' }), topicsOf().map(function (t) { return h('option', { value: t, text: t }); }));
      var nSel = h('select', { 'aria-label': 'Days to repeat' }, [1, 2, 3, 4, 5, 6, 7].map(function (n) { return h('option', { value: n, text: n + (n === 1 ? ' day' : ' days') }); }));
      bits.push(h('div', { class: 'selbar quick' },
        h('span', { text: 'Fill the rest of the day with' }), topicSel, h('button', { class: 'btn', type: 'button', text: 'Fill', onclick: function () { fill(topicSel.value); } }),
        h('span', { class: 'sep' }), h('span', { text: 'Copy this day to the next' }), nSel, h('button', { class: 'btn', type: 'button', text: 'Copy', onclick: function () { copyDay(+nSel.value); } }),
        h('span', { class: 'sep' }), h('button', { class: 'btn danger', type: 'button', text: 'Clear day', onclick: clearDay })));
      toolsEl.replaceChildren.apply(toolsEl, bits);
    }
    function topicsOf() { var t = []; programs.forEach(function (p) { if (p.topic && t.indexOf(p.topic) < 0) t.push(p.topic); }); return t; }
    function dayItems() { var a = day.getTime(), b = a + DAY; return items.filter(function (i) { var s = new Date(i.start_at).getTime(); return s >= a && s < b; }); }
    function fill(topic) {
      var pool = programs.filter(function (p) { return !topic || p.topic === topic; });
      if (!pool.length) return toast('No programmes to fill with. Add some to the library first.', true);
      var end = day.getTime() + DAY, t = nextStart(), n = 0, i = 0, chain = Promise.resolve();
      (function loop() {
        var p = pool[i++ % pool.length]; if (t + p.duration_s * 1000 > end + 3600000 || n >= 40) return;
        var at = t; n++; t = freeSpot(at, p.duration_s * 1000) + p.duration_s * 1000; t = snapUp(t);
        chain = chain.then(function () { return place(p, at, true); }); loop();
      })();
      chain.then(function () { toast('Filled the day with ' + n + ' programmes'); draw(); }).catch(function (e) { toast(errText(e), true); });
    }
    function copyDay(n) {
      var src = dayItems(); if (!src.length) return toast('This day is empty', true);
      var rows = [];
      for (var k = 1; k <= n; k++) src.forEach(function (i) { rows.push({ channel: chan, program_id: i.program_id, start_at: new Date(new Date(i.start_at).getTime() + k * DAY).toISOString() }); });
      sb.from('schedule_items').insert(rows).then(function (r) { if (r.error) return toast(errText(r.error), true); toast('Copied to ' + n + ' more day' + (n > 1 ? 's' : '') + '. Existing items on those days were not checked: look at them and remove doubles.'); refresh(); });
    }
    function clearDay() {
      var ids = dayItems().map(function (i) { return i.id; }); if (!ids.length) return;
      if (!confirm('Remove all ' + ids.length + ' programmes from this day?')) return;
      sb.from('schedule_items').delete().in('id', ids).then(function (r) { if (r.error) return toast(errText(r.error), true); items = items.filter(function (i) { return ids.indexOf(i.id) < 0; }); selItem = ''; draw(); });
    }

    function planner() {
      var scroller = h('div', { class: 'tl', tabindex: '0', 'aria-label': 'Day planner' }), inner = h('div', { class: 'tlin', style: 'height:' + 24 * PX + 'px' });
      for (var hh = 0; hh < 24; hh++) inner.appendChild(h('div', { class: 'hr', style: 'top:' + hh * PX + 'px' }, h('span', { text: pad(hh) + ':00' })));
      var a = day.getTime();
      var ghost = h('div', { class: 'ghost', hidden: true });
      inner.appendChild(ghost);
      items.forEach(function (it) {
        var p = progById(it.program_id); if (!p) return;
        var s = new Date(it.start_at).getTime(), e = s + p.duration_s * 1000;
        if (e <= a || s >= a + DAY) return;
        var top = (Math.max(s, a) - a) / 3600000 * PX, ht = Math.max(22, (Math.min(e, a + DAY) - Math.max(s, a)) / 3600000 * PX - 2);
        var b = h('div', { class: 'sitem' + (selItem === it.id ? ' on' : ''), draggable: 'true', style: 'top:' + top + 'px;height:' + ht + 'px;background:' + color(p.topic), tabindex: '0', role: 'button', 'aria-label': p.title + ' at ' + hm(new Date(s)) },
          h('b', { text: hm(new Date(s)) + '  ' + p.title }), ht > 40 ? h('small', { text: [p.topic, dur(p.duration_s)].filter(Boolean).join(' · ') }) : null);
        b.addEventListener('click', function (ev) { ev.stopPropagation(); selItem = selItem === it.id ? '' : it.id; selProg = ''; draw(); });
        b.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); b.click(); } else if (ev.key === 'Delete') remove(it.id); });
        b.addEventListener('dragstart', function (ev) { ev.dataTransfer.setData('text/plain', 'item:' + it.id); ev.dataTransfer.effectAllowed = 'move'; b.dataset.off = String(ev.offsetY || 0); });
        inner.appendChild(b);
      });
      if (slot && slot >= a && slot < a + DAY) inner.appendChild(h('div', { class: 'slot', style: 'top:' + (slot - a) / 3600000 * PX + 'px' }, h('span', { text: '▶ ' + hm(new Date(slot)) })));
      var now = Date.now();
      if (now >= a && now < a + DAY) { var nl = h('div', { class: 'nowline', style: 'top:' + (now - a) / 3600000 * PX + 'px' }, h('span', { text: 'now' })); inner.appendChild(nl); }
      function msAt(ev) { var r = inner.getBoundingClientRect(); return a + (ev.clientY - r.top) / PX * 3600000; }
      inner.addEventListener('click', function (ev) { if (ev.target !== inner && !ev.target.classList.contains('hr') && !ev.target.closest('.hr')) return; slot = snap(msAt(ev)); selItem = ''; draw(); });
      inner.addEventListener('dragover', function (ev) {
        ev.preventDefault(); var t = snap(msAt(ev)); ghost.hidden = false; ghost.style.top = (t - a) / 3600000 * PX + 'px'; ghost.textContent = hm(new Date(t));
      });
      inner.addEventListener('dragleave', function (ev) { if (!inner.contains(ev.relatedTarget)) ghost.hidden = true; });
      inner.addEventListener('drop', function (ev) {
        ev.preventDefault(); ghost.hidden = true; var d = ev.dataTransfer.getData('text/plain') || '', t = msAt(ev);
        if (d.indexOf('prog:') === 0) { var p = progById(d.slice(5)); if (p) place(p, t).then(function () { slot = null; draw(); }).catch(function (e) { toast(errText(e), true); }); }
        else if (d.indexOf('item:') === 0) move(d.slice(5), t);
      });
      scroller.appendChild(inner);
      /* keep the "now" line moving */
      timers.push(setInterval(function () { var nl2 = inner.querySelector('.nowline'); var n2 = Date.now(); if (nl2 && n2 >= a && n2 < a + DAY) nl2.style.top = (n2 - a) / 3600000 * PX + 'px'; }, 30000));
      setTimeout(function () { var n3 = Date.now(), at = n3 >= a && n3 < a + DAY ? (n3 - a) / 3600000 * PX - 120 : 8 * PX; scroller.scrollTop = Math.max(0, at); }, 0);
      return scroller;
    }

    /* ------------------------------------------------------------ whole window */
    function draw() {
      timers.forEach(clearInterval); timers = [];
      var c = chanObj(), live = ctx.onAir().indexOf(chan) >= 0;
      var chSel = h('select', { 'aria-label': 'Channel', onchange: function () { chan = chSel.value; selItem = ''; slot = null; try { location.hash = '#/schedule/' + chan; } catch (e) {} loadItems().then(draw, fail); } },
        ['tv', 'radio'].map(function (t) { return h('optgroup', { label: t === 'tv' ? 'TV channels' : 'Radio channels' }, channels.filter(function (x) { return x.type === t; }).map(function (x) { return h('option', { value: x.slug, text: x.name + (x.topic ? ' (' + x.topic + ')' : '') }); })); }));
      chSel.value = chan;
      var dIn = h('input', { type: 'date', value: dateVal(day), 'aria-label': 'Day', onchange: function () { if (dIn.value) { var p = dIn.value.split('-'); day = new Date(+p[0], +p[1] - 1, +p[2]); slot = null; selItem = ''; refresh(); } } });
      function shift(n) { day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + n); slot = null; selItem = ''; refresh(); }
      var wd = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
      el.replaceChildren(
        h('div', { class: 'dashhead' }, h('h2', { text: 'Schedule' }),
          h('div', { class: 'schedtop' }, chSel, h('button', { class: 'btn', type: 'button', text: '◀', 'aria-label': 'Previous day', onclick: function () { shift(-1); } }),
            h('button', { class: 'btn', type: 'button', text: 'Today', onclick: function () { day = midnight(new Date()); slot = null; refresh(); } }),
            h('button', { class: 'btn', type: 'button', text: '▶', 'aria-label': 'Next day', onclick: function () { shift(1); } }), dIn,
            isAdmin ? h('button', { class: 'btn', type: 'button', text: showChan ? 'Hide channels' : 'Channels…', onclick: function () { showChan = !showChan; draw(); } }) : null)),
        h('p', { class: 'hint', text: (c ? c.name + ': ' : '') + wd + '. Times are in your time zone' + (tz ? ' (' + tz + ')' : '') + '. Visitors see them in theirs. Whenever someone is live on this channel, visitors get the live broadcast instead of the schedule.' }),
        live ? h('div', { class: 'msg info', text: 'This channel is live from this browser right now, so the schedule is paused for visitors.' }) : h('span'),
        showChan && isAdmin ? chanPanel() : h('span'),
        h('div', { class: 'schedgrid' }, library(), h('section', { class: 'panel plan' }, h('h3', { text: wd }), toolsEl, planner())));
      drawTools();
    }

    el.appendChild(h('div', { class: 'empty', text: 'Loading…' }));
    var startSlug = ctx.start; try { if (!startSlug) startSlug = localStorage.getItem('spark-chan-sched') || ''; } catch (e) {}
    chan = channels.some(function (x) { return x.slug === startSlug; }) ? startSlug : (channels[0] || {}).slug || '';
    loadAll().then(function () { draw(); try { localStorage.setItem('spark-chan-sched', chan); } catch (e) {} }, fail);
    return { el: el, stop: function () { timers.forEach(clearInterval); } };
  }
})();
