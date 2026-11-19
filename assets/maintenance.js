/* Maintenance page: the team types the bypass password; only a hash is stored on the site. */
(function () {
  'use strict';
  var d; try { d = JSON.parse(document.getElementById('mnt-data').textContent); } catch (e) { return; }
  var f = document.querySelector('.mnt-form'); if (!f) return;
  var err = f.querySelector('.mnt-err');
  function hex(buf) { return [].map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  f.addEventListener('submit', function (e) {
    e.preventDefault(); err.textContent = '';
    if (!window.crypto || !crypto.subtle) { err.textContent = 'This browser cannot check passwords here. Use https.'; return; }
    var salt = new Uint8Array((d.salt.match(/../g) || []).map(function (x) { return parseInt(x, 16); }));
    crypto.subtle.importKey('raw', new TextEncoder().encode(f.querySelector('input').value), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: d.iter }, k, 256); })
      .then(function (b) {
        if (hex(b) !== d.hash) { err.textContent = 'That password is not right.'; f.querySelector('input').select(); return; }
        try { localStorage.setItem('spark-bypass-' + d.tag, '1'); } catch (x) {}
        document.documentElement.classList.remove('maint');
      }, function () { err.textContent = 'Could not check the password.'; });
  });
})();
