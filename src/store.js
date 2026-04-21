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
      return [...state.jobs].sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt))
      );
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
        updatedAt: new Date().toISOString(),
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

    getJobStats(jobId) {
      const job = this.getJob(jobId);
      if (!job) return null;
      const leads = readArtifactLeads(job);
      const topLead = leads[0] || null;
      return {
        leadCount: leads.length,
        countriesCount: Array.isArray(job.countries) ? job.countries.length : 0,
        domainSeeds: Number(job.summary?.domainSeeds || 0),
        acceptedLeads: Number(job.summary?.acceptedLeads || leads.length),
        topScore: topLead ? Number(topLead.score || 0) : null,
        provider: job.summary?.provider || null,
      };
    },

    startJob(jobId) {
      const job = this.getJob(jobId);
      if (!job) return null;
      job.status = "running";
      job.startedAt = new Date().toISOString();
      job.updatedAt = job.startedAt;
      persist();
      return job;
    },

    completeJob(jobId, summary) {
      const job = this.getJob(jobId);
      if (!job) return null;
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
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
      job.updatedAt = job.completedAt;
      job.error = error;
      persist();
      return job;
    },

    deleteJob(jobId) {
      const index = state.jobs.findIndex((job) => job.id === jobId);
      if (index === -1) return null;
      const [deleted] = state.jobs.splice(index, 1);
      delete state.nocoDbSyncStates[jobId];
      persist();
      return deleted;
    },

    claimNextPendingJob() {
      return state.jobs.find((job) => job.status === "pending") || null;
    },

    getJobLeads(jobId, { limit = 100, offset = 0 } = {}) {
      const job = this.getJob(jobId);
      if (!job) return [];
      const leads = readArtifactLeads(job);
      return leads.slice(offset, offset + limit).map((lead, index) => ({
        id: offset + index + 1,
        ...lead,
      }));
    },

    getJobLeadsAfterId(jobId, leadId, { limit = 100 } = {}) {
      const safeLeadId = Math.max(Number.parseInt(leadId, 10) || 0, 0);
      return this.getJobLeads(jobId, {
        offset: safeLeadId,
        limit,
      });
    },

    countJobLeads(jobId) {
      const job = this.getJob(jobId);
      if (!job) return 0;
      return readArtifactLeads(job).length;
    },

    countJobLeadsAfterId(jobId, leadId) {
      const total = this.countJobLeads(jobId);
      const safeLeadId = Math.max(Number.parseInt(leadId, 10) || 0, 0);
      return Math.max(total - safeLeadId, 0);
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
      state.sessions = state.sessions.filter(
        (session) => Date.parse(session.expiresAt) > now
      );
      persist();
    },

    getNocoDbConfig(defaults = {}) {
      return sanitizeNocoDbConfig({
        ...defaults,
        ...(state.appSettings.nocoDb || {}),
      });
    },

    saveNocoDbConfig(input = {}, defaults = {}) {
      const current = this.getNocoDbConfig(defaults);
      const next = sanitizeNocoDbConfig({
        ...current,
        ...input,
        apiToken:
          input.apiToken == null || input.apiToken === ""
            ? current.apiToken
            : input.apiToken,
      });
      state.appSettings.nocoDb = next;
      persist();
      return next;
    },

    getNocoDbSyncState(jobId) {
      return (
        state.nocoDbSyncStates[jobId] || {
          jobId,
          lastSyncedLeadId: 0,
          lastSyncedAt: null,
          lastStatus: "idle",
          lastMessage: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          syncedRecordCount: 0,
        }
      );
    },

    markNocoDbSyncStarted(jobId) {
      const current = this.getNocoDbSyncState(jobId);
      state.nocoDbSyncStates[jobId] = {
        ...current,
        lastStatus: "running",
        lastMessage: "Sync in progress.",
        lastStartedAt: new Date().toISOString(),
        lastFinishedAt: null,
      };
      persist();
      return state.nocoDbSyncStates[jobId];
    },

    markNocoDbSyncSuccess(jobId, input = {}) {
      const current = this.getNocoDbSyncState(jobId);
      const timestamp = new Date().toISOString();
      state.nocoDbSyncStates[jobId] = {
        ...current,
        lastSyncedLeadId: input.lastSyncedLeadId || 0,
        lastSyncedAt: timestamp,
        lastStatus: "success",
        lastMessage: input.message || "Sync completed.",
        lastStartedAt: input.startedAt || current.lastStartedAt || timestamp,
        lastFinishedAt: timestamp,
        syncedRecordCount:
          Number(current.syncedRecordCount || 0) +
          Number(input.syncedRecordCount || 0),
      };
      persist();
      return state.nocoDbSyncStates[jobId];
    },

    markNocoDbSyncFailure(jobId, message) {
      const current = this.getNocoDbSyncState(jobId);
      state.nocoDbSyncStates[jobId] = {
        ...current,
        lastStatus: "failed",
        lastMessage: message,
        lastFinishedAt: new Date().toISOString(),
      };
      persist();
      return state.nocoDbSyncStates[jobId];
    },
  };
}

function loadState(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      appSettings:
        parsed.appSettings && typeof parsed.appSettings === "object"
          ? parsed.appSettings
          : {},
      nocoDbSyncStates:
        parsed.nocoDbSyncStates && typeof parsed.nocoDbSyncStates === "object"
          ? parsed.nocoDbSyncStates
          : {},
    };
  } catch (_error) {
    return defaultState();
  }
}

function defaultState() {
  return {
    jobs: [],
    sessions: [],
    appSettings: {},
    nocoDbSyncStates: {},
  };
}

function readArtifactLeads(job) {
  if (!job?.artifactJsonPath || !fs.existsSync(job.artifactJsonPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(job.artifactJsonPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function sanitizeNocoDbConfig(input = {}) {
  const interval = Number.parseInt(
    String(input.autoSyncIntervalMinutes ?? "0"),
    10
  );
  return {
    baseUrl: cleanString(input.baseUrl),
    apiToken: cleanString(input.apiToken),
    baseId: cleanString(input.baseId),
    tableId: cleanString(input.tableId),
    autoSyncOnCompletion: Boolean(input.autoSyncOnCompletion),
    autoSyncIntervalMinutes: Number.isFinite(interval) && interval > 0 ? interval : 0,
    autoCreateColumns:
      input.autoCreateColumns == null ? true : Boolean(input.autoCreateColumns),
  };
}

function cleanString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

module.exports = {
  createStore,
};
