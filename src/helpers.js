import { createHash } from 'node:crypto';

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR',
  'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

const BLOCKED_WEBSITE_DOMAINS = [
  'brownbook.net', 'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'youtu.be', 'yelp.com', 'yellowpages.com', 'yellowpages.com.au', 'angi.com',
  'homeadvisor.com', 'houzz.com', 'manta.com', 'bbb.org', 'chamberofcommerce.com',
  'the-dots.com', 'google.com', 'googleusercontent.com', 'bing.com', 'pinterest.com',
];

export function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function extractLocs(xml = '') {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeHtml(match[1].trim()));
}

export function normalizeKeyword(keyword = '') {
  return keyword.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function matchKeyword(url, keywords) {
  const slug = decodeURIComponent(url).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return keywords.map(normalizeKeyword).filter(Boolean).find((keyword) => slug.includes(keyword)) || null;
}

export function normalizeDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isValidExternalWebsite(url) {
  const domain = normalizeDomain(url);
  if (!domain) return false;
  return !BLOCKED_WEBSITE_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function metaContent(html, attribute, value) {
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    if (!new RegExp(`${attribute}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(tag)) continue;
    return decodeHtml((tag.match(/content=["']([^"']*)["']/i) || [])[1] || '');
  }
  return '';
}

export function stripTags(html = '') {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function extractLabeledHref(html, label, protocol) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = html.match(new RegExp(`>${escaped}:?<\\/[^>]+>\\s*<a[^>]+href=["']([^"']+)["']`, 'i'));
  if (direct) return decodeHtml(direct[1]);
  const protocolMatch = html.match(new RegExp(`href=["']${protocol}:([^"']+)["']`, 'i'));
  return protocolMatch ? decodeHtml(protocolMatch[1]) : null;
}

export function detectCountry(text = '', website = '') {
  const source = ` ${decodeHtml(text)} `.replace(/\s+/g, ' ');
  const domain = normalizeDomain(website) || '';
  const explicit = [
    ['US', /(?:,|\b)(?:US|USA|United States(?: of America)?)(?:,|\b)/i],
    ['CA', /(?:,|\b)(?:CA|Canada)(?:,|\b)/i],
    ['GB', /(?:,|\b)(?:GB|UK|United Kingdom|England|Scotland|Wales|Northern Ireland)(?:,|\b)/i],
    ['AU', /(?:,|\b)(?:AU|Australia)(?:,|\b)/i],
    ['DE', /\bGermany\b/i], ['FR', /\bFrance\b/i], ['NL', /\bNetherlands\b/i],
    ['BE', /\bBelgium\b/i], ['IE', /\bIreland\b/i], ['ES', /\bSpain\b/i],
    ['PT', /\bPortugal\b/i], ['IT', /\bItaly\b/i], ['AT', /\bAustria\b/i],
    ['CH', /\bSwitzerland\b/i], ['SE', /\bSweden\b/i], ['NO', /\bNorway\b/i],
    ['DK', /\bDenmark\b/i], ['FI', /\bFinland\b/i], ['PL', /\bPoland\b/i],
  ];
  for (const [code, pattern] of explicit) if (pattern.test(source)) return code;

  if (/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(source) || /\+1[\s(.-]/.test(source)) return 'US';
  if (/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/i.test(source)) return 'CA';
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(source) || domain.endsWith('.co.uk')) return 'GB';
  if (/\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/i.test(source) || domain.endsWith('.com.au')) return 'AU';
  return null;
}

export function countryAllowed(country, targets) {
  if (!country) return false;
  const normalized = new Set(targets.map((item) => item.toUpperCase().trim()));
  return normalized.has(country) || (normalized.has('EU') && EU_COUNTRIES.has(country));
}

export function parseBrownbookProfile(html, profileUrl, sourceSitemapUrl, keywords) {
  const title = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'title');
  const description = metaContent(html, 'name', 'description');
  const companyName = title.replace(/\s+on Brownbook\.net.*$/i, '').trim() || null;
  const website = extractLabeledHref(html, 'Website', 'https?') || null;
  const email = extractLabeledHref(html, 'Email', 'mailto')?.replace(/^mailto:/i, '') || null;
  const phone = extractLabeledHref(html, 'Phone', 'tel')?.replace(/^tel:/i, '') || null;
  const visibleText = stripTags(html);
  const country = detectCountry(`${description} ${visibleText.slice(0, 2500)}`, website);
  const industryMatch = matchKeyword(`${profileUrl} ${description}`, keywords);
  const businessId = (profileUrl.match(/\/business\/(\d+)/) || [])[1] || null;
  const address = description
    .replace(/^Business profile:\s*/i, '')
    .replace(companyName ? new RegExp(`^${companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[, ]*`, 'i') : /^$/, '')
    .split(/,\s*(?:a |an )?[a-z][^,]*(?:service|contractor|company|firm|studio|builder)/i)[0]
    .trim() || null;

  return {
    businessId,
    companyName,
    website,
    websiteDomain: normalizeDomain(website),
    email,
    phone,
    address,
    country,
    industryMatch,
    description,
    brownbookProfileUrl: profileUrl,
    sourceSitemapUrl,
    collectedAt: new Date().toISOString(),
  };
}

export function campaignKey(name) {
  return `BROWNBOOK_STATE_${createHash('sha1').update(name).digest('hex').slice(0, 20)}`;
}
