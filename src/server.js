"use strict";

const express = require("express");
const path = require("path");
const { createAuth } = require("./auth");

function createApp({ store, config, nocoDb }) {
  const app = express();
  const auth = createAuth({ store, config });

  app.use(express.json({ limit: "1mb" }));
  app.use("/assets", express.static(path.join(__dirname, "..", "public")));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/", (req, res) => {
    if (!auth.isConfigured()) return res.redirect("/login");
    return res.redirect(auth.currentSession(req) ? "/dashboard" : "/login");
  });
  app.get("/login", (req, res) => {
    if (auth.isConfigured() && auth.currentSession(req)) return res.redirect("/dashboard");
    res.sendFile(path.join(__dirname, "..", "public", "login.html"));
  });
  app.post("/api/auth/login", (req, res) => auth.handleLogin(req, res));
  app.post("/api/auth/logout", withAuth(auth), (req, res) => auth.handleLogout(req, res));
  app.get("/api/auth/session", withAuth(auth), (req, res) => {
    res.json({ authenticated: true, username: req.authSession.username, expiresAt: req.authSession.expiresAt });
  });

  app.get("/dashboard", withAuth(auth), (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
  });

  app.get("/integrations/nocodb", withAuth(auth), (_req, res) => {
    res.json(nocoDb.getConfig());
  });

  app.put("/integrations/nocodb", withAuth(auth), (req, res) => {
    res.json(nocoDb.saveConfig(req.body || {}));
  });

  app.post("/integrations/nocodb/test", withAuth(auth), async (req, res, next) => {
    try {
      res.json(await nocoDb.testConnection(req.body || null));
    } catch (error) {
      next(error);
    }
  });

  app.use("/jobs", withAuth(auth));

  app.get("/jobs", (_req, res) => {
    res.json({ jobs: store.listJobs() });
  });

  app.post("/jobs", (req, res) => {
    const countries = normalizeCountries(req.body.countries);
    if (!countries.length) {
      return res.status(400).json({ error: "countries are required." });
    }
    const id = cryptoRandomId();
    const job = store.createJob({
      id,
      countries,
      country: countries.join(","),
      limitPerQuery: parsePositiveInt(req.body.limitPerQuery),
      maxDomains: parsePositiveInt(req.body.maxDomains),
      concurrency: parsePositiveInt(req.body.concurrency),
    });
    return res.status(202).json({ job, links: buildLinks(req, config, id) });
  });

  app.get("/jobs/:jobId", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    return res.json({
      job,
      stats: store.getJobStats(job.id),
      links: buildLinks(req, config, job.id),
    });
  });

  app.get("/jobs/:jobId/stats", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    return res.json({
      job,
      stats: store.getJobStats(job.id),
      links: buildLinks(req, config, job.id),
    });
  });

  app.get("/jobs/:jobId/leads", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 100, 1000);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    return res.json({
      jobId: job.id,
      limit,
      offset,
      total: store.countJobLeads(job.id),
      leads: store.getJobLeads(job.id, { limit, offset }),
    });
  });

  app.get("/jobs/:jobId/sync/nocodb", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    return res.json(nocoDb.getJobSyncStatus(job.id));
  });

  app.post("/jobs/:jobId/sync/nocodb", async (req, res, next) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    try {
      return res.json(await nocoDb.syncJob(job.id, { force: Boolean(req.body?.force) }));
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/jobs/:jobId", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    return res.json({ ok: true, deletedJob: store.deleteJob(job.id) });
  });

  app.get("/jobs/:jobId/download", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    const format = String(req.query.format || "csv").toLowerCase();
    const filePath = format === "json" ? job.artifactJsonPath : job.artifactCsvPath;
    if (!filePath) return res.status(409).json({ error: "Artifacts are not ready yet.", jobStatus: job.status });
    return res.download(filePath);
  });

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: error.message || "Unexpected error." });
  });

  return app;
}

function withAuth(auth) {
  return (req, res, next) => auth.requireAuth(req, res, next);
}

function buildLinks(req, config, jobId) {
  const base = config.publicBaseUrl || `${req.protocol}://${req.get("host")}`;
  return {
    self: `${base}/jobs/${jobId}`,
    dashboard: `${base}/dashboard?jobId=${jobId}`,
    stats: `${base}/jobs/${jobId}/stats`,
    leads: `${base}/jobs/${jobId}/leads`,
    csv: `${base}/jobs/${jobId}/download?format=csv`,
    json: `${base}/jobs/${jobId}/download?format=json`,
    delete: `${base}/jobs/${jobId}`,
    nocodbSync: `${base}/jobs/${jobId}/sync/nocodb`,
  };
}

function normalizeCountries(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [];
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { createApp };
