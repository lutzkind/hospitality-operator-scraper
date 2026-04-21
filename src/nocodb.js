"use strict";

const STANDARD_FIELDS = [
  { name: "job_id", type: "SingleLineText" },
  { name: "countries", type: "LongText" },
  { name: "country_code", type: "SingleLineText" },
  { name: "country_name", type: "SingleLineText" },
  { name: "company_name", type: "SingleLineText" },
  { name: "domain", type: "SingleLineText" },
  { name: "homepage", type: "URL" },
  { name: "score", type: "Number" },
  { name: "sectors", type: "LongText" },
  { name: "source_queries", type: "LongText" },
  { name: "signals", type: "LongText" },
  { name: "portfolio_pages", type: "LongText" },
  { name: "leadership_pages", type: "LongText" },
  { name: "contact_pages", type: "LongText" },
  { name: "executives", type: "LongText" },
  { name: "unit_counts", type: "LongText" },
  { name: "summary", type: "LongText" },
  { name: "titles", type: "LongText" },
  { name: "source_results_json", type: "LongText" },
  { name: "raw_json", type: "LongText" },
  { name: "lead_created_at", type: "DateTime" },
  { name: "lead_updated_at", type: "DateTime" },
];

function createNocoDbService({ store, config }) {
  return {
    getConfig() {
      return toPublicConfig(store.getNocoDbConfig(config.nocoDb));
    },

    saveConfig(input) {
      return toPublicConfig(store.saveNocoDbConfig(input, config.nocoDb));
    },

    async testConnection(input = null) {
      const settings = resolveSettings(store, config, input);
      validateSettings(settings);

      const columns = await listColumns(settings);
      return {
        ok: true,
        tableId: settings.tableId,
        columnCount: columns.length,
        autoSyncOnCompletion: settings.autoSyncOnCompletion,
        autoSyncIntervalMinutes: settings.autoSyncIntervalMinutes || 0,
        autoCreateColumns: settings.autoCreateColumns,
      };
    },

    getJobSyncStatus(jobId) {
      const settings = store.getNocoDbConfig(config.nocoDb);
      const sync = store.getNocoDbSyncState(jobId);
      return {
        enabled: hasEnoughSettings(settings),
        config: toPublicConfig(settings),
        sync,
        telemetry: {
          unsyncedLeadCount: store.countJobLeadsAfterId(
            jobId,
            sync.lastSyncedLeadId || 0
          ),
          nextDueAt: null,
        },
      };
    },

    async syncJob(jobId, options = {}) {
      const settings = resolveSettings(store, config, options.config);
      validateSettings(settings);

      const job = store.getJob(jobId);
      if (!job) {
        throw createHttpError(404, "Job not found.");
      }

      store.markNocoDbSyncStarted(jobId);

      try {
        const desiredFields = buildDesiredFields();
        let columns = await listColumns(settings);
        let availableFields = collectColumnNames(columns);

        if (settings.autoCreateColumns) {
          const missingFields = desiredFields.filter(
            (field) => !availableFields.has(field.name)
          );

          for (const field of missingFields) {
            await createColumn(settings, field);
          }

          if (missingFields.length > 0) {
            columns = await listColumns(settings);
            availableFields = collectColumnNames(columns);
          }
        }

        const syncState = options.force
          ? defaultSyncState(jobId)
          : store.getNocoDbSyncState(jobId);

        let lastSyncedLeadId = options.force ? 0 : syncState.lastSyncedLeadId;
        let syncedRecordCount = 0;

        while (true) {
          const leads = store.getJobLeadsAfterId(jobId, lastSyncedLeadId, {
            limit: 100,
          });

          if (!leads.length) {
            break;
          }

          const records = leads.map((lead) =>
            buildRecord(job, lead, availableFields)
          );

          await createRecords(settings, records);
          syncedRecordCount += records.length;
          lastSyncedLeadId = leads[leads.length - 1].id;
        }

        const message = syncedRecordCount
          ? `Synced ${syncedRecordCount} lead records to NocoDB.`
          : "No new leads to sync.";

        store.markNocoDbSyncSuccess(jobId, {
          lastSyncedLeadId,
          syncedRecordCount,
          message,
        });

        return {
          ok: true,
          jobId,
          syncedRecordCount,
          config: toPublicConfig(settings),
          sync: store.getNocoDbSyncState(jobId),
        };
      } catch (error) {
        store.markNocoDbSyncFailure(jobId, error.message);
        throw error;
      }
    },

    async syncCompletedJobIfEnabled(jobId) {
      const settings = store.getNocoDbConfig(config.nocoDb);
      if (!settings.autoSyncOnCompletion || !hasEnoughSettings(settings)) {
        return null;
      }

      try {
        return await this.syncJob(jobId);
      } catch (error) {
        console.error(`NocoDB sync failed for job ${jobId}:`, error.message);
        return null;
      }
    },
  };
}

function resolveSettings(store, config, input) {
  if (!input) {
    return store.getNocoDbConfig(config.nocoDb);
  }

  const current = store.getNocoDbConfig(config.nocoDb);
  return {
    ...current,
    ...input,
    apiToken:
      input.apiToken == null || input.apiToken === ""
        ? current.apiToken
        : input.apiToken,
  };
}

function validateSettings(settings) {
  if (!hasEnoughSettings(settings)) {
    throw createHttpError(
      400,
      "NocoDB base URL, API token, base ID, and table ID are required."
    );
  }
}

function hasEnoughSettings(settings) {
  return Boolean(
    settings.baseUrl &&
      settings.apiToken &&
      settings.baseId &&
      settings.tableId
  );
}

function toPublicConfig(settings) {
  return {
    baseUrl: settings.baseUrl,
    baseId: settings.baseId,
    tableId: settings.tableId,
    autoSyncOnCompletion: Boolean(settings.autoSyncOnCompletion),
    autoSyncIntervalMinutes: settings.autoSyncIntervalMinutes || 0,
    autoCreateColumns: settings.autoCreateColumns !== false,
    hasApiToken: Boolean(settings.apiToken),
  };
}

function buildDesiredFields() {
  return [...STANDARD_FIELDS];
}

function buildRecord(job, lead, availableFields) {
  const record = {
    job_id: job.id,
    countries: Array.isArray(job.countries) ? job.countries.join(", ") : "",
    country_code: lead.countryCode || "",
    country_name: lead.countryName || "",
    company_name: lead.companyName || "",
    domain: lead.domain || "",
    homepage: lead.homepage || "",
    score: lead.score || 0,
    sectors: Array.isArray(lead.sectors) ? lead.sectors.join(" | ") : "",
    source_queries: Array.isArray(lead.sourceQueries)
      ? lead.sourceQueries.join(" | ")
      : "",
    signals: Array.isArray(lead.signals) ? lead.signals.join(" | ") : "",
    portfolio_pages: Array.isArray(lead.portfolioPages)
      ? lead.portfolioPages.join(" | ")
      : "",
    leadership_pages: Array.isArray(lead.leadershipPages)
      ? lead.leadershipPages.join(" | ")
      : "",
    contact_pages: Array.isArray(lead.contactPages)
      ? lead.contactPages.join(" | ")
      : "",
    executives: Array.isArray(lead.executives) ? lead.executives.join(" | ") : "",
    unit_counts: Array.isArray(lead.unitCounts) ? lead.unitCounts.join(" | ") : "",
    summary: lead.summary || "",
    titles: Array.isArray(lead.titles) ? lead.titles.join(" | ") : "",
    source_results_json: JSON.stringify(lead.sourceResults || []),
    raw_json: JSON.stringify(lead),
    lead_created_at: job.createdAt || null,
    lead_updated_at: job.completedAt || job.updatedAt || null,
  };

  return Object.fromEntries(
    Object.entries(record).filter(([fieldName]) => availableFields.has(fieldName))
  );
}

async function listColumns(settings) {
  const payload = await apiRequestFallback(settings, [
    {
      pathname: `/api/v2/meta/tables/${encodeURIComponent(settings.tableId)}/columns`,
    },
    {
      pathname: `/api/v1/db/meta/tables/${encodeURIComponent(settings.tableId)}`,
      transform: (result) => result?.columns || [],
    },
  ]);

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.list)) {
    return payload.list;
  }

  return [];
}

async function createColumn(settings, field) {
  const payload = {
    title: field.name,
    column_name: field.name,
    name: field.name,
    uidt: field.type,
    type: field.type,
  };

  return apiRequestFallback(settings, [
    {
      pathname: `/api/v2/base/${encodeURIComponent(settings.baseId)}/table/${encodeURIComponent(
        settings.tableId
      )}/column`,
      method: "POST",
      body: payload,
    },
    {
      pathname: `/api/v1/db/meta/tables/${encodeURIComponent(settings.tableId)}/columns`,
      method: "POST",
      body: payload,
    },
  ]);
}

async function createRecords(settings, records) {
  if (!records.length) {
    return null;
  }

  return apiRequestFallback(settings, [
    {
      pathname: `/api/v2/tables/${encodeURIComponent(settings.tableId)}/records`,
      method: "POST",
      body: records,
    },
    {
      pathname: `/api/v1/db/data/noco/${encodeURIComponent(settings.baseId)}/${encodeURIComponent(
        settings.tableId
      )}`,
      method: "POST",
      body: records,
    },
    {
      pathname: `/api/v1/db/data/noco/${encodeURIComponent(settings.baseId)}/${encodeURIComponent(
        settings.tableId
      )}`,
      method: "POST",
      body: { list: records },
    },
  ]);
}

async function apiRequest(settings, pathname, options = {}) {
  const response = await fetch(joinUrl(settings.baseUrl, pathname), {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "xc-auth": settings.apiToken,
      "xc-token": settings.apiToken,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message =
      payload?.msg ||
      payload?.message ||
      payload?.error ||
      `NocoDB request failed with status ${response.status}.`;
    throw createHttpError(response.status, message);
  }

  return payload;
}

async function apiRequestFallback(settings, attempts) {
  let lastError = null;

  for (const attempt of attempts) {
    try {
      const result = await apiRequest(settings, attempt.pathname, attempt);
      return typeof attempt.transform === "function"
        ? attempt.transform(result)
        : result;
    } catch (error) {
      lastError = error;
      if (![400, 404].includes(error.statusCode)) {
        throw error;
      }
    }
  }

  throw lastError || createHttpError(500, "NocoDB request failed.");
}

function joinUrl(baseUrl, pathname) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${pathname}`;
}

function collectColumnNames(columns) {
  const names = new Set();
  for (const column of columns) {
    const candidates = [
      column.column_name,
      column.name,
      column.title,
      column.displayName,
    ];
    for (const value of candidates) {
      if (value) {
        names.add(String(value));
      }
    }
  }
  return names;
}

function defaultSyncState(jobId) {
  return {
    jobId,
    lastSyncedLeadId: 0,
    lastSyncedAt: null,
    lastStatus: "idle",
    lastMessage: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    syncedRecordCount: 0,
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { message: value };
  }
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  createNocoDbService,
};
