/* SparkNews email templates. Pure functions: (content, design, options) -> one complete HTML email.
   Built the way mail programs need it: tables, inline styles, 600px card, bulletproof buttons, mobile rules in <style>.
   Works in the browser (window.SparkEmail) and in Node (module.exports) so it can be tested. */
(function (root) {
  'use strict';

  var FONTS = {
    sans:    { head: "Helvetica, Arial, sans-serif", body: "Helvetica, Arial, sans-serif", label: 'Clean sans-serif' },
    serif:   { head: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif", label: 'Classic serif' },
    modern:  { head: "'Trebuchet MS', Helvetica, Arial, sans-serif", body: "'Trebuchet MS', Helvetica, Arial, sans-serif", label: 'Friendly modern' },
    classic: { head: "Georgia, 'Times New Roman', serif", body: "Helvetica, Arial, sans-serif", label: 'Serif headlines, sans text' }
  };

  var DESIGN = {
    brand: '#d4163f', header_bg: '#110c4a', header_text: '#ffffff', page_bg: '#f5f4fa', card_bg: '#ffffff',
    text: '#1f2933', muted: '#6b7280', line: '#e4e7ec', link: '',
    font: 'classic', width: 600, radius: 10, button: 'pill', header_style: 'banner',
    logo_url: '', show_name: true, tagline: '',
    footer_text: '', address: '', unsub_text: 'Unsubscribe',
    social: { website: '', x: '', facebook: '', instagram: '', youtube: '' },
    from_name: '', from_email: '', reply_to: ''
  };

  var TEMPLATES = [
    { id: 'daily',  name: 'Daily briefing',   about: 'A tidy list of today’s stories with small pictures.' },
    { id: 'top',    name: 'Top story',        about: 'One big lead story with a picture, then more headlines.' },
    { id: 'cards',  name: 'Weekly digest',    about: 'Stories as picture cards in two columns.' },
    { id: 'letter', name: 'Editor’s letter', about: 'A personal text letter with a short reading list.' },
    { id: 'alert',  name: 'Breaking alert',   about: 'A loud, short message with one big button.' },
    { id: 'html',   name: 'My own HTML',      about: 'Paste your own email code.' }
  ];

  function E(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function color(v, d) { return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : d; }
  function link(u) { u = String(u || '').trim(); return /^(https?:\/\/|mailto:)/i.test(u) || u === '{{unsubscribe_url}}' ? u : '#'; }
  function pic(u) { u = String(u || '').trim(); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
  function lum(hex) { var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  function onColor(hex) { return lum(hex) > 0.62 ? '#111111' : '#ffffff'; }

  function mergeDesign(d) {
    d = d || {};
    var o = {}; Object.keys(DESIGN).forEach(function (k) { o[k] = d[k] !== undefined && d[k] !== null ? d[k] : DESIGN[k]; });
    o.social = {}; Object.keys(DESIGN.social).forEach(function (k) { o.social[k] = (d.social && d.social[k]) || ''; });
    o.brand = color(o.brand, DESIGN.brand); o.header_bg = color(o.header_bg, DESIGN.header_bg); o.header_text = color(o.header_text, DESIGN.header_text);
    o.page_bg = color(o.page_bg, DESIGN.page_bg); o.card_bg = color(o.card_bg, DESIGN.card_bg); o.text = color(o.text, DESIGN.text);
    o.muted = color(o.muted, DESIGN.muted); o.line = color(o.line, DESIGN.line); o.link = color(o.link, o.brand);
    o.width = Math.max(480, Math.min(700, parseInt(o.width, 10) || 600)); o.radius = Math.max(0, Math.min(28, parseInt(o.radius, 10) || 0));
    if (!FONTS[o.font]) o.font = 'classic';
    if (['pill', 'rounded', 'square'].indexOf(o.button) < 0) o.button = 'pill';
    if (['banner', 'centered', 'minimal'].indexOf(o.header_style) < 0) o.header_style = 'banner';
    return o;
  }

  /* text -> paragraphs (blank line = new paragraph), with bare web addresses turned into links */
  function paras(text, style, D) {
    return String(text || '').split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      var h = E(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)'"])/g, function (u) { return '<a href="' + u.replace(/&amp;/g, '&amp;') + '" style="color:' + D.link + '">' + u + '</a>'; });
      return '<p style="margin:0 0 14px;' + style + '">' + h + '</p>';
    }).join('');
  }

  function button(D, F, text, url) {
    var r = D.button === 'pill' ? 999 : D.button === 'rounded' ? 8 : 0, fg = onColor(D.brand);
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0"><tr><td bgcolor="' + D.brand + '" style="background:' + D.brand + ';border-radius:' + r + 'px">' +
      '<a href="' + E(link(url)) + '" style="display:inline-block;padding:13px 28px;font:bold 15px/1 ' + F.body + ';color:' + fg + ';text-decoration:none;border-radius:' + r + 'px">' + E(text) + '</a></td></tr></table>';
  }

  function cell(inner, D, extra) { return '<tr><td class="pad" style="padding:' + (extra || '0 32px 6px') + '">' + inner + '</td></tr>'; }

  function header(D, F, o) {
    var name = E(o.site_name || 'SparkNews'), logo = pic(D.logo_url);
    var img = logo ? '<img src="' + E(logo) + '" alt="' + name + '" height="40" style="display:inline-block;height:40px;width:auto;border:0;vertical-align:middle">' : '';
    var showName = D.show_name !== false || !logo;
    var nm = showName ? '<span style="vertical-align:middle;font-family:' + F.head + ';font-size:24px;font-weight:bold">' + name + '</span>' : '';
    var inner = img + (img && nm ? '&nbsp;&nbsp;' : '') + nm;
    var tag = D.tagline ? '<div style="font-family:' + F.body + ';font-size:13px;font-weight:normal;margin-top:6px;opacity:.85">' + E(D.tagline) + '</div>' : '';
    if (D.header_style === 'centered') {
      return '<tr><td class="pad" align="center" bgcolor="' + D.card_bg + '" style="background:' + D.card_bg + ';padding:26px 32px 18px;border-bottom:4px solid ' + D.brand + ';color:' + D.text + '">' + inner + tag + '</td></tr>';
    }
    if (D.header_style === 'minimal') {
      return '<tr><td class="pad" bgcolor="' + D.card_bg + '" style="background:' + D.card_bg + ';padding:20px 32px 14px;border-bottom:1px solid ' + D.line + ';color:' + D.text + '">' + inner + tag + '</td></tr>';
    }
    return '<tr><td class="pad" bgcolor="' + D.header_bg + '" style="background:' + D.header_bg + ';padding:24px 32px;color:' + D.header_text + '">' + inner + tag + '</td></tr>';
  }

  function footer(D, F) {
    var s = D.social, labels = { website: 'Website', x: 'X', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube' };
    var soc = Object.keys(labels).filter(function (k) { return s[k] && link(s[k]) !== '#'; }).map(function (k) {
      return '<a href="' + E(link(s[k])) + '" style="color:' + D.link + ';text-decoration:none;font-weight:bold">' + labels[k] + '</a>';
    }).join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;');
    var small = 'font-family:' + F.body + ';font-size:12px;line-height:1.6;color:' + D.muted;
    return '<tr><td class="pad" align="center" style="padding:22px 32px 28px;border-top:1px solid ' + D.line + ';' + small + '">' +
      (soc ? '<div style="font-size:14px;margin-bottom:12px">' + soc + '</div>' : '') +
      (D.footer_text ? '<div style="margin-bottom:8px">' + E(D.footer_text).replace(/\n/g, '<br>') + '</div>' : '') +
      '<div>You are receiving this email because you subscribed to the newsletter.</div>' +
      (D.address ? '<div>' + E(D.address).replace(/\n/g, '<br>') + '</div>' : '') +
      '<div style="margin-top:8px"><a href="{{unsubscribe_url}}" style="color:' + D.muted + ';text-decoration:underline">' + E(D.unsub_text || 'Unsubscribe') + '</a></div></td></tr>';
  }

  function shell(subject, pre, rows, D, F) {
    var w = D.width;
    var preHtml = pre ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">' + E(pre) + '&nbsp;&zwnj;'.repeat(40) + '</div>' : '';
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><title>' + E(subject) + '</title>' +
      '<style>body{margin:0;padding:0;-webkit-text-size-adjust:100%}img{border:0;outline:none;text-decoration:none}table{border-collapse:collapse}a{color:' + D.link + '}' +
      '@media only screen and (max-width:' + (w + 20) + 'px){.w{width:100%!important;max-width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}' +
      '.stack{display:block!important;width:100%!important;max-width:100%!important;padding-right:0!important;padding-left:0!important}.thumb{width:100%!important;height:auto!important;margin-bottom:12px}}</style></head>\n' +
      '<body style="margin:0;padding:0;background:' + D.page_bg + '">' + preHtml +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + D.page_bg + '" style="background:' + D.page_bg + '"><tr><td align="center" style="padding:24px 12px">' +
      '<table role="presentation" class="w" width="' + w + '" cellpadding="0" cellspacing="0" border="0" style="width:' + w + 'px;max-width:' + w + 'px;background:' + D.card_bg + ';border-radius:' + D.radius + 'px;overflow:hidden;font-family:' + F.body + ';color:' + D.text + '">' +
      rows + '</table></td></tr></table></body></html>';
  }

  function itemLink(it) { return E(link(it.url)); }
  function catLabel(it, D, F) {
    return it.category ? '<div style="font:bold 11px/1 ' + F.body + ';letter-spacing:.08em;text-transform:uppercase;color:' + D.brand + ';margin:0 0 6px">' + E(it.category) + '</div>' : '';
  }
  function h1(text, D, F, size) { return '<h1 style="margin:0 0 12px;font:bold ' + (size || 28) + 'px/1.2 ' + F.head + ';color:' + D.text + '">' + E(text) + '</h1>'; }

  /* ------------------------------------------------------------------ the templates */
  var BUILD = {
    daily: function (s, D, F, o) {
      var rows = cell(h1(s.heading || 'Today’s briefing', D, F, 28) + (o.date ? '<div style="color:' + D.muted + ';font-size:13px;margin:-6px 0 16px">' + E(o.date) + '</div>' : ''), D, '28px 32px 0') +
        (s.intro ? cell(paras(s.intro, 'font-size:16px;line-height:1.65', D), D, '6px 32px 10px') : '');
      (s.items || []).forEach(function (it) {
        var im = s.showImages !== false && pic(it.image);
        rows += '<tr><td class="pad" style="padding:18px 32px;border-top:1px solid ' + D.line + '"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          (im ? '<td class="stack" width="150" valign="top" style="width:150px;padding-right:18px"><a href="' + itemLink(it) + '"><img class="thumb" src="' + E(im) + '" width="150" alt="" style="display:block;width:150px;height:auto;border-radius:' + Math.min(D.radius, 8) + 'px"></a></td>' : '') +
          '<td class="stack" valign="top">' + catLabel(it, D, F) +
          '<a href="' + itemLink(it) + '" style="font:bold 19px/1.3 ' + F.head + ';color:' + D.text + ';text-decoration:none">' + E(it.title) + '</a>' +
          (s.showSummaries !== false && it.summary ? '<div style="font-size:14px;line-height:1.55;color:' + D.muted + ';margin-top:6px">' + E(it.summary) + '</div>' : '') +
          '<div style="margin-top:8px"><a href="' + itemLink(it) + '" style="font:bold 13px ' + F.body + ';color:' + D.link + ';text-decoration:none">Read more &rarr;</a></div></td></tr></table></td></tr>';
      });
      return rows + (s.outro ? cell(paras(s.outro, 'font-size:15px;line-height:1.65', D), D, '18px 32px 14px') : '');
    },

    top: function (s, D, F, o) {
      var items = (s.items || []).slice(), lead = items.shift(), rows = '';
      if (lead) {
        var im = s.showImages !== false && pic(lead.image);
        rows += (im ? '<tr><td style="padding:0"><a href="' + itemLink(lead) + '"><img src="' + E(im) + '" width="' + D.width + '" alt="" style="display:block;width:100%;max-width:' + D.width + 'px;height:auto"></a></td></tr>' : '') +
          cell(catLabel(lead, D, F) + h1(lead.title, D, F, 30) + (s.showSummaries !== false && lead.summary ? '<p style="margin:0 0 16px;font-size:17px;line-height:1.6;color:' + D.text + '">' + E(lead.summary) + '</p>' : '') +
            button(D, F, s.buttonText || 'Read the story', s.buttonUrl || lead.url), D, '26px 32px 8px');
      }
      if (s.intro) rows += cell(paras(s.intro, 'font-size:16px;line-height:1.65', D), D, '14px 32px 6px');
      if (items.length) {
        rows += cell('<div style="font:bold 12px/1 ' + F.body + ';letter-spacing:.08em;text-transform:uppercase;color:' + D.muted + '">' + E(s.heading || 'More stories') + '</div>', D, '22px 32px 4px');
        items.forEach(function (it) {
          rows += '<tr><td class="pad" style="padding:12px 32px;border-top:1px solid ' + D.line + '">' + catLabel(it, D, F) +
            '<a href="' + itemLink(it) + '" style="font:bold 17px/1.35 ' + F.head + ';color:' + D.text + ';text-decoration:none">' + E(it.title) + '</a>' +
            (s.showSummaries !== false && it.summary ? '<div style="font-size:14px;line-height:1.5;color:' + D.muted + ';margin-top:4px">' + E(it.summary) + '</div>' : '') + '</td></tr>';
        });
      }
      return rows + (s.outro ? cell(paras(s.outro, 'font-size:15px;line-height:1.65', D), D, '18px 32px 14px') : '');
    },

    cards: function (s, D, F, o) {
      var rows = cell(h1(s.heading || 'This week in review', D, F, 28), D, '28px 32px 0') + (s.intro ? cell(paras(s.intro, 'font-size:16px;line-height:1.65', D), D, '6px 32px 10px') : '');
      var items = s.items || [];
      function card(it) {
        var im = s.showImages !== false && pic(it.image);
        return '<td class="stack" width="50%" valign="top" style="width:50%;padding:0 8px 22px">' +
          (im ? '<a href="' + itemLink(it) + '"><img src="' + E(im) + '" width="250" alt="" style="display:block;width:100%;height:auto;border-radius:' + Math.min(D.radius, 8) + 'px;margin-bottom:10px"></a>' : '') +
          catLabel(it, D, F) + '<a href="' + itemLink(it) + '" style="font:bold 17px/1.35 ' + F.head + ';color:' + D.text + ';text-decoration:none">' + E(it.title) + '</a>' +
          (s.showSummaries !== false && it.summary ? '<div style="font-size:14px;line-height:1.5;color:' + D.muted + ';margin-top:6px">' + E(it.summary) + '</div>' : '') + '</td>';
      }
      for (var i = 0; i < items.length; i += 2) {
        rows += '<tr><td class="pad" style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
          card(items[i]) + (items[i + 1] ? card(items[i + 1]) : '<td class="stack hide" width="50%" style="width:50%"></td>') + '</tr></table></td></tr>';
      }
      return rows + (s.outro ? cell(paras(s.outro, 'font-size:15px;line-height:1.65', D), D, '10px 32px 14px') : '');
    },

    letter: function (s, D, F, o) {
      var serif = FONTS.serif.body, items = s.items || [];
      var rows = cell(h1(s.heading || 'A note from the editor', D, { head: serif, body: serif }, 26), D, '32px 32px 0') +
        cell(paras(s.intro || '', 'font:17px/1.75 ' + serif, D), D, '6px 32px 4px');
      if (items.length) {
        rows += cell('<div style="font:bold 12px/1 ' + F.body + ';letter-spacing:.08em;text-transform:uppercase;color:' + D.muted + ';margin:10px 0 10px">' + E(s.listTitle || 'Also worth reading') + '</div>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + items.map(function (it) {
            return '<tr><td valign="top" width="18" style="color:' + D.brand + ';font-size:18px;line-height:1.5">&bull;</td><td style="padding-bottom:10px"><a href="' + itemLink(it) + '" style="font:bold 16px/1.45 ' + serif + ';color:' + D.link + ';text-decoration:none">' + E(it.title) + '</a>' +
              (s.showSummaries !== false && it.summary ? '<div style="font:14px/1.5 ' + F.body + ';color:' + D.muted + '">' + E(it.summary) + '</div>' : '') + '</td></tr>';
          }).join('') + '</table>', D, '4px 32px 6px');
      }
      if (s.outro) rows += cell(paras(s.outro, 'font:17px/1.75 ' + serif, D), D, '10px 32px 4px');
      if (s.signoff) rows += cell('<p style="margin:6px 0 0;font:italic 18px/1.5 ' + serif + ';color:' + D.text + '">' + E(s.signoff).replace(/\n/g, '<br>') + '</p>', D, '4px 32px 26px');
      return rows;
    },

    alert: function (s, D, F, o) {
      var it = (s.items || [])[0], fg = onColor(D.brand);
      var rows = '<tr><td class="pad" bgcolor="' + D.brand + '" align="left" style="background:' + D.brand + ';color:' + fg + ';padding:12px 32px;font:bold 12px/1 ' + F.body + ';letter-spacing:.14em;text-transform:uppercase">' + E(s.label || 'Breaking news') + '</td></tr>';
      rows += cell(h1(s.heading || (it && it.title) || 'Headline', D, F, 32) +
        (s.intro ? paras(s.intro, 'font-size:17px;line-height:1.65', D) : (it && it.summary ? '<p style="margin:0 0 14px;font-size:17px;line-height:1.65">' + E(it.summary) + '</p>' : '')) +
        ((s.buttonUrl || it) ? '<div style="margin-top:18px">' + button(D, F, s.buttonText || 'Read the full story', s.buttonUrl || it.url) + '</div>' : ''), D, '28px 32px 14px');
      if (s.outro) rows += cell(paras(s.outro, 'font-size:14px;line-height:1.6;color:' + D.muted, D), D, '6px 32px 18px');
      return rows;
    }
  };

  /* ------------------------------------------------------------------ public */
  var SAMPLE_VARS = { unsubscribe_url: '#unsubscribe', name: 'Alex', email: 'alex@example.com' };

  /** Final email for a composer state. Placeholders {{unsubscribe_url}} {{name}} {{email}} are left in for the sender. */
  function render(state, design, opts) {
    var s = state || {}, o = opts || {}, D = mergeDesign(design), F = FONTS[D.font];
    if (s.template === 'html') {
      var body = String(s.html || '');
      if (s.wrap === 'branded') {
        return shell(s.subject, s.preheader, header(D, F, o) + '<tr><td class="pad" style="padding:28px 32px;font-size:16px;line-height:1.65;color:' + D.text + '">' + body + '</td></tr>' + footer(D, F), D, F);
      }
      return body;
    }
    var build = BUILD[s.template] || BUILD.daily;
    return shell(s.subject, s.preheader, header(D, F, o) + build(s, D, F, o) + footer(D, F), D, F);
  }

  /** What a reader sees: placeholders filled in with sample values (the real values are filled in when sending). */
  function preview(state, design, opts) {
    var html = render(state, design, opts);
    if (state && state.template === 'html' && state.wrap !== 'branded' && !/\{\{\s*unsubscribe_url\s*\}\}/.test(html)) {
      html += '<div style="max-width:600px;margin:24px auto;padding:0 16px;font:12px/1.6 Arial,Helvetica,sans-serif;color:#6b7280;text-align:center">You are receiving this email because you subscribed.<br><a href="{{unsubscribe_url}}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a></div>';
    }
    return html.replace(/\{\{\s*(unsubscribe_url|name|email)\s*\}\}/g, function (_m, k) { return E(SAMPLE_VARS[k]); });
  }

  var api = { render: render, preview: preview, TEMPLATES: TEMPLATES, FONTS: FONTS, DESIGN: DESIGN, mergeDesign: mergeDesign, escape: E };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SparkEmail = api;
})(typeof window !== 'undefined' ? window : this);
