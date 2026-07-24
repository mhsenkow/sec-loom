import pg from "pg";
import { loadConfig } from "../ingest/config";
import { createLogger } from "../ingest/lib/logger";
import { SecClient } from "../ingest/lib/sec";
import { enrichWithSecTickers } from "../ingest/resolve/secTickers";

const config = loadConfig();
const logger = createLogger();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const sec = new SecClient(config);

try {
  const matched = await enrichWithSecTickers(pool, sec, logger);
  console.log(JSON.stringify({ matched }, null, 2));
} finally {
  await pool.end();
}
