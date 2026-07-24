import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;

export function createPool(connectionString: string) {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "sec-loom-ingest",
  });
}

export async function runMigrations(pool: pg.Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = [
    { filename: "db/schema.sql", repeatable: false },
    { filename: "db/001_value_units.sql", repeatable: false },
    { filename: "db/002_canonicalize_cusips.sql", repeatable: false },
    { filename: "db/003_holding_quality.sql", repeatable: false },
    { filename: "db/import13f.sql", repeatable: true },
    { filename: "db/recompute.sql", repeatable: true },
  ];
  for (const migration of files) {
    const { filename } = migration;
    const sql = await readFile(resolve(filename), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query<{ sha256: string }>(
      "SELECT sha256 FROM schema_migrations WHERE filename = $1",
      [filename],
    );

    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== sha256) {
        if (!migration.repeatable) {
          throw new Error(
            `${filename} changed after it was applied. Add a new migration instead of mutating production history.`,
          );
        }
        await pool.query(sql);
        await pool.query(
          "UPDATE schema_migrations SET sha256 = $2, applied_at = now() WHERE filename = $1",
          [filename, sha256],
        );
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename, sha256) VALUES ($1, $2)",
        [filename, sha256],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function withTransaction<T>(
  pool: pg.Pool,
  callback: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
