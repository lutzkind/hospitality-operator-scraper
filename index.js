"use strict";

const fs = require("fs");
const appConfig = require("./src/app-config");
const { createStore } = require("./src/store");
const { createWorker } = require("./src/worker");
const { createApp } = require("./src/server");

fs.mkdirSync(appConfig.dataDir, { recursive: true });
fs.mkdirSync(appConfig.exportsDir, { recursive: true });

const store = createStore(appConfig);
const worker = createWorker({ store, config: appConfig });
const app = createApp({ store, config: appConfig });

const server = app.listen(appConfig.port, appConfig.host, () => {
  worker
    .start()
    .then(() => {
      console.log(
        `hospitality-operator-scraper listening on http://${appConfig.host}:${appConfig.port}`
      );
    })
    .catch((error) => {
      console.error("Failed to start worker:", error);
      server.close(() => {
        process.exitCode = 1;
      });
    });
});

async function shutdown() {
  worker.stop();
  server.close();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
