"use strict";

const fs = require("fs");
const path = require("path");

function createStore(config) {
  const state = loadState(config.dbPath);

  function persist() {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    fs.writeFileSync(config.dbPath, JSON.stringify(state, null, 2));
  }

  return {
    listJobs() {
      return [...state.jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },
    createJob(payload) {
      const job = {
        id: payload.id,
        status: "pending",
        country: payload.country,
        countries: payload.countries,
        limitPerQuery: payload.limitPerQuery || null,
        maxDomains: payload.maxDomains || null,
        concurrency: payload.concurrency || null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        summary: null,
        error: null,
        artifactCsvPath: null,
        artifactJsonPath: null,
      };
      state.jobs.push(job);
      persist();
      return job;
    },
    getJob(jobId) {
      return state.jobs.find((job) => job.id === jobId) || null;
    },
    startJob(jobId) {
      const job = this.getJob(jobId);
      if (!job) return null;
      job.status = "running";
      job.startedAt = new Date().toISOString();
      persist();
      return job;
    },
    completeJob(jobId, summary) {
      const job = this.getJob(jobId);
      if (!job) return null;
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.summary = summary;
      job.artifactCsvPath = path.join(summary.outputDir, "leads.csv");
      job.artifactJsonPath = path.join(summary.outputDir, "leads.json");
      persist();
      return job;
    },
    failJob(jobId, error) {
      const job = this.getJob(jobId);
      if (!job) return null;
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = error;
      persist();
      return job;
    },
    deleteJob(jobId) {
      const index = state.jobs.findIndex((job) => job.id === jobId);
      if (index === -1) return null;
      const [deleted] = state.jobs.splice(index, 1);
      persist();
      return deleted;
    },
    claimNextPendingJob() {
      return state.jobs.find((job) => job.status === "pending") || null;
    },
    getJobLeads(jobId, { limit = 100, offset = 0 } = {}) {
      const job = this.getJob(jobId);
      if (!job?.artifactJsonPath || !fs.existsSync(job.artifactJsonPath)) {
        return [];
      }
      try {
        const leads = JSON.parse(fs.readFileSync(job.artifactJsonPath, "utf8"));
        return leads.slice(offset, offset + limit);
      } catch (_error) {
        return [];
      }
    },
    countJobLeads(jobId) {
      const job = this.getJob(jobId);
      if (!job?.artifactJsonPath || !fs.existsSync(job.artifactJsonPath)) {
        return 0;
      }
      try {
        const leads = JSON.parse(fs.readFileSync(job.artifactJsonPath, "utf8"));
        return leads.length;
      } catch (_error) {
        return 0;
      }
    },
    createSession(session) {
      state.sessions.push(session);
      persist();
    },
    getSession(sessionId) {
      return state.sessions.find((session) => session.id === sessionId) || null;
    },
    touchSession(sessionId, expiresAt) {
      const session = this.getSession(sessionId);
      if (!session) return null;
      session.expiresAt = expiresAt;
      persist();
      return session;
    },
    deleteSession(sessionId) {
      const index = state.sessions.findIndex((session) => session.id === sessionId);
      if (index === -1) return null;
      const [deleted] = state.sessions.splice(index, 1);
      persist();
      return deleted;
    },
    cleanupExpiredSessions() {
      const now = Date.now();
      state.sessions = state.sessions.filter((session) => Date.parse(session.expiresAt) > now);
      persist();
    },
  };
}

function loadState(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { jobs: [], sessions: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (_error) {
    return { jobs: [], sessions: [] };
  }
}

module.exports = {
  createStore,
};
