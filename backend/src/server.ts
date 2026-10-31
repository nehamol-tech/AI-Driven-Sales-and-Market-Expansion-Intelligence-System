import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { FMS_WARM_REQUESTS, getCachedFmsClient } from "./modules/fms/fms-client.factory.js";
import { startConfiguredFmsAutoSync } from "./modules/fms/fms-auto-sync.js";

/** Keeps actively-viewed FMS sheet responses fresh in the background — see fms-cache.ts. */
const FMS_REFRESH_INTERVAL_MS = 5 * 60_000;

app.listen(env.PORT, () => {
  logger.info(`AI Sales Expansion Engine backend listening on port ${env.PORT}`, { env: env.NODE_ENV });

  const fms = getCachedFmsClient();
  if (fms) {
    // Read-only GETs to the Apps Script, off the request path: the first visitor shouldn't wait ~80 s.
    void fms.warm(FMS_WARM_REQUESTS).then(() => logger.info("FMS sheet cache warmed", { requests: FMS_WARM_REQUESTS.length }));
    setInterval(() => void fms.refreshActive(), FMS_REFRESH_INTERVAL_MS).unref();
  }

  // FMS "FMS Response" → database, on a timer, when FMS_AUTO_SYNC_ENABLED=true (see fms-auto-sync.ts).
  void startConfiguredFmsAutoSync().catch((err) => logger.error("Could not start the FMS automatic sync", { error: String(err) }));
});
