# Susana Stethers Photography

Static website for susanastethersphotography.com — plain HTML, CSS and JavaScript.
No build step, no framework, no dependencies.

## Preview locally

```bash
cd susana-stethers-photography
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

> Open `index.html` directly (double-click) and the photos and styles will load,
> but the nav links will break — they're root-relative (`/about.html`), which only
> resolves over a server. Use the command above instead.

## Structure

```
index.html          Home — hero, intro, session carousel, testimonials, Instagram
about.html          About Susana
experience.html     The Experience + FAQ accordion
investment.html     Pricing packages
contact.html        Contact form
css/styles.css      All styles (design tokens at the top)
js/main.js          Carousel, FAQ accordion, contact form
js/config.js        Supabase keys — see "Contact form" below
images/             Optimized WebP + JPEG, 1x and 2x
vercel.json         Cache headers, clean URLs
sitemap.xml         Update lastmod when content changes meaningfully
```

## Photos

Source photos live outside this repo (they're 353 MB — far too big for git; the
`.gitignore` excludes `_original-photos/`). The `images/` folder holds web-ready
derivatives only: **5.9 MB total**, down from 353 MB.

Every image ships as WebP (modern browsers) with a JPEG fallback, at 1x and 2x
for retina screens. Browsers pick the smallest file that works.

### ⚠️ Three placeholders need real photos

These slots currently show a grey "PHOTO NEEDED" card, because no photo in the
source set matched:

| File prefix | Where it appears | What's needed |
|---|---|---|
| `about-portrait` | About page, main image | A portrait of Susana herself |
| `sess-maternity` | Home → What I Photograph | A maternity photo |
| `pkg-maternity` | Investment → Maternity card | A maternity photo |

To replace one: drop the new photo in, generate the four files
(`<name>-<w>.webp`, `<name>-<w>.jpg` at 1x and 2x — see the table of sizes in
the existing filenames), and overwrite. No HTML changes needed.

Also worth knowing: the site advertises five session types, but every real photo
comes from a single in-home newborn session. Family, couples and milestone slots
currently reuse those images. More variety would strengthen the portfolio a lot.

## Contact form

The form posts straight to Supabase's REST API — one `fetch`, no SDK.

**Until Supabase is configured**, the form falls back to opening the visitor's
email client, so no lead is silently dropped.

To wire it up, fill in `js/config.js`:

```js
window.SITE_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',        // the anon/publishable key ONLY
  FALLBACK_EMAIL: 'hello@susanastethersphotography.com'
};
```

### On the keys being public

The anon key is *designed* to ship in the browser — it isn't a secret. What
protects the data is Row Level Security: the `anon` role is granted `INSERT` on
`inquiries` and nothing else. It cannot read, update, or delete a single row, so
nobody can pull the client list out of the page source.

**Never put the service-role key in `config.js`.** That key bypasses RLS
entirely and would expose every inquiry to anyone who views source.

Other protections already in place:

- **Honeypot field** — hidden from people, filled in by bots. Submissions with it
  set are silently discarded (the bot is told it succeeded, so it doesn't retry).
- **`maxlength`** on every field, mirrored by `CHECK` constraints in the database.

## Deploying

Vercel serves this as-is; there's no build command. `vercel.json` sets
long-lived immutable caching on `/images` and basic security headers.

## Accessibility

Skip link, visible keyboard focus rings, real `<button>` elements for the FAQ
with `aria-expanded`/`aria-controls`, alt text on every image, `width`/`height`
on every image to prevent layout shift, and `prefers-reduced-motion` respected.
