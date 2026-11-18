/* SparkNews staff badge check: the page a badge's QR code opens. */
(function () {
  var el = document.getElementById('badge-data'), cfg = null, out = document.getElementById('badge-out');
  try { cfg = JSON.parse(el.textContent); } catch (e) {}
  if (!out) return;
  function say(cls, t) { out.className = 'bcheck ' + cls; out.textContent = t; }
  var t = (location.search.match(/[?&]t=([A-Za-z0-9]{16,64})/) || [])[1];
  if (!cfg || !cfg.url || !t) return say('bad', 'This badge link is not complete.');
  fetch(cfg.url + '/rest/v1/rpc/badge_lookup', {
    method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: t })
  }).then(function (r) { if (!r.ok) throw new Error('bad'); return r.text(); }).then(function (t) {
    var b = null; try { b = t ? JSON.parse(t) : null; } catch (e) {}
    if (!b) return say('bad', 'Not valid. This badge is unknown or has been switched off.');
    out.className = 'bcheck ok'; out.textContent = '';
    function add(tag, cls, text) { var n = document.createElement(tag); n.className = cls; n.textContent = text; out.appendChild(n); return n; }
    if (b.photo_url && /^https:\/\//.test(b.photo_url)) { var im = document.createElement('img'); im.src = b.photo_url; im.alt = ''; out.appendChild(im); }
    add('p', 'tick', '✓ Valid ' + (cfg.site || '') + ' staff badge');
    add('h1', 'nm', b.name);
    if (b.role) add('p', 'rl', b.role);
    if (b.employee_no) add('p', 'no', 'ID ' + b.employee_no);
  }, function () { say('bad', 'Could not check the badge right now.'); });
})();
