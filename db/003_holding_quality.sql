CREATE TABLE holding_quality_flags (
  holding_id bigint NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  flag_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'EXCLUDED')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (holding_id, flag_code)
);

CREATE INDEX holding_quality_severity_idx
  ON holding_quality_flags (severity, flag_code);
