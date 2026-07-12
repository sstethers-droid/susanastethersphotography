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

// Elements Susana can edit, each paired with a plain-English description of
// WHAT KIND of thing it is. The old labels just repeated the text itself
// ("Family" labelled "Family"), which told her nothing.
const TEXT_SELECTORS = [
  ['h1',                  'Main heading'],
  ['h2',                  'Section heading'],
  ['h3',                  'Sub-heading'],
  ['h4',                  'Sub-heading'],
  ['p.eyebrow',           'Small label above the heading'],
  ['.pkg__price',         'Price'],
  ['.pkg__tagline',       'Package description'],
  ['.pkg__includes li',   'Bullet point'],
  ['.know li',            'Bullet point'],
  ['.sess-card__note',    'Caption under the photo'],
  ['blockquote p',        'Testimonial quote'],
  ['figcaption cite',     'Testimonial — who said it'],
  ['.step p',             'Paragraph'],
  ['.faq__a',             'FAQ answer'],
  ['.prose p',            'Paragraph'],
  ['.intro p',            'Paragraph'],
  ['.lede p',             'Paragraph'],
  ['.btn',                'Button text'],
  ['.link-more',          'Link text'],
  ['.note',               'Small print'],
  ['.contact__meta',      'Small print'],
  ['.site-footer__loc',   'Small print'],
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
  const roleCount = {};   // "Home/Sessions/Paragraph" -> 2, so we can number them

  for (const [sel, role] of TEXT_SELECTORS) {
    $(sel).each((_, el) => {
      const $el = $(el);
      if ($el.attr('data-cms-done')) return;            // first matching rule wins
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
      $el.attr('data-cms', key).attr('data-cms-done', '1');

      // Number repeats so "Paragraph" / "Paragraph 2" / "Paragraph 3" are
      // distinguishable within the same section.
      const rk = `${page}|${section}|${role}`;
      roleCount[rk] = (roleCount[rk] || 0) + 1;
      const label = roleCount[rk] > 1 ? `${role} ${roleCount[rk]}` : role;

      // If the element holds no markup, store DECODED text ("Maternity &
      // Motherhood", not "Maternity &amp; Motherhood"). The raw innerHTML was
      // showing entity codes to Susana in the editor.
      const hasMarkup = $el.children().length > 0;
      const value = hasMarkup ? $el.html().trim() : text;

      content[key] = {
        value,
        label,
        page,
        section: section.slice(0, 40),
        kind: text.length > 90 ? 'textarea' : 'text',
        sort: sortCounter++,
      };
    });
  }

  $('[data-cms-done]').removeAttr('data-cms-done');

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

// -------------------------------------------------------------- relabel.sql
// Rows already exist in Susana's database, so the seed's ON CONFLICT DO NOTHING
// will not refresh their labels. This updates label/kind/sort/section ONLY —
// `value` is never touched, so nothing she has written is overwritten.
//
// It also repairs values that still contain raw HTML entities (&amp; showing
// up in the editor as literal text) — but ONLY where the stored value still
// matches what we originally seeded, i.e. she hasn't edited it herself.
let relabel = `-- AUTO-GENERATED by scripts/annotate.mjs — do not hand-edit.
-- Refreshes field labels. NEVER overwrites text Susana has edited.

`;
for (const [key, c] of Object.entries(content)) {
  relabel += `update public.site_content set label='${esc(c.label)}', kind='${c.kind}', section='${esc(c.section)}', sort=${c.sort} where key='${esc(key)}';\n`;
}
relabel += `\n-- Repair entity-encoded values, but only where untouched by Susana:\n`;
for (const [key, c] of Object.entries(content)) {
  if (!c.value.includes('<')) {
    const encoded = c.value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (encoded !== c.value) {
      relabel += `update public.site_content set value='${esc(c.value)}' where key='${esc(key)}' and value='${esc(encoded)}';\n`;
    }
  }
}
writeFileSync('supabase/relabel.sql', relabel);

// ------------------------------------------------- content.fallback.json
writeFileSync(
  'content.fallback.json',
  JSON.stringify({ content, images, generated: new Date().toISOString() }, null, 2)
);

console.log(`\n  ${Object.keys(content).length} editable text fields`);
console.log(`  ${Object.keys(images).length} editable image slots`);
console.log('  wrote supabase/seed.sql + content.fallback.json');
