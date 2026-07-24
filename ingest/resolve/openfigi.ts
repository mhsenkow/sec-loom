import type pg from "pg";
import type { IngestConfig } from "../config";
import type { Logger } from "../lib/logger";

interface OpenFigiInstrument {
  figi: string;
  compositeFIGI?: string;
  ticker?: string;
  name?: string;
  exchCode?: string;
  securityType?: string;
  marketSector?: string;
}

interface OpenFigiResult {
  data?: OpenFigiInstrument[];
  error?: string;
  warning?: string;
}

interface QueueRow {
  cusip: string;
}

export async function resolveOpenFigiQueue(
  pool: pg.Pool,
  config: IngestConfig,
  logger: Logger,
  limit = 1_000,
) {
  const batchSize = config.OPENFIGI_API_KEY ? 100 : 10;
  let resolved = 0;
  let attempted = 0;

  while (attempted < limit) {
    const rows = await claimBatch(pool, Math.min(batchSize, limit - attempted));
    if (rows.length === 0) break;
    attempted += rows.length;

    try {
      const results = await requestMappings(
        rows.map((row) => row.cusip),
        config.OPENFIGI_API_KEY,
      );
      for (let index = 0; index < rows.length; index += 1) {
        const result = results[index] ?? { error: "OpenFIGI omitted this result" };
        const instrument = chooseInstrument(result.data);
        if (instrument) {
          await storeResolution(pool, rows[index].cusip, instrument, result);
          resolved += 1;
        } else {
          await storeFailure(
            pool,
            rows[index].cusip,
            result.error ?? result.warning ?? "No matching instrument",
            result,
          );
        }
      }
    } catch (error) {
      await releaseBatch(
        pool,
        rows.map((row) => row.cusip),
        error instanceof Error ? error.message : "OpenFIGI request failed",
      );
      throw error;
    }

    await sleep(config.OPENFIGI_API_KEY ? 300 : 2_500);
  }

  logger.info("openfigi_resolution_complete", { attempted, resolved });
  return { attempted, resolved };
}

async function claimBatch(pool: pg.Pool, batchSize: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<QueueRow>(
      `
        SELECT cusip
        FROM resolution_queue
        WHERE status IN ('PENDING', 'ERROR')
          AND next_attempt_at <= now()
          AND (locked_at IS NULL OR locked_at < now() - interval '15 minutes')
        ORDER BY priority_value_usd DESC, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      `,
      [batchSize],
    );
    if (result.rows.length) {
      await client.query(
        `
          UPDATE resolution_queue
          SET locked_at = now(), attempts = attempts + 1, updated_at = now()
          WHERE cusip = ANY($1::text[])
        `,
        [result.rows.map((row) => row.cusip)],
      );
    }
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requestMappings(cusips: string[], apiKey?: string) {
  const response = await fetch("https://api.openfigi.com/v3/mapping", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "X-OPENFIGI-APIKEY": apiKey } : {}),
    },
    body: JSON.stringify(cusips.map((idValue) => ({ idType: "ID_CUSIP", idValue }))),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`OpenFIGI returned ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<OpenFigiResult[]>;
}

function chooseInstrument(instruments: OpenFigiInstrument[] | undefined) {
  if (!instruments?.length) return undefined;
  return [...instruments].sort((left, right) => score(right) - score(left))[0];
}

function score(instrument: OpenFigiInstrument) {
  let value = 0;
  if (instrument.marketSector === "Equity") value += 10;
  if (instrument.securityType?.toLowerCase().includes("common")) value += 5;
  if (instrument.exchCode === "US") value += 3;
  if (instrument.ticker) value += 1;
  return value;
}

async function storeResolution(
  pool: pg.Pool,
  cusip: string,
  instrument: OpenFigiInstrument,
  raw: OpenFigiResult,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const security = await client.query<{ security_id: string }>(
      `
        INSERT INTO securities (
          figi, composite_figi, ticker, issuer_name, primary_cusip,
          exchange_code, security_type, resolution_confidence, resolution_method
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0.9500, 'OPENFIGI')
        ON CONFLICT (figi) DO UPDATE SET
          composite_figi = coalesce(EXCLUDED.composite_figi, securities.composite_figi),
          -- Prefer a real OpenFIGI ticker when the existing row is still unresolved.
          ticker = coalesce(securities.ticker, EXCLUDED.ticker),
          issuer_name = CASE
            WHEN securities.issuer_name ILIKE 'CUSIP %' THEN EXCLUDED.issuer_name
            ELSE coalesce(securities.issuer_name, EXCLUDED.issuer_name)
          END,
          primary_cusip = coalesce(securities.primary_cusip, EXCLUDED.primary_cusip),
          exchange_code = coalesce(EXCLUDED.exchange_code, securities.exchange_code),
          security_type = coalesce(EXCLUDED.security_type, securities.security_type),
          resolution_confidence = greatest(
            coalesce(securities.resolution_confidence, 0),
            EXCLUDED.resolution_confidence
          ),
          resolution_method = coalesce(securities.resolution_method, EXCLUDED.resolution_method),
          updated_at = now()
        RETURNING security_id
      `,
      [
        instrument.figi,
        instrument.compositeFIGI,
        instrument.ticker ? instrument.ticker.toUpperCase() : null,
        instrument.name ?? instrument.ticker ?? `CUSIP ${cusip}`,
        cusip,
        instrument.exchCode,
        instrument.securityType,
      ],
    );
    const securityId = security.rows[0].security_id;
    await client.query(
      `
        UPDATE cusip_map
        SET security_id = $2, figi = $3, confidence = 0.9500,
            source = 'OPENFIGI', status = 'RESOLVED', raw_response = $4,
            resolved_at = now(), updated_at = now(), last_error = NULL
        WHERE cusip = $1
      `,
      [cusip, securityId, instrument.figi, raw],
    );
    await client.query(
      "UPDATE holdings SET security_id = $2 WHERE cusip = $1 AND security_id IS NULL",
      [cusip, securityId],
    );
    await client.query(
      "UPDATE resolution_queue SET status = 'RESOLVED', locked_at = NULL, updated_at = now() WHERE cusip = $1",
      [cusip],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storeFailure(
  pool: pg.Pool,
  cusip: string,
  message: string,
  raw: OpenFigiResult,
) {
  const permanent = /no identifier|not found|invalid/i.test(message);
  await pool.query(
    `
      UPDATE cusip_map
      SET status = $2, attempts = attempts + 1, last_error = $3,
          raw_response = $4, updated_at = now()
      WHERE cusip = $1
    `,
    [cusip, permanent ? "NOT_FOUND" : "ERROR", message, raw],
  );
  await pool.query(
    `
      UPDATE resolution_queue
      SET status = $2, locked_at = NULL, last_error = $3,
          next_attempt_at = now() + make_interval(mins => least(1440, (5 * (2 ^ attempts))::integer)),
          updated_at = now()
      WHERE cusip = $1
    `,
    [cusip, permanent ? "NOT_FOUND" : "ERROR", message],
  );
}

async function releaseBatch(pool: pg.Pool, cusips: string[], message: string) {
  await pool.query(
    `
      UPDATE resolution_queue
      SET status = 'ERROR', locked_at = NULL, last_error = $2,
          next_attempt_at = now() + interval '15 minutes', updated_at = now()
      WHERE cusip = ANY($1::text[])
    `,
    [cusips, message],
  );
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
