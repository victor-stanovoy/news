#!/usr/bin/env python3
"""
Static news site generator. Python 3.9+, standard library only.

    python build.py            # builds the site into ./_site
    python -m http.server -d _site 8000   # preview at http://localhost:8000

Drop article CSV files into ./articles/ (any file name, any number of rows).
See README.md for the column format.
"""
import csv
import hashlib
import html
import json
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARTICLES_DIR = ROOT / "articles"
ASSETS_DIR = ROOT / "assets"
OUT = ROOT / "_site"

csv.field_size_limit(10 ** 9)

LANG_NAMES = {"en": "English", "de": "Deutsch", "fr": "Français", "es": "Español", "it": "Italiano",
              "pt": "Português", "ru": "Русский", "zh": "中文", "ja": "日本語", "ko": "한국어",
              "ar": "العربية", "tr": "Türkçe", "pl": "Polski", "nl": "Nederlands", "uk": "Українська",
              "hi": "हिन्दी", "he": "עברית", "fa": "فارسی", "ur": "اردو"}
RTL_LANGS = {"ar", "he", "fa", "ur"}
SPARK_PATH = "M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z"

DEFAULT_CONFIG = {
    "site_name": "SparkNews™",
    "logo_left": "Spark",           # logo is drawn as  <spark icon> Spark News ™
    "logo_right": "News",
    "tagline": "Independent news, analysis and features",
    "language": "en",
    "base_url": "",                 # e.g. https://victor-stanovoy.github.io/news  (used for social tags)
    "breaking_max_age_days": 7,     # breaking banner hides after this many days (0 = never hide)
    "most_read_count": 5,
    "home_category_sections": 6,    # how many category blocks on the homepage
    "nav_max": 8,                   # sections shown in the menu; the rest go under "More"
    "nav_order": [],                # optional: categories listed first in the menu
    "footer_text": "",
    "ticker": {
        "enabled": True,            # scrolling headline bar under the menu
        "label": "LATEST",          # text on the coloured tag at the left
        "count": 10,                # how many of the newest articles to show
        "speed": 60,                # scroll speed in pixels per second
        "custom": [],               # your own headlines instead of the newest articles:
                                    #   ["Plain text", {"text": "With link", "url": "a/some-article.html"}]
        "tab": {
            "enabled": True,        # turn the browser tab title into a ticker when the visitor leaves the page
            "mode": "scroll",       # "scroll" = text slides along, "headline" = one headline at a time
            "prefix": "\u26a1 ",     # shown before the headlines
            "separator": "  \u25cf  ",
            "window_chars": 34,     # how many characters of the title are visible at once
            "step": 2,              # characters moved per tick
            "interval_ms": 350,     # time between ticks (scroll mode)
            "headline_interval_ms": 3000,   # time per headline (headline mode)
        },
    },
}


# --------------------------------------------------------------------------- helpers
def esc(s):
    return html.escape(s or "", quote=True)


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes", "y")


def slugify(s):
    s = re.sub(r"[^\w\s-]", "", (s or "").lower(), flags=re.UNICODE)
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s[:80] or "article"


def parse_dt(v):
    v = (v or "").strip()
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
            try:
                d = datetime.strptime(v, fmt)
                break
            except ValueError:
                d = None
        if d is None:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def fmt_date(d):
    return f"{d.day} {d.strftime('%B %Y')}" if d else ""


def fmt_datetime(d):
    return f"{d.day} {d.strftime('%B %Y, %H:%M')} UTC" if d else ""


def to_int(v, default=0):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return default


def json_list(v):
    v = (v or "").strip()
    if not v:
        return []
    try:
        data = json.loads(v)
        return data if isinstance(data, list) else []
    except ValueError:
        return [x.strip() for x in re.split(r"[\n,]", v) if x.strip()]


def strip_tags(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h or "")
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(h)).strip()


def clean_title(t):
    return (t or "").strip().strip("*").strip()


def sanitize(h):
    h = re.sub(r"(?is)<script\b.*?</script>", "", h)
    h = re.sub(r"(?i)\son\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", h)
    h = re.sub(r"(?i)(href|src)\s*=\s*([\"'])\s*javascript:[^\"']*\2", r"\1=\2#\2", h)
    return h


def plain_to_html(t):
    paras = [p.strip() for p in re.split(r"\n\s*\n", t.strip()) if p.strip()]
    return "".join(f"<p>{esc(p).replace(chr(10), '<br>')}</p>" for p in paras)


def linkify(escaped):
    return re.sub(r"(https?://[^\s<]+)", r'<a href="\1" rel="noopener" target="_blank">\1</a>', escaped)


def cat_hue(name):
    return int(hashlib.md5(name.encode()).hexdigest()[:4], 16) % 360


# --------------------------------------------------------------------------- loading
class Article:
    pass


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    p = ROOT / "site.json"
    if p.exists():
        def merge(base, new):
            for k, v in new.items():
                if isinstance(v, dict) and isinstance(base.get(k), dict):
                    merge(base[k], v)
                else:
                    base[k] = v
        cfg = json.loads(json.dumps(cfg))
        merge(cfg, json.loads(p.read_text(encoding="utf-8")))
    return cfg


def load_articles(cfg, now):
    files = sorted(p for p in ARTICLES_DIR.rglob("*.csv") if "images" not in p.relative_to(ARTICLES_DIR).parts)
    arts, skipped = [], {"draft": 0, "taken_down": 0, "scheduled": 0, "no_title": 0}
    seen_ids = set()
    for f in files:
        with open(f, encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                g = lambda k: (row.get(k) or "").strip()
                title = clean_title(g("title"))
                if not title:
                    skipped["no_title"] += 1
                    continue
                if truthy(g("taken_down")):
                    skipped["taken_down"] += 1
                    continue
                status = g("status").lower() or "published"
                sched = parse_dt(g("scheduled_publish_at"))
                if status == "scheduled":
                    if not sched or sched > now:
                        skipped["scheduled"] += 1
                        continue
                elif status != "published":
                    skipped["draft"] += 1
                    continue
                rid = g("id")
                if rid and rid in seen_ids:
                    continue
                seen_ids.add(rid)

                a = Article()
                a.src = f.name
                a.id = rid
                a.title = title
                a.subtitle = g("subtitle")
                a.category = g("category") or "News"
                a.author = g("author_name")
                a.date = parse_dt(g("published_at")) or sched or parse_dt(g("created_date")) or now
                a.updated = parse_dt(g("updated_date"))
                a.image_raw = g("image_url")
                a.fx = min(100, max(0, to_int(g("cover_focus_x"), 50)))
                a.fy = min(100, max(0, to_int(g("cover_focus_y"), 50)))
                a.extra_images = [u for u in json_list(g("additional_images")) if isinstance(u, str) and u.strip()]
                a.layout = g("image_layout") or "grid"
                a.video = g("reporter_video_url")
                a.breaking = truthy(g("is_breaking"))
                a.breaking_text = g("breaking_description") or title
                a.featured = truthy(g("is_featured"))
                a.views = to_int(g("views"))
                a.is_live = truthy(g("is_live_update"))
                a.live_label = g("live_update_label") or "LIVE"
                a.live_updates = [u for u in json_list(g("live_updates")) if isinstance(u, dict)]
                a.citations = row.get("citations") or ""
                a.ai_translated = truthy(g("is_ai_translated"))
                a.translations = {}
                try:
                    tdata = json.loads(g("translations") or "{}")
                except ValueError:
                    tdata = {}
                if isinstance(tdata, dict):
                    for lang, v in tdata.items():
                        if isinstance(v, dict) and (v.get("content") or v.get("title")):
                            a.translations[lang.lower()] = v
                a.series_id = g("series_id")
                a.series_order = to_int(g("series_order"))
                a.verified = truthy(g("author_verified"))
                ctype = g("content_type").lower()
                content = row.get("content") or ""
                a.raw_content = content
                a.is_embed = ctype in ("html", "interactive") or bool(
                    re.match(r"\s*<!doctype|\s*<html", content, re.I))
                if not a.is_embed and not re.search(r"<\w+[^>]*>", content):
                    content = plain_to_html(content)
                a.body_html = "" if a.is_embed else sanitize(content)
                text = strip_tags(content) if not a.is_embed else strip_tags(re.sub(r"(?is)<head.*?</head>", "", content))
                a.words = len(text.split())
                a.read_min = max(1, round(a.words / 220))
                ex = a.subtitle or text
                a.excerpt = ex if len(ex) <= 170 else ex[:167].rsplit(" ", 1)[0] + "…"
                a.cat_slug = slugify(a.category)
                arts.append(a)

    arts.sort(key=lambda a: a.date, reverse=True)
    used = {}
    for a in arts:
        base = slugify(a.title)
        n = used.get(base, 0)
        used[base] = n + 1
        a.slug = base if n == 0 else f"{base}-{n + 1}"
    return arts, skipped


# --------------------------------------------------------------------------- rendering
class Site:
    def __init__(self, cfg, arts, now):
        self.cfg, self.arts, self.now = cfg, arts, now
        cats = {}
        for a in arts:
            cats.setdefault(a.cat_slug, {"name": a.category, "items": []})["items"].append(a)
        order = [slugify(n) for n in cfg["nav_order"]]
        self.cats = dict(sorted(cats.items(), key=lambda kv: (
            order.index(kv[0]) if kv[0] in order else 999, -len(kv[1]["items"]), kv[1]["name"])))

    # -- urls / media
    def url(self, a, root):
        return f"{root}a/{a.slug}.html"

    def img(self, raw, root):
        raw = (raw or "").strip()
        if not raw:
            return ""
        if raw.startswith("/9j/"):
            return "data:image/jpeg;base64," + raw
        if re.match(r"^(https?:)?//|^data:", raw):
            return raw
        raw = raw.lstrip("./")
        if raw.startswith("images/"):
            raw = raw[len("images/"):]
        return f"{root}images/{raw}"

    def picture(self, a, root, cls="", lazy=True):
        src = self.img(a.image_raw, root)
        if not src:
            h = cat_hue(a.category)
            return (f'<div class="ph {cls}" style="--h:{h}" aria-hidden="true">'
                    f'<span>{esc(a.category[:1].upper())}</span></div>')
        return (f'<img class="{cls}" src="{esc(src)}" alt="" '
                f'style="object-position:{a.fx}% {a.fy}%" referrerpolicy="no-referrer" onerror="this.remove()"'
                f'{" loading=lazy" if lazy else ""}>')

    # -- chrome
    def head(self, title, root, desc="", image="", path="", kind="website", alts=None):
        cfg = self.cfg
        full = f"{title} | {cfg['site_name']}" if title else cfg["site_name"]
        desc = desc or cfg["tagline"]
        base = cfg["base_url"].rstrip("/")
        og = f'<meta property="og:title" content="{esc(title or cfg["site_name"])}">' \
             f'<meta property="og:description" content="{esc(desc)}">' \
             f'<meta property="og:type" content="{kind}">' \
             f'<meta property="og:site_name" content="{esc(cfg["site_name"])}">'
        if image and image.startswith("http"):
            og += f'<meta property="og:image" content="{esc(image)}"><meta name="twitter:card" content="summary_large_image">'
        if base and path:
            og += f'<link rel="canonical" href="{esc(base + "/" + path)}"><meta property="og:url" content="{esc(base + "/" + path)}">'
        alt = "".join(f'<link rel="alternate" hreflang="{l}" href="{esc(base + "/" + u if base else u)}">' for l, u in (alts or []))
        icon = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%230e1116'/%3E"
                "%3Cpath transform='translate(3 3) scale(.75)' fill='%23ff6a2b' d='" + SPARK_PATH + "'/%3E%3C/svg%3E")
        return (f'<!doctype html><html lang="{esc(cfg["language"])}"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width,initial-scale=1">'
                f'<title>{esc(full)}</title><meta name="description" content="{esc(desc)}">{og}{alt}<link rel="icon" href="{icon}">'
                f'<link rel="stylesheet" href="{root}assets/style.css"></head>')

    def header(self, root, active=""):
        cfg = self.cfg
        links = [
            f'<a href="{root}c/{slug}.html"{" class=on aria-current=page" if slug == active else ""}>{esc(c["name"])}</a>'
            for slug, c in self.cats.items()]
        if cfg["logo_left"]:
            tm = "<sup>™</sup>" if "™" in cfg["site_name"] else ""
            logo = (f'<a class="logo" href="{root}index.html" aria-label="{esc(cfg["site_name"])} home">'
                    f'<svg class="spark" viewBox="0 0 24 24" aria-hidden="true"><path d="{SPARK_PATH}"/></svg>'
                    f'<span><b>{esc(cfg["logo_left"])}</b>{esc(cfg["logo_right"])}{tm}</span></a>')
        else:
            logo = f'<a class="logo" href="{root}index.html">{esc(cfg["site_name"])}</a>'
        n = cfg["nav_max"]
        nav = "".join(links[:n])
        if len(links) > n:
            more_on = " on" if any("class=on" in l for l in links[n:]) else ""
            nav += (f'<details class="more"><summary class="{more_on.strip()}">More</summary>'
                    f'<div class="morep wrap">{"".join(links[n:])}</div></details>')
        return f'''<body><a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap bar">
{logo}
<form class="search" action="{root}search.html" role="search"><input type="search" name="q" placeholder="Search" aria-label="Search"><button aria-label="Search">&#9906;</button></form>
</div>
<nav class="wrap menu" aria-label="Sections"><a href="{root}index.html"{" class=on" if active == "" else ""}>Home</a>{nav}</nav></header>'''

    def footer(self, root):
        cfg = self.cfg
        cats = "".join(f'<a href="{root}c/{s}.html">{esc(c["name"])}</a>' for s, c in self.cats.items())
        extra = f"<p>{esc(cfg['footer_text'])}</p>" if cfg["footer_text"] else ""
        return (f'<footer class="foot"><div class="wrap"><div class="fcats">{cats}</div>{extra}'
                f'<p>&copy; {self.now.year} {esc(cfg["site_name"])}. {esc(cfg["tagline"])}.</p></div></footer>{self.scripts(root)}</body></html>')

    def ticker_entries(self, root):
        t = self.cfg["ticker"]
        out = []
        if t["custom"]:
            for it in t["custom"]:
                text, url = (it, "") if isinstance(it, str) else (it.get("text", ""), it.get("url", ""))
                if text:
                    out.append((text, url if re.match(r"^(https?:)?//|^#", url) or not url else root + url.lstrip("/")))
        else:
            out = [(a.title, self.url(a, root)) for a in self.arts[:t["count"]]]
        return out

    def ticker(self, root):
        t = self.cfg["ticker"]
        items = self.ticker_entries(root)
        if not t["enabled"] or not items:
            return ""
        one = "".join(f'<a href="{esc(u)}">{esc(x)}</a>' if u else f"<span>{esc(x)}</span>" for x, u in items)
        width = sum(len(x) * 7.6 + 56 for x, _ in items)
        dur = max(20, round(width / max(10, t["speed"]), 1))
        return (f'<div class="ticker" role="region" aria-label="Latest headlines"><div class="wrap tk">'
                f'<span class="lbl"><i></i>{esc(t["label"])}</span>'
                f'<div class="tv"><div class="track" style="--dur:{dur}s">'
                f'<div class="set">{one}</div><div class="set" aria-hidden="true">{one}</div></div></div></div></div>')

    def scripts(self, root):
        t = self.cfg["ticker"]
        data = {"items": [x for x, _ in self.ticker_entries(root)], "tab": t["tab"]}
        blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
        return (f'<script id="spark-ticker-data" type="application/json">{blob}</script>'
                f'<script src="{root}assets/site.js" defer></script>')

    def page(self, title, body, root, active="", **kw):
        return (self.head(title, root, **kw) + self.header(root, active) + self.ticker(root)
                + f'<main id="main">{body}</main>' + self.footer(root))

    # -- cards
    def meta(self, a, with_cat=True):
        bits = []
        if with_cat:
            bits.append(f'<span class="cat">{esc(a.category)}</span>')
        bits.append(f'<time datetime="{a.date.isoformat()}">{fmt_date(a.date)}</time>')
        live = f'<span class="live">{esc(a.live_label)}</span>' if a.is_live else ""
        return f'<p class="meta">{live}{" · ".join(bits)}</p>'

    def card(self, a, root, size="m"):
        return (f'<article class="card {size}"><a href="{self.url(a, root)}">'
                f'<div class="thumb">{self.picture(a, root)}</div>'
                f'<div class="ct"><h3>{esc(a.title)}</h3>'
                f'{"<p class=ex>" + esc(a.excerpt) + "</p>" if size != "s" and a.excerpt else ""}'
                f'{self.meta(a)}</div></a></article>')

    def row(self, a, root):
        return (f'<article class="rowc"><a href="{self.url(a, root)}"><div class="ct"><h3>{esc(a.title)}</h3>'
                f'{self.meta(a)}</div><div class="thumb">{self.picture(a, root)}</div></a></article>')

    # -- pages
    def home(self):
        root, arts, cfg = "", self.arts, self.cfg
        if not arts:
            return self.page("", '<div class="wrap empty"><h1>No articles yet</h1>'
                                  '<p>Add a CSV file to the <code>articles</code> folder and rebuild.</p></div>', root)
        featured = [a for a in arts if a.featured]
        hero = featured[0] if featured else arts[0]
        rest = [a for a in arts if a is not hero]
        side, latest = rest[:4], rest[4:13]

        banner = ""
        brk = [a for a in arts if a.breaking]
        if brk:
            b = brk[0]
            age = (self.now - b.date).days
            if cfg["breaking_max_age_days"] == 0 or age <= cfg["breaking_max_age_days"]:
                banner = (f'<div class="breaking"><div class="wrap"><strong>BREAKING</strong>'
                          f'<a href="{self.url(b, root)}">{esc(b.breaking_text)}</a></div></div>')

        top = (f'<section class="wrap top-grid"><article class="hero"><a href="{self.url(hero, root)}">'
               f'<div class="thumb">{self.picture(hero, root, lazy=False)}</div>'
               f'<div class="ct"><h2>{esc(hero.title)}</h2><p class="ex">{esc(hero.excerpt)}</p>{self.meta(hero)}</div></a></article>'
               f'<div class="side">{"".join(self.row(a, root) for a in side)}</div></section>')

        mr_pool = sorted(arts, key=lambda a: (-a.views, -a.date.timestamp()))[:cfg["most_read_count"]]
        if all(a.views == 0 for a in mr_pool):
            mr_pool = arts[:cfg["most_read_count"]]
            mr_title = "Latest"
        else:
            mr_title = "Most read"
        most = "".join(f'<li><a href="{self.url(a, root)}"><span class="n">{i}</span>{esc(a.title)}</a></li>'
                       for i, a in enumerate(mr_pool, 1))
        lat = (f'<section class="wrap two"><div><h2 class="sec">Latest news</h2><div class="grid3">'
               f'{"".join(self.card(a, root) for a in latest)}</div></div>'
               f'<aside class="most"><h2 class="sec">{mr_title}</h2><ol>{most}</ol></aside></section>')

        shown = {hero.slug} | {a.slug for a in side} | {a.slug for a in latest}
        blocks = ""
        for slug, c in list(self.cats.items())[:cfg["home_category_sections"]]:
            items = [a for a in c["items"] if a.slug not in shown][:4] or c["items"][:4]
            blocks += (f'<section class="wrap catblock"><h2 class="sec"><a href="c/{slug}.html">{esc(c["name"])} &rsaquo;</a></h2>'
                       f'<div class="grid4">{"".join(self.card(a, root, "s") for a in items)}</div></section>')
        return self.page("", banner + top + lat + blocks, root,
                         desc=cfg["tagline"], image=self.img(hero.image_raw, root), path="index.html")

    def category(self, slug, c):
        root = "../"
        items = c["items"]
        body = (f'<div class="wrap"><h1 class="pagetitle">{esc(c["name"])}</h1>'
                f'<p class="count">{len(items)} article{"s" if len(items) != 1 else ""}</p>'
                f'<div class="grid3">{"".join(self.card(a, root) for a in items)}</div></div>')
        return self.page(c["name"], body, root, active=slug, desc=f"Latest {c['name']} stories", path=f"c/{slug}.html")

    def search_page(self):
        root = ""
        body = '''<div class="wrap"><h1 class="pagetitle">Search</h1>
<form class="bigsearch" action="search.html"><input id="q" type="search" name="q" placeholder="Search articles" autofocus><button>Search</button></form>
<p id="status" class="count"></p><div id="results" class="results"></div></div>
<script>
(async()=>{
 const q=(new URLSearchParams(location.search).get('q')||'').trim();
 const box=document.getElementById('q'); box.value=q;
 const out=document.getElementById('results'), st=document.getElementById('status');
 if(!q){st.textContent='Type something to search.';return;}
 const data=await (await fetch('search.json')).json();
 const terms=q.toLowerCase().split(/\\s+/);
 const score=a=>{let s=0;const t=a.t.toLowerCase(),r=(a.s+' '+a.c+' '+a.x).toLowerCase();
  for(const w of terms){if(t.includes(w))s+=5;else if(r.includes(w))s+=1;else return 0;}return s;};
 const hits=data.map(a=>[score(a),a]).filter(x=>x[0]).sort((a,b)=>b[0]-a[0]||b[1].d.localeCompare(a[1].d)).map(x=>x[1]);
 st.textContent=hits.length+' result'+(hits.length===1?'':'s')+' for "'+q+'"';
 const e=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 out.innerHTML=hits.map(a=>`<article class="rowc res"><a href="${a.u}"><div class="ct"><h3>${e(a.t)}</h3><p class="ex">${e(a.e)}</p><p class="meta"><span class="cat">${e(a.c)}</span> · ${e(a.df)}</p></div></a></article>`).join('');
})();
</script>'''
        return self.page("Search", body, root, path="search.html")

    def article(self, a, lang=None):
        root = "../"
        tr = a.translations.get(lang) if lang else None
        title = (tr.get("title") or a.title) if tr else a.title
        subtitle = (tr.get("subtitle") or "") if tr else a.subtitle
        body_html = a.body_html
        if tr:
            c = tr.get("content") or ""
            body_html = sanitize(c if re.search(r"<\w+[^>]*>", c) else plain_to_html(c))
        fname = a.slug + (f".{lang}" if lang else "")
        same = [x for x in self.cats[a.cat_slug]["items"] if x is not a]
        related = same[:3]
        parts = []

        by = ""
        if a.author:
            by = f'<span class="by">By <strong>{esc(a.author)}</strong>{" ✓" if a.verified else ""}</span>'
        upd = ""
        if a.updated and (a.updated - a.date) > timedelta(hours=1):
            upd = f' · Updated {fmt_date(a.updated)}'
        live = f'<span class="live">{esc(a.live_label)}</span>' if a.is_live else ""
        parts.append(
            f'<header class="ah"><p class="kicker"><a href="{root}c/{a.cat_slug}.html">{esc(a.category)}</a></p>'
            f'<h1>{live}{esc(title)}</h1>'
            f'{"<p class=sub>" + esc(subtitle) + "</p>" if subtitle else ""}'
            f'<p class="byline">{by}<time datetime="{a.date.isoformat()}">{fmt_datetime(a.date)}</time>{upd}'
            f' · {a.read_min} min read</p></header>')

        if a.translations:
            pills = f'<a href="{a.slug}.html"{" class=on" if not lang else ""}>Original</a>'
            for l in a.translations:
                pills += (f'<a href="{a.slug}.{l}.html" hreflang="{l}" lang="{l}"'
                          f'{" class=on" if l == lang else ""}>{esc(LANG_NAMES.get(l, l.upper()))}</a>')
            parts.append(f'<nav class="langs" aria-label="Languages"><span>&#127760; Read in</span>{pills}</nav>')
            if lang:
                kind = "automatic" if a.ai_translated else ""
                parts.append(f'<p class="trnote">This is an {kind + " " if kind else ""}translation. '
                             f'<a href="{a.slug}.html">Read the original</a></p>')

        src = self.img(a.image_raw, root)
        if src:
            parts.append(f'<figure class="cover"><img src="{esc(src)}" alt="" style="object-position:{a.fx}% {a.fy}%" '
                         f'referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></figure>')

        if a.video:
            v = a.video
            m = re.search(r"(?:youtu\.be/|v=|embed/)([\w-]{11})", v)
            if m:
                parts.append(f'<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/{m.group(1)}" '
                             f'allowfullscreen loading="lazy" title="Video"></iframe></div>')
            else:
                parts.append(f'<p><a href="{esc(v)}" target="_blank" rel="noopener">Watch video &rsaquo;</a></p>')

        if a.is_live and a.live_updates:
            ups = sorted(a.live_updates, key=lambda u: u.get("timestamp", ""), reverse=True)
            lis = ""
            for u in ups:
                d = parse_dt(u.get("timestamp", ""))
                lis += (f'<li><time>{fmt_datetime(d)}</time>'
                        f'<div>{plain_to_html(str(u.get("text", "")))}</div></li>')
            parts.append(f'<section class="liveb"><h2>{esc(a.live_label)}</h2><ol>{lis}</ol></section>')

        if a.is_embed and not tr:
            parts.append(f'<iframe class="embed" src="{a.slug}-embed.html" title="{esc(a.title)}" '
                         f'></iframe>'
                         f'<p class="count"><a href="{a.slug}-embed.html" target="_blank">Open full screen &rsaquo;</a></p>')
        else:
            parts.append(f'<div class="body">{body_html}</div>')

        if a.extra_images:
            figs = "".join(f'<figure><img src="{esc(self.img(u, root))}" alt="" loading="lazy" referrerpolicy="no-referrer"></figure>'
                           for u in a.extra_images)
            cls = "gallery carousel" if a.layout == "carousel" else "gallery"
            parts.append(f'<div class="{cls}">{figs}</div>')

        if a.citations.strip():
            items = [c.strip() for c in re.split(r"\n\s*\n", a.citations) if c.strip()]
            lis = "".join(f"<li>{linkify(esc(c)).replace(chr(10), '<br>')}</li>" for c in items)
            parts.append(f'<section class="cites"><h2>Sources &amp; credits</h2><ul>{lis}</ul></section>')

        if a.series_id:
            ser = sorted([x for x in self.arts if x.series_id == a.series_id], key=lambda x: x.series_order)
            if len(ser) > 1:
                lis = "".join(f'<li{" class=cur" if x is a else ""}><a href="{x.slug}.html">{esc(x.title)}</a></li>' for x in ser)
                parts.append(f'<section class="series"><h2>In this series</h2><ol>{lis}</ol></section>')

        share_url = esc(self.cfg["base_url"].rstrip("/") + f"/a/{fname}.html") if self.cfg["base_url"] else ""
        if share_url:
            t = esc(title)
            parts.append(f'<div class="share"><span>Share</span>'
                         f'<a href="https://twitter.com/intent/tweet?url={share_url}&amp;text={t}" target="_blank" rel="noopener">X</a>'
                         f'<a href="https://www.facebook.com/sharer/sharer.php?u={share_url}" target="_blank" rel="noopener">Facebook</a>'
                         f'<a href="https://wa.me/?text={t}%20{share_url}" target="_blank" rel="noopener">WhatsApp</a>'
                         f'<a href="mailto:?subject={t}&amp;body={share_url}">Email</a></div>')

        dattr = f' lang="{lang}" dir="{"rtl" if lang in RTL_LANGS else "ltr"}"' if lang else ""
        art = f'<article class="wrap narrow"{dattr}>{"".join(parts)}</article>'
        if related:
            art += (f'<section class="wrap rel"><h2 class="sec">More in {esc(a.category)}</h2>'
                    f'<div class="grid3">{"".join(self.card(x, root) for x in related)}</div></section>')
        desc = (strip_tags(subtitle or body_html)[:160] if tr else a.excerpt)
        alts = [("x-default", f"a/{a.slug}.html")] + [(l, f"a/{a.slug}.{l}.html") for l in a.translations] if a.translations else None
        return self.page(title, art, root, active=a.cat_slug, desc=desc, image=src, kind="article",
                         path=f"a/{fname}.html", alts=alts)

    def embed_page(self, a):
        h = a.raw_content
        if not re.match(r"\s*<!doctype|\s*<html", h, re.I):
            h = (f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                 f'<body style="margin:0">{h}</body>')
        if "<base" not in h.lower():
            h = re.sub(r"(?i)(<head[^>]*>)", r'\1<base target="_top">', h, count=1) if re.search(r"(?i)<head", h) \
                else h.replace("<meta charset", '<base target="_top"><meta charset', 1)
        return h

    def sitemap(self):
        base = self.cfg["base_url"].rstrip("/")
        if not base:
            return None
        urls = [f"{base}/index.html"] + [f"{base}/c/{s}.html" for s in self.cats] + \
               [f"{base}/a/{a.slug}.html" for a in self.arts] + \
               [f"{base}/a/{a.slug}.{l}.html" for a in self.arts for l in a.translations]
        return ('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                + "".join(f"<url><loc>{esc(u)}</loc></url>" for u in urls) + "</urlset>")

    def feed(self):
        base = self.cfg["base_url"].rstrip("/")
        items = ""
        for a in self.arts[:30]:
            link = f"{base}/a/{a.slug}.html" if base else f"a/{a.slug}.html"
            items += (f"<item><title>{esc(a.title)}</title><link>{esc(link)}</link><guid>{esc(link)}</guid>"
                      f"<pubDate>{a.date.strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate>"
                      f"<category>{esc(a.category)}</category><description>{esc(a.excerpt)}</description></item>")
        return (f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{esc(self.cfg["site_name"])}</title>'
                f'<link>{esc(base or ".")}</link><description>{esc(self.cfg["tagline"])}</description>{items}</channel></rss>')


# --------------------------------------------------------------------------- main
def main():
    now = datetime.now(timezone.utc)
    cfg = load_config()
    arts, skipped = load_articles(cfg, now)
    site = Site(cfg, arts, now)

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "a").mkdir(parents=True)
    (OUT / "c").mkdir()
    shutil.copytree(ASSETS_DIR, OUT / "assets")
    img_dir = ARTICLES_DIR / "images"
    if img_dir.exists():
        shutil.copytree(img_dir, OUT / "images")

    w = lambda p, s: (OUT / p).write_text(s, encoding="utf-8")
    w("index.html", site.home())
    w("search.html", site.search_page())
    for slug, c in site.cats.items():
        w(f"c/{slug}.html", site.category(slug, c))
    for a in arts:
        w(f"a/{a.slug}.html", site.article(a))
        if a.is_embed:
            w(f"a/{a.slug}-embed.html", site.embed_page(a))
        for lang in a.translations:
            w(f"a/{a.slug}.{lang}.html", site.article(a, lang))
    w("search.json", json.dumps([{
        "t": a.title, "s": a.subtitle, "c": a.category, "d": a.date.isoformat(), "df": fmt_date(a.date),
        "e": a.excerpt, "u": f"a/{a.slug}.html",
        "x": (strip_tags(a.body_html)[:3000] if not a.is_embed else "") + " " + " ".join(
            (v.get("title") or "") + " " + (v.get("subtitle") or "") for v in a.translations.values())} for a in arts], ensure_ascii=False))
    w("feed.xml", site.feed())
    sm = site.sitemap()
    if sm:
        w("sitemap.xml", sm)
    w(".nojekyll", "")
    w("404.html", site.page("Page not found",
                            '<div class="wrap empty"><h1>Page not found</h1><p>Try the menu above or search.</p></div>', ""))

    print(f"Built {len(arts)} articles in {len(site.cats)} sections -> {OUT}")
    sk = ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in skipped.items() if v)
    if sk:
        print(f"Skipped: {sk}")


if __name__ == "__main__":
    sys.exit(main())
