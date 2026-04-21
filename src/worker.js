"use strict";

const { runScrape } = require("./runner");

function createWorker({ store, config }) {
  let timer = null;
  let busy = false;

  return {
    async start() {
      timer = setInterval(() => {
        this.tick().catch((error) => {
          console.error("Worker tick failed:", error);
        });
      }, config.workerPollMs);
      timer.unref?.();
      await this.tick();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    async tick() {
      if (busy) return;
      const job = store.claimNextPendingJob();
      if (!job) return;
      busy = true;
      try {
        store.startJob(job.id);
        const summary = await runScrape({
          countries: job.countries,
          limitPerQuery: job.limitPerQuery || undefined,
          maxDomains: job.maxDomains || undefined,
          concurrency: job.concurrency || undefined,
          outputDir: config.exportsDir,
          logger: console,
        });
        store.completeJob(job.id, summary);
      } catch (error) {
        store.failJob(job.id, error.message);
      } finally {
        busy = false;
      }
    },
  };
}

module.exports = {
  createWorker,
};
