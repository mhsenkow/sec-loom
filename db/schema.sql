CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE holding_action AS ENUM ('NEW', 'ADD', 'TRIM', 'EXIT', 'HOLD');
CREATE TYPE resolution_source AS ENUM ('SEC_13F', 'OPENFIGI', 'SEC_CIK', 'LLM_ASSISTED', 'MANUAL', 'COMMERCIAL');
CREATE TYPE resolution_status AS ENUM ('PENDING', 'RESOLVED', 'AMBIGUOUS', 'NOT_FOUND', 'ERROR');
CREATE TYPE ingestion_status AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL');

CREATE TABLE entities (
  cik text PRIMARY KEY CHECK (cik ~ '^[0-9]{10}$'),
  name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'UNKNOWN',
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE managers (
  cik text PRIMARY KEY REFERENCES entities(cik),
  latest_13f_period date,
  latest_13f_filed_at timestamptz,
  latest_reported_value_usd numeric(24,2),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE manager_families (
  family_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  notes text,
  reviewed_at timestamptz
);

CREATE TABLE manager_family_members (
  family_id uuid NOT NULL REFERENCES manager_families(family_id) ON DELETE CASCADE,
  cik text NOT NULL REFERENCES managers(cik) ON DELETE CASCADE,
  PRIMARY KEY (family_id, cik)
);

CREATE TABLE securities (
  security_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  figi text UNIQUE,
  composite_figi text,
  ticker text,
  issuer_name text NOT NULL,
  primary_cusip text,
  issuer_cik text REFERENCES entities(cik),
  exchange_code text,
  security_type text,
  sector text,
  resolution_confidence numeric(5,4) CHECK (resolution_confidence BETWEEN 0 AND 1),
  resolution_method resolution_source,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cusip_map (
  cusip text PRIMARY KEY CHECK (cusip ~ '^[0-9A-Z*@#]{8,9}$'),
  security_id uuid REFERENCES securities(security_id),
  figi text,
  confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  source resolution_source,
  status resolution_status NOT NULL DEFAULT 'PENDING',
  is_manual_override boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  raw_response jsonb,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE filings (
  accession_number text PRIMARY KEY,
  filer_cik text NOT NULL REFERENCES entities(cik),
  form_type text NOT NULL,
  filed_at timestamptz NOT NULL,
  period_of_report date,
  primary_document text,
  is_amendment boolean NOT NULL DEFAULT false,
  amendment_number integer,
  amendment_type text,
  amends_accession text REFERENCES filings(accession_number),
  raw_object_key text NOT NULL,
  source_url text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE filing_documents (
  accession_number text NOT NULL REFERENCES filings(accession_number) ON DELETE CASCADE,
  sequence integer NOT NULL,
  filename text NOT NULL,
  document_type text,
  description text,
  object_key text NOT NULL,
  content_type text,
  byte_size bigint,
  sha256 text,
  PRIMARY KEY (accession_number, sequence)
);

CREATE TABLE holdings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accession_number text NOT NULL REFERENCES filings(accession_number) ON DELETE CASCADE,
  line_number integer NOT NULL,
  cusip text NOT NULL,
  security_id uuid REFERENCES securities(security_id),
  issuer_name_as_filed text NOT NULL,
  title_of_class text,
  value_as_filed_thousands numeric(22,2) NOT NULL,
  value_usd numeric(24,2) NOT NULL,
  shares numeric(26,4) NOT NULL,
  share_type text,
  put_call text,
  investment_discretion text,
  voting_sole numeric(26,4),
  voting_shared numeric(26,4),
  voting_none numeric(26,4),
  other_manager text,
  as_filed_value jsonb NOT NULL,
  UNIQUE (accession_number, line_number)
);

CREATE TABLE holdings_resolved (
  cik text NOT NULL REFERENCES managers(cik),
  period_of_report date NOT NULL,
  security_id uuid NOT NULL REFERENCES securities(security_id),
  cusip text NOT NULL,
  issuer_name_as_filed text NOT NULL,
  value_usd numeric(24,2) NOT NULL,
  shares numeric(26,4) NOT NULL,
  source_accessions text[] NOT NULL CHECK (cardinality(source_accessions) > 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cik, period_of_report, security_id)
);

CREATE TABLE holdings_diffs (
  cik text NOT NULL REFERENCES managers(cik),
  security_id uuid NOT NULL REFERENCES securities(security_id),
  period_curr date NOT NULL,
  period_prev date NOT NULL,
  action holding_action NOT NULL,
  value_curr numeric(24,2) NOT NULL,
  value_prev numeric(24,2) NOT NULL,
  delta_value numeric(24,2) NOT NULL,
  shares_curr numeric(26,4) NOT NULL,
  shares_prev numeric(26,4) NOT NULL,
  delta_shares numeric(26,4) NOT NULL,
  pct_portfolio_curr numeric(12,8),
  input_accessions text[] NOT NULL CHECK (cardinality(input_accessions) > 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cik, security_id, period_curr)
);

CREATE TABLE insider_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accession_number text NOT NULL REFERENCES filings(accession_number) ON DELETE CASCADE,
  transaction_index integer NOT NULL,
  issuer_cik text NOT NULL REFERENCES entities(cik),
  insider_cik text REFERENCES entities(cik),
  insider_name text NOT NULL,
  role text,
  is_director boolean NOT NULL DEFAULT false,
  is_officer boolean NOT NULL DEFAULT false,
  is_ten_percent_owner boolean NOT NULL DEFAULT false,
  officer_title text,
  transaction_date date NOT NULL,
  transaction_code text NOT NULL,
  shares numeric(26,4),
  price numeric(20,6),
  value_usd numeric(24,2),
  acquired_disposed text,
  ownership_after numeric(26,4),
  ownership_nature text,
  is_open_market boolean NOT NULL,
  is_10b5_1 boolean,
  security_title text,
  footnotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  as_filed_value jsonb NOT NULL,
  UNIQUE (accession_number, transaction_index)
);

CREATE TABLE consensus_metrics (
  security_id uuid NOT NULL REFERENCES securities(security_id),
  period date NOT NULL,
  holder_count integer NOT NULL,
  net_flow_usd numeric(24,2) NOT NULL,
  new_positions integer NOT NULL,
  exits integer NOT NULL,
  aggregate_value_usd numeric(24,2) NOT NULL,
  insider_open_market_buy_count integer NOT NULL DEFAULT 0,
  insider_open_market_buy_value_usd numeric(24,2) NOT NULL DEFAULT 0,
  input_accessions text[] NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (security_id, period)
);

CREATE TABLE ingestion_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  source text NOT NULL,
  status ingestion_status NOT NULL DEFAULT 'RUNNING',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  discovered_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  error_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ingestion_checkpoints (
  source text PRIMARY KEY,
  cursor_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE resolution_queue (
  cusip text PRIMARY KEY REFERENCES cusip_map(cusip) ON DELETE CASCADE,
  priority_value_usd numeric(24,2) NOT NULL DEFAULT 0,
  status resolution_status NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_freshness (
  dataset text PRIMARY KEY,
  source_max_filed_at timestamptz,
  period_of_report date,
  last_ingested_at timestamptz,
  record_count bigint NOT NULL DEFAULT 0,
  coverage_pct numeric(7,4),
  status text NOT NULL DEFAULT 'STALE',
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNLOGGED TABLE staging_13f_submission (
  accession_number text,
  filing_date text,
  submission_type text,
  cik text,
  period_of_report text
);

CREATE UNLOGGED TABLE staging_13f_cover (
  accession_number text,
  report_calendar_or_quarter text,
  is_amendment text,
  amendment_no text,
  amendment_type text,
  conf_denied_expired text,
  date_denied_expired text,
  date_reported text,
  reason_for_non_confidentiality text,
  filing_manager_name text,
  filing_manager_street1 text,
  filing_manager_street2 text,
  filing_manager_city text,
  filing_manager_state_or_country text,
  filing_manager_zipcode text,
  report_type text,
  form13f_file_number text,
  crd_number text,
  sec_file_number text,
  provide_info_for_instruction5 text,
  additional_information text
);

CREATE UNLOGGED TABLE staging_13f_info (
  accession_number text,
  infotable_sk text,
  name_of_issuer text,
  title_of_class text,
  cusip text,
  figi text,
  value text,
  shares_or_principal_amount text,
  shares_or_principal_type text,
  put_call text,
  investment_discretion text,
  other_manager text,
  voting_sole text,
  voting_shared text,
  voting_none text
);

CREATE INDEX filings_filer_period_idx ON filings (filer_cik, period_of_report, filed_at DESC);
CREATE INDEX filings_form_filed_idx ON filings (form_type, filed_at DESC);
CREATE INDEX holdings_cusip_idx ON holdings (cusip);
CREATE INDEX holdings_security_idx ON holdings (security_id);
CREATE INDEX holdings_accession_idx ON holdings (accession_number);
CREATE INDEX resolved_security_period_idx ON holdings_resolved (security_id, period_of_report);
CREATE INDEX diffs_action_period_idx ON holdings_diffs (action, period_curr);
CREATE INDEX diffs_security_period_idx ON holdings_diffs (security_id, period_curr);
CREATE INDEX insider_issuer_date_idx ON insider_transactions (issuer_cik, transaction_date DESC);
CREATE INDEX insider_open_market_idx ON insider_transactions (transaction_date DESC) WHERE is_open_market;
CREATE INDEX resolution_queue_ready_idx ON resolution_queue (priority_value_usd DESC, next_attempt_at) WHERE status IN ('PENDING', 'ERROR');

