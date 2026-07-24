import pLimit from "p-limit";
import type pg from "pg";
import type { IngestConfig } from "../config";
import type { RawArchive } from "../lib/archive";
import type { Logger } from "../lib/logger";
import { HttpError, type SecClient } from "../lib/sec";
import { processFiling } from "./processFiling";

const TRACKED_FORMS = new Set([
  "13F-HR",
  "13F-HR/A",
  "3",
  "3/A",
  "4",
  "4/A",
  "5",
  "5/A",
]);

export async function runDailyIngestion(
  pool: pg.Pool,
  sec: SecClient,
  archive: RawArchive,
  config: IngestConfig,
  logger: Logger,
) {
  const run = await pool.query<{ run_id: string }>(
    `
      INSERT INTO ingestion_runs (job_name, source, metadata)
      VALUES ('daily', 'SEC_DAILY_INDEX', $1)
      RETURNING run_id
    `,
    [JSON.stringify({ forms: [...TRACKED_FORMS] })],
  );
  const runId = run.rows[0].run_id;
  let discovered = 0;
  let processed = 0;
  let failed = 0;
  const errors: Array<{ accession?: string; message: string }> = [];

  try {
    const checkpoint = await pool.query<{ cursor_value: string }>(
      "SELECT cursor_value FROM ingestion_checkpoints WHERE source = 'SEC_DAILY_INDEX'",
    );
    const dates = datesToProcess(checkpoint.rows[0]?.cursor_value);

    for (const date of dates) {
      let index;
      try {
        index = await sec.dailyIndex(date, TRACKED_FORMS);
      } catch (error) {
        if ((error as HttpError).status === 404) {
          await updateCheckpoint(pool, date);
          continue;
        }
        if (
          (error as HttpError).status === 403 &&
          date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
        ) {
          logger.info("daily_index_not_published_yet", {
            date: date.toISOString().slice(0, 10),
          });
          break;
        }
        throw error;
      }

      const uniqueEntries = [
        ...new Map(
          index.entries.map((entry) => [entry.accessionNumber, entry]),
        ).values(),
      ];
      discovered += uniqueEntries.length;
      const limit = pLimit(config.INGEST_CONCURRENCY);
      const results = await Promise.allSettled(
        uniqueEntries.map((entry) =>
          limit(() => processFiling(pool, sec, archive, entry, logger)),
        ),
      );

      let dateFailed = false;
      results.forEach((result, indexPosition) => {
        if (result.status === "fulfilled") {
          if (result.value.status === "processed") processed += 1;
          return;
        }
        failed += 1;
        dateFailed = true;
        const entry = uniqueEntries[indexPosition];
        const message = result.reason instanceof Error
          ? result.reason.message
          : "Unknown filing ingestion failure";
        errors.push({ accession: entry?.accessionNumber, message });
        logger.error("filing_ingest_failed", {
          accession: entry?.accessionNumber,
          form: entry?.formType,
          message,
        });
      });

      if (dateFailed) break;
      await updateCheckpoint(pool, date);
    }

    await pool.query(
      `
        UPDATE ingestion_runs
        SET status = $2, completed_at = now(), discovered_count = $3,
            processed_count = $4, failed_count = $5, error_summary = $6
        WHERE run_id = $1
      `,
      [
        runId,
        failed === 0 ? "SUCCEEDED" : "PARTIAL",
        discovered,
        processed,
        failed,
        JSON.stringify(errors.slice(0, 50)),
      ],
    );
    logger.info("daily_ingestion_complete", { runId, discovered, processed, failed });
    return { runId, discovered, processed, failed };
  } catch (error) {
    await pool.query(
      `
        UPDATE ingestion_runs
        SET status = 'FAILED', completed_at = now(), discovered_count = $2,
            processed_count = $3, failed_count = $4, error_summary = $5
        WHERE run_id = $1
      `,
      [
        runId,
        discovered,
        processed,
        failed + 1,
        JSON.stringify([
          ...errors.slice(0, 49),
          { message: error instanceof Error ? error.message : "Unknown daily ingestion failure" },
        ]),
      ],
    );
    throw error;
  }
}

function datesToProcess(cursor?: string) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = cursor ? new Date(`${cursor}T00:00:00Z`) : new Date(today);
  start.setUTCDate(start.getUTCDate() + (cursor ? 1 : -5));
  const dates: Date[] = [];
  for (const date = new Date(start); date <= today && dates.length < 14; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) {
      dates.push(new Date(date));
    }
  }
  return dates;
}

async function updateCheckpoint(pool: pg.Pool, date: Date) {
  await pool.query(
    `
      INSERT INTO ingestion_checkpoints (source, cursor_value, metadata)
      VALUES ('SEC_DAILY_INDEX', $1, $2)
      ON CONFLICT (source) DO UPDATE SET
        cursor_value = EXCLUDED.cursor_value,
        updated_at = now(),
        metadata = EXCLUDED.metadata
    `,
    [
      date.toISOString().slice(0, 10),
      JSON.stringify({ completed_through: date.toISOString().slice(0, 10) }),
    ],
  );
}
