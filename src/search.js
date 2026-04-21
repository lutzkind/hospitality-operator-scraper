"use strict";

const { URLSearchParams } = require("url");
const { decodeEntities, domainFromUrl, normalizeUrl } = require("./utils");

function createSearchProvider(config) {
  if (config.braveApiKey) {
    return {
      name: "brave",
      search: (query, country, limit) => searchBrave(config, query, country, limit),
    };
  }

  return {
    name: "duckduckgo",
    search: (query, country, limit) => searchDuckDuckGo(config, query, country, limit),
  };
}

async function searchBrave(config, query, country, limit) {
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
    country: country.braveCountry || "ALL",
    search_lang: "en",
    safesearch: "moderate",
  });

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": config.braveApiKey,
      "User-Agent": config.userAgent,
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Brave search failed with ${response.status}`);
  }

  const payload = await response.json();
  const items = payload.web?.results || [];
  return items.map((item) => ({
    title: item.title || "",
    url: item.url || "",
    snippet: item.description || "",
    domain: domainFromUrl(item.url || ""),
  }));
}

async function searchDuckDuckGo(config, query, _country, limit) {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": config.userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with ${response.status}`);
  }

  const html = await response.text();
  const results = [];
  const regex =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/gi;

  let match = regex.exec(html);
  while (match && results.length < limit) {
    const rawUrl = decodeDuckDuckGoUrl(match[1]);
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      match = regex.exec(html);
      continue;
    }

    results.push({
      title: decodeEntities(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
      url: normalized,
      snippet: decodeEntities(match[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
      domain: domainFromUrl(normalized),
    });
    match = regex.exec(html);
  }

  return results;
}

function decodeDuckDuckGoUrl(rawUrl) {
  if (rawUrl.startsWith("//duckduckgo.com/l/?")) {
    rawUrl = `https:${rawUrl}`;
  }
  if (rawUrl.startsWith("https://duckduckgo.com/l/?")) {
    try {
      const url = new URL(rawUrl);
      return url.searchParams.get("uddg") || rawUrl;
    } catch (_error) {
      return rawUrl;
    }
  }
  return rawUrl;
}

module.exports = {
  createSearchProvider,
};
