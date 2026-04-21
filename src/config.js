"use strict";

const path = require("path");

const ENGLISH_COUNTRIES = [
  { code: "us", name: "United States", braveCountry: "US" },
  { code: "ca", name: "Canada", braveCountry: "CA" },
  { code: "gb", name: "United Kingdom", braveCountry: "GB" },
  { code: "ie", name: "Ireland", braveCountry: "IE" },
  { code: "au", name: "Australia", braveCountry: "AU" },
  { code: "nz", name: "New Zealand", braveCountry: "NZ" },
  { code: "za", name: "South Africa", braveCountry: "ZA" },
  { code: "sg", name: "Singapore", braveCountry: "SG" },
  { code: "mt", name: "Malta", braveCountry: "ALL" },
];

const QUERY_TEMPLATES = [
  "{country} hotel management company portfolio",
  "{country} hotel operator portfolio",
  "{country} hospitality management company hotels portfolio",
  "{country} restaurant group portfolio",
  "{country} restaurant group leadership",
  "{country} hospitality group hotels restaurants portfolio",
  "{country} multi unit restaurant operator",
  "{country} franchise group restaurants",
  "{country} boutique hotel management company",
  "{country} hotel management company leadership",
];

const BLOCKED_DOMAINS = new Set([
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "tripadvisor.com",
  "booking.com",
  "expedia.com",
  "indeed.com",
  "glassdoor.com",
  "zoominfo.com",
  "bloomberg.com",
  "crunchbase.com",
  "opentable.com",
]);

const SOURCE_DOMAINS = new Set([
  "ahla.com",
  "franchising.com",
  "qsrmagazine.com",
  "nrn.com",
  "restaurantbusinessonline.com",
  "hospitalitynet.org",
  "hotelmanagement.net",
  "hotelsmag.com",
  "lodgingmagazine.com",
  "businesswire.com",
  "prnewswire.com",
  "cbre.com",
  "cbre.com.au",
  "sec.gov",
  "fintel.io",
]);

const DISCOVERY_PATH_HINTS = [
  "/portfolio",
  "/our-portfolio",
  "/properties",
  "/our-hotels",
  "/hotels",
  "/restaurants",
  "/brands",
  "/about",
  "/leadership",
  "/team",
  "/contact",
  "/news",
  "/press",
];

function buildConfig(env) {
  return {
    userAgent:
      env.USER_AGENT ||
      "hospitality-operator-scraper/0.1 (+https://luxeillum.com)",
    braveApiKey: env.BRAVE_API_KEY || env.BRAVE_SEARCH_API_KEY || "",
    outputDir:
      env.OUTPUT_DIR ||
      path.join("/root", "mcp-shared", "hospitality-operator-leads"),
    requestTimeoutMs: clampInt(env.REQUEST_TIMEOUT_MS, 20000),
    maxPagesPerDomain: clampInt(env.MAX_PAGES_PER_DOMAIN, 6),
    limitPerQuery: clampInt(env.LIMIT_PER_QUERY, 8),
    maxDomains: clampInt(env.MAX_DOMAINS, 250),
    countries: ENGLISH_COUNTRIES,
    queries: QUERY_TEMPLATES,
    blockedDomains: BLOCKED_DOMAINS,
    sourceDomains: SOURCE_DOMAINS,
    discoveryPathHints: DISCOVERY_PATH_HINTS,
  };
}

function clampInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  ENGLISH_COUNTRIES,
  buildConfig,
};
