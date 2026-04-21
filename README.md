# Hospitality Operator Scraper

Operator-first discovery scraper for high-quality hospitality leads across English-speaking countries. It is designed to find companies such as:

- hotel management companies
- hospitality groups with multiple hotels and/or restaurants
- restaurant groups
- multi-unit restaurant franchise operators

It does **not** start from Maps listings. It starts from search discovery, then crawls likely official sites and scores domains based on portfolio/operator evidence.

## Default coverage

The built-in country list is:

- `us` United States
- `ca` Canada
- `gb` United Kingdom
- `ie` Ireland
- `au` Australia
- `nz` New Zealand
- `za` South Africa
- `sg` Singapore
- `mt` Malta

You can restrict the run with `--countries us,gb,au`.

## How it works

1. Generate hospitality-operator search queries per country.
2. Search the web with:
   - Brave Search API if `BRAVE_API_KEY` is available
   - DuckDuckGo HTML fallback otherwise
3. Deduplicate domains from search results.
4. Crawl each candidate domain and inspect:
   - homepage
   - portfolio/properties/hotels/restaurants/brands pages
   - about/leadership/team/contact pages
5. Extract:
   - company name
   - sector hints
   - portfolio/unit count phrases
   - executive names + titles
   - portfolio/contact/leadership URLs
6. Score the domain and export ranked leads.

## Output

By default, exports are written to:

`/root/mcp-shared/hospitality-operator-leads/<run-id>/`

Files:

- `summary.json`
- `search-results.json`
- `domain-seeds.json`
- `leads.json`
- `leads.csv`

## Usage

Run all default English-speaking countries from CLI:

```bash
cd /root/hospitality-operator-scraper
npm install
npm run cli
```

Run a smaller sample:

```bash
cd /root/hospitality-operator-scraper
node src/index.js --countries us,gb --limit-per-query 3 --max-domains 12
```

Increase throughput:

```bash
cd /root/hospitality-operator-scraper
node src/index.js --concurrency 5 --limit-per-query 10 --max-domains 300
```

## Dashboard and API

The project exposes a small dashboard similar to the other scrapers in this repo.

Start it locally:

```bash
cd /root/hospitality-operator-scraper
npm install
npm start
```

Open:

- `http://localhost:3000/login`
- default login from env or local defaults:
  - `ADMIN_USERNAME=admin`
  - `ADMIN_PASSWORD=change-me`

Endpoints:

- `GET /login`
- `GET /dashboard`
- `GET /health`
- `GET /jobs`
- `POST /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/leads`
- `GET /jobs/:id/download?format=csv`
- `GET /jobs/:id/download?format=json`

Example:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "countries": ["us", "gb", "au"],
    "limitPerQuery": 6,
    "maxDomains": 120,
    "concurrency": 4
  }'
```

## Brave Search

If Brave MCP is configured on this host, the API key usually lives in `/root/mcp-brave-search.env`.

This scraper will load:

- project `.env`
- `/root/mcp-brave-search.env`

If `BRAVE_API_KEY` is present, Brave Search is used automatically.

## Notes

- This is a discovery and prioritization tool, not a guaranteed direct-contact extractor.
- The executive extraction is heuristic and should be treated as a first-pass enrichment layer.
- Trade/media/directory domains are used as search seeds only. The final lead set is weighted toward official operator domains with portfolio and leadership evidence.
- If you want email discovery next, use the exported domains and executive names as inputs to your email enrichment/verifier pipeline.
