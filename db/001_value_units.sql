DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'holdings'
      AND column_name = 'value_as_filed_thousands'
  ) THEN
    ALTER TABLE holdings
      RENAME COLUMN value_as_filed_thousands TO value_as_filed;
  END IF;
END;
$$;

ALTER TABLE holdings
  ALTER COLUMN value_as_filed TYPE numeric(24,2);

UPDATE holdings h
SET value_usd = h.value_as_filed
FROM filings f
WHERE f.accession_number = h.accession_number
  AND f.filed_at >= date '2023-01-03'
  AND h.value_usd <> h.value_as_filed;
