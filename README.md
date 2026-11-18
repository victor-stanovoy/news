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
2. In Supabase **SQL Editor > New query**, paste the whole file `supabase/instant-rebuild.sql` **unchanged** and press **Run** (it must say Success). Also run `supabase/settings.sql` the same way (once).
3. Open the editor, the **Settings** tab, the **Instant website updates** box: paste the token, press **Save token**. (The token is stored where the website and the editor pages cannot read it, and is never shown again.)
4. Open the editor and press **Update website**. It says the update started; the **Actions** tab shows a new run. A minute later refresh the site with Ctrl+Shift+R (GitHub Pages caches for a few minutes).
5. From now on every publish, edit, unpublish or take-down starts a rebuild by itself. Drafts do not. Set a reminder for the token's expiry day: make a new token and paste it in Settings again.

If nothing happens run `select status_code, content from net._http_response order by id desc limit 5;`. 204 = accepted. 401/403/404 = wrong or expired token, or it lacks *Actions: Read and write* on `news`.

## Editor windows

The editor has separate windows (tabs): **Articles**, **Radio studio** and **TV studio** (the studios are for admins and editors) and **Settings** (admins).
In **Settings** an admin changes the site name, logo, tagline, footer, menu, homepage sections, tickers and the Live page, and enters the LiveKit and GitHub keys. Run `supabase/settings.sql` once to switch it on. Saved settings win over `site.json` the next time the website is built (it rebuilds by itself when instant updates are set up, otherwise press **Update website**). Only the database address and key stay in `site.json`, because the editor needs them to log in.
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
4. **LiveKit details.** Run `supabase/settings.sql` once (SQL Editor). Then open the editor's **Settings** tab, box **Live radio and TV**, enter the LiveKit address (`wss://...`), API key and API secret, and press **Test connection**. It says *Connected to LiveKit* when all is right. The secret is stored where the website and the editor pages cannot read it; browsers only ever get short-lived tokens (publishing: signed-in admins and editors only; watching: anyone, only while on air). (Alternative: Supabase Edge Functions > Secrets `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; settings saved in the editor win.)
5. Open the editor, choose the **Radio studio** tab, enter a title, **Start broadcast**, allow the microphone. Then open the website's **Live** page in another tab and press Listen.
6. If you do not want the Live page, untick *Show the Live page and menu link* in Settings.

Tips: use headphones while testing so the radio does not echo into your microphone. Keep the editor page open while broadcasting.

### Free music library and the Live page

The radio studio has a **Find free, royalty-free music** box. It searches Openverse (openverse.org), a free catalogue of openly licensed audio, and only shows tracks that may be used commercially (CC0, public domain, CC BY, CC BY-SA). Press **Add** and the song is copied into your private music library together with its license and credit line.

One-time setup:

1. Run `supabase/music.sql` and `supabase/live.sql` again in the SQL Editor (both were extended).
2. Edge Functions → new function named `music-library` → paste `supabase/functions/music-library/index.ts` → turn **Verify JWT off**.

No account or key is needed. Songs licensed "CC BY" or "CC BY-SA" require credit: while such a song plays, listeners see its credit line under the player on the Live page, which satisfies that. The library shows each song's license so you can check.

The Live page for visitors has a TV player (play, volume, mute, full screen) and a radio player (equalizer, on-air time, the current song), updates every 10 seconds, reconnects after a weak connection, and shows the latest stories when nothing is live. Keyboard: `M` mutes, `F` goes full screen.

### Look and feel

The public site uses a newspaper-style layout: a light masthead with your logo and the date, a sticky section bar, serif headlines, thin dividing rules, and compact story rows on phones. The logo and icons are in `assets/logo.png`, `assets/favicon.png`, `assets/apple-touch-icon.png` and `assets/og-default.png` (shown when a page is shared); replace those files to change them. The colors are the variables at the top of `assets/style.css` (`--head` indigo, `--spark` and `--accent` pink).

### TV studio: pictures, videos, screen and captions

Set **Source** to *Studio* in the TV studio window. You get a program picture (exactly what the audience sees), six scenes (keys 1 to 6): **Camera**, **Picture / video**, **Picture + me** (you in a corner), **Screen**, **Screen + me**, **Black**, and an on-screen **caption** bar. Upload pictures (JPG, PNG, WebP, GIF) and videos (MP4, WebM, MOV; up to 50 MB each) in the same window; press **Show** to put one on screen. The sound of a video goes out to the audience too, mixed with your microphone.

One-time setup: run `supabase/tvmedia.sql` in the Supabase SQL Editor (creates the private picture and video storage).

Tips: keep the studio tab open while you broadcast; switching to another window inside the editor is fine. Browsers can play most MP4 files but not every one: if a video stays black, use an MP4 made with H.264.

#### Jingle pads and mixer (radio and TV)

Upload jingles in *Music & jingles*; they become pads (keys Q W E R A S D F) that play on top of the music and are heard on air. Channel strips show live level meters for the microphone, music and pads, each with a mute button.

### More TV controls

Under the studio picture: a **Starting soon slate** (key 7) with your own title and an optional countdown timer, a **LIVE bug with clock** (key L), a **scrolling ticker** along the bottom with text you type (key T), and **cross-fades** between scenes (key F to turn on or off). Everything is drawn into the broadcast picture, so viewers see exactly what you see.

## Importing articles from a CSV file

Admins: **Articles → Import CSV**, choose the file (for example your export), check the summary and press Import. New articles are added; articles that already exist (same id, or same headline when the file has no ids) are updated. Nothing is deleted, and you can run it again safely. Then press **Update website**.

## Newsletter (compose, send, sign-up box)

The **Newsletter** window in the editor lets admins and editors build an email from a template (Daily digest, Top story, Cards, Letter, Alert) or paste your own HTML, preview it on desktop and phone, send a test, and send it to everyone confirmed. The **Design** tab changes colors, font, width, header, buttons, logo, footer and social links for all templates.

You choose the service that delivers the emails in **Settings → Newsletter → Email service**:

| Service | Free plan | What you need |
|---|---|---|
| Resend | about 100 emails a day | API key (resend.com → API Keys, "Sending access"); your own domain verified at resend.com/domains; sender address on that domain |
| Mailjet | about 200 emails a day | API key + secret key; sender address verified in Mailjet |
| Your own mail server (SMTP) | your mailbox's limit (Gmail about 500 a day) | server name, port (587 or 465), user name, password (Gmail needs an "app password") |

One-time setup:

1. Supabase → SQL Editor → run `supabase/newsletter.sql`, and run `supabase/settings.sql` again (it knows the email keys now).
2. Deploy the function: Edge Functions → new function named `newsletter` → paste `supabase/functions/newsletter/index.ts` → turn **Verify JWT off** (the function checks who is calling by itself).
3. Editor → Settings → Newsletter: choose the email service, fill in its details, press **Save and test connection**, tick **Show the sign-up box on the website**, press Save (this also saves your site address, which the confirm and unsubscribe links need).
4. Editor → Newsletter → Design: set the sender name, sender email and your postal address, then Save.

Good to know:

- Sign-up uses double opt-in: people get a confirmation email first. Every email gets an unsubscribe link automatically, even pasted HTML.
- Free plans have a daily limit. A bigger list sends in several rounds; the Send dialog resumes where it stopped and nobody gets it twice.
- Placeholders in your text: `{{name}}`, `{{email}}`, `{{unsubscribe_url}}`.
- Only add people who agreed to receive email (the Add box asks you to confirm this). Keep a real postal address in the footer; many countries require it.
- The keys are stored where the website and the editor pages cannot read them; only the function can.

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

## Search engines (SEO)

Extras: Google News sitemap (`news-sitemap.xml`), image and last-changed dates in `sitemap.xml`, breadcrumb and website-search structured data, an RSS link in every page, a custom page-title ending and a default share picture.

Settings > **Search engines (SEO)** controls how Google and others see the site. The build writes `robots.txt` and `sitemap.xml` for you, adds `NewsArticle` / organisation structured data, social-card tags and the canonical address of every page. Options: let search engines index the site or hide it completely, a default description, your X handle, Google Search Console and Bing verification codes, and a switch to ask AI training crawlers (GPTBot, CCBot, ClaudeBot and others) to stay away. Set the **Website address** in Settings first, or the sitemap and canonical links cannot be written.

Note: crawlers only read `robots.txt` at the very top of a domain. On a GitHub Pages address like `name.github.io/news` it is ignored, so for the `noindex` switch and the AI-crawler block to be reliable use a custom domain at the root.

## Protecting your team's names (GDPR for authors and editors)

Settings > **Privacy and GDPR** > *Hide author and editor names*. While it is on, every published page, the search data and the structured data credit the **newsroom** (or the name you type) instead of a person. The box *Names to remove from article text too* wipes names that appear inside articles (a sign-off, a photo credit) everywhere on the website, translations included. Authors and editors still see their own names inside the editor.

To also hide the names from the public database (anyone could otherwise read the author column through the Supabase API), run `supabase/privacy.sql` once, after `settings.sql`. Run it again whenever you re-run `schema.sql`. Visitors can then no longer read author names or user ids; only the website build can, through a function that returns nothing while names are hidden.

## Visitor lockdown mode

Settings > **Privacy and GDPR** > *Lockdown mode*. When on, the next website update:

- removes polls, the newsletter box and the Live page (the only features that store or send visitor data),
- adds a browser rule (Content-Security-Policy) so pages cannot contact any outside server or load frames, and sends no referrer,
- turns embedded videos in articles into plain links,
- writes an automatic **Privacy** page (footer link) saying exactly this, with your contact email.

Remaining caveat: pictures hosted on other websites are still fetched by the visitor's browser (that site sees their IP address). Host images yourself to avoid it. This is a technical aid, not legal advice.

## Partners and embeds (white-label copies of the site)

Settings > **Partners and embeds** > *Add partner*. Give each partner a **website name** (anything: it replaces the logo and site name in their copy), a **label** (letters, numbers, dashes), optionally their **own website address** (leave it empty if the partner lives on your website: their stories then go to their copy at `/p/<label>/`; otherwise use `{slug}` where the story's name goes, e.g. `https://partner.com/news/{slug}`), an optional accent colour, and a default for labelled stories. Save and wait for the website to update. Each partner then has a full copy of the site (articles, Live radio/TV, polls, newsletter, search, settings) at `/p/<label>/index.html`. The settings page shows that link and a **Copy embed code** button with a ready `<iframe>`.

**Labelling a story:** in the article editor, *More options > Partner label*, then *On this website*:

| Choice | Main website and other embeds | The partner's embed |
|---|---|---|
| Show in both | normal story | normal story |
| Send visitors to the partner | redirects to the partner's copy on your site (or their own website if you gave one) | normal story |
| Only in the partner embed | story is left out completely | normal story |
| Partner default | whatever you chose for the partner | normal story |

**Labelling a broadcast:** the Radio and TV studios have a *Partner label* box. On the main Live page that broadcast is not played; visitors see "Live now on <partner>" with a link (or nothing at all if the partner is set to hide). Inside that partner's embed it plays normally.

Run `supabase/partners.sql` once for the labels (and `live.sql` again, it now stores the broadcast label). Partner copies are kept out of search engines. Hosting limit: every partner copy duplicates the site's files, so a handful of partners is fine, hundreds is not.

## Visitor polls

Polls tab (admins and editors): write a question and 2 to 8 answers, choose a **card inside the page** or a **full-screen banner**, where it appears (home, articles, every page), when results are shown, optional start and end time, then **Go live**. It appears on the website immediately with no update. Run `supabase/polls.sql` once in the Supabase SQL Editor. One vote per browser (a random code in local storage); clearing browser data allows a second vote, so treat results as a pulse check, not an election. Lockdown mode switches polls off.

## Visitor settings page

Every site has a **Settings** page (link in the footer, `/settings/`). Visitors can turn the browser-tab ticker on or off, choose scrolling text or one headline at a time, pick the speed, and choose light, dark or match-my-device. Choices are saved in the visitor's own browser (nothing is sent to a server). If you turn the tab ticker off in `site.json` (`ticker.tab.enabled`), the option is greyed out for everyone.

**Safari:** the tab ticker is tuned for it: shorter window (Safari shows about 20 characters), non-breaking spaces so Safari does not trim the text, a Web Worker clock because Safari slows normal timers in hidden tabs, and cleanup on `pagehide`. Safari hides tab titles when only one tab is open; that is the browser's behaviour.

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

## 404 page and partner logos

* `404.html` is a small catch-the-404s game (arrow keys, A/D or drag on a phone). GitHub Pages serves it automatically for unknown addresses.
* Each partner in **Settings > Partners** can have a **logo** (paste an https address or upload an image). It replaces the site name in the header of that partner's embed.
* In the article editor, **Where it appears** is one drop-down: everywhere, main site and a partner, only in a partner (hidden on the main site), or main site sends readers to the partner. No new Supabase steps are needed.

## Staff ID badges

Admins get a **Badges** tab. Add a person (name, job title, employee ID, optional photo) and you get a credit-card-size badge with a QR code.

* **Copy QR code** puts the QR image on the clipboard to paste into your label or design software; **Download QR** saves a PNG; **Copy link** copies the address inside the QR.
* **Print this badge** / **Print all** open the print dialog with 85.6 × 54 mm cards, two per row.
* Scanning the QR opens `/badge/` on your website, which shows the person's name, title, ID and photo and says the badge is valid. **Switch off** makes a lost badge stop verifying; **New link** replaces the secret code.
* One-time setup: run `supabase/badges.sql` in the Supabase SQL Editor. The page is not built in GDPR lockdown mode.
