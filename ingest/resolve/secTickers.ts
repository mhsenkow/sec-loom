import type pg from "pg";
import type { Logger } from "../lib/logger";
import type { SecClient } from "../lib/sec";

interface SecTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SecurityRow {
  security_id: string;
  ticker: string | null;
  issuer_name: string;
  figi: string | null;
  primary_cusip: string | null;
  issuer_cik: string | null;
}

interface MatchCandidate {
  entry: SecTickerEntry;
  score: number;
  method: "TICKER" | "NAME";
}

interface IndexedEntry {
  entry: SecTickerEntry;
  tokenSet: Set<string>;
  normalized: string;
}

const NAME_MATCH_THRESHOLD = 0.72;
const TICKER_MATCH_THRESHOLD = 0.45;

export async function enrichWithSecTickers(
  pool: pg.Pool,
  sec: SecClient,
  logger: Logger,
) {
  const payload = await sec.json<Record<string, SecTickerEntry>>(
    "https://www.sec.gov/files/company_tickers.json",
  );
  const entries = Object.values(payload);
  const byTicker = new Map(
    entries.map((entry) => [entry.ticker.toUpperCase(), entry]),
  );

  const indexed: IndexedEntry[] = [];
  const byNormalizedTitle = new Map<string, SecTickerEntry[]>();
  const inverted = new Map<string, IndexedEntry[]>();

  for (const entry of entries) {
    const tokenSet = tokens(entry.title);
    const normalized = [...tokenSet].sort().join(" ");
    const item: IndexedEntry = { entry, tokenSet, normalized };
    indexed.push(item);
    if (normalized) {
      const bucket = byNormalizedTitle.get(normalized) ?? [];
      bucket.push(entry);
      byNormalizedTitle.set(normalized, bucket);
    }
    for (const token of tokenSet) {
      const posting = inverted.get(token) ?? [];
      posting.push(item);
      inverted.set(token, posting);
    }
  }

  const securities = await pool.query<SecurityRow>(
    `
      SELECT security_id, ticker, issuer_name, figi, primary_cusip, issuer_cik
      FROM securities
      WHERE issuer_cik IS NULL
         OR ticker IS NULL
    `,
  );

  let matched = 0;
  let tickerFilled = 0;
  for (const security of securities.rows) {
    const candidate = chooseCandidate(
      security,
      byTicker,
      byNormalizedTitle,
      inverted,
    );
    if (!candidate) continue;

    const cik = String(candidate.entry.cik_str).padStart(10, "0");
    const confidence =
      candidate.method === "TICKER"
        ? Math.min(0.93, 0.55 + candidate.score * 0.4)
        : Math.min(0.88, 0.5 + candidate.score * 0.35);
    const nextTicker = security.ticker ?? candidate.entry.ticker.toUpperCase();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO entities (cik, name, entity_type)
          VALUES ($1, $2, 'ISSUER')
          ON CONFLICT (cik) DO UPDATE SET
            name = EXCLUDED.name,
            last_seen = now()
        `,
        [cik, candidate.entry.title],
      );
      await client.query(
        `
          UPDATE securities
          SET
            issuer_cik = coalesce(issuer_cik, $2),
            ticker = coalesce(ticker, $3),
            resolution_confidence = greatest(coalesce(resolution_confidence, 0), $4),
            resolution_method = coalesce(resolution_method, 'SEC_CIK'),
            updated_at = now()
          WHERE security_id = $1
        `,
        [security.security_id, cik, nextTicker, confidence],
      );
      await client.query("COMMIT");
      matched += 1;
      if (!security.ticker && nextTicker) tickerFilled += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  logger.info("sec_ticker_enrichment_complete", {
    candidates: securities.rowCount,
    matched,
    tickerFilled,
  });
  return matched;
}

function chooseCandidate(
  security: SecurityRow,
  byTicker: Map<string, SecTickerEntry>,
  byNormalizedTitle: Map<string, SecTickerEntry[]>,
  inverted: Map<string, IndexedEntry[]>,
): MatchCandidate | null {
  if (security.ticker) {
    const entry = byTicker.get(security.ticker.toUpperCase());
    if (entry) {
      const score = nameSimilarity(tokens(entry.title), tokens(security.issuer_name));
      if (score >= TICKER_MATCH_THRESHOLD) {
        return { entry, score, method: "TICKER" };
      }
    }
  }

  const issuerTokens = tokens(security.issuer_name);
  if (!issuerTokens.size) return null;
  const normalizedIssuer = [...issuerTokens].sort().join(" ");

  const exact = byNormalizedTitle.get(normalizedIssuer) ?? [];
  if (exact.length) {
    const uniqueCiks = new Set(exact.map((entry) => entry.cik_str));
    if (uniqueCiks.size === 1) {
      return { entry: preferShareClass(exact), score: 1, method: "NAME" };
    }
  }

  const candidates = new Map<string, IndexedEntry>();
  for (const token of issuerTokens) {
    for (const item of inverted.get(token) ?? []) {
      candidates.set(item.entry.ticker, item);
    }
  }

  const scored: MatchCandidate[] = [];
  for (const item of candidates.values()) {
    const score = nameSimilarity(item.tokenSet, issuerTokens);
    if (score < NAME_MATCH_THRESHOLD) continue;
    scored.push({ entry: item.entry, score, method: "NAME" });
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return null;

  const bestScore = scored[0].score;
  const near = scored.filter((item) => item.score >= bestScore - 0.02);
  const uniqueCiks = new Set(near.map((item) => item.entry.cik_str));
  // Allow BRK-A/BRK-B style collisions when they resolve to one issuer CIK.
  if (uniqueCiks.size !== 1) return null;
  return {
    entry: preferShareClass(near.map((item) => item.entry)),
    score: bestScore,
    method: "NAME",
  };
}

function preferShareClass(entries: SecTickerEntry[]) {
  const preferred = entries.find((entry) => /-(B|C)$/i.test(entry.ticker))
    ?? entries.find((entry) => !/-A$/i.test(entry.ticker))
    ?? entries[0];
  return preferred;
}

function nameSimilarity(leftTokens: Set<string>, rightTokens: Set<string>) {
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = intersection / Math.max(union, 1);
  const coverage =
    intersection / Math.max(Math.min(leftTokens.size, rightTokens.size), 1);
  return jaccard * 0.55 + coverage * 0.45;
}

function tokens(value: string) {
  const ignored = new Set([
    "inc",
    "corp",
    "corporation",
    "company",
    "co",
    "plc",
    "ltd",
    "class",
    "com",
    "common",
    "ordinary",
    "shares",
    "the",
    "and",
    "of",
    "del",
    "lp",
    "llc",
  ]);
  return new Set(
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !ignored.has(token)),
  );
}
