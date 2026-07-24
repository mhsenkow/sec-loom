import type pg from "pg";
import type { Logger } from "../lib/logger";
import type { SecClient } from "../lib/sec";

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SecurityRow {
  security_id: string;
  ticker: string;
  issuer_name: string;
}

export async function enrichWithSecTickers(
  pool: pg.Pool,
  sec: SecClient,
  logger: Logger,
) {
  const payload = await sec.json<Record<string, SecTickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  const byTicker = new Map(
    Object.values(payload).map((entry) => [entry.ticker.toUpperCase(), entry]),
  );
  const securities = await pool.query<SecurityRow>(
    `
      SELECT security_id, ticker, issuer_name
      FROM securities
      WHERE issuer_cik IS NULL AND ticker IS NOT NULL
    `,
  );

  let matched = 0;
  for (const security of securities.rows) {
    const candidate = byTicker.get(security.ticker.toUpperCase());
    if (!candidate || nameSimilarity(candidate.title, security.issuer_name) < 0.45) continue;
    const cik = String(candidate.cik_str).padStart(10, "0");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO entities (cik, name, entity_type)
          VALUES ($1, $2, 'ISSUER')
          ON CONFLICT (cik) DO UPDATE SET
            name = EXCLUDED.name,
            last_seen = now()
        `,
        [cik, candidate.title],
      );
      await client.query(
        "UPDATE securities SET issuer_cik = $2, updated_at = now() WHERE security_id = $1",
        [security.security_id, cik],
      );
      await client.query("COMMIT");
      matched += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  logger.info("sec_ticker_enrichment_complete", {
    candidates: securities.rowCount,
    matched,
  });
  return matched;
}

function nameSimilarity(left: string, right: string) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size, 1);
}

function tokens(value: string) {
  const ignored = new Set(["inc", "corp", "corporation", "company", "co", "plc", "ltd", "class"]);
  return new Set(
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token && !ignored.has(token)),
  );
}
