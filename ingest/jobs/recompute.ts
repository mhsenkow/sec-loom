import type pg from "pg";
import type { Logger } from "../lib/logger";

interface ManagerPeriod {
  cik: string;
  period: string;
}

export async function recomputeDerivedData(pool: pg.Pool, logger: Logger) {
  const run = await pool.query<{ run_id: string }>(
    `
      INSERT INTO ingestion_runs (job_name, source)
      VALUES ('recompute', 'POSTGRES')
      RETURNING run_id
    `,
  );
  const runId = run.rows[0].run_id;

  try {
    await pool.query("SELECT refresh_holding_quality_flags()");
    const managerPeriods = await pool.query<ManagerPeriod>(
      `
        SELECT DISTINCT filer_cik AS cik, period_of_report::text AS period
        FROM filings
        WHERE form_type IN ('13F-HR', '13F-HR/A')
          AND period_of_report IS NOT NULL
        ORDER BY period, cik
      `,
    );

    let completed = 0;
    for (const item of managerPeriods.rows) {
      await pool.query("SELECT recompute_manager_period($1, $2::date)", [
        item.cik,
        item.period,
      ]);
      completed += 1;
      if (completed % 250 === 0) {
        logger.info("recompute_progress", {
          completed,
          total: managerPeriods.rowCount,
        });
      }
    }

    const periods = await pool.query<{ period: string }>(
      `
        SELECT DISTINCT period_of_report::text AS period
        FROM holdings_resolved
        ORDER BY period
      `,
    );
    for (const item of periods.rows) {
      await pool.query("SELECT recompute_consensus($1::date)", [item.period]);
    }
    await pool.query("SELECT refresh_data_freshness()");

    const unknownAmendments = await pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM filings
        WHERE form_type = '13F-HR/A'
          AND coalesce(amendment_type, '') !~* '(RESTAT|NEW HOLDING)'
      `,
    );
    await pool.query(
      `
        UPDATE ingestion_runs
        SET status = $2, completed_at = now(), processed_count = $3,
            metadata = $4
        WHERE run_id = $1
      `,
      [
        runId,
        Number(unknownAmendments.rows[0].count) > 0 ? "PARTIAL" : "SUCCEEDED",
        completed,
        JSON.stringify({
          periods: periods.rowCount,
          unknown_amendments: Number(unknownAmendments.rows[0].count),
        }),
      ],
    );
    logger.info("derived_data_recompute_complete", {
      runId,
      managerPeriods: completed,
      periods: periods.rowCount,
      unknownAmendments: Number(unknownAmendments.rows[0].count),
    });
  } catch (error) {
    await pool.query(
      `
        UPDATE ingestion_runs
        SET status = 'FAILED', completed_at = now(), failed_count = 1,
            error_summary = $2
        WHERE run_id = $1
      `,
      [
        runId,
        JSON.stringify([
          { message: error instanceof Error ? error.message : "Unknown recompute error" },
        ]),
      ],
    );
    throw error;
  }
}
