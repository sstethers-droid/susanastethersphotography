/**
 * BUILD — runs on Vercel for every deploy.
 * ---------------------------------------------------------------------------
 * Takes the annotated HTML (source of truth for structure) and overlays
 * Susana's edits from Supabase, producing plain static HTML in dist/.
 *
 * WHY BAKE INSTEAD OF FETCHING IN THE BROWSER
 * A CMS that loads text via JavaScript ships an empty page to Google. Every
 * headline, every paragraph, every price would be invisible to search — which
 * would defeat the whole point of the SEO work. Baking at build time means
 * Susana gets a live editor AND Google gets fully-rendered HTML.
 *
 * FAILURE BEHAVIOUR
 * If Supabase is unreachable (free tier pauses after inactivity), we fall back
 * to content.fallback.json — the last known-good text committed to the repo.
 * A build never ships a blank page. If even that is missing we use the text
 * already in the HTML. There is no failure mode that produces an empty site.
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
  statSync, readdirSync, copyFileSync,
} from 'node:fs';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
const SITE = 'https://susanastethersphotography.com';

const PAGES = ['index.html','about.html','experience.html','portfolio.html','investment.html','contact.html'];
const PASSTHROUGH = ['login.html','admin.html','css','js','images','robots.txt','favicon.ico'];

const OUT = 'dist';

/* ------------------------------------------------------------- safety guard */
// Fail the build loudly if a secret ever lands in a shipped file.
//
// The deploy-hook URL is a capability URL — possession is authorisation. Anyone
// holding it can trigger endless rebuilds. The Supabase SERVICE ROLE key is far
// worse: it bypasses every RLS policy in schema.sql and exposes the entire
// client list. Neither belongs in this repo, and a failed build is a much
// cheaper way to find that out than a leak.
{
  const FORBIDDEN = [
    [/api\.vercel\.com\/v\d+\/integrations\/deploy\//i, 'a Vercel deploy-hook URL'],
    [/\bservice_role\b/i, 'a Supabase service-role key'],
    [/\bsb_secret_[A-Za-z0-9_-]+/, 'a Supabase secret key'],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, 'a JWT (possibly a service key)'],
  ];
  const scan = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', '.git', 'dist', '_original-photos', 'images'].includes(entry)) continue;
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) { scan(full); continue; }
      if (!/\.(html|js|mjs|json|css|md|sql)$/i.test(entry)) continue;
      const body = readFileSync(full, 'utf8');
      // A file may opt out ONLY by saying so explicitly, in the file itself.
      // Used by the setup docs, which have to show what the URL looks like.
      // Deliberately not a blanket skip of docs/ — a real key pasted into a
      // doc is still a real leak.
      if (body.includes('secret-scan: allow-example')) continue;
      for (const [re, what] of FORBIDDEN) {
        if (re.test(body)) {
          console.error(`\n  ✗ SECRET IN REPO: ${full} appears to contain ${what}.`);
          console.error('    This must never be committed. See docs/TURN-ON-PUBLISHING.md.\n');
          process.exit(1);
        }
      }
    }
  };
  scan('.');
}

/* ----------------------------------------------------------- fetch content */
async function fromSupabase(table) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) throw new Error(`${table} -> HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`  ⚠ Supabase unavailable for "${table}" (${err.message})`);
    return null;
  }
}

const fallback = existsSync('content.fallback.json')
  ? JSON.parse(readFileSync('content.fallback.json', 'utf8'))
  : { content: {}, images: {} };

const contentRows = await fromSupabase('site_content');
const imageRows   = await fromSupabase('site_images');

const text = {};
if (contentRows) {
  for (const r of contentRows) if (r.value != null && r.value !== '') text[r.key] = r.value;
  console.log(`  ✓ ${Object.keys(text).length} text fields from Supabase`);
} else {
  for (const [k, v] of Object.entries(fallback.content)) text[k] = v.value;
  console.log(`  ↩ using committed fallback text (${Object.keys(text).length} fields)`);
}

const media = {};
if (imageRows) {
  for (const r of imageRows) if (r.url) media[r.slot] = { url: r.url, alt: r.alt };
  console.log(`  ✓ ${Object.keys(media).length} custom images from Supabase`);
}

/* ------------------------------------------------------------------ render */
rmSync(OUT, { recursive: true, force: true });   // always a clean build
mkdirSync(OUT, { recursive: true });

for (const file of PAGES) {
  if (!existsSync(file)) continue;
  const $ = cheerio.load(readFileSync(file, 'utf8'), { decodeEntities: false });

  // 1. text nodes
  //    If the stored value contains no markup we set it as TEXT, so cheerio
  //    escapes it correctly. Setting "Maternity & Motherhood" via .html() would
  //    emit a bare "&" (invalid); setting an entity-encoded string via .text()
  //    would double-escape it into "&amp;amp;". This picks the right one.
  $('[data-cms]').each((_, el) => {
    const $el = $(el);
    const key = $el.attr('data-cms');
    const v = text[key];
    $el.removeAttr('data-cms');
    if (v == null) return;
    if (/<[a-z][\s\S]*>/i.test(v)) $el.html(v);
    else $el.text(cheerio.load(`<x>${v}</x>`)('x').text());   // decode, then escape once
  });

  // 2. attribute content (meta description)
  $('[data-cms-content]').each((_, el) => {
    const $el = $(el);
    const key = $el.attr('data-cms-content');
    if (text[key] != null) $el.attr('content', text[key]);
    $el.removeAttr('data-cms-content');
  });

  // 3. images Susana replaced via the admin portal.
  //    A Supabase-hosted image has no responsive variants, so we drop srcset
  //    and point every source at the single uploaded file. Slightly heavier,
  //    but correct — a stale srcset would silently keep showing the old photo.
  $('[data-cms-image]').each((_, el) => {
    const $node = $(el);
    const slot = $node.attr('data-cms-image');
    const override = media[slot];
    $node.removeAttr('data-cms-image');
    if (!override) return;

    const $img = $node.is('img') ? $node : $node.find('img').first();
    $node.find('source').remove();
    $img.attr('src', override.url).removeAttr('srcset').removeAttr('sizes');
    if (override.alt) $img.attr('alt', override.alt);
  });

  // 4. SEO: keep canonical + og:url honest, and give every page an og:image
  const path = file === 'index.html' ? '/' : '/' + file.replace('.html', '');
  $('link[rel="canonical"]').attr('href', SITE + path);
  $('meta[property="og:url"]').attr('content', SITE + path);
  if (!$('meta[property="og:image"]').length) {
    $('head').append(`\n<meta property="og:image" content="${SITE}/images/hero-family-garden-1600.jpg">`);
  }
  if (!$('meta[name="twitter:card"]').length) {
    $('head').append(`\n<meta name="twitter:card" content="summary_large_image">`);
  }
  // description mirrors into og:description so social cards match Google
  const d = $('meta[name="description"]').attr('content');
  if (d) $('meta[property="og:description"]').attr('content', d);
  const pageTitle = $('title').text().trim();
  const socialImage = $('meta[property="og:image"]').attr('content');
  const seoMeta = [
    ['meta[name="robots"]', `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">`],
    ['meta[property="og:site_name"]', `<meta property="og:site_name" content="Susana Stethers Photography">`],
    ['meta[property="og:locale"]', `<meta property="og:locale" content="en_US">`],
    ['meta[property="og:image:width"]', `<meta property="og:image:width" content="1600">`],
    ['meta[property="og:image:height"]', `<meta property="og:image:height" content="1067">`],
    ['meta[name="twitter:title"]', `<meta name="twitter:title" content="${pageTitle.replace(/"/g, '&quot;')}">`],
    ['meta[name="twitter:description"]', `<meta name="twitter:description" content="${(d || '').replace(/"/g, '&quot;')}">`],
    ['meta[name="twitter:image"]', `<meta name="twitter:image" content="${socialImage}">`],
    ['meta[name="geo.region"]', `<meta name="geo.region" content="US-GA">`],
    ['meta[name="geo.placename"]', `<meta name="geo.placename" content="Roswell">`],
  ];
  for (const [selector, tag] of seoMeta) if (!$(selector).length) $('head').append(`\n${tag}`);
  if (!$('link[rel="alternate"][hreflang="en-US"]').length) {
    $('head').append(`\n<link rel="alternate" hreflang="en-US" href="${SITE + path}">`);
    $('head').append(`\n<link rel="alternate" hreflang="x-default" href="${SITE + path}">`);
  }

  // 5. Structured data. This is what earns the rich result in Google — the
  //    star rating, the price range, the map pin. Without it she's just
  //    another blue link. LocalBusiness goes on every page; the specific
  //    types are added where they're truthful.
  const ld = [];

  ld.push({
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'ProfessionalService'],
    '@id': SITE + '/#business',
    name: 'Susana Stethers Photography',
    description: d || '',
    url: SITE + path,
    image: SITE + '/images/hero-family-garden-1600.jpg',
    priceRange: '$$',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Roswell',
      addressRegion: 'GA',
      addressCountry: 'US',
    },
    areaServed: [
      { '@type': 'City', name: 'Roswell' },
      { '@type': 'City', name: 'Alpharetta' },
      { '@type': 'City', name: 'Milton' },
      { '@type': 'City', name: 'Johns Creek' },
      { '@type': 'City', name: 'Marietta' },
      { '@type': 'City', name: 'Atlanta' },
    ],
    knowsAbout: [
      'newborn photography', 'family photography', 'maternity photography',
      'milestone photography', 'couples photography',
    ],
    sameAs: ['https://www.instagram.com/susanatakesaphoto/'],
  });

  ld.push({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': SITE + path + '#webpage',
    url: SITE + path,
    name: pageTitle,
    description: d || '',
    inLanguage: 'en-US',
    isPartOf: { '@id': SITE + '/#website' },
    about: { '@id': SITE + '/#business' },
    primaryImageOfPage: { '@type': 'ImageObject', url: socialImage },
  });

  if (file === 'index.html') {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': SITE + '/#website',
      url: SITE + '/',
      name: 'Susana Stethers Photography',
      description: d || '',
      inLanguage: 'en-US',
      publisher: { '@id': SITE + '/#business' },
    });
  }

  if (file === 'about.html') {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'Person',
      '@id': SITE + '/about#susana',
      name: 'Susana Stethers',
      jobTitle: 'Family, Newborn and Maternity Photographer',
      url: SITE + '/about',
      worksFor: { '@id': SITE + '/#business' },
      sameAs: ['https://www.instagram.com/susanatakesaphoto/'],
    });
  }

  // Pricing page -> Offer markup, so Google can show the "$350" price.
  if (file === 'investment.html') {
    const offers = [];
    $('.pkg').each((_, el) => {
      const $p = $(el);
      const nameTxt = $p.find('h3').first().text().trim();
      const priceTxt = ($p.find('.pkg__price').first().text().match(/[\d.]+/) || [])[0];
      if (nameTxt && priceTxt) {
        offers.push({
          '@type': 'Offer',
          name: nameTxt,
          price: priceTxt,
          priceCurrency: 'USD',
          category: 'Photography session',
          availability: 'https://schema.org/InStock',
          url: SITE + '/contact',
        });
      }
    });
    if (offers.length) {
      ld.push({
        '@context': 'https://schema.org',
        '@type': 'Service',
        serviceType: 'Portrait photography',
        provider: { '@id': SITE + '/#business' },
        areaServed: { '@type': 'City', name: 'Roswell' },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Photography sessions',
          itemListElement: offers,
        },
      });
    }
  }

  // FAQ page -> FAQPage markup. Google frequently expands these directly in
  // the results, which eats screen space competitors don't get.
  const faqs = [];
  $('.faq__item').each((_, el) => {
    const q = $(el).find('.faq__q span').first().text().trim();
    const a = $(el).find('.faq__a').first().text().trim();
    if (q && a) {
      faqs.push({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      });
    }
  });
  if (faqs.length) {
    ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs });
  }

  // Breadcrumbs on every page but home.
  if (file !== 'index.html') {
    const label = $('h1').first().text().trim() || file.replace('.html', '');
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: label, item: SITE + path },
      ],
    });
  }

  // Replace any hand-written JSON-LD so we never ship two conflicting copies.
  $('script[type="application/ld+json"]').remove();
  $('head').append(
    `\n<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld)}</script>\n`
  );

  writeFileSync(`${OUT}/${file}`, $.html());
  console.log(`  ✓ ${file}`);
}

/* ------------------------------------------------------------- sitemap.xml */
const today = new Date().toISOString().slice(0, 10);
const urls = PAGES.filter((f) => existsSync(f)).map((f) => {
  const loc = SITE + (f === 'index.html' ? '/' : '/' + f.replace('.html', ''));
  const pri = f === 'index.html' ? '1.0' : (f === 'contact.html' || f === 'investment.html') ? '0.9' : '0.8';
  return `  <url><loc>${loc}</loc><lastmod>${today}</lastmod><priority>${pri}</priority></url>`;
});
writeFileSync(
  `${OUT}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
);

writeFileSync(
  `${OUT}/robots.txt`,
  `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /login\n\nSitemap: ${SITE}/sitemap.xml\n`
);

/* -------------------------------------------------------------- passthrough */
// Plain recursive copy. cpSync() tries to preserve file modes, which blows up
// with EACCES on some mounted filesystems — this doesn't care.
function copy(src, dest) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) copy(`${src}/${entry}`, `${dest}/${entry}`);
  } else {
    copyFileSync(src, dest);
  }
}

for (const p of PASSTHROUGH) {
  if (!existsSync(p) || p === 'robots.txt') continue;
  copy(p, `${OUT}/${p}`);
}

console.log(`\n  built -> ${OUT}/`);
