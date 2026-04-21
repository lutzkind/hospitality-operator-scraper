"use strict";

const path = require("path");

module.exports = {
  host: process.env.HOST || "0.0.0.0",
  port: Number.parseInt(process.env.PORT, 10) || 3000,
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
  dbPath:
    process.env.DB_PATH || path.join(process.cwd(), "data", "hospitality-operator-scraper.json"),
  exportsDir:
    process.env.EXPORTS_DIR ||
    process.env.OUTPUT_DIR ||
    path.join("/root", "mcp-shared", "hospitality-operator-leads"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "change-me",
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "hospitality_scraper_session",
  sessionTtlHours: Number.parseInt(process.env.SESSION_TTL_HOURS, 10) || 24,
  workerPollMs: Number.parseInt(process.env.WORKER_POLL_MS, 10) || 3000,
};
