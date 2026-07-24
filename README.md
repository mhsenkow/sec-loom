# SEC Loom

A cited research terminal for exploring quarterly 13F changes and Form 4 insider activity. The current repository is a polished, interactive product proof built from `docs/PRD.md`.

## Included

- Whale Grid with action filters, position/delta toggle, transposition, and per-cell filing provenance
- Animated Conviction Flow with a quarterly playback scrubber
- Consensus–Contrarian map with security inspection and insider-buy overlays
- Manager pulse briefs, code-P insider wire, and constrained natural-language query surface
- Four tokenized visual themes: Night Grid, Blacksite, Solar Bloom, and Paper Terminal
- Responsive layout, reduced-motion handling, and keyboard-accessible controls
- Cloudflare Worker API scaffold with the representative PRD endpoints
- Postgres schema covering provenance, amendment-aware holdings, diffs, consensus, and CUSIP→FIGI resolution

The UI starts with clearly labeled demonstration data, then replaces it with SEC-backed data only when `/api/dashboard` reports `data_status: "live"`. It never relabels mock values as current.

## Data recency and semantics

- The latest complete institutional snapshot is Q1 2026 (holdings dated March 31, 2026). Q2 is intentionally excluded from cross-manager insights until its August 14 filing deadline.
- Forms 3/4/5 are discovered from SEC daily indexes. The verified local run is current through July 23, 2026; the July 24 index had not yet been published when tested.
- 13F is a delayed holdings disclosure, not a real-time trading feed. A manager can file up to 45 days after quarter end.
- Values are stored in current SEC units: filings submitted on or after January 3, 2023 report nearest-dollar values, not thousands.
- Quarter identity is canonicalized by CUSIP before computing diffs. FIGI is retained as identifier metadata and OpenFIGI fills unresolved mappings.
- Obvious as-filed quality anomalies are retained in raw storage but excluded from derived insights. Every displayed move keeps its input accession numbers.

The SEC warns that as-filed datasets can contain filer errors. “Live” in this app means continuously ingested and provenance-backed, not independently audited market truth.

## Run locally

```bash
npm install
npm run dev
```

Build and validate:

```bash
npm run typecheck
npm run lint
npm run build
```

Test the Worker and static app together:

```bash
npm run build
npm run worker:dev
```

For the live local stack:

```bash
cp .env.example .env
docker compose up -d --wait postgres
npm run db:migrate
npm run ingest:bootstrap
npm run worker:dev
# in a second terminal
npm run dev
```

`ingest:bootstrap` loads the two official SEC bulk archives needed for Q1 2026 quarter-over-quarter comparisons, catches up daily filings, resolves identifiers, and materializes diffs/consensus. Raw objects use `.data/raw` locally and R2 when R2 credentials are configured.

API routes are under `/api`, including `/api/managers`, `/api/diffs`, `/api/consensus`, `/api/insiders`, `/api/cite/:accession`, and `POST /api/query`.

## GitHub Pages

The static UI is published from `main` via `.github/workflows/pages.yml` at:

https://mhsenkow.github.io/sec-loom/

GitHub Pages cannot host Postgres or the Worker. The site loads synced SEC data from `public/dashboard.json` (exported from the local live API). Refresh the snapshot after ingestion:

```bash
npm run worker:dev
# in another terminal
npm run snapshot:export
git add public/dashboard.json && git commit -m "Refresh SEC dashboard snapshot" && git push
```

For continuously live data, attach Neon + Hyperdrive and set `VITE_API_BASE_URL` to the deployed Worker origin. Local `npm run build` still defaults to `/` for Worker hosting.

## Production deployment

1. Provision a managed Postgres database and apply `npm run db:migrate`.
2. Create the immutable archive bucket:

```bash
npx wrangler r2 bucket create sec-loom-raw
```

3. Configure the ingestion secrets from `.env.example` in the scheduled job. `.github/workflows/ingest.yml` runs the daily sync and supports a manual bootstrap.
4. Create Hyperdrive with the managed Postgres connection string, copy `wrangler.production.example.jsonc` to an ignored production config, and replace `<HYPERDRIVE_ID>`.
5. Deploy with that production config:

```bash
npm run build
npx wrangler deploy --config wrangler.production.jsonc
```

The edge API uses one `pg` client per request through Hyperdrive. If the binding is absent, it serves explicitly labeled demonstration data rather than silently presenting stale records as live.

Operational commands:

```bash
npm run ingest:daily
npm run ingest:resolve -- 5000
npm run ingest:recompute
npm run ingest:sync
```

Never put EDGAR calls, portfolio aggregation, or free-form SQL on the user request path.
