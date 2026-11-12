# SparkNews™

A static news website. You can add articles in the **online editor** (see below) or by dropping a **CSV file into the `articles/` folder** and pushing to GitHub. A GitHub Action rebuilds and publishes the site automatically.

Live site (after enabling Pages, see below): https://victor-stanovoy.github.io/news/

## Online editor (write and publish on the website)

The editor lives at **https://victor-stanovoy.github.io/news/editor/**. People sign in, write articles in a rich-text editor
(headline, photos, sections, translations, scheduling, live pages) and press **Publish**. The website rebuilds itself and the
article is online about a minute later (after the one-time step *Update the website right after publishing*, below). Articles are stored in a free [Supabase](https://supabase.com) database.

**Roles** (an admin gives these out in the editor's **Team** panel):

| Role | Can do |
|---|---|
| Admin | Everything: delete articles, full-HTML / interactive pages, manage the team |
| Editor | Write, edit and publish any article |
| Writer | Write drafts and edit their own drafts. An editor publishes them |

### One-time setup (about 15 minutes)

1. **Create the database.** Sign up at supabase.com and create a project (any name, region *Central EU (Frankfurt)*, save the database password).
2. **Create the tables.** In the project open **SQL Editor > New query**, paste the whole file `supabase/schema.sql`, press **Run**. It should say *Success*. It is safe to run again at any time (do this whenever a newer version of the file is published).
3. **Connect the website.** In Supabase open **Project Settings > API**. Copy the **Project URL** and the **anon / publishable key** into `site.json`:
   ```json
   "supabase": { "url": "https://abcdxyz.supabase.co", "anon_key": "eyJ..." }
   ```
   Both values are meant to be public. Never put the *service_role / secret* key in this file.
4. **Allow logins from the editor page.** In Supabase open **Authentication > URL Configuration**. Set **Site URL** to
   `https://victor-stanovoy.github.io/news/editor/` and add the same address under **Redirect URLs**.
5. **Make yourself admin.** Open the editor page, enter your email and press **Email me a login link**, then click the link in the email.
   You will see "No editor access yet". Now in Supabase **SQL Editor** run (with your email):
   ```sql
   insert into public.editors (user_id, role, name)
   select id, 'admin', 'Your Name' from auth.users where email = 'you@example.com';
   ```
   Reload the editor. After this, add everyone else from the editor's **Team** panel (they first open the editor page and request a login link so their account exists).
6. **Copy the existing articles into the database (once).** In GitHub open **Settings > Secrets and variables > Actions > New repository secret**,
   name it `SUPABASE_SERVICE_KEY` and paste the *service_role / secret* key from Supabase **Project Settings > API**.
   Then open the **Actions** tab, choose **Import articles into the database**, press **Run workflow**.
7. **Push `site.json`.** The site rebuilds and from now on shows the database articles. Every article address stays exactly the same.

### Good to know

- **Where articles come from.** Database articles and CSV files in `articles/` are combined. If the same article is in both, the database wins.
  An article you hide in the editor (draft, taken down, scheduled) never reappears from an old CSV.
- **Safe by design.** If the database cannot be reached while the site builds, the build stops and the live site stays as it was.
- **Updating the website.** Publishing saves the article in the database. The website itself is rebuilt when a push happens, once an hour, or when the database tells GitHub to rebuild (set up below). The **Update website** button in the editor does the same by hand. Scheduled articles go live at the next rebuild.
- **Images** uploaded in the editor are stored in Supabase (free plan: 1 GB). Images from other websites can be used by address.
- **Signed-in editors** see an **Edit this article** button on every article page.
- **Slugs.** An article's web address is created when it is first saved and never changes, even if the headline is edited.
- **Backups.** In Supabase, *Database > Backups* (or export the `articles` table as CSV) keeps a copy. A CSV export can be dropped into `articles/` as before.
- **Security.** Articles are cleaned before publishing: scripts and unsafe links are removed. Only admins can create full-HTML pages.
  Visitors can only read published articles. Everything is enforced by rules inside the database, not just by the editor page.
- **"permission denied for table articles"** in a failed build means the database has not got the latest permissions: paste the current `supabase/schema.sql` into the SQL Editor and Run it again, then re-run the failed build in the Actions tab.
- **If a build fails** with "Could not read articles from the database", check that `site.json` has the right URL and key and that the Supabase project is not paused (free projects pause after a week of no use).

### Update the website right after publishing (one-time, about 5 minutes)

Without this, a published article appears on the site only at the next hourly rebuild (GitHub does not always run it on time).

1. Open https://github.com/settings/personal-access-tokens/new. Name: `SparkNews rebuild`. Expiration: 1 year. **Repository access: Only select repositories > news.**
   Under **Repository permissions** add **Actions** and set it to **Read and write**. Leave all else. **Generate token** and copy it (starts with `github_pat_`; shown once).
2. In Supabase **SQL Editor > New query**, paste the whole file `supabase/instant-rebuild.sql` **unchanged** and press **Run** (it must say Success).
3. New query, paste this with your token instead of the dots, **Run** (it must say *1 row affected*):
   ```sql
   update public.app_secrets set value = 'github_pat_...' where key = 'github_token';
   ```
4. Open the editor and press **Update website**. It says the update started; the **Actions** tab shows a new run. A minute later refresh the site with Ctrl+Shift+R (GitHub Pages caches for a few minutes).
5. From now on every publish, edit, unpublish or take-down starts a rebuild by itself. Drafts do not. Set a reminder for the token's expiry day: make a new token and repeat step 3.

If nothing happens run `select status_code, content from net._http_response order by id desc limit 5;`. 204 = accepted. 401/403/404 = wrong or expired token, or it lacks *Actions: Read and write* on `news`.

## Editor windows

The editor has separate windows (tabs): **Articles**, **Radio studio** and **TV studio** (the studios are for admins and editors).
In an article press **Focus** for a full-screen writing window: only the line you are typing on stays bright, the rest is dimmed, and the line stays in the middle of the screen (both can be switched off). Press Esc to leave.

## Live radio and live TV (LiveKit)

Editors and admins have two separate studio windows in the editor, the **Radio studio** and **TV studio** tabs. Each has its own title, settings (microphone, camera, video quality, echo and noise filters, saved in that browser), a microphone level meter and a Start / Stop button. The tab shows a red dot while that channel is on air, and you can switch to other windows while broadcasting.
Each studio also has a **Music & jingles** panel: upload songs and jingles (mp3, m4a, wav, ogg, flac; up to 50 MB each), press play, and the music is **mixed with your microphone into the broadcast**. There are volume sliders for the microphone and the music, a mute button, an option that lowers the music while you speak, and automatic play of the next song. Before you go on air, music plays on your speakers only so you can try it. Only admins and editors can see or use the library; visitors only hear the broadcast. One-time setup: run `supabase/music.sql` in the Supabase SQL Editor (same way as the other files). Only upload music you have the right to broadcast.
Visitors open the **Live** page of the website (a menu link that pulses red while something is on air) and press Listen / Watch. No login is needed to watch.
A broadcast goes off air by itself about a minute after the editor page is closed. Streaming goes through [LiveKit Cloud](https://livekit.io) (a free plan exists; check their limits).

One-time setup (about 15 minutes):

1. **LiveKit project.** Sign up at cloud.livekit.io and create a project. In **Settings > Keys** create an API key. Note three values: the **URL** (`wss://....livekit.cloud`), the **API key** and the **API secret**.
2. **Database part.** Supabase **SQL Editor > New query**, paste `supabase/live.sql`, **Run**.
3. **Token function.** Supabase **Edge Functions > Deploy a new function > Via Editor**. Name it exactly `livekit-token`, paste the whole file `supabase/functions/livekit-token/index.ts`, and **turn OFF "Verify JWT"** (the function checks who is asking itself). Deploy.
4. **Secrets.** Supabase **Edge Functions > Secrets**, add `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` with the three values from step 1. The secret never reaches the website; browsers only get short-lived tokens (publishing: signed-in admins and editors only; watching: anyone, only while on air).
5. Open the editor, choose the **Radio studio** tab, enter a title, **Start broadcast**, allow the microphone. Then open the website's **Live** page in another tab and press Listen.
6. If you do not want the Live page, set `"live": {"enabled": false}` in `site.json`.

Tips: use headphones while testing so the radio does not echo into your microphone. Keep the editor page open while broadcasting.

## Adding articles with CSV files

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

## Dark mode

The site follows the visitor's system setting (light or dark) and has a toggle button in the header that remembers their choice. Colours for both modes are variables at the top of `assets/style.css`.

To check the tab ticker without leaving the page, add `?tickertest` to any page address (click the page to stop it).

## If something doesn't work

Add `?debug` to any page address (for example `https://victor-stanovoy.github.io/news/?debug`). A small green panel shows whether the script is running, whether the ticker is animating, the tab title, the theme and any errors. Stylesheet and script links carry a version stamp, so browsers pick up new versions automatically after a deploy.

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
