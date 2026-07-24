CREATE OR REPLACE FUNCTION refresh_holding_quality_flags()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM holding_quality_flags
  WHERE flag_code IN ('UNIT_SCALE_OUTLIER', 'NONPOSITIVE_POSITION');

  INSERT INTO holding_quality_flags (
    holding_id,
    flag_code,
    severity,
    details
  )
  SELECT
    h.id,
    'NONPOSITIVE_POSITION',
    'EXCLUDED',
    jsonb_build_object('value_usd', h.value_usd, 'shares', h.shares)
  FROM holdings h
  WHERE h.value_usd <= 0 OR h.shares <= 0;

  WITH implied_prices AS (
    SELECT
      h.id,
      h.cusip,
      f.period_of_report,
      h.value_usd,
      h.value_usd / nullif(h.shares, 0) AS implied_price
    FROM holdings h
    JOIN filings f USING (accession_number)
    WHERE h.value_usd > 0
      AND h.shares > 0
      AND h.put_call IS NULL
      AND coalesce(h.share_type, 'SH') = 'SH'
      AND f.period_of_report IS NOT NULL
  ),
  benchmarks AS (
    SELECT
      cusip,
      period_of_report,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY implied_price) AS median_price,
      count(*) AS peer_count
    FROM implied_prices
    GROUP BY cusip, period_of_report
    HAVING count(*) >= 5
  )
  INSERT INTO holding_quality_flags (
    holding_id,
    flag_code,
    severity,
    details
  )
  SELECT
    p.id,
    'UNIT_SCALE_OUTLIER',
    'EXCLUDED',
    jsonb_build_object(
      'implied_price', p.implied_price,
      'peer_median_price', b.median_price,
      'ratio', p.implied_price / nullif(b.median_price, 0),
      'peer_count', b.peer_count
    )
  FROM implied_prices p
  JOIN benchmarks b USING (cusip, period_of_report)
  WHERE p.value_usd >= 1000000
    AND (
      p.implied_price >= b.median_price * 100
      OR p.implied_price <= b.median_price / 100
    );
END;
$$;

CREATE OR REPLACE FUNCTION recompute_manager_period(target_cik text, target_period date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  previous_period date;
BEGIN
  DELETE FROM holdings_resolved
  WHERE cik = target_cik AND period_of_report = target_period;

  WITH period_filings AS (
    SELECT
      f.*,
      CASE
        WHEN NOT f.is_amendment THEN 'BASE'
        WHEN upper(coalesce(f.amendment_type, '')) LIKE '%RESTAT%' THEN 'RESTATEMENT'
        WHEN upper(coalesce(f.amendment_type, '')) LIKE '%NEW HOLDING%' THEN 'NEW_HOLDINGS'
        ELSE 'UNKNOWN'
      END AS amendment_mode
    FROM filings f
    WHERE f.filer_cik = target_cik
      AND f.period_of_report = target_period
      AND f.form_type IN ('13F-HR', '13F-HR/A')
  ),
  anchor AS (
    SELECT *
    FROM period_filings
    WHERE amendment_mode IN ('BASE', 'RESTATEMENT')
    ORDER BY
      CASE WHEN amendment_mode = 'RESTATEMENT' THEN 1 ELSE 0 END DESC,
      filed_at DESC,
      accession_number DESC
    LIMIT 1
  ),
  effective_filings AS (
    SELECT accession_number FROM anchor
    UNION ALL
    SELECT f.accession_number
    FROM period_filings f
    CROSS JOIN anchor a
    WHERE f.amendment_mode = 'NEW_HOLDINGS'
      AND (f.filed_at, f.accession_number) > (a.filed_at, a.accession_number)
  )
  INSERT INTO holdings_resolved (
    cik,
    period_of_report,
    security_id,
    cusip,
    issuer_name_as_filed,
    value_usd,
    shares,
    source_accessions,
    computed_at
  )
  SELECT
    target_cik,
    target_period,
    h.security_id,
    min(h.cusip),
    min(h.issuer_name_as_filed),
    sum(h.value_usd),
    sum(h.shares),
    array_agg(DISTINCT h.accession_number ORDER BY h.accession_number),
    now()
  FROM holdings h
  JOIN effective_filings ef USING (accession_number)
  WHERE h.security_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM holding_quality_flags q
      WHERE q.holding_id = h.id AND q.severity = 'EXCLUDED'
    )
  GROUP BY h.security_id;

  SELECT max(period_of_report)
  INTO previous_period
  FROM holdings_resolved
  WHERE cik = target_cik AND period_of_report < target_period;

  DELETE FROM holdings_diffs
  WHERE cik = target_cik AND period_curr = target_period;

  IF previous_period IS NOT NULL THEN
    WITH current_positions AS (
      SELECT * FROM holdings_resolved
      WHERE cik = target_cik AND period_of_report = target_period
    ),
    previous_positions AS (
      SELECT * FROM holdings_resolved
      WHERE cik = target_cik AND period_of_report = previous_period
    ),
    portfolio_total AS (
      SELECT nullif(sum(value_usd), 0) AS total_value
      FROM current_positions
    )
    INSERT INTO holdings_diffs (
      cik,
      security_id,
      period_curr,
      period_prev,
      action,
      value_curr,
      value_prev,
      delta_value,
      shares_curr,
      shares_prev,
      delta_shares,
      pct_portfolio_curr,
      input_accessions,
      computed_at
    )
    SELECT
      target_cik,
      coalesce(curr.security_id, prev.security_id),
      target_period,
      previous_period,
      CASE
        WHEN prev.security_id IS NULL THEN 'NEW'::holding_action
        WHEN curr.security_id IS NULL THEN 'EXIT'::holding_action
        WHEN curr.shares > prev.shares THEN 'ADD'::holding_action
        WHEN curr.shares < prev.shares THEN 'TRIM'::holding_action
        ELSE 'HOLD'::holding_action
      END,
      coalesce(curr.value_usd, 0),
      coalesce(prev.value_usd, 0),
      coalesce(curr.value_usd, 0) - coalesce(prev.value_usd, 0),
      coalesce(curr.shares, 0),
      coalesce(prev.shares, 0),
      coalesce(curr.shares, 0) - coalesce(prev.shares, 0),
      coalesce(curr.value_usd / portfolio_total.total_value, 0),
      ARRAY(
        SELECT DISTINCT accession
        FROM unnest(
          coalesce(curr.source_accessions, ARRAY[]::text[]) ||
          coalesce(prev.source_accessions, ARRAY[]::text[])
        ) accession
        ORDER BY accession
      ),
      now()
    FROM current_positions curr
    FULL OUTER JOIN previous_positions prev USING (security_id)
    CROSS JOIN portfolio_total;
  END IF;

  INSERT INTO managers (cik, latest_13f_period, latest_13f_filed_at, latest_reported_value_usd)
  SELECT
    target_cik,
    target_period,
    max(f.filed_at),
    sum(r.value_usd)
  FROM filings f
  JOIN holdings_resolved r
    ON r.cik = f.filer_cik AND r.period_of_report = f.period_of_report
  WHERE f.filer_cik = target_cik
    AND f.period_of_report = target_period
    AND f.form_type IN ('13F-HR', '13F-HR/A')
  GROUP BY f.filer_cik
  ON CONFLICT (cik) DO UPDATE SET
    latest_13f_period = GREATEST(managers.latest_13f_period, EXCLUDED.latest_13f_period),
    latest_13f_filed_at = CASE
      WHEN EXCLUDED.latest_13f_period >= managers.latest_13f_period
      THEN EXCLUDED.latest_13f_filed_at
      ELSE managers.latest_13f_filed_at
    END,
    latest_reported_value_usd = CASE
      WHEN EXCLUDED.latest_13f_period >= managers.latest_13f_period
      THEN EXCLUDED.latest_reported_value_usd
      ELSE managers.latest_reported_value_usd
    END;
END;
$$;

CREATE OR REPLACE FUNCTION recompute_consensus(target_period date)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM consensus_metrics WHERE period = target_period;

  INSERT INTO consensus_metrics (
    security_id,
    period,
    holder_count,
    net_flow_usd,
    new_positions,
    exits,
    aggregate_value_usd,
    insider_open_market_buy_count,
    insider_open_market_buy_value_usd,
    input_accessions,
    computed_at
  )
  SELECT
    r.security_id,
    target_period,
    count(DISTINCT r.cik),
    coalesce(sum(d.delta_value), 0),
    count(*) FILTER (WHERE d.action = 'NEW'),
    count(*) FILTER (WHERE d.action = 'EXIT'),
    sum(r.value_usd),
    coalesce(ins.buy_count, 0),
    coalesce(ins.buy_value, 0),
    ARRAY(
      SELECT DISTINCT accession
      FROM (
        SELECT unnest(hr2.source_accessions) AS accession
        FROM holdings_resolved hr2
        WHERE hr2.period_of_report = target_period
          AND hr2.security_id = r.security_id
        UNION
        SELECT unnest(coalesce(ins.accessions, ARRAY[]::text[]))
      ) inputs
      ORDER BY accession
    ),
    now()
  FROM holdings_resolved r
  LEFT JOIN holdings_diffs d
    ON d.cik = r.cik
    AND d.security_id = r.security_id
    AND d.period_curr = target_period
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS buy_count,
      coalesce(sum(t.value_usd), 0) AS buy_value,
      array_agg(DISTINCT t.accession_number) AS accessions
    FROM insider_transactions t
    JOIN securities s ON s.issuer_cik = t.issuer_cik
    WHERE s.security_id = r.security_id
      AND t.is_open_market
      AND t.acquired_disposed = 'A'
      AND t.transaction_date > target_period - interval '92 days'
      AND t.transaction_date <= target_period + interval '45 days'
  ) ins ON true
  WHERE r.period_of_report = target_period
  GROUP BY r.security_id, ins.buy_count, ins.buy_value, ins.accessions;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_data_freshness()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO data_freshness (
    dataset,
    source_max_filed_at,
    period_of_report,
    last_ingested_at,
    record_count,
    coverage_pct,
    status,
    details
  )
  SELECT
    '13F',
    max(f.filed_at),
    max(f.period_of_report) FILTER (
      WHERE f.period_of_report <= current_date - interval '45 days'
    ),
    max(f.ingested_at),
    count(DISTINCT f.accession_number),
    CASE
      WHEN sum(h.value_usd) = 0 THEN 0
      ELSE 100 * sum(h.value_usd) FILTER (
        WHERE h.security_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM holding_quality_flags q
            WHERE q.holding_id = h.id AND q.severity = 'EXCLUDED'
          )
      ) / sum(h.value_usd)
    END,
    CASE WHEN max(f.ingested_at) > now() - interval '36 hours' THEN 'CURRENT' ELSE 'STALE' END,
    jsonb_build_object(
      'unresolved_positions', count(*) FILTER (WHERE h.security_id IS NULL),
      'excluded_quality_outliers', (
        SELECT count(*) FROM holding_quality_flags WHERE severity = 'EXCLUDED'
      ),
      'latest_complete_period', max(f.period_of_report) FILTER (
        WHERE f.period_of_report <= current_date - interval '45 days'
      ),
      'latest_observed_period', max(f.period_of_report)
    )
  FROM filings f
  LEFT JOIN holdings h USING (accession_number)
  WHERE f.form_type IN ('13F-HR', '13F-HR/A')
  ON CONFLICT (dataset) DO UPDATE SET
    source_max_filed_at = EXCLUDED.source_max_filed_at,
    period_of_report = EXCLUDED.period_of_report,
    last_ingested_at = EXCLUDED.last_ingested_at,
    record_count = EXCLUDED.record_count,
    coverage_pct = EXCLUDED.coverage_pct,
    status = EXCLUDED.status,
    details = EXCLUDED.details;

  INSERT INTO data_freshness (
    dataset,
    source_max_filed_at,
    period_of_report,
    last_ingested_at,
    record_count,
    coverage_pct,
    status,
    details
  )
  SELECT
    'FORM4',
    max(f.filed_at),
    max(t.transaction_date),
    max(f.ingested_at),
    count(*),
    100,
    CASE WHEN max(f.ingested_at) > now() - interval '6 hours' THEN 'CURRENT' ELSE 'STALE' END,
    jsonb_build_object(
      'open_market_buys', count(*) FILTER (WHERE t.is_open_market AND t.acquired_disposed = 'A')
    )
  FROM insider_transactions t
  JOIN filings f USING (accession_number)
  ON CONFLICT (dataset) DO UPDATE SET
    source_max_filed_at = EXCLUDED.source_max_filed_at,
    period_of_report = EXCLUDED.period_of_report,
    last_ingested_at = EXCLUDED.last_ingested_at,
    record_count = EXCLUDED.record_count,
    coverage_pct = EXCLUDED.coverage_pct,
    status = EXCLUDED.status,
    details = EXCLUDED.details;
END;
$$;
