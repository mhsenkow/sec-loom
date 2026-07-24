import { existsSync } from "node:fs";
import process from "node:process";
import { loadConfig } from "./config";
import { backfill13FArchive } from "./jobs/backfill13f";
import { runDailyIngestion } from "./jobs/daily";
import { recomputeDerivedData } from "./jobs/recompute";
import { createArchive } from "./lib/archive";
import { createPool, runMigrations } from "./lib/db";
import { createLogger } from "./lib/logger";
import { SecClient } from "./lib/sec";
import { resolveOpenFigiQueue } from "./resolve/openfigi";
import { enrichWithSecTickers } from "./resolve/secTickers";

const LATEST_COMPLETE_13F_ARCHIVES = [
  "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01dec2025-28feb2026_form13f.zip",
  "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2026-31may2026_form13f.zip",
];

if (existsSync(".env")) process.loadEnvFile(".env");

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL);
const archive = createArchive(config);
const sec = new SecClient(config, logger);
const [command = "help", argument] = process.argv.slice(2);

try {
  switch (command) {
    case "migrate":
      await runMigrations(pool);
      logger.info("migrations_complete");
      break;

    case "backfill":
      await requireSchema();
      await backfill13FArchive(
        pool,
        sec,
        archive,
        argument ?? LATEST_COMPLETE_13F_ARCHIVES.at(-1)!,
        logger,
      );
      break;

    case "bootstrap":
      await runMigrations(pool);
      if (!config.r2Configured) {
        logger.warn("r2_not_configured", {
          message: "Raw filings will use .data/raw locally; do not call this a production ingest.",
        });
      }
      for (const sourceUrl of LATEST_COMPLETE_13F_ARCHIVES) {
        await backfill13FArchive(pool, sec, archive, sourceUrl, logger);
      }
      await resolveOpenFigiQueue(pool, config, logger, 100_000);
      await enrichWithSecTickers(pool, sec, logger);
      await recomputeDerivedData(pool, logger);
      await runDailyIngestion(pool, sec, archive, config, logger);
      await recomputeDerivedData(pool, logger);
      break;

    case "daily":
      await requireSchema();
      await runDailyIngestion(pool, sec, archive, config, logger);
      break;

    case "resolve":
      await requireSchema();
      try {
        await resolveOpenFigiQueue(pool, config, logger, Number(argument ?? 1_000));
      } catch (error) {
        logger.error("openfigi_resolution_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await enrichWithSecTickers(pool, sec, logger);
      break;

    case "recompute":
      await requireSchema();
      await recomputeDerivedData(pool, logger);
      break;

    case "sync":
      await requireSchema();
      await runDailyIngestion(pool, sec, archive, config, logger);
      await resolveOpenFigiQueue(pool, config, logger, Number(argument ?? 1_000));
      await enrichWithSecTickers(pool, sec, logger);
      await recomputeDerivedData(pool, logger);
      break;

    default:
      console.log(`
SEC Loom ingestion

  npm run db:migrate               Apply immutable database migrations
  npm run ingest:bootstrap         Load Q4 2025 + Q1 2026, resolve, compute, then catch up daily
  npm run ingest:daily             Poll SEC daily indexes for 13F and Forms 3/4/5
  npm run ingest:resolve [limit]   Resolve queued CUSIPs through OpenFIGI + SEC tickers
  npm run ingest:recompute         Rebuild amendment-aware positions, diffs, and consensus
  npm run ingest:sync              Daily ingest + resolve + recompute
  npm run ingest:backfill [url]    Import an official SEC 13F bulk ZIP
`);
  }
} catch (error) {
  logger.error("ingestion_command_failed", {
    command,
    message: error instanceof Error ? error.message : "unknown",
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}

async function requireSchema() {
  const result = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.filings') IS NOT NULL AS exists",
  );
  if (!result.rows[0].exists) {
    throw new Error("Database schema is missing. Run npm run db:migrate first.");
  }
}
