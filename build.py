#!/usr/bin/env python3
"""
Static news site generator. Python 3.9+, standard library only.

    python build.py            # builds the site into ./_site
    python -m http.server -d _site 8000   # preview at http://localhost:8000

Drop article CSV files into ./articles/ (any file name, any number of rows).
See README.md for the column format.
"""
import copy
from urllib.parse import urlsplit
import csv
import hashlib
import html
import json
import urllib.parse
from html.parser import HTMLParser
import os
import time
import urllib.error
import urllib.request
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


def asset_ver(name):
    """Short content hash, appended to asset links so browsers never use a stale cached copy."""
    p = ASSETS_DIR / name
    return hashlib.md5(p.read_bytes()).hexdigest()[:8] if p.exists() else "0"

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
    "newsletter": {"enabled": False,            # subscribe box in the footer and the /newsletter/ page (set up in the editor first)
                   "title": "Get the newsletter", "blurb": "The best of our reporting in your inbox. Free, and you can leave at any time."},
    "seo": {
        "indexing": True,           # False = ask search engines to stay away from the whole site (robots.txt + noindex)
        "twitter_site": "",         # your X/Twitter handle, e.g. @sparknews
        "default_description": "",  # shown in search results when a page has no summary (falls back to the tagline)
        "google_verification": "",  # the code from Google Search Console ("HTML tag" method)
        "bing_verification": "",    # the code from Bing Webmaster Tools
        "title_suffix": "",         # text after every page title, e.g. " | SparkNews" (empty = site name)
        "default_image": "",        # picture used in social shares when an article has none (full https:// address)
        "news_sitemap": True,       # also write news-sitemap.xml for Google News (articles of the last 2 days)
        "block_ai_crawlers": False, # ask AI training crawlers (GPTBot, CCBot, ...) not to read the site
    },
    "privacy": {
        "hide_authors": False,      # leave out the names of authors and editors on every published page, feed and data file
        "redact": [],               # names to wipe from article text, titles and data too (a sign-off, a photo credit); used while names are hidden
        "byline": "",               # what to print instead of a name (empty = the site name)
        "lockdown": False,          # GDPR lockdown: no visitor data is collected or sent anywhere (see the Privacy page)
        "contact": "",              # email shown on the Privacy page for questions about personal data
    },
    "partners": [],                 # white-label embeds: [{"slug","name","url","main":"redirect|hide","accent"}] (set up in the editor, Settings)
    "polls": {"enabled": True},     # visitor polls: card or full-screen banner (set up in the editor first, needs supabase/polls.sql)
    "live": {"enabled": True},      # "Live" page for live radio and TV (needs the database and supabase/live.sql)
    "supabase": {"url": "", "anon_key": ""},   # the editor and database; both values are safe to publish
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


_OK_TAGS = {"a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "dd", "del", "details",
            "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img",
            "ins", "li", "mark", "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong", "sub", "summary", "sup",
            "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"}
_VOID = {"br", "hr", "img", "col"}
_DROP_WITH_CONTENT = {"script", "style", "noscript", "template", "textarea", "object", "embed", "applet", "title", "head"}
_OK_ATTRS = {"*": {"class", "title", "lang", "dir"}, "a": {"href", "target", "rel"},
             "img": {"src", "alt", "width", "height"}, "td": {"colspan", "rowspan", "align"}, "th": {"colspan", "rowspan", "align"},
             "ol": {"start", "type"}, "iframe": {"src", "width", "height", "allowfullscreen", "title"}, "details": {"open"}}
_OK_CSS = {"color", "background-color", "text-align", "font-weight", "font-style", "text-decoration"}
_VIDEO_HOSTS = {"www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"}


def _safe_url(u, kind):
    """Return the URL if it is harmless, else None. Control characters are removed first so that
    tricks like 'java\tscript:' cannot sneak through."""
    u = html.unescape(u or "").strip()
    flat = re.sub(r"[\x00-\x20\x7f]+", "", u).lower()
    if not flat:
        return None
    if flat.startswith("#"):
        return u
    if flat.startswith("//"):
        flat = "https:" + flat
    m = re.match(r"^([a-z][a-z0-9+.-]*):", flat)
    if not m:
        return u                                    # relative link
    scheme = m.group(1)
    if kind == "href" and scheme in ("http", "https", "mailto", "tel"):
        return u
    if kind == "img" and (scheme in ("http", "https") or re.match(r"^data:image/(png|jpe?g|gif|webp);base64,", flat)):
        return u
    if kind == "frame" and scheme == "https":
        host = (urllib.parse.urlsplit(flat).hostname or "")
        return u if host in _VIDEO_HOSTS else None
    return None


def _safe_css(v):
    out = []
    for decl in (v or "").split(";"):
        if ":" not in decl:
            continue
        k, val = decl.split(":", 1)
        k, val = k.strip().lower(), val.strip()
        if k in _OK_CSS and re.match(r"^[#\w\s%.,()-]+$", val) and "url(" not in val.lower() and "expression" not in val.lower():
            out.append(f"{k}:{val}")
    return ";".join(out)


class _Cleaner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out, self.stack, self.skip = [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in _DROP_WITH_CONTENT:
            self.skip += 1
            return
        if self.skip or tag not in _OK_TAGS:
            return
        keep = []
        allowed = _OK_ATTRS["*"] | _OK_ATTRS.get(tag, set())
        for k, v in attrs:
            k = (k or "").lower()
            v = v if v is not None else ""
            if k == "style":
                v = _safe_css(v)
                if v:
                    keep.append(("style", v))
                continue
            if k not in allowed:
                continue
            if tag == "a" and k == "href":
                v = _safe_url(v, "href")
            elif tag == "img" and k == "src":
                v = _safe_url(v, "img")
            elif tag == "iframe" and k == "src":
                v = _safe_url(v, "frame")
            if v is None:
                if tag in ("img", "iframe") and k == "src":
                    return                          # no safe source: drop the whole element
                continue
            keep.append((k, v))
        if tag == "iframe" and not any(k == "src" for k, _ in keep):
            return
        if tag == "a":
            keep = [(k, v) for k, v in keep if k not in ("rel", "target")]
            if any(k == "href" for k, _ in keep) and not any(v.startswith("#") for k, v in keep if k == "href"):
                keep += [("target", "_blank"), ("rel", "noopener noreferrer")]
        attr = "".join(f' {k}="{html.escape(v, quote=True)}"' if v != "" or k not in ("allowfullscreen", "open") else f" {k}" for k, v in keep)
        self.out.append(f"<{tag}{attr}>")
        if tag not in _VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and tag in self.stack and tag in _OK_TAGS and not self.skip:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in _DROP_WITH_CONTENT:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip or tag not in _OK_TAGS or tag in _VOID or tag not in self.stack:
            return
        while self.stack:
            t = self.stack.pop()
            self.out.append(f"</{t}>")
            if t == tag:
                break

    def handle_data(self, d):
        if not self.skip:
            self.out.append(html.escape(d, quote=False))

    def handle_entityref(self, n):
        if not self.skip:
            self.out.append(f"&{n};")

    def handle_charref(self, n):
        if not self.skip:
            self.out.append(f"&#{n};")

    def result(self):
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")
        return "".join(self.out)


def sanitize(h):
    """Keep ordinary article markup, remove everything that could run code or hijack the page."""
    c = _Cleaner()
    c.feed(h or "")
    c.close()
    return c.result()


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


def clean_db_url(u):
    """Accept the project address however it was copied: with or without a trailing slash or /rest/v1."""
    u = (u or "").strip().rstrip("/")
    u = re.sub(r"/(rest|auth|storage)/v1$", "", u, flags=re.I)
    return u.rstrip("/")


def db_settings(cfg):
    sbc = cfg.get("supabase") or {}
    url = clean_db_url(os.environ.get("SUPABASE_URL") or sbc.get("url"))
    key = (os.environ.get("SUPABASE_ANON_KEY") or sbc.get("anon_key") or "").strip()
    return url, key


def db_get(url, key, path, method="GET", body=None, extra=None, optional=False):
    """One request to the Supabase REST API, with a few retries. Any failure stops the build on purpose:
    the previous version of the website then stays online instead of being replaced by one with articles missing."""
    headers = {"apikey": key, "Accept": "application/json"}
    if key.startswith("eyJ"):                       # classic keys are JWTs; newer "sb_..." keys go in apikey only
        headers["Authorization"] = f"Bearer {key}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    headers.update(extra or {})
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url + path, method=method, headers=headers,
                                         data=None if body is None else json.dumps(body).encode())
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"
            if e.code < 500 and e.code != 429:
                break
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            last = str(e)
        time.sleep(2 * (attempt + 1))
    if optional and any(x in str(last) for x in ("PGRST205", "42P01", "HTTP 404", "42703", "does not exist")):
        return None                                  # an optional table that has not been created yet
    hint = ""
    if "404" in str(last):
        hint = ("\nHint: HTTP 404 usually means the address in site.json is wrong (it should look like https://abcdxyz.supabase.co) "
                "or the tables are missing (run supabase/schema.sql in the Supabase SQL Editor).")
    elif "42501" in str(last) or "permission denied" in str(last):
        hint = ("\nHint: the database refused access. Run the latest supabase/schema.sql again in the Supabase SQL Editor "
                "(it contains the permissions this needs). The key and address are fine.")
    elif "401" in str(last) or "403" in str(last):
        hint = "\nHint: the key in site.json is not accepted. Use the Publishable (anon) key, not the Secret key."
    sys.exit(f"Could not read articles from the database ({path}): {last}{hint}\n"
             f"Build stopped so the live site is not replaced by an incomplete one.")


def fetch_db(cfg):
    """Published articles and the ids of every article in the database. Empty when no database is set up."""
    url, key = db_settings(cfg)
    if not url or not key:
        return [], set()
    rows, start, page = [], 0, 1000
    cols_nolabel = "id,slug,title,subtitle,content,content_type,category,image_url,cover_focus_x,cover_focus_y,additional_images,image_layout,reporter_video_url,status,taken_down,is_breaking,breaking_description,published_at,scheduled_publish_at,is_ai_translated,is_featured,views,is_live_update,live_update_label,live_updates,citations,series_id,series_order,translations,created_at,updated_at"        # never ask for created_by / updated_by: nothing public needs them
    cols = cols_nolabel + ",partner_label,partner_mode"            # needs supabase/partners.sql; older databases work without it
    while True:
        chunk = db_get(url, key, "/rest/v1/articles?select=" + cols + "&order=id", optional=(cols != cols_nolabel),
                       extra={"Range-Unit": "items", "Range": f"{start}-{start + page - 1}"})
        if chunk is None:
            cols = cols_nolabel
            continue
        rows += chunk or []
        if not chunk or len(chunk) < page:
            break
        start += page
    ids = db_get(url, key, "/rest/v1/rpc/known_article_ids", method="POST", body={}) or []
    # author names come through article_authors(), which is empty when authors are hidden (supabase/privacy.sql);
    # without privacy.sql installed, fall back to the old open columns
    auth = db_get(url, key, "/rest/v1/rpc/article_authors", method="POST", body={}, optional=True)
    if auth is None:
        got = db_get(url, key, "/rest/v1/articles?select=id,author_name,author_verified&author_name=not.is.null", optional=True) or []
        auth = {str(r["id"]): {"name": r.get("author_name"), "verified": r.get("author_verified")} for r in got}
    for r in rows:
        x = (auth or {}).get(str(r.get("id")))
        if x:
            r["author_name"], r["author_verified"] = x.get("name"), x.get("verified")
    print(f"Database: {len(rows)} live articles ({len(ids)} in total)")
    return rows, set(map(str, ids)) | {str(r.get("id")) for r in rows}


def normalize_db_row(r):
    """Make a database row look like a CSV row, so one code path builds articles from both."""
    out = {}
    for k, v in r.items():
        if v is None:
            out[k] = ""
        elif isinstance(v, bool):
            out[k] = "true" if v else "false"
        elif isinstance(v, (dict, list)):
            out[k] = json.dumps(v, ensure_ascii=False)
        else:
            out[k] = str(v)
    out["created_date"] = out.get("created_at", "")
    out["updated_date"] = out.get("updated_at", "")
    return out


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


def _int(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(float(v))))
    except (TypeError, ValueError):
        return default


def _str(v, n, default=""):
    return v.strip()[:n] if isinstance(v, str) else default


def clean_settings(d):
    """Settings saved in the editor, reduced to known keys with safe types. Anything else is ignored."""
    out = {}
    if not isinstance(d, dict):
        return out
    for k, n in (("site_name", 80), ("logo_left", 40), ("logo_right", 40), ("tagline", 200), ("language", 10),
                 ("base_url", 200), ("footer_text", 400)):
        if isinstance(d.get(k), str):
            out[k] = _str(d[k], n)
    for k, lo, hi in (("nav_max", 1, 20), ("home_category_sections", 0, 20), ("most_read_count", 1, 20), ("breaking_max_age_days", 0, 365)):
        if k in d:
            out[k] = _int(d[k], lo, hi, DEFAULT_CONFIG[k])
    if isinstance(d.get("nav_order"), list):
        out["nav_order"] = [_str(x, 80) for x in d["nav_order"][:40] if isinstance(x, str) and x.strip()]
    if isinstance(d.get("newsletter"), dict):
        nl = d["newsletter"]; o = {}
        if "enabled" in nl: o["enabled"] = bool(nl["enabled"])
        if isinstance(nl.get("title"), str) and nl["title"].strip(): o["title"] = _str(nl["title"], 80)
        if isinstance(nl.get("blurb"), str): o["blurb"] = _str(nl["blurb"], 240)
        out["newsletter"] = o
    if isinstance(d.get("seo"), dict):
        s = d["seo"]; o = {}
        for k in ("indexing", "block_ai_crawlers"):
            if k in s: o[k] = bool(s[k])
        if "news_sitemap" in s: o["news_sitemap"] = bool(s["news_sitemap"])
        for k, n in (("title_suffix", 60), ("default_image", 300), ("twitter_site", 40), ("default_description", 200), ("google_verification", 120), ("bing_verification", 120)):
            if isinstance(s.get(k), str): o[k] = _str(s[k], n)
        out["seo"] = o
    if isinstance(d.get("privacy"), dict):
        s = d["privacy"]; o = {}
        if "lockdown" in s: o["lockdown"] = bool(s["lockdown"])
        if "hide_authors" in s: o["hide_authors"] = bool(s["hide_authors"])
        if isinstance(s.get("byline"), str): o["byline"] = _str(s["byline"], 60)
        if isinstance(s.get("redact"), list): o["redact"] = [_str(x, 80) for x in s["redact"] if isinstance(x, str) and len(x.strip()) >= 3][:200]
        if isinstance(s.get("contact"), str): o["contact"] = _str(s["contact"], 120)
        out["privacy"] = o
    if isinstance(d.get("partners"), list):
        ps, seen = [], set()
        for x in d["partners"][:30]:
            if not isinstance(x, dict): continue
            slug = re.sub(r"[^a-z0-9-]+", "-", str(x.get("slug", "")).lower()).strip("-")[:40]
            url = str(x.get("url", "")).strip()[:300]
            if not slug or slug in seen: continue
            if url and not re.match(r"^https?://[^\s]+$", url): url = ""      # empty = the partner is hosted here, on this website
            seen.add(slug)
            acc = str(x.get("accent", "")).strip()
            ps.append({"slug": slug, "name": _str(x.get("name") or slug, 80), "url": url,
                       "main": "hide" if x.get("main") == "hide" else "redirect",
                       "accent": acc if re.match(r"^#[0-9a-fA-F]{6}$", acc) else "",
                       "logo": str(x.get("logo", "")).strip()[:400] if re.match(r"^https://[^\s\"'<>]+$", str(x.get("logo", "")).strip()) else ""})
        out["partners"] = ps
    if isinstance(d.get("polls"), dict) and "enabled" in d["polls"]:
        out["polls"] = {"enabled": bool(d["polls"]["enabled"])}
    if isinstance(d.get("live"), dict) and "enabled" in d["live"]:
        out["live"] = {"enabled": bool(d["live"]["enabled"])}
    t = d.get("ticker")
    if isinstance(t, dict):
        o = {}
        if "enabled" in t: o["enabled"] = bool(t["enabled"])
        if isinstance(t.get("label"), str): o["label"] = _str(t["label"], 30)
        if "count" in t: o["count"] = _int(t["count"], 1, 30, 10)
        if "speed" in t: o["speed"] = _int(t["speed"], 10, 300, 60)
        if isinstance(t.get("custom"), list):
            cust = []
            for it in t["custom"][:30]:
                if isinstance(it, str) and it.strip():
                    cust.append(_str(it, 200))
                elif isinstance(it, dict) and isinstance(it.get("text"), str) and it["text"].strip():
                    cust.append({"text": _str(it["text"], 200), "url": _str(it.get("url"), 300)})
            o["custom"] = cust
        tb = t.get("tab")
        if isinstance(tb, dict):
            q = {}
            if "enabled" in tb: q["enabled"] = bool(tb["enabled"])
            if tb.get("mode") in ("scroll", "headline"): q["mode"] = tb["mode"]
            if isinstance(tb.get("prefix"), str): q["prefix"] = tb["prefix"][:10]
            if isinstance(tb.get("separator"), str): q["separator"] = tb["separator"][:20]
            for k, lo, hi in (("window_chars", 10, 80), ("step", 1, 6), ("interval_ms", 100, 3000), ("headline_interval_ms", 1000, 20000)):
                if k in tb: q[k] = _int(tb[k], lo, hi, DEFAULT_CONFIG["ticker"]["tab"][k])
            o["tab"] = q
        out["ticker"] = o
    return out


def apply_db_settings(cfg):
    """Settings changed in the editor's Settings panel win over site.json (which keeps the database address)."""
    url, key = db_settings(cfg)
    if not url or not key:
        return
    rows = db_get(url, key, "/rest/v1/site_settings?select=data&id=eq.1", optional=True)
    data = clean_settings(rows[0].get("data") if rows else None)
    def merge(base, new):
        for k, v in new.items():
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                merge(base[k], v)
            else:
                base[k] = v
    merge(cfg, data)
    if data:
        print(f"Settings: {len(data)} saved in the editor override site.json")


def load_articles(cfg, now):
    files = sorted(p for p in ARTICLES_DIR.rglob("*.csv") if "images" not in p.relative_to(ARTICLES_DIR).parts)

    def iter_rows(cfg):
        # Database articles first, so they win over a CSV row with the same id.
        db_rows, known_ids = fetch_db(cfg)
        for r in db_rows:
            yield "database", normalize_db_row(r)
        for f in files:
            with open(f, encoding="utf-8-sig", newline="") as fh:
                for row in csv.DictReader(fh):
                    # An article that lives in the database but is currently hidden there (draft,
                    # taken down, scheduled for later) must not come back from an old CSV copy.
                    if (row.get("id") or "").strip() in known_ids:
                        continue
                    yield f.name, row

    arts, skipped = [], {"draft": 0, "taken_down": 0, "scheduled": 0, "no_title": 0}
    seen_ids = set()
    for srcname, row in iter_rows(cfg):
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
        a.src = srcname
        a.from_db = srcname == "database"
        a.fixed_slug = slugify(g("slug")) if g("slug") else ""
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
        a.label = g("partner_label").lower()
        a.pmode = g("partner_mode").lower()       # redirect | hide | show (empty = the partner's default)
        a.series_id = g("series_id")
        a.series_order = to_int(g("series_order"))
        a.verified = truthy(g("author_verified"))
        ctype = g("content_type").lower()
        content = row.get("content") or ""
        a.raw_content = content
        # Full-HTML pages run their own scripts, so for database articles only the admin-controlled
        # content_type may switch that on. A "normal" article is never promoted by what its text looks like.
        a.is_embed = ctype in ("html", "interactive") or (
            not a.from_db and bool(re.match(r"\s*<!doctype|\s*<html", content, re.I)))
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
    # Articles saved by the editor keep their slug forever (links never break when a headline changes).
    taken = {a.fixed_slug for a in arts if a.fixed_slug}
    used = {}
    for a in arts:
        if a.fixed_slug:
            a.slug = a.fixed_slug
            continue
        base = slugify(a.title)
        n = used.get(base, 0)
        while True:
            cand = base if n == 0 else f"{base}-{n + 1}"
            n += 1
            if cand not in taken:
                break
        used[base] = n
        taken.add(cand)
        a.slug = cand
    return arts, skipped


# --------------------------------------------------------------------------- rendering
class Site:
    def __init__(self, cfg, arts, now):
        self.cfg, self.arts, self.now = cfg, arts, now
        self.embed = cfg.get("_embed") or ""            # slug of the partner this copy of the site is made for
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
                f'style="object-position:{a.fx}% {a.fy}%" referrerpolicy="no-referrer" onerror="this.remove()" decoding=async'
                f'{" loading=lazy fetchpriority=low" if lazy else ""}>')

    # -- chrome
    def head(self, title, root, desc="", image="", path="", kind="website", alts=None, ld=None):
        cfg = self.cfg
        seo = cfg["seo"]
        suf = seo.get("title_suffix")
        full = (title + (suf if suf else f" | {cfg['site_name']}")) if title else cfg["site_name"]
        desc = desc or seo.get("default_description") or cfg["tagline"]
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
        icon = (f'<link rel="icon" type="image/png" sizes="64x64" href="{root}assets/favicon.png?v={asset_ver("favicon.png")}">'
                f'<link rel="apple-touch-icon" href="{root}assets/apple-touch-icon.png?v={asset_ver("apple-touch-icon.png")}">'
                f'<meta name="theme-color" content="#110c4a">')
        dimg = seo.get("default_image") if str(seo.get("default_image", "")).startswith("https://") else (base + "/assets/og-default.png" if base else "")
        if dimg and not (image and image.startswith("http")):
            og += f'<meta property="og:image" content="{esc(dimg)}"><meta name="twitter:card" content="summary_large_image">'
        og += f'<link rel="alternate" type="application/rss+xml" title="{esc(cfg["site_name"])}" href="{root}feed.xml">'
        return (f'<!doctype html><html lang="{esc(cfg["language"])}"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width,initial-scale=1">{self.seo_tags(ld)}'
                f'<meta name="color-scheme" content="light dark">'
                f'<script>try{{var th=localStorage.getItem("spark-theme");if(th)document.documentElement.dataset.theme=th}}catch(e){{}}</script>'
                f'<title>{esc(full)}</title><meta name="description" content="{esc(desc)}">{og}{alt}{icon}'
                f'<link rel="stylesheet" href="{root}assets/style.css?v={asset_ver("style.css")}">{self.accent_css()}</head>')

    def nl_on(self):
        return not self.locked() and bool(self.cfg["newsletter"].get("enabled")) and bool(db_settings(self.cfg)[0])

    def nlbox(self, root):
        if not self.nl_on():
            return ""
        n = self.cfg["newsletter"]
        return (f'<section class="nlbox" aria-labelledby="nl-h"><div class="wrap nlin"><div><h2 id="nl-h">{esc(n["title"])}</h2><p>{esc(n["blurb"])}</p></div>'
                f'<form class="nlform" data-nl novalidate><label class="sr" for="nl-mail">Email address</label>'
                f'<input id="nl-mail" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>'
                f'<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
                f'<button type="submit">Subscribe</button><p class="nlmsg" role="status"></p></form></div></section>')

    def newsletter_page(self):
        n = self.cfg["newsletter"]
        body = (f'<div class="wrap nlpage"><h1>{esc(n["title"])}</h1><div id="nl-state"><p class="lead">{esc(n["blurb"])}</p>'
                f'<form class="nlform big" data-nl novalidate><label class="sr" for="nl-mail2">Email address</label>'
                f'<input id="nl-mail2" type="email" name="email" placeholder="you@example.com" autocomplete="email" required>'
                f'<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
                f'<button type="submit">Subscribe</button><p class="nlmsg" role="status"></p></form>'
                f'<p class="small">We send a confirmation email first. Every email has an unsubscribe link.</p></div></div>')
        return self.page("Newsletter", body, "../")

    def settings_page(self):
        def radios(name, opts):
            return "".join(f'<label class="opt"><input type="radio" name="{name}" value="{v}"><span>{l}</span></label>' for v, l in opts)
        body = ('<div class="wrap prefspage"><h1>Settings</h1><p class="lead">These choices are saved in this browser only. We do not collect them.</p>'
                '<form id="prefs" novalidate>'
                '<fieldset><legend>Browser tab ticker</legend>'
                '<p class="small">When you switch to another tab or window, the title of this tab can scroll the latest headlines.</p>'
                '<label class="switch"><input type="checkbox" name="tab"><span>Show headlines in the tab title while I am away</span></label>'
                '<p id="prefs-off" class="small" hidden>The tab ticker is turned off for this site.</p>'
                '<div class="sub"><p class="h">Style</p>' + radios("mode", [("scroll", "Scrolling text"), ("headline", "One headline at a time")]) + '</div>'
                '<div class="sub"><p class="h">Speed</p>' + radios("speed", [("slow", "Slow"), ("normal", "Normal"), ("fast", "Fast")]) + '</div>'
                '<p><button type="button" id="prefs-preview">Preview in this tab</button></p>'
                '<p id="prefs-safari" class="small" hidden>Safari shows only about 20 characters of a tab title, and hides titles when there is just one tab open, so the ticker is shortened there.</p>'
                '</fieldset>'
                '<fieldset><legend>Appearance</legend>' + radios("theme", [("auto", "Match my device"), ("light", "Light"), ("dark", "Dark")]) + '</fieldset>'
                '<p id="prefs-msg" class="small" role="status"></p></form></div>')
        return self.page("Settings", body, "../")

    def redact(self, text):
        """While names are hidden: replace every listed name (and the authors we still know about) with the byline."""
        if not self.hide_names():
            return text
        if not hasattr(self, "_redact_re"):
            names = {n.strip() for n in self.cfg["privacy"].get("redact", []) if n.strip()} | {a.author.strip() for a in self.arts if a.author and len(a.author.strip()) >= 4}
            who = self.cfg["privacy"].get("byline") or self.cfg["site_name"]
            self._redact_re = (re.compile(r"(?<!\w)(?:" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True)) + r")(?!\w)", re.I), who) if names else None
        r = self._redact_re
        return r[0].sub(lambda m: r[1], text) if r else text

    def hide_names(self):
        return bool(self.cfg["privacy"].get("hide_authors")) or self.locked()

    def locked(self):
        return bool(self.cfg["privacy"].get("lockdown"))

    def partner(self, slug):
        return next((p for p in self.cfg.get("partners", []) if p["slug"] == slug), None)

    def accent_css(self):
        p = self.partner(self.embed) if self.embed else None
        return f'<style>:root{{--accent:{p["accent"]};--spark:{p["accent"]}}}</style>' if p and p.get("accent") else ""

    def seo_tags(self, ld=None):
        cfg = self.cfg; seo = cfg["seo"]; o = ""
        o += '<meta name="robots" content="%s">' % ("max-image-preview:large" if seo.get("indexing") else "noindex,nofollow")
        if seo.get("twitter_site"):
            o += f'<meta name="twitter:site" content="{esc(seo["twitter_site"])}">'
        if seo.get("google_verification"):
            o += f'<meta name="google-site-verification" content="{esc(seo["google_verification"])}">'
        if seo.get("bing_verification"):
            o += f'<meta name="msvalidate.01" content="{esc(seo["bing_verification"])}">'
        if self.locked():
            o += ('<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
                  "img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; "
                  "frame-src 'none'; form-action 'self'; base-uri 'self'\">")
        if ld and seo.get("indexing"):
            o += '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False).replace("</", "<\\/") + "</script>"
        return o

    def robots(self):
        seo = self.cfg["seo"]; base = self.cfg["base_url"].rstrip("/")
        if not seo.get("indexing"):
            return "User-agent: *\nDisallow: /\n"
        pre = urlsplit(base).path.rstrip("/") if base else ""      # a site at example.com/news keeps its pages under /news
        out = f"User-agent: *\nAllow: /\nDisallow: {pre}/editor/\nDisallow: {pre}/settings/\nDisallow: {pre}/badge/\nDisallow: {pre}/search.html\nDisallow: {pre}/p/\nDisallow: {pre}/*-embed.html\n"
        out += "".join(f"Disallow: {pre}{x}\n" for x in seo.get("disallow", []) if isinstance(x, str) and x.startswith("/"))
        if seo.get("block_ai_crawlers"):
            for bot in ("GPTBot", "ChatGPT-User", "OAI-SearchBot", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "PerplexityBot",
                        "Bytespider", "Amazonbot", "Applebot-Extended", "FacebookBot", "cohere-ai"):
                out += f"\nUser-agent: {bot}\nDisallow: /\n"
        if base:
            out += f"\nSitemap: {base}/sitemap.xml\n"
            if seo.get("news_sitemap"):
                out += f"Sitemap: {base}/news-sitemap.xml\n"
        return out

    def privacy_page(self):
        cfg = self.cfg; locked = self.locked(); li = []
        li.append("<li><b>Your choices on this device.</b> Theme and tab-ticker choices are kept in your own browser (local storage) so the site can remember them. They never leave your device and contain no personal data.</li>")
        if locked:
            li.append("<li><b>Lockdown mode is on.</b> This site does not run polls, newsletter sign-up or live radio and TV, and it makes no requests to any database or third-party service while you read. Embedded videos are shown as plain links. Your browser only talks to this website's own server.</li>")
            li.append("<li><b>Images.</b> A few images may be hosted elsewhere; if so, your browser asks that host for the picture (your IP address is visible to it). Referrer details are not sent.</li>")
        else:
            if self.polls_on():
                li.append("<li><b>Polls.</b> To count one vote per person, a random code is stored in your browser and sent with your vote. It is not linked to your name or email.</li>")
            if self.nl_on():
                li.append("<li><b>Newsletter.</b> If you sign up, we store your email address (and name, if given) to send the newsletter. You confirm by email first and every email has an unsubscribe link, which deletes nothing else about you because nothing else is collected.</li>")
            if self.live_on():
                li.append("<li><b>Live radio and TV.</b> Pressing play connects your browser to our streaming provider (LiveKit), which sees your IP address.</li>")
            li.append("<li><b>Articles.</b> Embedded videos (YouTube, privacy-enhanced mode) load only on pages that include one; the provider then sees your IP address. Share buttons contact the social network only when you click them.</li>")
        if self.hide_names():
            li.append("<li><b>Our team.</b> Names of individual authors and editors are not published on this site; articles are credited to the newsroom.</li>")
        li.append("<li><b>No tracking.</b> This site has no analytics, advertising cookies or fingerprinting.</li>")
        who = f'<p>Questions about your data, or want your newsletter record deleted? Write to <a href="mailto:{esc(cfg["privacy"]["contact"])}">{esc(cfg["privacy"]["contact"])}</a>.</p>' if cfg["privacy"].get("contact") else ""
        body = f'<div class="wrap prefspage"><h1>Privacy</h1><p class="lead">What {esc(cfg["site_name"])} stores about you, in plain words.</p><ul class="privlist">{"".join(li)}</ul>{who}</div>'
        return self.page("Privacy", body, "../")

    def badge_page(self):
        url, key = db_settings(self.cfg)
        data = json.dumps({"url": url, "key": key, "site": self.cfg["site_name"]}, ensure_ascii=False).replace("</", "<\\/")
        body = (f'<div class="wrap badgepage"><div id="badge-out" class="bcheck">Checking badge…</div>'
                f'<script type="application/json" id="badge-data">{data}</script>'
                f'<script src="../assets/badge.js?v={asset_ver("badge.js")}" defer></script></div>')
        return self.page("Staff badge check", body, "../")

    def polls_on(self):
        return not self.locked() and bool(self.cfg.get("polls", {}).get("enabled")) and bool(db_settings(self.cfg)[0])

    def live_on(self):
        return not self.locked() and bool(self.cfg["live"].get("enabled")) and bool(db_settings(self.cfg)[0])

    def live_page(self):
        url, key = db_settings(self.cfg)
        mb = self.cfg.get("_main_base", self.cfg["base_url"].rstrip("/"))
        up = "../../../" if self.embed else "../"
        labels = {p["slug"]: {"name": p["name"], "main": p["main"],
                              "url": p["url"] or (f"{mb}/p/{p['slug']}/live/index.html" if mb else f"{up}p/{p['slug']}/live/index.html")}
                  for p in self.cfg.get("partners", [])}
        conf = json.dumps({"url": url, "anon_key": key, "labels": labels, "embed": self.embed}).replace("</", "<\\/")
        ctl = ('<div class="ctl"><button class="lbtn" type="button" hidden aria-label="{verb}"><span class="ic">&#9654;</span><span class="tx">{verb}</span></button>'
               '<button class="lmute" type="button" aria-label="Mute" aria-pressed="false" hidden>&#128266;</button>'
               '<input class="lvol" type="range" min="0" max="100" value="80" aria-label="Volume" hidden>{extra}</div>')
        tv = ('<section class="livecard tvc" data-kind="tv" aria-label="Live TV"><div class="stage"><video class="lmedia" playsinline></video>'
              '<div class="poster"><span class="ps">Off air</span><span class="pm">Live TV is not broadcasting right now.</span></div>'
              '<span class="lstate off">Off air</span><span class="ltime" hidden></span></div>'
              + ctl.format(verb="Watch live", extra='<button class="lfs" type="button" aria-label="Full screen" hidden>&#x26F6;</button>') +
              '<p class="ltopic" hidden></p><h2 class="ltitle">Live TV</h2><p class="lsub"></p><ol class="lnext" hidden></ol><p class="lmsg" role="status" aria-live="polite"></p></section>')
        radio = ('<section class="livecard radc" data-kind="radio" aria-label="Live radio"><div class="rtop"><span class="lstate off">Off air</span><span class="ltime" hidden></span></div>'
                 '<div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>'
                 '<audio class="lmedia" hidden></audio><p class="ltopic" hidden></p><h2 class="ltitle">Live radio</h2><p class="lnow" hidden></p><p class="lsub">Live radio is not broadcasting right now.</p><ol class="lnext" hidden></ol>'
                 + ctl.format(verb="Listen live", extra="") + '<p class="lmsg" role="status" aria-live="polite"></p></section>')
        more = "".join(self.card(a, "../", "m") for a in self.arts[:3])
        more = (f'<section class="lvmore"><h2 id="lvmoreh">Meanwhile, the latest stories</h2><div class="grid3">{more}</div></section>' if more else "")
        body = (f'<div class="wrap livepage"><div class="lvhead"><h1>Live</h1><p class="lead">Live TV and radio from {esc(self.cfg["site_name"])}. '
                f'Anyone can listen and watch, no account needed.</p></div>'
                f'<div class="livegrid" data-live="none">{tv}{radio}</div><template id="tpl-tv">{tv}</template><template id="tpl-radio">{radio}</template>{more}'
                f'<script id="spark-live-config" type="application/json">{conf}</script>'
                f'<script src="../assets/live.js?v={asset_ver("live.js")}" defer></script></div>')
        return self.page("Live", body, "../", active="live")

    def header(self, root, active=""):
        cfg = self.cfg
        links = [
            f'<a href="{root}c/{slug}.html"{" class=on aria-current=page" if slug == active else ""}>{esc(c["name"])}</a>'
            for slug, c in self.cats.items()]
        pl = (self.partner(self.embed) or {}).get("logo") if self.embed else ""
        if pl:
            logo = (f'<a class="logo plogo" href="{root}index.html" aria-label="{esc(cfg["site_name"])} home">'
                    f'<img src="{esc(pl)}" alt="{esc(cfg["site_name"])}" height="44"></a>')
        elif cfg["logo_left"]:
            tm = "<sup>™</sup>" if "™" in cfg["site_name"] else ""
            logo = (f'<a class="logo" href="{root}index.html" aria-label="{esc(cfg["site_name"])} home">'
                    f'<img class="spark" src="{root}assets/logo.png?v={asset_ver("logo.png")}" width="40" height="40" alt="">'
                    f'<span><b>{esc(cfg["logo_left"])}</b>{esc(cfg["logo_right"])}{tm}</span></a>')
        else:
            logo = f'<a class="logo" href="{root}index.html">{esc(cfg["site_name"])}</a>'
        n = cfg["nav_max"]
        nav = "".join(links[:n])
        if len(links) > n:
            more_on = " on" if any("class=on" in l for l in links[n:]) else ""
            nav += (f'<details class="more"><summary class="{more_on.strip()}">More</summary>'
                    f'<div class="morep wrap">{"".join(links[n:])}</div></details>')
        livelink = (f'<a class="livelink{" on" if active == "live" else ""}" href="{root}live/index.html"><i></i>Live</a>'
                    if self.live_on() else "")
        return f'''<body{' class="embed"' if self.embed else ''}><a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap bar">
<span class="dateline">{self.now.strftime("%A, %B ") + str(self.now.day) + self.now.strftime(", %Y")}</span>
{logo}
<div class="tools"><form class="search" action="{root}search.html" role="search"><input type="search" name="q" placeholder="Search" aria-label="Search"><button aria-label="Search">&#9906;</button></form><button class="theme" type="button" aria-label="Switch light / dark mode" title="Light / dark"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M12 3.5a8.5 8.5 0 0 1 0 17z"/></svg></button></div>
</div>
</header><div class="navbar"><nav class="wrap menu" aria-label="Sections"><a href="{root}index.html"{" class=on" if active == "" else ""}>Home</a>{livelink}{nav}</nav></div>'''

    def footer(self, root):
        cfg = self.cfg
        cats = "".join(f'<a href="{root}c/{s}.html">{esc(c["name"])}</a>' for s, c in self.cats.items())
        extra = f"<p>{esc(cfg['footer_text'])}</p>" if cfg["footer_text"] else ""
        return (f'{self.nlbox(root)}<footer class="foot"><div class="wrap"><a class="flogo" href="{root}index.html"><img src="{root}assets/logo.png?v={asset_ver("logo.png")}" width="36" height="36" alt=""><span>{esc(cfg["site_name"])}</span></a><div class="fcats">{cats}</div>{extra}'
                f'<p><a href="{root}settings/index.html">Settings</a> &middot; <a href="{root}privacy/index.html">Privacy</a></p>'
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
                f'<div class="set">{one}</div><div class="set" aria-hidden="true">{one}</div></div></div>'
                f'<button class="tpause" type="button" aria-label="Pause ticker" title="Pause / play">&#10074;&#10074;</button>'
                f'</div></div>')

    def scripts(self, root):
        t = self.cfg["ticker"]
        data = {"items": [x for x, _ in self.ticker_entries(root)], "tab": t["tab"]}
        if self.live_on():
            u, k = db_settings(self.cfg)
            data["live"] = {"url": u, "key": k}
        nl_tag = ""
        if self.nl_on():
            u, k = db_settings(self.cfg)
            data["nl"] = {"url": u, "key": k}
            nl_tag = f'<script src="{root}assets/newsletter.js?v={asset_ver("newsletter.js")}" defer></script>'
        polls_tag = ""
        if self.polls_on():
            u, k = db_settings(self.cfg)
            data["polls"] = {"url": u, "key": k}
            polls_tag = f'<script src="{root}assets/polls.js?v={asset_ver("polls.js")}" defer></script>'
        blob = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
        return (f'<script id="spark-ticker-data" type="application/json">{blob}</script>'
                f'<script src="{root}assets/site.js?v={asset_ver("site.js")}" defer></script>' + nl_tag + polls_tag)

    def page(self, title, body, root, active="", **kw):
        if title == "" and not kw.get("ld"):
            base = self.cfg["base_url"].rstrip("/")
            kw["ld"] = {"@context": "https://schema.org", "@type": "NewsMediaOrganization", "name": self.cfg["site_name"], "url": base or None,
                        "logo": f"{base}/assets/logo.png" if base else None, "description": self.cfg["tagline"]}
            kw["ld"] = {k: v for k, v in kw["ld"].items() if v}
            if base:
                kw["ld"] = [kw["ld"], {"@context": "https://schema.org", "@type": "WebSite", "name": self.cfg["site_name"], "url": base + "/",
                                       "potentialAction": {"@type": "SearchAction", "target": f"{base}/search.html?q={{search_term_string}}", "query-input": "required name=search_term_string"}}]
        return (self.head(title, root, **kw) + self.header(root, active) + self.ticker(root)
                + f'<main id="main" data-page="{"article" if kw.get("kind") == "article" else "home" if title == "" else "other"}">{body}</main>' + self.footer(root))

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

        chips = "".join(f'<a href="c/{s}.html">{esc(c["name"])}</a>' for s, c in list(self.cats.items())[:12])
        chipbar = f'<nav class="wrap chips" aria-label="Sections"><span>Explore</span>{chips}</nav>' if chips else ""
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

        pool = [a for a in rest[13:] if a.image_raw and not a.is_embed] or [a for a in rest[13:] if not a.is_embed]
        spot = pool[0] if pool else None
        spotlight = ""
        if spot:
            spotlight = (f'<section class="spotlight"><div class="wrap spotin"><a class="spimg" href="{self.url(spot, root)}">{self.picture(spot, root)}</a>'
                         f'<div class="sptxt"><span class="kicker">Spotlight</span><h2><a href="{self.url(spot, root)}">{esc(spot.title)}</a></h2>'
                         f'<p>{esc(spot.excerpt)}</p><a class="spmore" href="{self.url(spot, root)}">Read the story &rarr;</a></div></div></section>')
        shown = {hero.slug} | {a.slug for a in side} | {a.slug for a in latest} | ({spot.slug} if spot else set())
        blocks = ""
        for slug, c in list(self.cats.items())[:cfg["home_category_sections"]]:
            items = [a for a in c["items"] if a.slug not in shown][:4] or c["items"][:4]
            blocks += (f'<section class="catband"><div class="wrap catblock"><h2 class="sec"><a href="c/{slug}.html">{esc(c["name"])} &rsaquo;</a></h2>'
                       f'<div class="grid4">{"".join(self.card(a, root, "s") for a in items)}</div></div></section>')
        return self.page("", banner + top + chipbar + lat + spotlight + blocks, root,
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
        if self.hide_names():
            who = self.cfg["privacy"].get("byline") or self.cfg["site_name"]
            by = f'<span class="by">By <strong>{esc(who)}</strong></span>'
        elif a.author:
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
            f' · {a.read_min} min read</p>'
            f'{"<a class=editlink hidden href=" + root + "editor/#/edit/" + esc(a.id) + ">Edit this article</a>" if a.from_db else ""}'
            f'</header>')

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
            elif re.match(r"^https?://", v.strip(), re.I):
                parts.append(f'<p><a href="{esc(v.strip())}" target="_blank" rel="noopener">Watch video &rsaquo;</a></p>')

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
        inner = "".join(parts)
        if self.locked():
            inner = re.sub(r'<iframe[^>]*?src="(https?://[^"]+)"[^>]*>\s*</iframe>', lambda m: f'<p><a href="{m.group(1)}" target="_blank" rel="noopener noreferrer">Open embedded content &rsaquo;</a></p>', inner)
        art = f'<article class="wrap narrow"{dattr}>{inner}</article>'
        if related:
            art += (f'<section class="wrap rel"><h2 class="sec">More in {esc(a.category)}</h2>'
                    f'<div class="grid3">{"".join(self.card(x, root) for x in related)}</div></section>')
        desc = (strip_tags(subtitle or body_html)[:160] if tr else a.excerpt)
        alts = [("x-default", f"a/{a.slug}.html")] + [(l, f"a/{a.slug}.{l}.html") for l in a.translations] if a.translations else None
        base = self.cfg["base_url"].rstrip("/")
        ld = {"@context": "https://schema.org", "@type": "NewsArticle", "headline": title[:110], "datePublished": a.date.isoformat(),
              "description": desc, "author": ({"@type": "Organization", "name": self.cfg["privacy"].get("byline") or self.cfg["site_name"]} if self.hide_names() or not a.author
                                   else {"@type": "Person", "name": a.author}),
              "publisher": {"@type": "Organization", "name": self.cfg["site_name"]}}
        if src and src.startswith("http"): ld["image"] = [src]
        if base: ld["mainEntityOfPage"] = f"{base}/a/{fname}.html"
        if base:
            ld = [ld, {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{base}/index.html"},
                {"@type": "ListItem", "position": 2, "name": a.category, "item": f"{base}/c/{a.cat_slug}.html"},
                {"@type": "ListItem", "position": 3, "name": title[:110]}]}]
        return self.page(title, art, root, active=a.cat_slug, desc=desc, image=src, kind="article",
                         path=f"a/{fname}.html", alts=alts, ld=ld)

    def embed_page(self, a):
        h = a.raw_content
        if not re.match(r"\s*<!doctype|\s*<html", h, re.I):
            h = (f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                 f'<body style="margin:0">{h}</body>')
        if "<base" not in h.lower():
            h = re.sub(r"(?i)(<head[^>]*>)", r'\1<base target="_top">', h, count=1) if re.search(r"(?i)<head", h) \
                else h.replace("<meta charset", '<base target="_top"><meta charset', 1)
        return h

    def not_found(self):
        """The 404 page: GitHub Pages serves it from any address, so every link in it must be absolute."""
        base = self.cfg["base_url"].rstrip("/")
        pre = urlsplit(base).path.rstrip("/") if base else ""
        root = pre + "/"
        body = (f'<div class="wrap lost"><p class="code" aria-hidden="true">4<span>0</span>4</p>'
                f'<h1>This page wandered off</h1>'
                f'<p class="lead">We looked everywhere, even behind the sofa. While you are here, catch some headlines and dodge the 404s.</p>'
                f'<div class="gamebox"><div class="gscores"><span>Score <b id="gscore">0</b></span><span>Best <b id="gbest">0</b></span></div>'
                f'<canvas id="game" tabindex="0" width="360" height="480" role="img" aria-label="Game: move the atom left and right to catch headlines and avoid the 404 blocks"></canvas>'
                f'<p id="gmsg" class="gmsg" role="status"></p><button id="gstart" class="gbtn" type="button">Play</button>'
                f'<p class="small">Arrow keys or A and D to move. On a phone, drag your finger.</p></div>'
                f'<p class="lostlinks"><a href="{root}index.html">Home page</a> &middot; <a href="{root}search.html">Search</a></p></div>'
                f'<script src="{root}assets/404.js?v={asset_ver("404.js")}" defer></script>')
        return self.page("Page not found", body, root)

    def redirect_page(self, to, who):
        to_e = esc(to)
        return (f'<!doctype html><html lang="{esc(self.cfg["language"])}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                f'<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url={to_e}"><link rel="canonical" href="{to_e}">'
                f'<title>Continue to {esc(who)}</title></head><body style="font-family:system-ui,sans-serif;padding:32px">'
                f'<p>This story is on <a href="{to_e}">{esc(who)}</a>. Taking you there\u2026</p>'
                f'<script>location.replace({json.dumps(to)})</script></body></html>')

    def sitemap(self, skip=()):
        base = self.cfg["base_url"].rstrip("/")
        if not base:
            return None
        def u(loc, mod=None, img=None):
            x = f"<url><loc>{esc(loc)}</loc>"
            if mod: x += f"<lastmod>{mod.strftime('%Y-%m-%d')}</lastmod>"
            if img and str(img).startswith("http"): x += f"<image:image><image:loc>{esc(img)}</image:loc></image:image>"
            return x + "</url>"
        rows = [u(f"{base}/index.html")] + [u(f"{base}/c/{s}.html") for s in self.cats]
        for a in self.arts:
            if a.is_embed or a.slug in skip: continue
            mod = a.updated or a.date
            rows.append(u(f"{base}/a/{a.slug}.html", mod, getattr(a, "image_raw", None)))
            rows += [u(f"{base}/a/{a.slug}.{l}.html", mod) for l in a.translations]
        return ('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + "".join(rows) + "</urlset>")

    def news_sitemap(self, skip=()):
        base = self.cfg["base_url"].rstrip("/")
        if not base or not self.cfg["seo"].get("news_sitemap"):
            return None
        cutoff = self.now - timedelta(days=2)
        rows = "".join(
            f"<url><loc>{esc(base)}/a/{esc(a.slug)}.html</loc><news:news><news:publication><news:name>{esc(self.cfg['site_name'])}</news:name>"
            f"<news:language>{esc(self.cfg['language'][:2])}</news:language></news:publication>"
            f"<news:publication_date>{a.date.strftime('%Y-%m-%dT%H:%M:%S+00:00')}</news:publication_date><news:title>{esc(a.title)}</news:title></news:news></url>"
            for a in self.arts if not a.is_embed and a.date >= cutoff and a.slug not in skip)
        return ('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">' + rows + "</urlset>")

    def feed(self):
        base = self.cfg["base_url"].rstrip("/")
        items = ""
        for a in self.arts[:30]:
            link = f"{base}/a/{a.slug}.html" if base else f"a/{a.slug}.html"
            items += (f"<item><title>{esc(a.title)}</title><link>{esc(link)}</link><guid>{esc(link)}</guid>"
                      f"<pubDate>{a.date.strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate>"
                      f"<category>{esc(a.category)}</category><description>{esc(a.excerpt)}</description></item>")
        return (f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><language>{esc(self.cfg["language"])}</language><title>{esc(self.cfg["site_name"])}</title>'
                f'<link>{esc(base or ".")}</link><description>{esc(self.cfg["tagline"])}</description>{items}</channel></rss>')


# --------------------------------------------------------------------------- main
def partner_target(p, a, base, viewer):
    """Where a redirected story goes: the partner's own website if they have one, otherwise their copy hosted on this site."""
    if p.get("url"):
        return p["url"].replace("{slug}", a.slug).replace("{id}", str(a.id))
    return f"{base}/p/{p['slug']}/a/{a.slug}.html" if base else ("../" if not viewer else "../../../") + f"p/{p['slug']}/a/{a.slug}.html"


def view_for(arts, partners, viewer, base=""):
    """The articles one copy of the site shows. A labelled article belongs to its partner: everywhere else it is
    redirected to the partner's website, or left out altogether when the partner is set to "hide"."""
    pm = {p["slug"]: p for p in partners}
    keep, red = [], {}
    for a in arts:
        if viewer and not a.label and a.pmode == "main":   # only the main website
            continue
        p = pm.get(a.label)
        mode = (a.pmode or (p or {}).get("main") or "redirect") if p else ""
        if p and a.label != viewer and mode != "show":          # "show" = it belongs to the partner but also appears everywhere
            if mode == "hide":
                continue
            red[a.slug] = partner_target(p, a, base, viewer)
        keep.append(a)
    return keep, red


def write_site(site, arts, redirects, out, with_editor, cfg):
    (out / "a").mkdir(parents=True)
    (out / "c").mkdir()
    shutil.copytree(ASSETS_DIR, out / "assets")
    img_dir = ARTICLES_DIR / "images"
    if img_dir.exists():
        shutil.copytree(img_dir, out / "images")

    def w(p, s):
        if not p.startswith("editor/") and p.endswith((".html", ".json", ".xml")):
            s = site.redact(s)
        (out / p).write_text(s, encoding="utf-8")
    ed = ROOT / "editor" / "index.html"
    if with_editor and ed.exists():
        (out / "editor").mkdir()
        url, key = db_settings(cfg)
        site_keys = ("site_name", "logo_left", "logo_right", "tagline", "language", "base_url", "footer_text", "nav_max", "nav_order",
                     "home_category_sections", "most_read_count", "breaking_max_age_days", "ticker", "live", "newsletter", "seo", "privacy", "polls", "partners")
        conf = json.dumps({"url": url, "anon_key": key, "site": {k: site.cfg[k] for k in site_keys},
                           "ver": {"tpl": asset_ver("email-templates.js"), "nl": asset_ver("newsletter-editor.js"), "polls": asset_ver("polls-editor.js"), "badges": asset_ver("badges-editor.js"), "schedule": asset_ver("schedule-editor.js")}}, ensure_ascii=False).replace("</", "<\\/")
        page = (ed.read_text(encoding="utf-8").replace("{{CONFIG}}", conf)
                .replace("{{CSS_VER}}", asset_ver("editor.css")).replace("{{JS_VER}}", asset_ver("editor.js")))
        w("editor/index.html", page)
    w("index.html", site.home())
    w("search.html", site.search_page())
    (out / "privacy").mkdir()
    w("privacy/index.html", site.privacy_page())
    w("robots.txt", site.robots())
    (out / "settings").mkdir()
    w("settings/index.html", site.settings_page())
    if not site.embed and not site.locked() and db_settings(cfg)[0]:
        (out / "badge").mkdir()
        w("badge/index.html", site.badge_page())
    if site.nl_on():
        (out / "newsletter").mkdir()
        w("newsletter/index.html", site.newsletter_page())
    if site.live_on():
        (out / "live").mkdir()
        w("live/index.html", site.live_page())
    for slug, c in site.cats.items():
        w(f"c/{slug}.html", site.category(slug, c))
    for a in arts:
        if a.slug in redirects:
            who = (site.partner(a.label) or {}).get("name", "the partner site")
            w(f"a/{a.slug}.html", site.redirect_page(redirects[a.slug], who))
            for lang in a.translations:
                w(f"a/{a.slug}.{lang}.html", site.redirect_page(redirects[a.slug], who))
            continue
        w(f"a/{a.slug}.html", site.article(a))
        if a.is_embed:
            w(f"a/{a.slug}-embed.html", site.embed_page(a))
        for lang in a.translations:
            w(f"a/{a.slug}.{lang}.html", site.article(a, lang))
    w("search.json", json.dumps([{
        "t": a.title, "s": a.subtitle, "c": a.category, "d": a.date.isoformat(), "df": fmt_date(a.date),
        "e": a.excerpt, "u": f"a/{a.slug}.html",
        "x": (strip_tags(a.body_html)[:3000] if not a.is_embed else "") + " " + " ".join(
            (v.get("title") or "") + " " + (v.get("subtitle") or "") for v in a.translations.values())} for a in arts if a.slug not in redirects], ensure_ascii=False))
    w("feed.xml", site.feed())
    sm = site.sitemap(skip=redirects)
    if sm:
        w("sitemap.xml", sm)
    ns = site.news_sitemap(skip=redirects)
    if ns:
        w("news-sitemap.xml", ns)
    w(".nojekyll", "")
    w("404.html", site.not_found())


def main():
    now = datetime.now(timezone.utc)
    cfg = load_config()
    apply_db_settings(cfg)
    arts, skipped = load_articles(cfg, now)
    partners = cfg.get("partners", [])
    if OUT.exists():
        shutil.rmtree(OUT)
    base = cfg["base_url"].rstrip("/")
    keep, red = view_for(arts, partners, None, base)
    site = Site(cfg, keep, now)
    write_site(site, keep, red, OUT, True, cfg)
    for p in partners:                      # one full copy of the site per partner, under /p/<label>/
        c2 = copy.deepcopy(cfg)
        c2.update(site_name=p["name"], logo_left=p["name"], logo_right="", _embed=p["slug"], _main_base=base, base_url=f"{base}/p/{p['slug']}" if base else "")
        c2["seo"].update(indexing=False, news_sitemap=False)
        keep2, red2 = view_for(arts, partners, p["slug"], base)
        write_site(Site(c2, keep2, now), keep2, red2, OUT / "p" / p["slug"], False, c2)
        print(f"Partner embed '{p['slug']}': {len(keep2)} articles -> {OUT / 'p' / p['slug']}")
    print(f"Built {len(keep)} articles in {len(site.cats)} sections -> {OUT}")
    sk = ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in skipped.items() if v)
    if sk:
        print(f"Skipped: {sk}")


if __name__ == "__main__":
    sys.exit(main())
