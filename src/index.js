"use strict";

const path = require("path");
const { ENGLISH_COUNTRIES } = require("./config");
const { parseArgs } = require("./utils");
const { runScrape } = require("./runner");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedCountries = selectCountries(args.countries);
  const summary = await runScrape({
    countries: selectedCountries.map((country) => country.code),
    limitPerQuery: parsePositiveInt(args["limit-per-query"], undefined),
    maxDomains: parsePositiveInt(args["max-domains"], undefined),
    concurrency: parsePositiveInt(args.concurrency, undefined),
    outputDir: args.output ? path.resolve(args.output) : undefined,
    logger: console,
  });
  console.log(JSON.stringify(summary, null, 2));
}

function selectCountries(value) {
  if (!value) {
    return ENGLISH_COUNTRIES;
  }
  const requested = new Set(
    String(value)
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  return ENGLISH_COUNTRIES.filter((country) => requested.has(country.code));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
