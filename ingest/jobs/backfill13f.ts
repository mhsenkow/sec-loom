import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename } from "node:path";
import type pg from "pg";
import { from as copyFrom } from "pg-copy-streams";
import unzipper from "unzipper";
import type { RawArchive } from "../lib/archive";
import type { Logger } from "../lib/logger";
import type { SecClient } from "../lib/sec";

const tableByFile: Record<string, { table: string; columns: string[] }> = {
  "SUBMISSION.tsv": {
    table: "staging_13f_submission",
    columns: [
      "accession_number",
      "filing_date",
      "submission_type",
      "cik",
      "period_of_report",
    ],
  },
  "COVERPAGE.tsv": {
    table: "staging_13f_cover",
    columns: [
      "accession_number",
      "report_calendar_or_quarter",
      "is_amendment",
      "amendment_no",
      "amendment_type",
      "conf_denied_expired",
      "date_denied_expired",
      "date_reported",
      "reason_for_non_confidentiality",
      "filing_manager_name",
      "filing_manager_street1",
      "filing_manager_street2",
      "filing_manager_city",
      "filing_manager_state_or_country",
      "filing_manager_zipcode",
      "report_type",
      "form13f_file_number",
      "crd_number",
      "sec_file_number",
      "provide_info_for_instruction5",
      "additional_information",
    ],
  },
  "INFOTABLE.tsv": {
    table: "staging_13f_info",
    columns: [
      "accession_number",
      "infotable_sk",
      "name_of_issuer",
      "title_of_class",
      "cusip",
      "figi",
      "value",
      "shares_or_principal_amount",
      "shares_or_principal_type",
      "put_call",
      "investment_discretion",
      "other_manager",
      "voting_sole",
      "voting_shared",
      "voting_none",
    ],
  },
};

export async function backfill13FArchive(
  pool: pg.Pool,
  sec: SecClient,
  archive: RawArchive,
  sourceUrl: string,
  logger: Logger,
) {
  const filename = basename(new URL(sourceUrl).pathname);
  const run = await pool.query<{ run_id: string }>(
    `
      INSERT INTO ingestion_runs (job_name, source, metadata)
      VALUES ('backfill-13f', 'SEC_13F_BULK', $1)
      RETURNING run_id
    `,
    [JSON.stringify({ source_url: sourceUrl, filename })],
  );
  const runId = run.rows[0].run_id;

  try {
    logger.info("bulk_13f_download_started", { sourceUrl });
    const bytes = await sec.bytes(sourceUrl, 175_000_000);
    const object = await archive.putImmutable(
      `sec-bulk/13f/${filename}`,
      bytes,
      "application/zip",
    );
    logger.info("bulk_13f_download_complete", {
      sourceUrl,
      bytes: object.byteSize,
      sha256: object.sha256,
      existed: object.existed,
    });

    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtext('sec_loom_13f_bulk_import'))");
      await client.query(
        "TRUNCATE staging_13f_submission, staging_13f_cover, staging_13f_info",
      );

      const zip = Readable.from(Buffer.from(bytes)).pipe(
        unzipper.Parse({ forceStream: true }),
      );
      for await (const entry of zip) {
        const definition = tableByFile[entry.path];
        if (!definition) {
          entry.autodrain();
          continue;
        }
        const columns = definition.columns.map((column) => `"${column}"`).join(", ");
        const copy = client.query(
          copyFrom(
            `COPY ${definition.table} (${columns}) FROM STDIN WITH (FORMAT csv, DELIMITER E'\\t', QUOTE E'\\x01')`,
          ),
        );
        await pipeline(entry, new StripFirstLine(), copy);
        logger.info("bulk_13f_staging_loaded", {
          filename: entry.path,
          table: definition.table,
        });
      }

      const imported = await client.query<{
        filings_imported: string;
        holdings_imported: string;
        securities_resolved: string;
      }>(
        "SELECT * FROM import_staged_13f($1, $2)",
        [object.key, sourceUrl],
      );
      await client.query(
        "TRUNCATE staging_13f_submission, staging_13f_cover, staging_13f_info",
      );
      await client.query("SELECT pg_advisory_unlock(hashtext('sec_loom_13f_bulk_import'))");

      const summary = imported.rows[0];
      await pool.query(
        `
          UPDATE ingestion_runs
          SET status = 'SUCCEEDED', completed_at = now(),
              discovered_count = $2, processed_count = $3,
              metadata = metadata || $4::jsonb
          WHERE run_id = $1
        `,
        [
          runId,
          Number(summary.filings_imported),
          Number(summary.holdings_imported),
          JSON.stringify({
            archive_key: object.key,
            archive_sha256: object.sha256,
            securities_resolved: Number(summary.securities_resolved),
          }),
        ],
      );
      logger.info("bulk_13f_import_complete", { runId, ...summary });
      return summary;
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('sec_loom_13f_bulk_import'))",
      ).catch(() => undefined);
      client.release();
    }
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
          { message: error instanceof Error ? error.message : "Unknown bulk import error" },
        ]),
      ],
    );
    throw error;
  }
}

class StripFirstLine extends Transform {
  private stripped = false;
  private buffered = Buffer.alloc(0);

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ) {
    if (this.stripped) {
      callback(null, chunk);
      return;
    }
    this.buffered = Buffer.concat([this.buffered, chunk]);
    const newline = this.buffered.indexOf(0x0a);
    if (newline < 0) {
      callback();
      return;
    }
    this.stripped = true;
    callback(null, this.buffered.subarray(newline + 1));
    this.buffered = Buffer.alloc(0);
  }
}
