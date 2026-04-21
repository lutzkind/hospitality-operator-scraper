"use strict";

const {
  domainFromUrl,
  extractLinks,
  extractMeta,
  extractTitle,
  normalizeUrl,
  scoreMatches,
  textFromHtml,
  unique,
} = require("./utils");

const OPERATOR_TERMS = [
  "portfolio",
  "management company",
  "hospitality group",
  "hotel management",
  "restaurant group",
  "owner operator",
  "owns and operates",
  "operates",
  "managed properties",
  "our hotels",
  "our restaurants",
  "properties",
  "brands",
];

const LEADERSHIP_TERMS = [
  "leadership",
  "our team",
  "executive team",
  "management team",
  "leadership team",
  "founder",
  "chief executive officer",
  "president",
  "chief operating officer",
  "chief development officer",
  "vice president",
];

const SECTOR_KEYWORDS = {
  hotels: ["hotel", "hotels", "resort", "resorts", "lodging", "inn", "suite", "hospitality management"],
  restaurants: [
    "restaurant",
    "restaurants",
    "bar",
    "bars",
    "cafe",
    "cafes",
    "franchisee",
    "multi-unit",
    "qsr",
    "dining",
  ],
};

async function analyzeDomain(seed, config) {
  const homepage = await fetchHtml(seed.url, config);
  if (!homepage) {
    return null;
  }

  const homepageAnalysis = analyzePage(seed.url, homepage.html, config);
  const candidateUrls = pickCandidatePages(seed.url, homepage.html, config);
  const extraPages = [];

  for (const url of candidateUrls.slice(0, config.maxPagesPerDomain)) {
    const page = await fetchHtml(url, config);
    if (!page) {
      continue;
    }
    extraPages.push(analyzePage(url, page.html, config));
  }

  const pages = [homepageAnalysis, ...extraPages];
  const combinedText = pages.map((page) => page.text).join(" ");
  const combinedSignals = pages.flatMap((page) => page.signals);
  const companyName = inferCompanyName(seed, pages);
  const executives = extractExecutives(combinedText);
  const unitCounts = extractUnitCounts(combinedText);
  const sectors = inferSectors(combinedText);
  const contactPages = unique(
    pages
      .flatMap((page) => page.links)
      .filter((link) => /contact/i.test(link.text) || /\/contact/i.test(link.url))
      .map((link) => link.url)
  );
  const leadershipPages = unique(
    [
      ...pages.map((page) => page.url),
      ...pages.flatMap((page) => page.links.map((link) => link.url)),
    ].filter((url) => /leadership|team|about/i.test(url))
  );

  const score = scoreLead({
    pages,
    executives,
    unitCounts,
    contactPages,
    leadershipPages,
    sectors,
  });

  return {
    companyName,
    domain: domainFromUrl(seed.url),
    homepage: seed.url,
    countryCode: seed.countryCode,
    countryName: seed.countryName,
    sectors,
    score,
    sourceQueries: seed.sourceQueries,
    sourceResults: seed.sourceResults,
    titles: unique(pages.map((page) => page.title).filter(Boolean)),
    signals: unique(combinedSignals),
    portfolioPages: pages
      .map((page) => page.url)
      .filter((url) => /portfolio|properties|hotels|restaurants|brands/i.test(url)),
    leadershipPages,
    contactPages,
    executives,
    unitCounts,
    summary: summarizeFindings(companyName, sectors, unitCounts, executives),
  };
}

async function fetchHtml(url, config) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": config.userAgent,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return null;
    }
    const html = await response.text();
    return { html };
  } catch (_error) {
    return null;
  }
}

function analyzePage(url, html, config) {
  const title = extractTitle(html);
  const metaDescription = extractMeta(html, "description") || extractMeta(html, "og:description");
  const siteName = extractMeta(html, "og:site_name");
  const text = textFromHtml(html).slice(0, 50000);
  const links = extractLinks(html, url);
  const signals = [];

  if (scoreMatches(`${title} ${metaDescription} ${text}`, OPERATOR_TERMS) > 0) {
    signals.push("operator_language");
  }
  if (/portfolio|properties|our hotels|our restaurants|brands/i.test(`${title} ${url}`)) {
    signals.push("portfolio_page");
  }
  if (/leadership|team|founder|chief executive|president|vice president/i.test(`${title} ${url} ${text}`)) {
    signals.push("leadership_page");
  }
  if (/contact|headquarters|office/i.test(`${title} ${url} ${text}`)) {
    signals.push("contact_signal");
  }

  const filteredLinks = links.filter((link) => {
    const sameDomain = domainFromUrl(link.url) === domainFromUrl(url);
    if (!sameDomain) {
      return false;
    }
    return config.discoveryPathHints.some((hint) => link.url.toLowerCase().includes(hint));
  });

  return {
    url,
    title,
    metaDescription,
    siteName,
    text,
    links: filteredLinks,
    signals,
  };
}

function pickCandidatePages(homepageUrl, html, config) {
  const homepage = new URL(homepageUrl);
  const urls = config.discoveryPathHints.map((hint) => normalizeUrl(hint, homepage.origin));
  const links = extractLinks(html, homepageUrl)
    .filter((link) => domainFromUrl(link.url) === domainFromUrl(homepageUrl))
    .filter((link) =>
      config.discoveryPathHints.some(
        (hint) =>
          link.url.toLowerCase().includes(hint) ||
          link.text.toLowerCase().includes(hint.replace("/", "").replace("-", " "))
      )
    )
    .map((link) => link.url);
  return unique([...urls, ...links]).filter((url) => url !== homepageUrl);
}

function inferCompanyName(seed, pages) {
  const candidates = [];
  for (const page of pages) {
    if (page.siteName) {
      candidates.push(page.siteName);
    }
    if (page.title) {
      candidates.push(page.title.split("|")[0].split(" - ")[0].trim());
    }
  }
  candidates.push(seed.title.split("|")[0].trim());
  return (
    candidates
      .map((value) => value.replace(/\s+/g, " ").trim())
      .find((value) => value && value.length > 2) || domainFromUrl(seed.url)
  );
}

function inferSectors(text) {
  const sectors = [];
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (scoreMatches(text, keywords) > 0) {
      sectors.push(sector);
    }
  }
  return sectors.length ? sectors : ["unknown"];
}

function extractExecutives(text) {
  const titles = [
    "CEO",
    "Chief Executive Officer",
    "President",
    "Founder",
    "Managing Director",
    "Chief Operating Officer",
    "COO",
    "Chief Development Officer",
    "Vice President",
    "VP Development",
    "VP Operations",
    "Director of Development",
    "Owner",
  ];

  const matches = [];
  for (const title of titles) {
    const regex = new RegExp(
      `([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3})\\s*,?\\s*(?:is\\s+the\\s+)?${escapeRegex(title)}`,
      "g"
    );
    let match = regex.exec(text);
    while (match) {
      matches.push(`${match[1]} - ${title}`);
      match = regex.exec(text);
    }
  }
  return unique(matches)
    .filter((entry) => {
      const [name] = entry.split(" - ");
      return isLikelyExecutiveName(name);
    })
    .slice(0, 12);
}

function extractUnitCounts(text) {
  const regex =
    /(\d{1,4}\+?)\s+(hotels|properties|restaurants|locations|venues|bars|cafes|resorts|assets|units)/gi;
  const matches = [];
  let match = regex.exec(text);
  while (match) {
    matches.push(`${match[1]} ${match[2]}`.toLowerCase());
    match = regex.exec(text);
  }
  return unique(matches).slice(0, 20);
}

function scoreLead({ pages, executives, unitCounts, contactPages, leadershipPages, sectors }) {
  let score = 0;
  if (pages.some((page) => page.signals.includes("operator_language"))) {
    score += 20;
  }
  if (pages.some((page) => page.signals.includes("portfolio_page"))) {
    score += 20;
  }
  if (leadershipPages.length) {
    score += 15;
  }
  if (contactPages.length) {
    score += 10;
  }
  if (unitCounts.length) {
    score += Math.min(20, unitCounts.length * 5);
  }
  if (executives.length) {
    score += Math.min(15, executives.length * 3);
  }
  if (sectors.includes("hotels") && sectors.includes("restaurants")) {
    score += 10;
  } else if (sectors.includes("hotels") || sectors.includes("restaurants")) {
    score += 5;
  }
  return Math.min(score, 100);
}

function summarizeFindings(companyName, sectors, unitCounts, executives) {
  const parts = [companyName];
  if (sectors.length && !sectors.includes("unknown")) {
    parts.push(`sectors=${sectors.join("/")}`);
  }
  if (unitCounts.length) {
    parts.push(`portfolio_signals=${unitCounts.slice(0, 3).join("; ")}`);
  }
  if (executives.length) {
    parts.push(`executives=${executives.slice(0, 2).join("; ")}`);
  }
  return parts.join(" | ");
}

function isLikelyExecutiveName(name) {
  const bannedTokens = new Set([
    "business",
    "updates",
    "update",
    "news",
    "our",
    "people",
    "new",
    "home",
    "portfolio",
    "contact",
  ]);
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length < 2 || parts.length > 4) {
    return false;
  }
  if (parts.some((part) => bannedTokens.has(part))) {
    return false;
  }
  return parts.every((part) => /^[a-z][a-z' -]*$/i.test(part));
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  analyzeDomain,
};
