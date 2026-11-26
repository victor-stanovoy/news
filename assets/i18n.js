/* Interface translation. Swaps the site's own buttons and labels (not the articles) into the visitor's language.
   Languages: the six UN languages (Arabic, Chinese, English, French, Russian, Spanish) plus German. Right-to-left for Arabic. */
(function () {
  'use strict';
  var LANGS = { en: 'English', ar: 'العربية', zh: '中文', fr: 'Français', ru: 'Русский', es: 'Español', de: 'Deutsch' };
  var ORDER = ['ar', 'zh', 'fr', 'ru', 'es', 'de'];
  var RTL = { ar: 1 };
  /* English text -> [ar, zh, fr, ru, es, de] */
  var D = {
    'Skip to content': ['انتقل إلى المحتوى', '跳到正文', 'Aller au contenu', 'Перейти к содержимому', 'Saltar al contenido', 'Zum Inhalt springen'],
    'Home': ['الرئيسية', '首页', 'Accueil', 'Главная', 'Inicio', 'Start'],
    'Live': ['مباشر', '直播', 'En direct', 'Эфир', 'En vivo', 'Live'],
    'More': ['المزيد', '更多', 'Plus', 'Ещё', 'Más', 'Mehr'],
    'LATEST': ['الأحدث', '最新', 'À LA UNE', 'СВЕЖЕЕ', 'ÚLTIMO', 'NEU'],
    'About': ['من نحن', '关于', 'À propos', 'О нас', 'Acerca de', 'Über uns'],
    'All articles': ['كل المقالات', '全部文章', 'Tous les articles', 'Все статьи', 'Todos los artículos', 'Alle Artikel'],
    'Cookie settings': ['إعدادات ملفات تعريف الارتباط', 'Cookie 设置', 'Réglages des cookies', 'Настройки cookie', 'Ajustes de cookies', 'Cookie-Einstellungen'],
    'Settings': ['الإعدادات', '设置', 'Réglages', 'Настройки', 'Ajustes', 'Einstellungen'],
    'Privacy': ['الخصوصية', '隐私', 'Confidentialité', 'Конфиденциальность', 'Privacidad', 'Datenschutz'],
    'Search': ['بحث', '搜索', 'Rechercher', 'Поиск', 'Buscar', 'Suchen'],
    'Search articles': ['ابحث في المقالات', '搜索文章', 'Rechercher des articles', 'Поиск статей', 'Buscar artículos', 'Artikel suchen'],
    'Sections': ['الأقسام', '栏目', 'Rubriques', 'Разделы', 'Secciones', 'Rubriken'],
    'Switch light / dark mode': ['تبديل الوضع الفاتح / الداكن', '切换浅色 / 深色模式', 'Basculer clair / sombre', 'Светлая / тёмная тема', 'Cambiar modo claro / oscuro', 'Hell / Dunkel umschalten'],
    'Light / dark': ['فاتح / داكن', '浅色 / 深色', 'Clair / sombre', 'Светлая / тёмная', 'Claro / oscuro', 'Hell / Dunkel'],
    'Latest headlines': ['آخر العناوين', '最新头条', 'Dernières dépêches', 'Последние заголовки', 'Últimos titulares', 'Neueste Schlagzeilen'],
    'Pause ticker': ['إيقاف الشريط مؤقتاً', '暂停滚动条', 'Mettre le bandeau en pause', 'Приостановить ленту', 'Pausar el rótulo', 'Laufband anhalten'],
    'Pause / play': ['إيقاف / تشغيل', '暂停 / 播放', 'Pause / lecture', 'Пауза / воспроизведение', 'Pausa / reproducir', 'Pause / Wiedergabe'],
    'By': ['بقلم', '作者', 'Par', 'Автор:', 'Por', 'Von'],
    'Edit this article': ['تحرير هذا المقال', '编辑本文', 'Modifier cet article', 'Редактировать статью', 'Editar este artículo', 'Artikel bearbeiten'],
    'Sources & credits': ['المصادر والاعتمادات', '来源与鸣谢', 'Sources et crédits', 'Источники и благодарности', 'Fuentes y créditos', 'Quellen und Nachweise'],
    'Share': ['مشاركة', '分享', 'Partager', 'Поделиться', 'Compartir', 'Teilen'],
    'Email': ['البريد الإلكتروني', '电子邮件', 'E-mail', 'Эл. почта', 'Correo', 'E-Mail'],
    'Cover Image:': ['صورة الغلاف:', '封面图片：', 'Image de couverture :', 'Обложка:', 'Imagen de portada:', 'Titelbild:'],
    'Read the story →': ['اقرأ القصة ←', '阅读全文 →', 'Lire l’article →', 'Читать →', 'Leer la historia →', 'Zum Artikel →'],
    'Most read': ['الأكثر قراءة', '最多阅读', 'Les plus lus', 'Самое читаемое', 'Lo más leído', 'Meistgelesen'],
    'Spotlight': ['تحت الضوء', '焦点', 'À la une', 'В центре внимания', 'En portada', 'Im Fokus'],
    'Explore': ['استكشف', '探索', 'Explorer', 'Обзор', 'Explorar', 'Entdecken'],
    'Latest news': ['آخر الأخبار', '最新消息', 'Dernières nouvelles', 'Последние новости', 'Últimas noticias', 'Neueste Nachrichten'],
    'Read the latest stories →': ['اقرأ أحدث القصص ←', '阅读最新报道 →', 'Lire les derniers articles →', 'Читать свежие материалы →', 'Leer las últimas historias →', 'Die neuesten Artikel lesen →'],
    'Our mission': ['مهمتنا', '我们的使命', 'Notre mission', 'Наша миссия', 'Nuestra misión', 'Unsere Mission'],
    'Our main publication': ['منشورنا الرئيسي', '我们的主要刊物', 'Notre publication principale', 'Наше главное издание', 'Nuestra publicación principal', 'Unsere Hauptpublikation'],
    'School media partners': ['شركاء إعلام المدارس', '学校媒体伙伴', 'Médias scolaires partenaires', 'Школьные медиа-партнёры', 'Medios escolares asociados', 'Schulmedien-Partner'],
    'Take me home': ['خذني إلى الرئيسية', '回到首页', 'Retour à l’accueil', 'На главную', 'Volver al inicio', 'Zur Startseite'],
    'Surprise me': ['فاجئني', '给我惊喜', 'Surprenez-moi', 'Удиви меня', 'Sorpréndeme', 'Überrasch mich'],
    'Page not found': ['الصفحة غير موجودة', '页面未找到', 'Page introuvable', 'Страница не найдена', 'Página no encontrada', 'Seite nicht gefunden'],
    'This page wandered off': ['هذه الصفحة ضلّت طريقها', '这个页面走丢了', 'Cette page s’est égarée', 'Эта страница потерялась', 'Esta página se perdió', 'Diese Seite hat sich verlaufen'],
    'Subscribe': ['اشترك', '订阅', 'S’abonner', 'Подписаться', 'Suscribirse', 'Abonnieren'],
    'Email address': ['البريد الإلكتروني', '电子邮箱', 'Adresse e-mail', 'Адрес эл. почты', 'Correo electrónico', 'E-Mail-Adresse'],
    'Newsletter': ['النشرة الإخبارية', '新闻简报', 'Newsletter', 'Рассылка', 'Boletín', 'Newsletter'],
    'Original': ['الأصل', '原文', 'Original', 'Оригинал', 'Original', 'Original'],
    'This is an automatic translation.': ['هذه ترجمة آلية.', '这是自动翻译。', 'Ceci est une traduction automatique.', 'Это автоматический перевод.', 'Esta es una traducción automática.', 'Dies ist eine automatische Übersetzung.'],
    'Read the original': ['اقرأ النص الأصلي', '阅读原文', 'Lire l’original', 'Читать оригинал', 'Leer el original', 'Original lesen'],
    'Browser tab ticker': ['شريط عنوان التبويب', '浏览器标签滚动标题', 'Bandeau dans l’onglet', 'Бегущая строка во вкладке', 'Rótulo en la pestaña', 'Laufschrift im Tab'],
    'Appearance': ['المظهر', '外观', 'Apparence', 'Оформление', 'Apariencia', 'Darstellung'],
    'Match my device': ['مطابقة جهازي', '跟随设备', 'Suivre mon appareil', 'Как на устройстве', 'Igual que mi dispositivo', 'Wie mein Gerät'],
    'Light': ['فاتح', '浅色', 'Clair', 'Светлая', 'Claro', 'Hell'],
    'Dark': ['داكن', '深色', 'Sombre', 'Тёмная', 'Oscuro', 'Dunkel'],
    'Sepia': ['بني دافئ', '护眼棕', 'Sépia', 'Сепия', 'Sepia', 'Sepia'],
    'Midnight': ['منتصف الليل', '午夜黑', 'Minuit', 'Полночь', 'Medianoche', 'Mitternacht'],
    'High contrast': ['تباين عالٍ', '高对比度', 'Contraste élevé', 'Высокий контраст', 'Alto contraste', 'Hoher Kontrast'],
    'Forest': ['غابة', '森林', 'Forêt', 'Лес', 'Bosque', 'Wald'],
    'Topics': ['المواضيع', '主题', 'Rubriques', 'Темы', 'Temas', 'Themen'],
    'Quick reads': ['قراءات سريعة', '快读', 'Lectures rapides', 'Быстро прочесть', 'Lecturas rápidas', 'Kurz gelesen'],
    'Saved for you': ['محفوظ لك', '为你保存', 'Enregistrés pour vous', 'Сохранено для вас', 'Guardado para ti', 'Für dich gespeichert'],
    'Sparks': ['ومضات', '快讯', 'Flashs', 'Коротко', 'Destellos', 'Sparks'],
    'Series': ['سلاسل', '系列', 'Séries', 'Серии', 'Series', 'Serien'],
    'All series': ['كل السلاسل', '所有系列', 'Toutes les séries', 'Все серии', 'Todas las series', 'Alle Serien'],
    'Start with part 1': ['ابدأ بالجزء 1', '从第1部分开始', 'Commencer par la partie 1', 'Начать с части 1', 'Empezar por la parte 1', 'Mit Teil 1 beginnen'],
    'Previous': ['السابق', '上一篇', 'Précédent', 'Назад', 'Anterior', 'Zurück'],
    'Next': ['التالي', '下一篇', 'Suivant', 'Далее', 'Siguiente', 'Weiter'],
    'Photo': ['صورة', '图片', 'Photo', 'Фото', 'Foto', 'Foto'],
    'Save': ['حفظ', '保存', 'Enregistrer', 'Сохранить', 'Guardar', 'Speichern'],
    'Saved articles': ['المقالات المحفوظة', '已保存的文章', 'Articles enregistrés', 'Сохранённые статьи', 'Artículos guardados', 'Gespeicherte Artikel'],
    'Nothing saved yet.': ['لا شيء محفوظ بعد.', '尚未保存任何内容。', 'Rien d’enregistré pour le moment.', 'Пока ничего не сохранено.', 'Aún no hay nada guardado.', 'Noch nichts gespeichert.'],
    'Copy link': ['نسخ الرابط', '复制链接', 'Copier le lien', 'Копировать ссылку', 'Copiar enlace', 'Link kopieren'],
    'Copied': ['تم النسخ', '已复制', 'Copié', 'Скопировано', 'Copiado', 'Kopiert'],
    'Text size': ['حجم النص', '文字大小', 'Taille du texte', 'Размер текста', 'Tamaño del texto', 'Textgröße'],
    'Smaller': ['أصغر', '较小', 'Plus petit', 'Меньше', 'Más pequeño', 'Kleiner'],
    'Standard': ['عادي', '标准', 'Standard', 'Обычный', 'Estándar', 'Standard'],
    'Larger': ['أكبر', '较大', 'Plus grand', 'Крупнее', 'Más grande', 'Größer'],
    'Language': ['اللغة', '语言', 'Langue', 'Язык', 'Idioma', 'Sprache'],
    'Slow': ['بطيء', '慢', 'Lent', 'Медленно', 'Lento', 'Langsam'],
    'Normal': ['عادي', '正常', 'Normal', 'Обычно', 'Normal', 'Normal'],
    'Fast': ['سريع', '快', 'Rapide', 'Быстро', 'Rápido', 'Schnell'],
    'Read aloud': ['استمع إلى المقال', '朗读', 'Écouter', 'Слушать', 'Escuchar', 'Vorlesen'],
    'Your privacy choices': ['خياراتك للخصوصية', '您的隐私选择', 'Vos choix de confidentialité', 'Ваш выбор конфиденциальности', 'Tus opciones de privacidad', 'Ihre Datenschutzwahl'],
    'Accept all': ['قبول الكل', '全部接受', 'Tout accepter', 'Принять все', 'Aceptar todo', 'Alle akzeptieren'],
    'Only necessary': ['الضروري فقط', '仅必要项', 'Uniquement l’essentiel', 'Только необходимые', 'Solo necesarias', 'Nur notwendige'],
    'Customise': ['تخصيص', '自定义', 'Personnaliser', 'Настроить', 'Personalizar', 'Anpassen'],
    'Save choices': ['حفظ الاختيارات', '保存选择', 'Enregistrer', 'Сохранить выбор', 'Guardar elecciones', 'Auswahl speichern']
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var LOCALE = { ar: 'ar', zh: 'zh-CN', fr: 'fr', ru: 'ru', es: 'es', de: 'de' };
  var PAT = [   /* texts with a changing part */
    [/^More in (.+)$/, { ar: 'المزيد في $1', zh: '更多“$1”', fr: 'Plus dans $1', ru: 'Ещё в разделе «$1»', es: 'Más en $1', de: 'Mehr in $1' }],
    [/^(\d+) articles?$/, { ar: '$1 مقالات', zh: '$1 篇文章', fr: '$1 articles', ru: 'Статей: $1', es: '$1 artículos', de: '$1 Artikel' }],
    [/^(\d+) min read$/, { ar: 'قراءة $1 دقيقة', zh: '阅读 $1 分钟', fr: 'Lecture : $1 min', ru: 'Чтение: $1 мин', es: 'Lectura: $1 min', de: '$1 Min. Lesezeit' }],
    [/^(\d+) words$/, { ar: '$1 كلمة', zh: '$1 字', fr: '$1 mots', ru: 'Слов: $1', es: '$1 palabras', de: '$1 Wörter' }]
  ];
  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

  var cfg = {}; try { cfg = (JSON.parse((document.getElementById('spark-ticker-data') || {}).textContent || '{}') || {}).i18n || {}; } catch (e) {}
  var base = String(cfg.site || document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
  var enabled = cfg.on !== false;

  function stored() { try { return localStorage.getItem('spark-lang') || ''; } catch (e) { return ''; } }
  function pick() {
    var s = stored(); if (s && (s === 'en' || D['Home'][ORDER.indexOf(s)])) return s;
    var d = String(cfg.def || 'auto').toLowerCase();
    if (d !== 'auto') return d;
    var nav = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS[nav] ? nav : base;
  }
  var cur = base, back = new WeakMap(), lookups = {};
  function table(lang) {
    if (lookups[lang]) return lookups[lang];
    var i = ORDER.indexOf(lang), t = {};
    Object.keys(D).forEach(function (k) { t[k] = D[k][i]; });
    var X = cfg.extra || {}; Object.keys(X).forEach(function (k) { if (X[k] && X[k][i]) t[k] = X[k][i]; });   /* texts translated from Settings override the built-in ones */
    return (lookups[lang] = t);
  }
  function tr(text, lang) {
    var t = text.trim(); if (!t) return null;
    var hit = table(lang)[t]; if (hit) return text.replace(t, hit);
    for (var i = 0; i < PAT.length; i++) { var m = t.match(PAT[i][0]); if (m && PAT[i][1][lang]) return text.replace(t, t.replace(PAT[i][0], PAT[i][1][lang])); }
    var d = t.match(/^(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})$/);
    if (d) { try { return text.replace(t, new Date(+d[3], MONTHS.indexOf(d[2]), +d[1]).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric' })); } catch (e) {} }
    var w = t.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/);
    if (w) { try { return text.replace(t, new Date(+w[3], MONTHS.indexOf(w[1]), +w[2]).toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })); } catch (e) {} }
    return null;
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1 };
  function skipNode(n) { for (var e = n.parentNode; e && e.nodeType === 1; e = e.parentNode) { if (SKIP[e.tagName] || e.hasAttribute('data-no-i18n') || e.getAttribute('translate') === 'no' || e.classList.contains('body')) return true; } return false; }
  function walk(root, lang) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (n) {
      if (skipNode(n)) return;
      var orig = back.has(n) ? back.get(n) : n.nodeValue;
      var out = lang === base ? null : tr(orig, lang);
      if (out) { if (!back.has(n)) back.set(n, orig); n.nodeValue = out; }
      else if (back.has(n)) { n.nodeValue = back.get(n); back.delete(n); }
    });
    [].forEach.call(root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title],[alt]') : [], function (e) {
      if (skipNode(e.firstChild || e)) return;
      ATTRS.forEach(function (a) {
        if (!e.hasAttribute(a)) return;
        var k = 'data-i18n-' + a, orig = e.hasAttribute(k) ? e.getAttribute(k) : e.getAttribute(a);
        var out = lang === base ? null : tr(orig, lang);
        if (out) { e.setAttribute(k, orig); e.setAttribute(a, out); }
        else if (e.hasAttribute(k)) { e.setAttribute(a, e.getAttribute(k)); e.removeAttribute(k); }
      });
    });
  }
  var busy = false, mo = null;
  function apply(lang) {
    cur = lang; busy = true;
    var html = document.documentElement;
    if (lang !== base) { html.setAttribute('data-ui', lang); html.setAttribute('dir', RTL[lang] ? 'rtl' : 'ltr'); }
    else { html.removeAttribute('data-ui'); html.setAttribute('dir', RTL[base] ? 'rtl' : 'ltr'); }
    if (!document.querySelector('main[data-page=article][lang]')) html.setAttribute('lang', lang);   /* a translated article keeps its own language */
    walk(document.body, lang);
    pages(lang);
    busy = false;
    var sel = document.querySelector('.uilang select'); if (sel) sel.value = lang;
    var ps = document.getElementById('ui-lang-pref'); if (ps) ps.value = stored() || 'auto';
  }
  /* fixed pages (About, Privacy) carry a translated copy per language, made when the site was built */
  function pages(lang) {
    var blocks = document.querySelectorAll('[data-tr]'); if (!blocks.length) return;
    var orig = document.querySelector('[data-orig]'), any = false;
    [].forEach.call(blocks, function (b) {
      var on = b.getAttribute('data-tr') === lang && lang !== base; b.hidden = !on; any = any || on;
      if (on && !b.querySelector('.trnote')) {
        var n = document.createElement('p'); n.className = 'trnote'; n.setAttribute('data-no-i18n', '');
        var a = document.createElement('a'); a.href = '#'; a.textContent = D['Read the original'][ORDER.indexOf(lang)];
        a.addEventListener('click', function (e) { e.preventDefault(); set('en'); });
        n.appendChild(document.createTextNode(D['This is an automatic translation.'][ORDER.indexOf(lang)] + ' ')); n.appendChild(a); b.insertBefore(n, b.firstChild);
      }
    });
    if (orig) orig.hidden = any;
  }
  function set(lang) {
    try { if (lang === 'auto') localStorage.removeItem('spark-lang'); else localStorage.setItem('spark-lang', lang); } catch (e) {}
    apply(lang === 'auto' ? pick() : lang);
  }
  function picker() {
    var foot = document.querySelector('footer .wrap, footer'); if (!foot || document.querySelector('.uilang')) return;
    var w = document.createElement('label'); w.className = 'uilang'; w.setAttribute('data-no-i18n', '');
    var s = document.createElement('select'); s.setAttribute('aria-label', 'Language');
    var all = ['en'].concat(ORDER);
    if (all.indexOf(base) < 0) all.unshift(base);
    all.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = LANGS[c] || c; s.appendChild(o); });
    s.addEventListener('change', function () { set(s.value); });
    var ic = document.createElement('span'); ic.setAttribute('aria-hidden', 'true'); ic.textContent = '🌐';
    w.appendChild(ic); w.appendChild(s); foot.appendChild(w); s.value = cur;
  }
  function start() {
    if (!enabled) return;
    picker();
    apply(pick());
    if ('MutationObserver' in window) {
      var t = 0;
      mo = new MutationObserver(function () { if (busy || cur === base) return; clearTimeout(t); t = setTimeout(function () { busy = true; walk(document.body, cur); busy = false; }, 120); });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }
  window.SparkI18n = { set: set, languages: LANGS, current: function () { return cur; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
