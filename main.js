import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import {
  campaignKey,
  countryAllowed,
  extractLocs,
  isValidExternalWebsite,
  matchKeyword,
  parseBrownbookProfile,
} from './helpers.js';

await Actor.init();

const defaults = {
  startUrl: 'https://api.brownbook.net/sitemap_indexes.xml',
  targetCountries: ['US', 'CA', 'GB', 'AU', 'EU'],
  constructionKeywords: ['construction', 'contractor', 'builder', 'architect', 'drafting', 'cad', 'bim', 'rendering'],
  maximumNewCompanies: 500,
  maximumProfilesVisited: 1500,
  maximumSitemapsThisRun: 100,
  requireWebsite: true,
  collectEmails: true,
  includeUnknownCountries: false,
  scanNewestFirst: true,
  useResidentialProxy: true,
  proxyCountryCode: 'US',
  proxyRetryCount: 3,
  campaignName: 'brownbook-global-construction-design',
  resetProgress: false,
  requestTimeoutSecs: 60,
  delayMillis: 10000,
};

const input = { ...defaults, ...(await Actor.getInput() || {}) };
const key = campaignKey(input.campaignName);

let store;
let persistentAcrossRuns = true;
try {
  store = await Actor.openKeyValueStore('brownbook-global-construction-progress');
} catch (error) {
  persistentAcrossRuns = false;
  log.warning('Named progress storage is unavailable. Falling back to run storage. Enable Actor storage permissions for continuation across new runs.', { message: error.message });
  store = await Actor.openKeyValueStore();
}

const emptyState = {
  campaignName: input.campaignName,
  masterIndexPosition: 0,
  leafSitemapPosition: 0,
  processedProfileIds: [],
  processedDomains: [],
  totalOutput: 0,
  completed: false,
  updatedAt: null,
};

let state = input.resetProgress ? structuredClone(emptyState) : (await store.getValue(key) || structuredClone(emptyState));
if (input.resetProgress) await store.setValue(key, state);

const processedProfileIds = new Set(state.processedProfileIds || []);
const processedDomains = new Set(state.processedDomains || []);

async function saveState() {
  state.processedProfileIds = [...processedProfileIds];
  state.processedDomains = [...processedDomains];
  state.updatedAt = new Date().toISOString();
  await store.setValue(key, state);
}

Actor.on('persistState', saveState);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const proxyConfiguration = input.useResidentialProxy
  ? await Actor.createProxyConfiguration({
      groups: ['RESIDENTIAL'],
      countryCode: String(input.proxyCountryCode || 'US').toUpperCase(),
    })
  : null;

if (proxyConfiguration) {
  log.info('Apify residential proxy enabled', { countryCode: String(input.proxyCountryCode || 'US').toUpperCase() });
}

const client = gotScraping.extend({
  timeout: { request: input.requestTimeoutSecs * 1000 },
  retry: { limit: 3, methods: ['GET'], statusCodes: [408, 425, 429, 500, 502, 503, 504] },
  headers: {
    'user-agent': 'BrownbookConstructionResearchBot/1.0 (public business directory research; respects robots.txt)',
    accept: 'text/html,application/xml,text/xml;q=0.9,*/*;q=0.8',
  },
});

async function getText(url) {
  const response = await client.get(url);
  if (response.statusCode >= 400) throw new Error(`HTTP ${response.statusCode} for ${url}`);
  return response.body;
}

async function getProfileText(url) {
  if (!proxyConfiguration) return getText(url);

  let lastError;
  for (let attempt = 1; attempt <= input.proxyRetryCount; attempt++) {
    const sessionId = `brownbook_${Date.now()}_${attempt}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const proxyUrl = await proxyConfiguration.newUrl(sessionId);
      const response = await client.get(url, { proxyUrl, retry: { limit: 0 } });
      if (response.statusCode === 403 || response.statusCode === 429) {
        throw new Error(`HTTP ${response.statusCode}`);
      }
      if (response.statusCode >= 400) throw new Error(`HTTP ${response.statusCode}`);
      return response.body;
    } catch (error) {
      lastError = error;
      log.warning('Brownbook profile request blocked; rotating residential proxy session', {
        profileUrl: url,
        attempt,
        maximumAttempts: input.proxyRetryCount,
        message: error.message,
      });
      if (attempt < input.proxyRetryCount) await sleep(1500);
    }
  }
  throw new Error(`${lastError?.message || 'Profile request failed'} for ${url}`);
}

let companiesOutputThisRun = 0;
let profilesVisited = 0;
let sitemapsScanned = 0;
let fatalError = null;

try {
  let masterIndexes = extractLocs(await getText(input.startUrl));
  if (input.scanNewestFirst) masterIndexes = masterIndexes.reverse();

  outer:
  for (let masterPos = state.masterIndexPosition; masterPos < masterIndexes.length; masterPos++) {
    const masterUrl = masterIndexes[masterPos];
    let leafSitemaps = extractLocs(await getText(masterUrl));
    if (input.scanNewestFirst) leafSitemaps = leafSitemaps.reverse();
    const leafStart = masterPos === state.masterIndexPosition ? state.leafSitemapPosition : 0;

    for (let leafPos = leafStart; leafPos < leafSitemaps.length; leafPos++) {
      if (sitemapsScanned >= input.maximumSitemapsThisRun) break outer;
      const sitemapUrl = leafSitemaps[leafPos];
      const profileUrls = extractLocs(await getText(sitemapUrl));
      const candidates = profileUrls.filter((url) => matchKeyword(url, input.constructionKeywords));
      sitemapsScanned++;

      log.info('Brownbook sitemap scanned', {
        sitemapUrl,
        profilesFound: profileUrls.length,
        constructionCandidates: candidates.length,
        sitemapsScanned,
      });

      for (const profileUrl of candidates) {
        if (profilesVisited >= input.maximumProfilesVisited || companiesOutputThisRun >= input.maximumNewCompanies) break outer;
        const businessId = (profileUrl.match(/\/business\/(\d+)/) || [])[1];
        if (!businessId || processedProfileIds.has(businessId)) continue;

        await sleep(input.delayMillis);
        profilesVisited++;

        try {
          const html = await getProfileText(profileUrl);
          const record = parseBrownbookProfile(html, profileUrl, sitemapUrl, input.constructionKeywords);
          processedProfileIds.add(businessId);

          if (!record.companyName || !record.industryMatch) continue;
          if (!record.country && !input.includeUnknownCountries) continue;
          if (record.country && !countryAllowed(record.country, input.targetCountries)) continue;
          if (input.requireWebsite && !isValidExternalWebsite(record.website)) continue;
          if (record.website && !isValidExternalWebsite(record.website)) record.website = null;
          if (!input.collectEmails) record.email = null;
          if (record.websiteDomain && processedDomains.has(record.websiteDomain)) continue;

          if (record.websiteDomain) processedDomains.add(record.websiteDomain);
          await Actor.pushData(record);
          companiesOutputThisRun++;
          state.totalOutput = (state.totalOutput || 0) + 1;

          if (companiesOutputThisRun % 10 === 0) {
            await saveState();
            log.info('Brownbook companies collected', {
              companiesOutputThisRun,
              profilesVisited,
              totalOutput: state.totalOutput,
            });
          }
        } catch (error) {
          log.warning('Brownbook profile failed safely', { profileUrl, message: error.message });
        }
      }

      state.masterIndexPosition = masterPos;
      state.leafSitemapPosition = leafPos + 1;
      if (state.leafSitemapPosition >= leafSitemaps.length) {
        state.masterIndexPosition = masterPos + 1;
        state.leafSitemapPosition = 0;
      }
      await saveState();
    }
  }

  if (state.masterIndexPosition >= masterIndexes.length) state.completed = true;
  await saveState();

  log.info('Brownbook campaign run completed', {
    campaignName: input.campaignName,
    companiesOutputThisRun,
    profilesVisited,
    sitemapsScanned,
    totalOutput: state.totalOutput,
    completed: state.completed,
    persistentAcrossRuns,
  });
} catch (error) {
  fatalError = error;
  log.exception(error, 'Brownbook run failed; completed progress was preserved');
} finally {
  await saveState();
  await Actor.exit({ exitCode: fatalError ? 1 : 0 });
}
