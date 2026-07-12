/**
 * ONE-TIME (and re-runnable) ANNOTATOR
 * ---------------------------------------------------------------------------
 * Walks every public page, finds each piece of human-readable text, and tags
 * it with a stable `data-cms="<key>"` attribute. Also emits:
 *
 *   supabase/seed.sql   — INSERTs for site_content / site_images
 *   content.fallback.json — the current text, used if Supabase is unreachable
 *                            at build time (so a build never ships a blank page)
 *
 * The HTML remains completely valid and readable. `data-cms` is inert in the
 * browser; only scripts/build.mjs cares about it.
 *
 *   node scripts/annotate.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as cheerio from 'cheerio';

const PAGES = {
  'index.html':      'home',
  'about.html':      'about',
  'experience.html': 'experience',
  'portfolio.html':  'portfolio',
  'investment.html': 'investment',
  'contact.html':    'contact',
};

// Elements whose text Susana should be able to edit.
const TEXT_SELECTORS = [
  'h1', 'h2', 'h3', 'h4',
  'p.eyebrow',
  '.prose p', '.intro p', '.lede p',
  '.sess-card__note', '.pkg__tagline', '.pkg__price',
  '.pkg__includes li', '.know li',
  'blockquote p', 'figcaption cite',
  '.step p', '.faq__a',
  '.btn', '.link-more',
  '.note', '.contact__meta',
  '.site-footer__loc',
];

// Never touch these — they're structural or navigational.
const SKIP = new Set(['Skip to content', 'Home', 'About', 'The Experience', 'Portfolio', 'Investment', 'Contact', 'Instagram']);

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

const content = {};   // key -> { value, label, page, section, kind, sort }
const images  = {};   // slot -> { label, section, alt }
let sortCounter = 0;

for (const [file, page] of Object.entries(PAGES)) {
  if (!existsSync(file)) { console.warn(`  skip (missing): ${file}`); continue; }

  const $ = cheerio.load(readFileSync(file, 'utf8'), { decodeEntities: false });
  const used = new Set();

  const keyFor = (base) => {
    let k = base, n = 2;
    while (used.has(k)) k = `${base}-${n++}`;
    used.add(k);
    return k;
  };

  // ---- <title> and <meta name="description"> — the two biggest SEO levers
  const title = $('title').first();
  if (title.length) {
    const key = `${page}.meta.title`;
    title.attr('data-cms', key);
    content[key] = { value: title.text().trim(), label: 'Page title (shows in Google)', page, section: 'SEO', kind: 'text', sort: sortCounter++ };
  }
  const desc = $('meta[name="description"]').first();
  if (desc.length) {
    const key = `${page}.meta.description`;
    desc.attr('data-cms-content', key);
    content[key] = { value: desc.attr('content') || '', label: 'Google description (aim for 150–160 characters)', page, section: 'SEO', kind: 'textarea', sort: sortCounter++ };
  }

  // ---- Body text
  // IDEMPOTENT: re-running must produce the same result. If an element is
  // already tagged we reuse its key and re-record its text — otherwise a second
  // run would silently empty content.fallback.json, and a Supabase outage would
  // then ship a blank website. (Learned the hard way.)
  for (const sel of TEXT_SELECTORS) {
    $(sel).each((_, el) => {
      const $el = $(el);
      if ($el.closest('.site-nav, .site-footer nav').length) return;
      if ($el.find('img, picture, input, select, textarea').length) return;

      const text = $el.text().replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2 || SKIP.has(text)) return;

      const existing = $el.attr('data-cms');
      const section = $el.closest('section, header, footer, article').find('h2').first().text().trim()
                   || $el.closest('section').attr('id')
                   || 'Page';

      const key = existing || keyFor(`${page}.${slug(section)}.${slug(text)}`);
      if (existing) used.add(existing);
      $el.attr('data-cms', key);

      content[key] = {
        value: $el.html().trim(),
        label: text.length > 60 ? text.slice(0, 57) + '…' : text,
        page,
        section: section.slice(0, 40),
        kind: text.length > 90 ? 'textarea' : 'text',
        sort: sortCounter++,
      };
    });
  }

  // ---- Images: tag each <picture>/<img> with the slot it fills
  $('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src') || '';
    const m = src.match(/images\/([a-z0-9-]+?)-\d+\.(jpg|webp|png)$/i);
    if (!m) return;
    const slot = m[1];
    const $pic = $img.closest('picture');
    ($pic.length ? $pic : $img).attr('data-cms-image', slot);
    if (!images[slot]) {
      images[slot] = {
        label: slot.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        section: page.charAt(0).toUpperCase() + page.slice(1),
        alt: $img.attr('alt') || '',
      };
    }
  });

  writeFileSync(file, $.html());
  console.log(`  ✓ ${file}`);
}

// ---------------------------------------------------------------- seed.sql
const esc = (s) => String(s).replace(/'/g, "''");

let sql = `-- AUTO-GENERATED by scripts/annotate.mjs — do not hand-edit.
-- Seeds the editable content. Safe to re-run: existing rows keep Susana's
-- edits (ON CONFLICT DO NOTHING), so this never overwrites her work.

`;
for (const [key, c] of Object.entries(content)) {
  sql += `insert into public.site_content (key,value,label,page,section,kind,sort) values ('${esc(key)}','${esc(c.value)}','${esc(c.label)}','${esc(c.page)}','${esc(c.section)}','${c.kind}',${c.sort}) on conflict (key) do nothing;\n`;
}
sql += '\n';
for (const [slot, i] of Object.entries(images)) {
  sql += `insert into public.site_images (slot,label,section,alt) values ('${esc(slot)}','${esc(i.label)}','${esc(i.section)}','${esc(i.alt)}') on conflict (slot) do nothing;\n`;
}
mkdirSync('supabase', { recursive: true });
writeFileSync('supabase/seed.sql', sql);

// ------------------------------------------------- content.fallback.json
writeFileSync(
  'content.fallback.json',
  JSON.stringify({ content, images, generated: new Date().toISOString() }, null, 2)
);

console.log(`\n  ${Object.keys(content).length} editable text fields`);
console.log(`  ${Object.keys(images).length} editable image slots`);
console.log('  wrote supabase/seed.sql + content.fallback.json');
