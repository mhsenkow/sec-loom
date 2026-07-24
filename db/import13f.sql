CREATE OR REPLACE FUNCTION import_staged_13f(
  archive_object_key text,
  archive_source_url text
)
RETURNS TABLE (
  filings_imported bigint,
  holdings_imported bigint,
  securities_resolved bigint
)
LANGUAGE plpgsql
AS $$
DECLARE
  filing_count bigint;
  holding_count bigint;
  resolved_count bigint;
BEGIN
  INSERT INTO entities (cik, name, entity_type, first_seen, last_seen)
  SELECT DISTINCT ON (lpad(s.cik, 10, '0'))
    lpad(s.cik, 10, '0'),
    coalesce(nullif(c.filing_manager_name, ''), 'Manager CIK ' || s.cik),
    'MANAGER',
    now(),
    now()
  FROM staging_13f_submission s
  LEFT JOIN staging_13f_cover c USING (accession_number)
  WHERE s.submission_type IN ('13F-HR', '13F-HR/A')
  ORDER BY
    lpad(s.cik, 10, '0'),
    to_date(s.filing_date, 'DD-MON-YYYY') DESC,
    s.accession_number DESC
  ON CONFLICT (cik) DO UPDATE SET
    name = EXCLUDED.name,
    entity_type = 'MANAGER',
    last_seen = now();

  INSERT INTO managers (cik)
  SELECT DISTINCT lpad(cik, 10, '0')
  FROM staging_13f_submission
  WHERE submission_type IN ('13F-HR', '13F-HR/A')
  ON CONFLICT (cik) DO UPDATE SET is_active = true;

  INSERT INTO filings (
    accession_number,
    filer_cik,
    form_type,
    filed_at,
    period_of_report,
    is_amendment,
    amendment_number,
    amendment_type,
    raw_object_key,
    source_url,
    metadata
  )
  SELECT
    s.accession_number,
    lpad(s.cik, 10, '0'),
    s.submission_type,
    to_date(s.filing_date, 'DD-MON-YYYY'),
    to_date(s.period_of_report, 'DD-MON-YYYY'),
    s.submission_type = '13F-HR/A' OR upper(coalesce(c.is_amendment, '')) = 'Y',
    nullif(c.amendment_no, '')::integer,
    nullif(c.amendment_type, ''),
    archive_object_key,
    'https://www.sec.gov/Archives/edgar/data/' ||
      ltrim(s.cik, '0') || '/' || replace(s.accession_number, '-', '') || '/',
    jsonb_build_object(
      'bulk_source_url', archive_source_url,
      'report_type', nullif(c.report_type, ''),
      'form13f_file_number', nullif(c.form13f_file_number, '')
    )
  FROM staging_13f_submission s
  LEFT JOIN staging_13f_cover c USING (accession_number)
  WHERE s.submission_type IN ('13F-HR', '13F-HR/A')
  ON CONFLICT (accession_number) DO NOTHING;
  GET DIAGNOSTICS filing_count = ROW_COUNT;

  INSERT INTO securities (
    figi,
    issuer_name,
    primary_cusip,
    resolution_confidence,
    resolution_method
  )
  SELECT DISTINCT ON (nullif(figi, ''))
    nullif(figi, ''),
    name_of_issuer,
    upper(cusip),
    1.0000,
    'SEC_13F'
  FROM staging_13f_info
  WHERE nullif(figi, '') IS NOT NULL
  ORDER BY nullif(figi, ''), accession_number DESC
  ON CONFLICT (figi) DO UPDATE SET
    issuer_name = EXCLUDED.issuer_name,
    primary_cusip = coalesce(securities.primary_cusip, EXCLUDED.primary_cusip),
    updated_at = now();

  INSERT INTO cusip_map (
    cusip,
    security_id,
    figi,
    confidence,
    source,
    status,
    resolved_at
  )
  SELECT DISTINCT ON (upper(i.cusip))
    upper(i.cusip),
    s.security_id,
    s.figi,
    1.0000,
    'SEC_13F',
    'RESOLVED',
    now()
  FROM staging_13f_info i
  JOIN securities s ON s.figi = nullif(i.figi, '')
  WHERE nullif(i.figi, '') IS NOT NULL
  ORDER BY upper(i.cusip), i.accession_number DESC
  ON CONFLICT (cusip) DO UPDATE SET
    security_id = CASE
      WHEN cusip_map.is_manual_override OR cusip_map.status = 'RESOLVED'
      THEN cusip_map.security_id
      ELSE EXCLUDED.security_id
    END,
    figi = CASE
      WHEN cusip_map.is_manual_override OR cusip_map.status = 'RESOLVED'
      THEN cusip_map.figi
      ELSE EXCLUDED.figi
    END,
    confidence = CASE
      WHEN cusip_map.is_manual_override OR cusip_map.status = 'RESOLVED'
      THEN cusip_map.confidence
      ELSE EXCLUDED.confidence
    END,
    source = CASE
      WHEN cusip_map.is_manual_override OR cusip_map.status = 'RESOLVED'
      THEN cusip_map.source
      ELSE EXCLUDED.source
    END,
    status = 'RESOLVED',
    resolved_at = now(),
    updated_at = now();
  GET DIAGNOSTICS resolved_count = ROW_COUNT;

  INSERT INTO cusip_map (cusip)
  SELECT DISTINCT upper(cusip)
  FROM staging_13f_info
  WHERE nullif(cusip, '') IS NOT NULL
  ON CONFLICT (cusip) DO NOTHING;

  INSERT INTO holdings (
    accession_number,
    line_number,
    cusip,
    security_id,
    issuer_name_as_filed,
    title_of_class,
    value_as_filed,
    value_usd,
    shares,
    share_type,
    put_call,
    investment_discretion,
    voting_sole,
    voting_shared,
    voting_none,
    other_manager,
    as_filed_value
  )
  SELECT
    i.accession_number,
    row_number() OVER (
      PARTITION BY i.accession_number
      ORDER BY nullif(i.infotable_sk, '')::bigint NULLS LAST, i.cusip
    )::integer,
    upper(i.cusip),
    cm.security_id,
    i.name_of_issuer,
    nullif(i.title_of_class, ''),
    nullif(i.value, '')::numeric,
    nullif(i.value, '')::numeric,
    nullif(i.shares_or_principal_amount, '')::numeric,
    nullif(i.shares_or_principal_type, ''),
    nullif(i.put_call, ''),
    nullif(i.investment_discretion, ''),
    coalesce(nullif(i.voting_sole, '')::numeric, 0),
    coalesce(nullif(i.voting_shared, '')::numeric, 0),
    coalesce(nullif(i.voting_none, '')::numeric, 0),
    nullif(i.other_manager, ''),
    jsonb_build_object(
      'infotable_sk', nullif(i.infotable_sk, ''),
      'value_thousands', nullif(i.value, ''),
      'figi_as_filed', nullif(i.figi, '')
    )
  FROM staging_13f_info i
  JOIN filings f USING (accession_number)
  LEFT JOIN cusip_map cm ON cm.cusip = upper(i.cusip)
  ON CONFLICT (accession_number, line_number) DO NOTHING;
  GET DIAGNOSTICS holding_count = ROW_COUNT;

  UPDATE holdings h
  SET security_id = cm.security_id
  FROM cusip_map cm
  WHERE cm.cusip = h.cusip
    AND cm.status = 'RESOLVED'
    AND h.security_id IS DISTINCT FROM cm.security_id;

  INSERT INTO resolution_queue (cusip, priority_value_usd)
  SELECT
    h.cusip,
    sum(h.value_usd)
  FROM holdings h
  JOIN filings f USING (accession_number)
  LEFT JOIN cusip_map cm USING (cusip)
  WHERE f.raw_object_key = archive_object_key
    AND cm.status <> 'RESOLVED'
  GROUP BY h.cusip
  ON CONFLICT (cusip) DO UPDATE SET
    priority_value_usd = greatest(
      resolution_queue.priority_value_usd,
      EXCLUDED.priority_value_usd
    ),
    updated_at = now()
  WHERE resolution_queue.status <> 'RESOLVED';

  UPDATE managers m
  SET
    latest_13f_period = summary.period,
    latest_13f_filed_at = summary.filed_at,
    latest_reported_value_usd = summary.reported_value
  FROM (
    SELECT
      f.filer_cik,
      f.period_of_report AS period,
      max(f.filed_at) AS filed_at,
      sum(h.value_usd) AS reported_value,
      row_number() OVER (
        PARTITION BY f.filer_cik
        ORDER BY f.period_of_report DESC
      ) AS period_rank
    FROM filings f
    JOIN holdings h USING (accession_number)
    WHERE f.form_type IN ('13F-HR', '13F-HR/A')
    GROUP BY f.filer_cik, f.period_of_report
  ) summary
  WHERE summary.filer_cik = m.cik
    AND summary.period_rank = 1;

  RETURN QUERY SELECT filing_count, holding_count, resolved_count;
END;
$$;
