"use strict";

const fs = require("fs");
const path = require("path");
const { analyzeDomain } = require("./extractor");
const { buildConfig, ENGLISH_COUNTRIES } = require("./config");
const { createSearchProvider } = require("./search");
const {
  domainFromUrl,
  ensureDir,
  loadEnvFiles,
  runPool,
  toCsv,
  unique,
  writeJson,
} = require("./utils");

async function runScrape(options = {}) {
  loadEnvFiles([path.join(process.cwd(), ".env"), "/root/mcp-brave-search.env"]);
  const config = buildConfig(process.env);
  const provider = createSearchProvider(config);
  const logger = options.logger || silentLogger();
  const selectedCountries = resolveCountries(options.countries);
  const limitPerQuery = options.limitPerQuery || config.limitPerQuery;
  const maxDomains = options.maxDomains || config.maxDomains;
  const concurrency = options.concurrency || 3;
  const outputDir = options.outputDir || config.outputDir;

  ensureDir(outputDir);
  logger.log(
    `[run] provider=${provider.name} countries=${selectedCountries
      .map((country) => country.code)
      .join(",")} limitPerQuery=${limitPerQuery} maxDomains=${maxDomains}`
  );

  const domainSeeds = new Map();
  const rawSearchResults = [];

  for (const country of selectedCountries) {
    for (const template of config.queries) {
      const query = template.replace("{country}", country.name);
      logger.log(`[search] ${country.code} ${query}`);
      let results = [];
      try {
        results = await provider.search(query, country, limitPerQuery);
      } catch (error) {
        logger.warn(`[warn] search failed for "${query}": ${error.message}`);
        continue;
      }

      rawSearchResults.push({
        countryCode: country.code,
        countryName: country.name,
        query,
        count: results.length,
        results,
      });

      for (const result of results) {
        const domain = domainFromUrl(result.url);
        if (!domain || isBlockedDomain(domain, config)) {
          continue;
        }
        const existing = domainSeeds.get(domain) || {
          url: result.url,
          title: result.title,
          countryCode: country.code,
          countryName: country.name,
          sourceQueries: [],
          sourceResults: [],
        };
        existing.sourceQueries.push(query);
        existing.sourceResults.push({
          title: result.title,
          url: result.url,
          snippet: result.snippet,
        });
        if (result.url.length < existing.url.length) {
          existing.url = result.url;
          existing.title = result.title;
        }
        domainSeeds.set(domain, existing);
      }
    }
  }

  const prioritizedSeeds = Array.from(domainSeeds.values())
    .sort((left, right) => right.sourceQueries.length - left.sourceQueries.length)
    .slice(0, maxDomains);

  logger.log(`[analyze] domains=${prioritizedSeeds.length}`);

  const analyses = await runPool(prioritizedSeeds, concurrency, async (seed) => {
    const analysis = await analyzeDomain(seed, config);
    return analysis || null;
  });

  const leads = analyses
    .filter(Boolean)
    .filter((lead) => !isSourceDomain(lead.domain, config))
    .filter((lead) => lead.score >= 35)
    .sort((left, right) => right.score - left.score);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(outputDir, runId);
  ensureDir(runDir);

  writeJson(path.join(runDir, "search-results.json"), rawSearchResults);
  writeJson(path.join(runDir, "domain-seeds.json"), prioritizedSeeds);
  writeJson(path.join(runDir, "leads.json"), leads);

  const csvRows = leads.map((lead) => ({
    score: lead.score,
    company_name: lead.companyName,
    country_code: lead.countryCode,
    country_name: lead.countryName,
    domain: lead.domain,
    homepage: lead.homepage,
    sectors: lead.sectors,
    portfolio_pages: lead.portfolioPages,
    leadership_pages: lead.leadershipPages,
    contact_pages: lead.contactPages,
    executives: lead.executives,
    unit_counts: lead.unitCounts,
    source_queries: unique(lead.sourceQueries),
    signals: lead.signals,
    summary: lead.summary,
  }));
  fs.writeFileSync(path.join(runDir, "leads.csv"), toCsv(csvRows));

  const summary = {
    runId,
    provider: provider.name,
    countries: selectedCountries.map((country) => country.code),
    domainSeeds: prioritizedSeeds.length,
    acceptedLeads: leads.length,
    outputDir: runDir,
    topLeads: leads.slice(0, 15).map((lead) => ({
      score: lead.score,
      companyName: lead.companyName,
      domain: lead.domain,
      countryCode: lead.countryCode,
      summary: lead.summary,
    })),
  };

  writeJson(path.join(runDir, "summary.json"), summary);
  logger.log(`[done] leads=${leads.length} output=${runDir}`);
  return summary;
}

function resolveCountries(countryCodes) {
  if (!countryCodes || !countryCodes.length) {
    return ENGLISH_COUNTRIES;
  }
  const requested = new Set(countryCodes.map((code) => String(code).toLowerCase()));
  return ENGLISH_COUNTRIES.filter((country) => requested.has(country.code));
}

function isBlockedDomain(domain, config) {
  for (const blocked of config.blockedDomains) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

function isSourceDomain(domain, config) {
  for (const source of config.sourceDomains) {
    if (domain === source || domain.endsWith(`.${source}`)) {
      return true;
    }
  }
  return false;
}

function silentLogger() {
  return {
    log() {},
    warn() {},
  };
}

module.exports = {
  runScrape,
};
