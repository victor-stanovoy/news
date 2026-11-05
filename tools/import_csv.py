#!/usr/bin/env python3
"""
Copy articles from a CSV export into the Supabase database (standard library only).

    SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... \
        python tools/import_csv.py articles/articles-2026-10-export.csv

Use the *service_role* key (Supabase > Project Settings > API). Keep it secret: never commit it and
never put it in site.json. Running the import again updates the same articles (matched by id).
Each article gets a permanent slug equal to the page name it already has on the website, so existing
links keep working even if you later change a title.
"""
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

csv.field_size_limit(10 ** 9)

JSON_COLS = {"additional_images": [], "live_updates": [], "translations": {}}
BOOL_COLS = ["author_verified", "taken_down", "is_breaking", "is_ai_translated", "is_featured", "is_live_update"]
INT_COLS = ["cover_focus_x", "cover_focus_y", "views", "series_order"]
DATE_COLS = ["published_at", "scheduled_publish_at"]
TEXT_COLS = ["id", "title", "subtitle", "content", "content_type", "category", "image_url", "image_layout",
             "reporter_video_url", "author_name", "status", "breaking_description", "live_update_label",
             "citations", "series_id"]


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
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def convert(row):
    out = {}
    for c in TEXT_COLS:
        v = (row.get(c) or "")
        out[c] = v if c in ("content",) else v.strip()
        if out[c] == "" and c not in ("content", "title"):
            out[c] = None
    out["title"] = (row.get("title") or "").strip().strip("*").strip()
    for c in BOOL_COLS:
        out[c] = (row.get(c) or "").strip().lower() == "true"
    for c in INT_COLS:
        try:
            out[c] = int(float(row.get(c)))
        except (TypeError, ValueError):
            out[c] = None
    for c in DATE_COLS:
        d = parse_dt(row.get(c))
        out[c] = d.isoformat() if d else None
    for c, default in JSON_COLS.items():
        try:
            v = json.loads(row.get(c) or "")
        except ValueError:
            v = default
        if c == "translations" and isinstance(v, dict):
            v = {k: x for k, x in v.items() if isinstance(x, dict)}
        out[c] = v if isinstance(v, type(default)) else default
    for src, dst in (("created_date", "created_at"), ("updated_date", "updated_at")):
        d = parse_dt(row.get(src))
        if d:
            out[dst] = d.isoformat()      # keep the original dates; missing ones fall back to "now"
    out["category"] = out["category"] or "News"
    out["status"] = out["status"] if out["status"] in ("draft", "published", "scheduled") else "draft"
    out["content_type"] = out["content_type"] or "rich"
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url:                                     # fall back to the address in site.json
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site.json"), encoding="utf-8") as fh:
                url = (json.load(fh).get("supabase") or {}).get("url", "").strip().rstrip("/")
        except (OSError, ValueError):
            pass
    if not url or not key:
        sys.exit("Missing settings: the Supabase address (site.json > supabase > url) and the SUPABASE_SERVICE_KEY secret.")

    rows = []
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            rows += list(csv.DictReader(fh))

    items = [convert(r) for r in rows if (r.get("title") or "").strip()]
    # same ordering and de-duplication as build.py, so slugs match the pages already online
    def sort_key(a):
        return a["published_at"] or ""
    published_first = sorted(items, key=sort_key, reverse=True)
    used = {}
    for a in published_first:
        base = slugify(a["title"])
        n = used.get(base, 0)
        used[base] = n + 1
        a["slug"] = base if n == 0 else f"{base}-{n + 1}"
    for a in items:
        if not a.get("id"):
            a.pop("id", None)

    with_id = [a for a in items if a.get("id")]
    without_id = [a for a in items if not a.get("id")]
    for batch_name, batch in (("with id", with_id), ("without id", without_id)):
        for i in range(0, len(batch), 25):
            chunk = batch[i:i + 25]
            req = urllib.request.Request(
                f"{url}/rest/v1/articles", data=json.dumps(chunk).encode("utf-8"), method="POST",
                headers={"apikey": key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal",
                         **({"Authorization": f"Bearer {key}"} if key.startswith("eyJ") else {})})
            try:
                urllib.request.urlopen(req, timeout=60).read()
            except urllib.error.HTTPError as e:
                sys.exit(f"Import failed ({batch_name}, rows {i}-{i + len(chunk)}): {e.code} {e.read().decode('utf-8', 'replace')[:500]}")
    print(f"Imported {len(items)} articles ({sum(1 for a in items if a['status'] == 'published')} published).")


if __name__ == "__main__":
    main()
