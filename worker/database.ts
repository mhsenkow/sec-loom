import { Client } from "pg";

export type DatabaseEnv = Env & { HYPERDRIVE?: Hyperdrive };

export interface DatabasePayload {
  data: unknown;
  meta?: Record<string, unknown>;
  status?: number;
}

export async function handleDatabaseRequest(
  request: Request,
  env: DatabaseEnv,
  url: URL,
): Promise<DatabasePayload | null> {
  if (!env.HYPERDRIVE) return null;
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    const pathname = url.pathname.replace(/^\/api/, "") || "/";
    const freshness = await getFreshness(client);
    const baseMeta = {
      data_status: "live",
      source: "SEC EDGAR",
      freshness,
      as_of: freshness.find((item) => item.dataset === "13F")?.period_of_report ?? null,
    };

    if (request.method === "GET" && pathname === "/freshness") {
      return { data: freshness, meta: baseMeta };
    }

    if (request.method === "GET" && pathname === "/managers") {
      const result = await client.query(
        `
          SELECT
            m.cik,
            e.name,
            m.latest_13f_period,
            m.latest_13f_filed_at,
            m.latest_reported_value_usd,
            coalesce(coverage.coverage_pct, 0) AS coverage_pct
          FROM managers m
          JOIN entities e USING (cik)
          LEFT JOIN LATERAL (
            SELECT
              100 * sum(h.value_usd) FILTER (WHERE h.security_id IS NOT NULL)
                / nullif(sum(h.value_usd), 0) AS coverage_pct
            FROM holdings h
            JOIN filings f USING (accession_number)
            WHERE f.filer_cik = m.cik
              AND f.period_of_report = m.latest_13f_period
          ) coverage ON true
          WHERE m.is_active
          ORDER BY m.latest_reported_value_usd DESC NULLS LAST
          LIMIT $1
        `,
        [boundedInt(url.searchParams.get("limit"), 100, 1, 500)],
      );
      return { data: result.rows, meta: { ...baseMeta, result_count: result.rowCount } };
    }

    const managerMatch = pathname.match(/^\/managers\/(\d{1,10})\/portfolio$/);
    if (request.method === "GET" && managerMatch) {
      const cik = managerMatch[1].padStart(10, "0");
      const period = url.searchParams.get("period");
      const result = await client.query(
        `
          SELECT
            r.security_id,
            s.figi,
            s.ticker,
            s.issuer_name,
            s.sector,
            r.value_usd,
            r.shares,
            d.action,
            d.delta_value,
            d.delta_shares,
            d.pct_portfolio_curr,
            r.source_accessions
          FROM holdings_resolved r
          JOIN securities s USING (security_id)
          LEFT JOIN holdings_diffs d
            ON d.cik = r.cik
            AND d.security_id = r.security_id
            AND d.period_curr = r.period_of_report
          WHERE r.cik = $1
            AND r.period_of_report = coalesce(
              $2::date,
              (SELECT period_of_report FROM data_freshness WHERE dataset = '13F')
            )
          ORDER BY r.value_usd DESC
        `,
        [cik, period],
      );
      return { data: result.rows, meta: { ...baseMeta, cik, result_count: result.rowCount } };
    }

    const securityMatch = pathname.match(/^\/securities\/([0-9a-f-]{36})\/holders$/i);
    if (request.method === "GET" && securityMatch) {
      const period = url.searchParams.get("period");
      const result = await client.query(
        `
          SELECT
            r.cik,
            e.name AS manager_name,
            r.value_usd,
            r.shares,
            d.action,
            d.delta_value,
            r.source_accessions
          FROM holdings_resolved r
          JOIN entities e ON e.cik = r.cik
          LEFT JOIN holdings_diffs d
            ON d.cik = r.cik
            AND d.security_id = r.security_id
            AND d.period_curr = r.period_of_report
          WHERE r.security_id = $1::uuid
            AND r.period_of_report = coalesce(
              $2::date,
              (SELECT period_of_report FROM data_freshness WHERE dataset = '13F')
            )
          ORDER BY r.value_usd DESC
        `,
        [securityMatch[1], period],
      );
      return { data: result.rows, meta: { ...baseMeta, result_count: result.rowCount } };
    }

    if (request.method === "GET" && pathname === "/diffs") {
      const action = validAction(url.searchParams.get("action"));
      const period = url.searchParams.get("period");
      const minValue = boundedNumber(url.searchParams.get("min_value"), 0, 0, 1e15);
      const result = await client.query(
        `
          SELECT
            d.cik,
            e.name AS manager_name,
            d.security_id,
            s.figi,
            s.ticker,
            s.issuer_name,
            s.sector,
            d.action,
            d.value_curr,
            d.value_prev,
            d.delta_value,
            d.delta_shares,
            d.pct_portfolio_curr,
            d.input_accessions
          FROM holdings_diffs d
          JOIN entities e ON e.cik = d.cik
          JOIN securities s USING (security_id)
          WHERE d.period_curr = coalesce(
              $1::date,
              (SELECT period_of_report FROM data_freshness WHERE dataset = '13F')
            )
            AND ($2::holding_action IS NULL OR d.action = $2::holding_action)
            AND abs(d.delta_value) >= $3
          ORDER BY abs(d.delta_value) DESC
          LIMIT $4
        `,
        [
          period,
          action,
          minValue,
          boundedInt(url.searchParams.get("limit"), 250, 1, 2_000),
        ],
      );
      return { data: result.rows, meta: { ...baseMeta, result_count: result.rowCount } };
    }

    if (request.method === "GET" && pathname === "/consensus") {
      const period = url.searchParams.get("period");
      const result = await client.query(
        `
          SELECT
            c.*,
            s.figi,
            s.ticker,
            s.issuer_name,
            s.sector
          FROM consensus_metrics c
          JOIN securities s USING (security_id)
          WHERE c.period = coalesce(
            $1::date,
            (SELECT period_of_report FROM data_freshness WHERE dataset = '13F')
          )
          ORDER BY abs(c.net_flow_usd) DESC
          LIMIT $2
        `,
        [period, boundedInt(url.searchParams.get("limit"), 250, 1, 2_000)],
      );
      return { data: result.rows, meta: { ...baseMeta, result_count: result.rowCount } };
    }

    if (request.method === "GET" && pathname === "/insiders") {
      const code = url.searchParams.get("code") ?? "P";
      const since = url.searchParams.get("since");
      const result = await client.query(
        `
          SELECT
            t.*,
            e.name AS issuer_name,
            s.ticker,
            f.filed_at
          FROM insider_transactions t
          JOIN entities e ON e.cik = t.issuer_cik
          JOIN filings f USING (accession_number)
          LEFT JOIN securities s ON s.issuer_cik = t.issuer_cik
          WHERE ($1::text IS NULL OR t.transaction_code = $1)
            AND t.transaction_date >= coalesce($2::date, current_date - interval '30 days')
          ORDER BY t.transaction_date DESC, f.filed_at DESC
          LIMIT $3
        `,
        [code || null, since, boundedInt(url.searchParams.get("limit"), 100, 1, 500)],
      );
      return { data: result.rows, meta: { ...baseMeta, result_count: result.rowCount } };
    }

    const citeMatch = pathname.match(/^\/cite\/([\d-]+)$/);
    if (request.method === "GET" && citeMatch) {
      const result = await client.query(
        `
          SELECT
            f.*,
            e.name AS filer_name,
            'https://www.sec.gov/Archives/edgar/data/' ||
              ltrim(f.filer_cik, '0') || '/' ||
              replace(f.accession_number, '-', '') || '/' AS edgar_url
          FROM filings f
          JOIN entities e ON e.cik = f.filer_cik
          WHERE f.accession_number = $1
        `,
        [citeMatch[1]],
      );
      if (!result.rowCount) return { data: null, status: 404, meta: baseMeta };
      return { data: result.rows[0], meta: baseMeta };
    }

    if (request.method === "GET" && pathname === "/dashboard") {
      const periodResult = await client.query<{ period_of_report: string | null }>(
        "SELECT period_of_report FROM data_freshness WHERE dataset = '13F'",
      );
      const period = periodResult.rows[0]?.period_of_report ?? null;

      const [managers, diffs, consensus, insiders, aggregates] = await Promise.all([
        client.query(
          `
            SELECT
              m.cik,
              e.name,
              m.latest_13f_period,
              m.latest_13f_filed_at,
              m.latest_reported_value_usd,
              coalesce(coverage.coverage_pct, 0) AS coverage_pct
            FROM managers m
            JOIN entities e USING (cik)
            LEFT JOIN LATERAL (
              SELECT
                100 * sum(h.value_usd) FILTER (WHERE h.security_id IS NOT NULL)
                  / nullif(sum(h.value_usd), 0) AS coverage_pct
              FROM holdings h
              JOIN filings f USING (accession_number)
              WHERE f.filer_cik = m.cik
                AND f.period_of_report = m.latest_13f_period
            ) coverage ON true
            WHERE m.is_active
            ORDER BY m.latest_reported_value_usd DESC NULLS LAST
            LIMIT 100
          `,
        ),
        client.query(
          `
            SELECT
              d.cik,
              e.name AS manager_name,
              d.security_id,
              s.ticker,
              s.issuer_name,
              s.sector,
              s.figi,
              d.action,
              d.value_curr,
              d.value_prev,
              d.delta_value,
              d.shares_curr,
              d.shares_prev,
              d.delta_shares,
              d.pct_portfolio_curr,
              d.input_accessions,
              d.period_curr,
              f.filed_at,
              f.is_amendment
            FROM holdings_diffs d
            JOIN entities e ON e.cik = d.cik
            JOIN securities s USING (security_id)
            LEFT JOIN LATERAL (
              SELECT filed_at, is_amendment
              FROM filings
              WHERE accession_number = d.input_accessions[cardinality(d.input_accessions)]
              LIMIT 1
            ) f ON true
            WHERE d.period_curr = $1
            ORDER BY abs(d.delta_value) DESC
            LIMIT 100
          `,
          [period],
        ),
        client.query(
          `
            SELECT
              c.security_id,
              c.period,
              c.holder_count,
              c.net_flow_usd,
              c.aggregate_value_usd,
              c.insider_open_market_buy_count,
              s.ticker,
              s.issuer_name,
              s.sector,
              s.figi
            FROM consensus_metrics c
            JOIN securities s USING (security_id)
            WHERE c.period = $1
            ORDER BY abs(c.net_flow_usd) DESC
            LIMIT 100
          `,
          [period],
        ),
        client.query(
          `
            SELECT *
            FROM (
              SELECT DISTINCT ON (t.accession_number, t.transaction_index)
                t.accession_number,
                t.transaction_index,
                t.issuer_cik,
                t.insider_name,
                t.role,
                t.value_usd,
                t.transaction_date,
                e.name AS issuer_name,
                s.ticker,
                f.filed_at
              FROM insider_transactions t
              JOIN entities e ON e.cik = t.issuer_cik
              JOIN filings f USING (accession_number)
              LEFT JOIN securities s ON s.issuer_cik = t.issuer_cik
              WHERE t.transaction_code = 'P'
                AND t.is_open_market
                AND t.transaction_date >= current_date - interval '30 days'
              ORDER BY t.accession_number, t.transaction_index, s.ticker NULLS LAST
            ) insider_rows
            ORDER BY transaction_date DESC
            LIMIT 50
          `,
        ),
        client.query(
          `
            WITH period_diffs AS (
              SELECT *
              FROM holdings_diffs
              WHERE period_curr = $1
            ),
            period_consensus AS (
              SELECT *
              FROM consensus_metrics
              WHERE period = $1
            ),
            sample_securities AS (
              SELECT DISTINCT security_id FROM period_diffs
              UNION
              SELECT DISTINCT security_id FROM period_consensus
            ),
            coverage AS (
              SELECT
                100.0 * count(*) FILTER (WHERE s.ticker IS NOT NULL)
                  / nullif(count(*), 0) AS ticker_pct,
                100.0 * count(*) FILTER (
                  WHERE s.sector IS NOT NULL AND s.sector <> 'Unclassified'
                ) / nullif(count(*), 0) AS sector_pct,
                100.0 * count(*) FILTER (WHERE s.figi IS NOT NULL)
                  / nullif(count(*), 0) AS resolution_pct
              FROM sample_securities ss
              JOIN securities s USING (security_id)
            ),
            action_mix AS (
              SELECT
                count(*) FILTER (WHERE action = 'NEW') AS "NEW",
                count(*) FILTER (WHERE action = 'ADD') AS "ADD",
                count(*) FILTER (WHERE action = 'TRIM') AS "TRIM",
                count(*) FILTER (WHERE action = 'EXIT') AS "EXIT",
                count(*) FILTER (WHERE action = 'HOLD') AS "HOLD",
                count(*) FILTER (WHERE action <> 'HOLD') AS "activeTotal"
              FROM period_diffs
            ),
            totals AS (
              SELECT
                (SELECT count(*) FROM period_diffs) AS diff_count,
                (SELECT count(*) FROM period_consensus) AS consensus_count,
                (SELECT count(DISTINCT cik) FROM period_diffs) AS manager_count,
                (
                  SELECT count(*)
                  FROM insider_transactions t
                  WHERE t.transaction_code = 'P'
                    AND t.is_open_market
                    AND t.transaction_date >= current_date - interval '30 days'
                ) AS insider_count
            )
            SELECT jsonb_build_object(
              'actionMix', to_jsonb(action_mix),
              'coverage', jsonb_build_object(
                'tickerPct', coalesce(coverage.ticker_pct, 0),
                'sectorPct', coalesce(coverage.sector_pct, 0),
                'resolutionPct', coalesce(coverage.resolution_pct, 0)
              ),
              'totals', jsonb_build_object(
                'diffCount', totals.diff_count,
                'consensusCount', totals.consensus_count,
                'managerCount', totals.manager_count,
                'insiderCount', totals.insider_count
              )
            ) AS aggregates
            FROM action_mix, coverage, totals
          `,
          [period],
        ),
      ]);
      return {
        data: {
          managers: managers.rows,
          diffs: diffs.rows,
          consensus: consensus.rows,
          insiders: insiders.rows,
          aggregates: aggregates.rows[0]?.aggregates ?? null,
        },
        meta: baseMeta,
      };
    }

    return null;
  } finally {
    await client.end();
  }
}

async function getFreshness(client: Client) {
  const result = await client.query<{
    dataset: string;
    source_max_filed_at: string | null;
    period_of_report: string | null;
    last_ingested_at: string | null;
    record_count: string;
    coverage_pct: string | null;
    status: string;
    details: Record<string, unknown>;
  }>(
    "SELECT * FROM data_freshness ORDER BY dataset",
  );
  return result.rows;
}

function validAction(value: string | null) {
  return value && ["NEW", "ADD", "TRIM", "EXIT", "HOLD"].includes(value)
    ? value
    : null;
}

function boundedInt(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(maximum, Math.max(minimum, Math.trunc(Number(value) || fallback)));
}

function boundedNumber(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(maximum, Math.max(minimum, Number(value) || fallback));
}
