import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countryAllowed,
  detectCountry,
  extractLocs,
  isValidExternalWebsite,
  matchKeyword,
  normalizeDomain,
  parseBrownbookProfile,
} from '../src/helpers.js';

test('extractLocs reads sitemap URLs', () => {
  assert.deepEqual(extractLocs('<urlset><url><loc>https://example.com/a&amp;b</loc></url></urlset>'), ['https://example.com/a&b']);
});

test('construction keyword matching normalizes punctuation', () => {
  assert.equal(matchKeyword('https://x.test/business/1/example-3d-rendering/', ['3D rendering']), '3d-rendering');
});

test('directory and social websites are rejected', () => {
  assert.equal(isValidExternalWebsite('https://www.yellowpages.com/example'), false);
  assert.equal(isValidExternalWebsite('https://www.realcontractor.com/'), true);
  assert.equal(normalizeDomain('https://www.RealContractor.com/path'), 'realcontractor.com');
});

test('country detection supports core target regions', () => {
  assert.equal(detectCountry('Austin, TX 78738, US', 'https://example.com'), 'US');
  assert.equal(detectCountry('Cardiff CF83 8FS, United Kingdom', 'https://example.co.uk'), 'GB');
  assert.equal(detectCountry('Sydney NSW 2000', 'https://example.com.au'), 'AU');
  assert.equal(detectCountry('Toronto ON M5V 3A8, Canada', 'https://example.ca'), 'CA');
  assert.equal(countryAllowed('DE', ['US', 'EU']), true);
});

test('profile parser extracts public Brownbook fields', () => {
  const html = `
    <meta property="og:title" content="Capital City Roofing on Brownbook.net">
    <meta name="description" content="Business profile: Capital City Roofing, Austin, TX 78738, US, commercial roofing contractor">
    <span>Phone:</span><a href="tel:(512) 555-0199">phone</a>
    <span>Email:</span><a href="mailto:office@example.com">email</a>
    <span>Website:</span><a href="https://example.com/">site</a>`;
  const record = parseBrownbookProfile(html, 'https://www.brownbook.net/business/123/capital-city-roofing/', 'https://www.brownbook.net/sitemap/1.xml', ['roofing']);
  assert.equal(record.companyName, 'Capital City Roofing');
  assert.equal(record.website, 'https://example.com/');
  assert.equal(record.email, 'office@example.com');
  assert.equal(record.phone, '(512) 555-0199');
  assert.equal(record.country, 'US');
});
