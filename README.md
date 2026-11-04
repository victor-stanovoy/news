# SparkNews™

A static news website. You add articles by dropping a **CSV file into the `articles/` folder** and pushing to GitHub. A GitHub Action rebuilds and publishes the site automatically.

Live site (after enabling Pages, see below): https://victor-stanovoy.github.io/news/

## Adding articles

1. Put a `.csv` file in `articles/` (any file name; one file can hold many articles, one per row).
2. Commit and push (or upload through the GitHub web interface: **Add file → Upload files**).
3. Wait about a minute. The site updates itself.

The CSV uses the same columns as your article export. Only these matter for the website right now:

| Column | Required | Meaning |
|---|---|---|
| `title` | yes | Headline |
| `content` | yes | Article body. HTML, or plain text (blank line = new paragraph) |
| `category` | yes | Section the article appears in (a new name creates a new section) |
| `subtitle` | | Standfirst under the headline |
| `image_url` | | Cover image: a web address, or a file name from `articles/images/` |
| `cover_focus_x`, `cover_focus_y` | | 0 to 100, which part of the cover image stays visible when cropped |
| `additional_images` | | JSON list of image URLs, e.g. `["https://a.jpg","https://b.jpg"]` |
| `image_layout` | | `grid` or `carousel` for the additional images |
| `reporter_video_url` | | YouTube link, embedded in the article |
| `author_name`, `author_verified` | | Byline |
| `status` | | `published` shows on the site. `draft` is skipped. `scheduled` goes live at `scheduled_publish_at` |
| `taken_down` | | `true` hides the article |
| `published_at`, `updated_date` | | ISO dates, e.g. `2026-11-04T09:30:00Z` |
| `is_featured` | | `true` makes it the main homepage story |
| `is_breaking`, `breaking_description` | | Red breaking banner on the homepage (hides after 7 days) |
| `is_live_update`, `live_update_label`, `live_updates` | | Live page. `live_updates` is JSON: `[{"timestamp":"...","text":"..."}]` |
| `content_type` | | `html` / `interactive` shows a full HTML page inside the article (quizzes, interactives) |
| `citations` | | Sources and credits, separated by blank lines |
| `series_id`, `series_order` | | Groups articles into a series |
| `views` | | Used for the "Most read" box |

All other columns are accepted and ignored for now (AI review, approvals, logistics, paywall, translations, badges, etc.). They are kept in the CSV so they can be used when those features get built.

### Translations

If the `translations` column holds JSON like
`{"es":{"title":"…","subtitle":"…","content":"<p>…</p>"},"fr":null}`,
the article automatically gets a "Read in" language switcher and one page per language (Arabic is shown right-to-left). Languages with `null` are ignored. Translated titles are searchable too.

### Your own images

Put image files in `articles/images/` and write just the file name in `image_url` (for example `fire-drill.jpg`).

## Site settings

`site.json` holds the site name, tagline, public address, how many sections show in the menu, and so on.

## Tickers

Both tickers show the newest articles automatically and are controlled by the `"ticker"` block in `site.json`:

| Setting | What it does |
|---|---|
| `enabled` | Turns the scrolling bar under the menu on or off |
| `label` | Text on the coloured tag at the left (`LATEST`, `BREAKING`, …) |
| `count` | How many of the newest articles are shown |
| `speed` | Scroll speed in pixels per second (the bar pauses when hovered) |
| `custom` | Your own headlines instead of the newest articles, e.g. `["Plain text", {"text":"With link","url":"a/some-article.html"}]` |
| `tab.enabled` | Turns the tab-title ticker on or off. It starts when a visitor switches to another tab and stops when they come back |
| `tab.mode` | `scroll` (text slides along) or `headline` (one headline at a time) |
| `tab.prefix`, `tab.separator` | Symbols before and between headlines |
| `tab.window_chars`, `tab.step`, `tab.interval_ms` | How much of the title is visible, how far it moves, and how often (scroll mode) |
| `tab.headline_interval_ms` | Seconds per headline in `headline` mode, in milliseconds |

Browsers slow down timers in background tabs, so the tab ticker may move slower than the interval you set.

## Look and feel

All styling is in `assets/style.css`. The colours and fonts are variables at the top of the file. You can replace the whole file with your own stylesheet; the class names used by the pages are `.card`, `.hero`, `.rowc`, `.body`, `.top`, `.menu`, `.foot`, and so on.

## Preview on your computer

```
python build.py
python -m http.server -d _site 8000
```

then open http://localhost:8000. (Needs Python 3.9 or newer, nothing else to install.)

## One-time GitHub setup

Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. After that every push to `main` publishes the site. The site also rebuilds every hour so scheduled articles go live on time.
