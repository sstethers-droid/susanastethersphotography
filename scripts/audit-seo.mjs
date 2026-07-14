import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';

const root = resolve('dist');
const pages = ['index.html', 'about.html', 'experience.html', 'portfolio.html', 'portfolio-newborn.html', 'portfolio-family.html', 'portfolio-maternity.html', 'portfolio-milestones.html', 'investment.html', 'contact.html'];
const expectedUrls = new Set(pages.map((page) => page === 'index.html' ? 'https://susanastethersphotography.com/' : `https://susanastethersphotography.com/${page.replace('.html', '')}`));
const errors = [];
const warnings = [];

for (const page of pages) {
  const file = resolve(root, page);
  if (!existsSync(file)) { errors.push(`${page}: missing from production build`); continue; }
  const $ = cheerio.load(readFileSync(file, 'utf8'));
  const title = $('title').text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || '';
  const expectedUrl = page === 'index.html' ? 'https://susanastethersphotography.com/' : `https://susanastethersphotography.com/${page.replace('.html', '')}`;
  if (!title) errors.push(`${page}: missing title`);
  if (title.length < 30 || title.length > 65) warnings.push(`${page}: title is ${title.length} characters`);
  if (!description) errors.push(`${page}: missing meta description`);
  if (description.length < 120 || description.length > 170) warnings.push(`${page}: description is ${description.length} characters`);
  if ($('link[rel="canonical"]').attr('href') !== expectedUrl) errors.push(`${page}: canonical URL is incorrect`);
  if ($('h1').length !== 1) errors.push(`${page}: expected exactly one H1, found ${$('h1').length}`);
  const robots = $('meta[name="robots"]').attr('content') || '';
  if (!robots.includes('index') || !robots.includes('max-image-preview:large')) errors.push(`${page}: incomplete robots meta tag`);
  for (const selector of ['meta[property="og:title"]','meta[property="og:description"]','meta[property="og:url"]','meta[property="og:image"]','meta[name="twitter:card"]','meta[name="twitter:title"]','meta[name="twitter:description"]','meta[name="twitter:image"]']) {
    if (!$(selector).attr('content')) errors.push(`${page}: missing ${selector}`);
  }
  if ($('meta[property="og:url"]').attr('content') !== expectedUrl) errors.push(`${page}: og:url does not match canonical`);
  $('img').each((_, image) => { if (!(($(image).attr('alt') || '').trim())) errors.push(`${page}: image missing alt text (${($(image).attr('src') || 'unknown')})`); });
  $('script[type="application/ld+json"]').each((_, script) => { try { JSON.parse($(script).text()); } catch { errors.push(`${page}: invalid JSON-LD`); } });
  $('a[href]').each((_, link) => {
    const href = $(link).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('http')) return;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean || clean === '/') return;
    if (!existsSync(resolve(root, clean.replace(/^\//, '')))) errors.push(`${page}: broken internal link ${href}`);
  });
}

const sitemapPath = resolve(root, 'sitemap.xml');
const robotsPath = resolve(root, 'robots.txt');
if (!existsSync(sitemapPath)) errors.push('sitemap.xml: missing');
else {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  for (const url of expectedUrls) if (!sitemap.includes(`<loc>${url}</loc>`)) errors.push(`sitemap.xml: missing ${url}`);
  if (/admin|login/.test(sitemap)) errors.push('sitemap.xml: private owner pages must not be indexed');
}
if (!existsSync(robotsPath)) errors.push('robots.txt: missing');
else {
  const robots = readFileSync(robotsPath, 'utf8');
  if (!robots.includes('Sitemap: https://susanastethersphotography.com/sitemap.xml')) errors.push('robots.txt: sitemap URL is missing');
  if (!robots.includes('Disallow: /admin') || !robots.includes('Disallow: /login')) errors.push('robots.txt: owner pages are not blocked');
}
if (warnings.length) console.log(`SEO warnings:\n- ${warnings.join('\n- ')}`);
if (errors.length) { console.error(`SEO audit failed:\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`SEO audit passed for ${pages.length} public pages${warnings.length ? ` with ${warnings.length} length warning(s)` : ''}.`);
