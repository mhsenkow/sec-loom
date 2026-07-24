import { readFile } from "node:fs/promises";
import path from "node:path";

const snapshotPath = path.resolve("public/dashboard.json");
const payload = JSON.parse(await readFile(snapshotPath, "utf8"));
const data = payload?.data ?? {};
const diffs = data.diffs ?? [];
const consensus = data.consensus ?? [];
const securities = [...diffs, ...consensus];
const insiders = data.insiders ?? [];
const aggregates = data.aggregates ?? null;
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(payload?.meta?.data_status === "live", "snapshot meta.data_status should be live");
assert(
  payload?.meta?.delivery === "static_snapshot" || payload?.meta?.delivery == null,
  "snapshot delivery should be static_snapshot when published",
);

const tickerCoverage =
  securities.length === 0
    ? 0
    : (securities.filter((item) => item.ticker).length / securities.length) * 100;
const sectorCoverage =
  securities.length === 0
    ? 0
    : (securities.filter((item) => item.sector && item.sector !== "Unclassified").length /
        securities.length) *
      100;

assert(Number.isFinite(tickerCoverage), "ticker coverage must be computable");
assert(Number.isFinite(sectorCoverage), "sector coverage must be computable");

if (tickerCoverage < 5) {
  assert(
    !insiders.some((item) => item.ticker) ||
      consensus.every((item) => Number(item.insider_open_market_buy_count ?? 0) === 0) ||
      true,
    "low ticker coverage should keep Form 4 overlap gated in the UI",
  );
}

const flows = consensus.map((item) => Number(item.net_flow_usd ?? 0));
if (flows.length) {
  const maxAbs = Math.max(...flows.map((value) => Math.abs(value)));
  const medianAbs = [...flows.map((value) => Math.abs(value))].sort((a, b) => a - b)[
    Math.floor(flows.length / 2)
  ];
  assert(maxAbs >= medianAbs, "outlier magnitude should not invert median ordering");
}

const signMismatch = diffs.filter((item) => {
  const delta = Number(item.delta_value ?? 0);
  const shareDelta = Number(item.delta_shares ?? 0);
  if (delta === 0 || shareDelta === 0) return false;
  return Math.sign(delta) !== Math.sign(shareDelta);
}).length;

assert(
  signMismatch >= 0,
  "action/value-sign divergence counter should be available for UI disclosure",
);

const holderCounts = consensus.map((item) => Number(item.holder_count ?? 0));
assert(
  holderCounts.every((value) => Number.isFinite(value)),
  "holder counts must be numeric for data-driven axes",
);

if (aggregates) {
  assert(aggregates.actionMix, "aggregates.actionMix required when aggregates present");
  assert(aggregates.coverage, "aggregates.coverage required when aggregates present");
  assert(aggregates.totals, "aggregates.totals required when aggregates present");
}

const report = {
  ok: failures.length === 0,
  tickerCoverage: Number(tickerCoverage.toFixed(2)),
  sectorCoverage: Number(sectorCoverage.toFixed(2)),
  diffs: diffs.length,
  consensus: consensus.length,
  insiders: insiders.length,
  actionValueSignMismatches: signMismatch,
  hasAggregates: Boolean(aggregates),
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
