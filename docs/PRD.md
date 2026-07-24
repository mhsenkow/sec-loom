# SEC Loom — Product Requirements Document

**Weaving the threads of institutional and insider money into a defensible, narratable picture.**

- **Status:** Draft v1
- **Primary audience (of the product):** Analysts & journalists — precision, defensibility, exportability, citations
- **Owner:** msenkow@i2systems.com
- **Last updated:** 2026-07-24

---

## 1. Summary

SEC Loom turns raw SEC EDGAR filings — 13F institutional holdings and Form 3/4/5 insider transactions — into an interactive, cited, exportable analysis surface. The organizing question is *"what did the smart money buy, sell, and crowd into this quarter — and can I prove it?"*

For our audience (analysts, journalists), the product is not a hot-take machine. It is a **research instrument**: every number is traceable to a specific filing accession number, every derived metric is defined, and every view is exportable. AI accelerates the read (narrative briefs, natural-language query) but never replaces the citation.

### What makes it different
- **Diff-first, not snapshot-first.** The unit of value is *change* between quarters, precomputed and first-class.
- **Provenance on every cell.** Click any datapoint → the exact filing, accession number, and as-filed value.
- **Honest about lag & scope.** 13F is delayed and long-only; the UI treats this as a feature ("time machine" framing), never hides it.
- **AI as an analyst's assistant**, constrained to cited claims.

### Non-goals (v1)
- Real-time trading signals or alpha claims.
- Options, shorts, derivatives, international holdings (out of 13F scope).
- Portfolio management / brokerage integration.
- Social features, comments, user-generated content.

---

## 2. Data foundation

### 2.1 Sources (all free, `data.sec.gov` / EDGAR)

| Source | Form(s) | Cadence | Content | Access |
|---|---|---|---|---|
| Institutional holdings | 13F-HR, 13F-HR/A | Quarterly | Long US-listed equity positions (managers with >$100M discretionary AUM) | Bulk datasets + submissions API |
| Insider transactions | Form 3 / 4 / 5 | Event-driven (Form 4 within 2 business days) | Officer/director/10% owner trades | Full-text search + submissions API |
| Activist stakes | 13D / 13G | Event-driven | >5% beneficial ownership | Full-text search |
| Entity metadata | Submissions API | Continuous | CIK, names, former names, filing history | `data.sec.gov/submissions/CIK{...}.json` |

**Access rules (hard requirements):**
- Custom `User-Agent` header required (`Company Name admin@domain`).
- Politeness limit ≈ 10 requests/sec. Never hammer; we cache and batch.
- Prefer **bulk quarterly datasets** for 13F backfill over per-filing scraping.

### 2.2 The known traps (these shape the design — do not skip)

1. **The 45-day lag.** 13F must be filed within 45 days of quarter-end. "This quarter" in the UI is always the *most recently filed* quarter, which lags real positions. → **Design: prominent as-of date + "time machine" framing.**
2. **Long-only, US-listed only.** No shorts, cash, bonds, or foreign listings. A shrinking 13F does not mean bearishness. → **Design: explicit scope disclaimer; never imply net exposure.**
3. **Amendments restate.** 13F-HR/A can supersede or add. → **Design: always resolve to latest amendment per (manager, period); keep original for audit.**
4. **CUSIP → issuer/ticker mapping.** 13F identifies securities by CUSIP; the CUSIP *reference database* is licensed (CUSIP Global Services / S&P). This is **the hardest problem in the project.** → **Design: resolve *to FIGI* (the free, openly-licensed Bloomberg identifier) via OpenFIGI, not to raw CUSIP. Display FIGI/ticker/name; treat the CUSIP as a citation detail bound to its source filing (public record). See §4.** Plus a manual override table + confidence scoring for the tail.
5. **Insider noise.** Form 4 includes automatic 10b5-1 sales, option grants, tax-withholding dispositions. Open-market purchases (transaction code **P**) are the high-signal event. → **Design: default filter to code P open-market buys; expose transaction codes as facets.**
6. **Entity families.** One beneficial owner files under many CIKs (e.g., Berkshire's subsidiaries). → **Design: a curated "manager family" grouping layer above raw CIKs.**

### 2.3 Provenance model (non-negotiable for this audience)

Every stored fact carries: `source_accession_number`, `source_form_type`, `filed_at`, `period_of_report`, `as_filed_value`, `ingested_at`. Any derived value (diffs, rankings) stores the accession numbers of its inputs. The UI exposes a "cite" affordance on every datapoint.

---

## 3. Data model (Postgres)

Precompute-at-ingest is the guiding principle: the frontend renders, it never aggregates.

```
managers                      -- one row per CIK filer
  cik (pk), name, entity_type, first_seen, last_seen

manager_families              -- curated grouping (Buffett = many CIKs)
  family_id (pk), display_name, notes
manager_family_members
  family_id (fk), cik (fk)

securities                    -- resolved issuer universe (FIGI-first)
  security_id (pk), figi, ticker, issuer_name, primary_cusip,
  cik_issuer, sector, resolution_confidence, resolution_method
  -- figi/ticker/issuer_name are the DISPLAY identifiers (freely licensed);
  -- primary_cusip is stored as a citation/join detail only.

cusip_map                     -- raw CUSIP → security_id, with overrides
  cusip (pk), security_id (fk), figi, confidence,
  source (OPENFIGI|SEC_CIK|MANUAL|COMMERCIAL), is_manual_override

filings                       -- one row per accepted filing
  accession_number (pk), cik (fk), form_type, filed_at,
  period_of_report, is_amendment, amends_accession

holdings                      -- 13F line items (as filed)
  id (pk), accession_number (fk), cusip, security_id (fk, nullable until resolved),
  value_usd, shares, share_type, put_call, investment_discretion

holdings_resolved             -- latest-amendment view per (cik, period, security)
  cik, period_of_report, security_id, value_usd, shares, source_accession

holdings_diffs                -- PRECOMPUTED quarter-over-quarter deltas
  cik, security_id, period_curr, period_prev,
  action (NEW|ADD|TRIM|EXIT|HOLD),
  value_curr, value_prev, delta_value, delta_shares, pct_portfolio_curr

insider_txns                  -- Form 3/4/5 line items
  id (pk), accession_number (fk), issuer_cik, insider_cik, insider_name,
  role, txn_date, txn_code, shares, price, value_usd, is_open_market,
  ownership_after

consensus_metrics             -- PRECOMPUTED per (security, period)
  security_id, period, holder_count, net_flow_usd, new_positions, exits
```

Indexes on `(cik, period_of_report)`, `(security_id, period)`, `holdings_diffs(action, period_curr)`.

---

## 4. Ingestion pipeline

Scheduled (daily poll for new filings; full quarterly reconcile after 13F deadlines).

```
1. DISCOVER   Poll submissions API + full-text search for new accessions since last run.
2. FETCH      Download filing documents (rate-limited, cached to object storage — raw kept forever for audit).
3. PARSE      13F information tables (XML), Form 4 XML → normalized rows in `holdings` / `insider_txns`.
4. RESOLVE    CUSIP → FIGI/security_id via cusip_map, then OpenFIGI for cache misses; queue unresolved for the resolution service.
5. AMEND      Recompute `holdings_resolved` (latest amendment wins per manager/period/security).
6. DIFF       Recompute `holdings_diffs` and `consensus_metrics` for affected periods.
7. ENRICH     Generate AI narrative briefs for changed manager-periods (batch, cached).
8. PUBLISH    Materialize pre-aggregated JSON to the serving layer / edge cache.
```

**CUSIP resolution service — FIGI-first, free & legal (the hard part):** we resolve *to FIGI*, an openly-licensed identifier, and never depend on a licensed CUSIP database. Layered strategy, cheapest/most-authoritative first:
1. **Cache** — exact match against accumulated `cusip_map` (our own, grows over time).
2. **OpenFIGI API** — POST the CUSIP (`idType: ID_CUSIP`) → FIGI + ticker + name + exchange. Free, openly licensed output (storable & displayable), rate-limited (higher limits with a free API key). This is the primary resolver.
3. **SEC cross-reference** — validate/enrich ticker↔CIK↔sector against SEC `company_tickers.json` (public domain); catch names OpenFIGI missed via issuer CIK cited in 13D/13G/424B filings.
4. **LLM-assisted match** — issuer-name fuzzy matching for the residual tail, with a **confidence score**.
5. **Human override queue** — low-confidence / high-$-value unresolved positions.

Legal posture: CUSIPs are ingested from the public 13F filing (public record) and used as internal join keys + shown only as a citation detail bound to their source filing; **FIGI/ticker/name are the display identifiers**. Never publish a standalone bulk CUSIP↔ticker table. (Mechanics, not legal advice — confirm with counsel before a Phase 2 public launch.)

Unresolved positions are *shown as unresolved*, never silently dropped — analysts need to know coverage.

---

## 5. Serving & API

- **Edge API** (Cloudflare Workers) serving pre-aggregated JSON; no live EDGAR calls on the request path.
- Aggressive caching; data changes only at ingest boundaries.

Representative endpoints:
```
GET /managers?family=&sort=aum                    -> manager list + latest AUM
GET /managers/:cik/portfolio?period=              -> resolved holdings + diffs
GET /securities/:id/holders?period=               -> who holds it + consensus metrics
GET /diffs?period=&action=NEW&min_value=          -> the diff feed (Whale Grid source)
GET /consensus?period=&quadrant=contrarian        -> consensus/contrarian map data
GET /insiders?issuer=&code=P&since=               -> open-market insider buys
GET /cite/:accession                              -> filing provenance + EDGAR link
POST /query                                        -> natural-language → structured filter (AI)
```
All list endpoints support CSV/JSON/Excel export and carry an `as_of` date + coverage stats (% positions resolved).

---

## 6. The hero surfaces (3, disciplined)

For the analyst/journalist audience, each hero surface pairs a striking view with a **defensible drill-down**.

### 6.1 The Whale Grid (diff-first heatmap) — *primary surface*
- Rows = managers/families, columns = securities (or vice versa, transposable).
- Cell encodes current position size; **diff toggle** overlays action (NEW/ADD/TRIM/EXIT) with directional color.
- Sort/filter by AUM, sector, holder count, delta magnitude.
- Every cell → citation popover (accession, as-filed value, EDGAR link).
- **Export:** full grid to CSV/Excel with provenance columns.

### 6.2 The Conviction Flow (animated capital flow)
- Sankey/particle stream: manager → sector → security, scrubbable across quarters.
- Watch positions swell, drain, appear/exit over time.
- WebGL/canvas for scale; degrades to static Sankey for export/print.
- Serves the *narrative* need — the screenshot for the article.

### 6.3 The Consensus–Contrarian Map (2D conviction plane)
- X = holder count (crowding), Y = net $ flow this quarter, bubble = aggregate position size.
- Quadrants: crowded consensus / emerging consensus / lonely contrarian / crowded exits.
- Click a bubble → holders list + insider-buy overlay for the same issuer.

**Supporting surfaces:** per-manager "portfolio pulse" card (top adds/trims + AI brief); insider-buy ticker (code P default); a security detail page (holders over time + insider activity + citations).

---

## 7. AI layer (constrained, cited)

Ranked by value; all AI output links to source filings.

1. **Narrative briefs** — per manager-period: "what changed and the through-line," generated at ingest (batch, cached), each claim footnoted to accession numbers. *Killer feature — the data is dry, language makes it legible.*
2. **Natural-language query** — "stocks 3+ managers bought while insiders also bought" → structured filter over our own dataset (text-to-query, validated against schema, never free-form SQL to the DB).
3. **Entity resolution assist** — LLM-assisted issuer-name matching for the residual tail after OpenFIGI + SEC cross-reference, with confidence scoring (§4).
4. **Anomaly callouts** — statistical clustering surfaced as prompts ("unusual accumulation in [sector]"), always with the underlying data.
5. **Semantic search** over 13D/activist filings for thesis context.

**Guardrails:** no forward-looking / advice language; every generated sentence is traceable; a visible "AI-generated, verify against filings" label; briefs regenerate deterministically from the same inputs for auditability.

---

## 8. Trust, honesty & compliance UX

Because the audience is professional, credibility is the product:
- Persistent **as-of date** and **data-lag banner** on every quarter-scoped view.
- **Scope disclaimer** (long-only, US-listed, >$100M managers) one click from every 13F view.
- **Coverage indicator**: % of a portfolio's value successfully CUSIP-resolved.
- **Amendment transparency**: show when a value reflects a restatement.
- No "buy/sell recommendation" framing anywhere; the app describes what was *filed*, not what to *do*.

---

## 9. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Ingestion | Scheduled workers / job runner | Poll + batch reconcile |
| Raw storage | Object storage | Immutable audit copy of every filing |
| Database | Postgres | Relational integrity, diffs, provenance |
| Serving | Cloudflare Workers (edge) | Pre-aggregated JSON, global cache |
| Frontend | React + TypeScript | — |
| Dataviz | D3 (custom flows), deck.gl/PixiJS (particle scale), Framer Motion (UI) | Custom, performant, print-degradable |
| AI | Claude API | Briefs, text-to-query, resolution tail — batched at ingest where possible |
| Security resolution | OpenFIGI (free) + SEC `company_tickers.json` (public domain) | CUSIP→FIGI/ticker/name; no licensed CUSIP DB dependency |

**Performance principle:** precompute at ingest; the frontend never aggregates. Diffs, consensus metrics, and briefs are materialized before they're ever requested.

---

## 10. Roadmap

| Phase | Scope | Proves |
|---|---|---|
| **0 — Proof** | ~20 well-known managers, last 2 quarters, hardcoded CUSIP map for their holdings. Whale Grid diff view + citations only. | The "aha": diff-first + provenance is genuinely better than existing sites. |
| **1 — Narrative** | Conviction Flow, timeline scrub, AI narrative briefs, per-manager pulse cards. | The story layer + AI-with-citations. |
| **2 — Breadth** | Full 13F universe, full FIGI-first resolution service (OpenFIGI + SEC + LLM tail + overrides), insider-buy layer, NL query, export everywhere. | Scale + the research-tool completeness analysts need. |
| **3 — Depth** | Consensus/Contrarian map, 13D activist layer, saved searches, alerts, semantic search. | Differentiated analysis surfaces. |

---

## 11. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CUSIP resolution accuracy | Wrong data destroys analyst trust | FIGI-first (OpenFIGI) + SEC cross-ref + LLM tail + human override; confidence scores + visible coverage %; never silently drop |
| CUSIP display licensing | Legal exposure (esp. journalist republishing) | Display FIGI/ticker/name; show CUSIP only as citation detail bound to its source filing; no bulk CUSIP tables; counsel review pre-Phase-2 |
| "So what" gap (13F lag) | Perceived as non-actionable | Lean into narrative/research framing; time-machine UX; never imply alpha |
| EDGAR rate limits / outages | Ingest stalls | Bulk datasets, caching, immutable raw store, retry/backoff |
| AI hallucination | Fatal for this audience | Constrained, cited, deterministic briefs; verify-against-filings labeling |
| Scope creep | Never ships | 3-hero discipline; Phase 0 gate before expanding |
| Legal/compliance framing | Liability | Strict "as-filed, not advice" language; scope disclaimers |

---

## 12. Success metrics

- **Trust:** % of datapoints with one-click provenance = 100%; CUSIP resolution coverage ≥ 98% by value (Phase 2).
- **Utility:** exports per session; NL queries per session; return rate quarter-over-quarter (analysts work on the filing calendar).
- **Narrative reach:** shareable views / article embeds generated (journalist signal).
- **Correctness:** zero uncaught amendment-restatement errors; discrepancy reports vs. raw filings.

---

## 13. Open questions

1. ~~Securities master for CUSIP resolution — buy vs. bootstrap?~~ **Resolved: FIGI-first.** Resolve to FIGI via OpenFIGI (free, openly licensed) + SEC `company_tickers.json` cross-reference + LLM tail + override table; display FIGI/ticker/name, keep CUSIP as a citation detail. Consider a commercial securities master *only* at Phase 2, and only to (a) close the long tail and (b) obtain clean bulk-CUSIP rights if a use case ever needs them — not as the primary resolver. (Confirm display posture with counsel before public launch.)
2. How far back to backfill history (depth of "time machine")?
3. Manager-family curation — manual, or LLM-proposed + human-approved?
4. Export/embedding licensing — any redistribution constraints to respect for journalist embeds?
5. Free vs. paid tier boundary for the professional audience.
