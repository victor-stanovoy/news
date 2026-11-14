/* SparkNews newsletter sign-up, confirmation and unsubscribe (talks to the "newsletter" function). */
(function () {
  var conf = {};
  try { conf = (JSON.parse(document.getElementById('spark-ticker-data').textContent) || {}).nl || {}; } catch (e) {}
  if (!conf.url) return;
  var endpoint = conf.url.replace(/\/+$/, '') + '/functions/v1/newsletter';

  function call(body) {
    return fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: conf.key }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .catch(function () { return { ok: false, j: { error: 'No connection. Please try again.' } }; });
  }

  document.querySelectorAll('form[data-nl]').forEach(function (form) {
    var msg = form.querySelector('.nlmsg'), btn = form.querySelector('button[type=submit]');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = form.elements.email.value.trim();
      if (!email || email.indexOf('@') < 1) { msg.textContent = 'Please enter a valid email address.'; msg.className = 'nlmsg err'; return; }
      btn.disabled = true; msg.className = 'nlmsg'; msg.textContent = 'Signing you up…';
      call({ mode: 'subscribe', email: email, hp: form.elements.website.value }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { form.elements.email.value = ''; msg.className = 'nlmsg ok'; msg.textContent = 'Almost done! We sent you an email: open it and press "Confirm my subscription".'; }
        else { msg.className = 'nlmsg err'; msg.textContent = r.j.error || 'Something went wrong. Please try again.'; }
      });
    });
  });

  /* the page the links in the emails open: /newsletter/?confirm=TOKEN or ?unsubscribe=TOKEN */
  var state = document.getElementById('nl-state'), q = new URLSearchParams(location.search);
  function say(title, text, ok) {
    if (!state) return;
    var h = document.createElement('h2'), p = document.createElement('p'), a = document.createElement('a');
    h.textContent = title; p.textContent = text; p.className = 'lead' + (ok === false ? ' err' : '');
    a.href = '../index.html'; a.className = 'nlback'; a.textContent = 'Back to the news';
    state.replaceChildren(h, p, a);
  }
  if (state && q.get('confirm')) {
    say('Confirming…', 'One moment.');
    call({ mode: 'confirm', token: q.get('confirm') }).then(function (r) {
      r.ok ? say('You are subscribed', 'Thank you! You will get our newsletter from now on. Every email has an unsubscribe link.') : say('This link did not work', r.j.error || 'Please sign up again.', false);
    });
  } else if (state && q.get('unsubscribe')) {
    var b = document.createElement('button'), h = document.createElement('h2'), p = document.createElement('p');
    h.textContent = 'Unsubscribe'; p.className = 'lead'; p.textContent = 'Press the button to stop receiving the newsletter.';
    b.type = 'button'; b.className = 'nlbtn'; b.textContent = 'Yes, unsubscribe me';
    b.onclick = function () {
      b.disabled = true;
      call({ mode: 'unsubscribe', token: q.get('unsubscribe') }).then(function (r) {
        r.ok ? say('You are unsubscribed', 'You will not get any more newsletters. Sorry to see you go.') : say('This link did not work', r.j.error || 'Please try again.', false);
      });
    };
    state.replaceChildren(h, p, b);
  }
})();
