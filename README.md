# Brownbook Global Construction Leads

GitHub-ready Apify Actor that discovers public Brownbook company profiles through Brownbook's XML sitemaps and collects construction, architecture, engineering, CAD, BIM, 2D drafting and 3D-rendering company contacts.

## Collected fields

- Company name
- Real external company website
- Public profile email
- Phone
- Address
- Detected country
- Matched industry keyword
- Brownbook profile URL
- Source sitemap URL

The Actor rejects Brownbook, social-media, search-engine and other directory URLs as company websites. It deduplicates companies by Brownbook business ID and normalized external website domain.

## Supported regions

- United States (`US`)
- Canada (`CA`)
- United Kingdom (`GB`)
- Australia (`AU`)
- European Union (`EU`)

Individual European country codes can also be supplied.

## Recommended first test input

```json
{
  "startUrl": "https://api.brownbook.net/sitemap_indexes.xml",
  "targetCountries": ["US", "CA", "GB", "AU", "EU"],
  "maximumNewCompanies": 20,
  "maximumProfilesVisited": 60,
  "maximumSitemapsThisRun": 10,
  "requireWebsite": true,
  "collectEmails": true,
  "includeUnknownCountries": false,
  "scanNewestFirst": true,
  "campaignName": "brownbook-global-construction-test",
  "resetProgress": true,
  "requestTimeoutSecs": 60,
  "delayMillis": 10000
}
```

Use 1 GB memory and at least a 1,800-second timeout for the first test.

## Continuation runs

After the first run, keep the same `campaignName` and use:

```json
"resetProgress": false
```

Do not resurrect a run whose input still has `resetProgress: true`. Start a new run with reset disabled.

## GitHub to Apify

1. Create a new GitHub repository named `brownbook-global-construction-leads`.
2. Upload the contents of this ZIP to the repository root. Make sure `.actor` remains a folder in the root.
3. In Apify, create an Actor from a Git repository.
4. Use `https://github.com/YOUR-USERNAME/brownbook-global-construction-leads.git#main`.
5. Build the Actor, paste the test input, and start the run.

## Important operating notes

- The Actor uses Brownbook's public sitemaps because Brownbook's visible search page can return zero results.
- The default 10-second delay follows Brownbook's published crawl-delay instruction for general crawlers.
- A residential proxy is not required for the tested public sitemap and profile pages.
- URL keyword filtering is efficient but cannot guarantee discovery of construction companies whose names and profile URLs contain no construction-related wording.
- Cross-run persistence uses a named key-value store. If the Actor runs with permissions that cannot create/access named storage, it falls back to run storage and prints a warning. Enable the necessary Actor storage permissions for continuation across separate runs.
