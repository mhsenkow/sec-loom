import {
  handleDatabaseRequest,
  type DatabaseEnv,
} from "./database";

type JsonRecord = Record<string, unknown>;

const demoManagers = [
  { cik: "0001067983", name: "Berkshire Hathaway", family: "Berkshire", aum_usd_m: 267331, coverage_pct: 99.8 },
  { cik: "0001350694", name: "Bridgewater Associates", family: "Bridgewater", aum_usd_m: 21839, coverage_pct: 98.9 },
  { cik: "0001649339", name: "Citadel Advisors", family: "Citadel", aum_usd_m: 571824, coverage_pct: 97.6 },
];

const demoDiffs = [
  { cik: "0001067983", security_id: "amzn", ticker: "AMZN", action: "ADD", value_curr: 2210, value_prev: 1830, delta_value: 380, source_accession: "0001193125-25-118742" },
  { cik: "0001350694", security_id: "nvda", ticker: "NVDA", action: "NEW", value_curr: 984, value_prev: 0, delta_value: 984, source_accession: "0001350694-25-000006" },
  { cik: "0001649339", security_id: "googl", ticker: "GOOGL", action: "ADD", value_curr: 4320, value_prev: 3710, delta_value: 610, source_accession: "0000950123-25-007934" },
  { cik: "0001067983", security_id: "aapl", ticker: "AAPL", action: "TRIM", value_curr: 68540, value_prev: 75200, delta_value: -6660, source_accession: "0001193125-25-118742" },
];

const demoSecurities = [
  { id: "amzn", ticker: "AMZN", issuer_name: "Amazon.com Inc.", figi: "BBG000BVPV84", holder_count: 15, net_flow_usd_m: 2920, aggregate_value_usd_m: 22700 },
  { id: "nvda", ticker: "NVDA", issuer_name: "NVIDIA Corp.", figi: "BBG000BBJQV0", holder_count: 19, net_flow_usd_m: 6480, aggregate_value_usd_m: 28900 },
  { id: "googl", ticker: "GOOGL", issuer_name: "Alphabet Inc.", figi: "BBG009S39JX6", holder_count: 17, net_flow_usd_m: 3210, aggregate_value_usd_m: 25600 },
];

const apiHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...apiHeaders, ...init.headers },
  });
}

function envelope(data: unknown, extra: JsonRecord = {}) {
  return {
    data,
    meta: {
      as_of: "2025-05-15",
      period: "2025-Q1",
      coverage_pct: 98.6,
      data_status: "demonstration",
      scope: "Long US-listed 13F positions; delayed up to 45 days.",
      ...extra,
    },
  };
}

function notFound(pathname: string) {
  return json(
    { error: { code: "not_found", message: `No SEC Loom endpoint matches ${pathname}` } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function accessionPayload(accession: string) {
  const filing = demoDiffs.find((diff) => diff.source_accession === accession);
  if (!filing) return null;
  const cik = filing.cik.replace(/^0+/, "");
  return {
    accession_number: accession,
    cik: filing.cik,
    form_type: accession === "0001193125-25-118742" ? "13F-HR/A" : "13F-HR",
    filed_at: "2025-05-15",
    period_of_report: "2025-03-31",
    edgar_url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/`,
  };
}

function parseQuery(input: string) {
  const normalized = input.toLowerCase();
  return {
    min_manager_count: normalized.match(/(\d+)\+?\s+managers?/)?.[1]
      ? Number(normalized.match(/(\d+)\+?\s+managers?/)?.[1])
      : undefined,
    actions: normalized.includes("bought") || normalized.includes("added") ? ["NEW", "ADD"] : undefined,
    insider_code: normalized.includes("insider") ? "P" : undefined,
    period: "2025-Q1",
  };
}

async function handleApi(request: Request, env: DatabaseEnv, url: URL) {
  const pathname = url.pathname.replace(/^\/api/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders });
  const databasePayload = await handleDatabaseRequest(request, env, url);
  if (databasePayload) {
    return json(
      { data: databasePayload.data, meta: databasePayload.meta },
      { status: databasePayload.status ?? 200 },
    );
  }
  if (pathname === "/health") return json({ ok: true, service: "sec-loom-edge", data_status: "demonstration" });
  if (pathname === "/freshness") {
    return json(envelope([
      {
        dataset: "13F",
        source_max_filed_at: "2025-05-15",
        period_of_report: "2025-03-31",
        last_ingested_at: null,
        status: "DEMONSTRATION",
      },
    ]));
  }

  if (request.method === "GET" && pathname === "/managers") {
    return json(envelope([...demoManagers].sort((a, b) => b.aum_usd_m - a.aum_usd_m)));
  }

  const managerMatch = pathname.match(/^\/managers\/(\d+)\/portfolio$/);
  if (request.method === "GET" && managerMatch) {
    const manager = demoManagers.find((item) => item.cik === managerMatch[1]);
    if (!manager) return notFound(pathname);
    return json(envelope({ manager, holdings: demoDiffs.filter((diff) => diff.cik === manager.cik) }));
  }

  const securityMatch = pathname.match(/^\/securities\/([\w-]+)\/holders$/);
  if (request.method === "GET" && securityMatch) {
    const security = demoSecurities.find((item) => item.id === securityMatch[1]);
    if (!security) return notFound(pathname);
    return json(envelope({ security, holders: demoDiffs.filter((diff) => diff.security_id === security.id) }));
  }

  if (request.method === "GET" && pathname === "/diffs") {
    const action = url.searchParams.get("action");
    const minValue = Number(url.searchParams.get("min_value") ?? 0);
    const rows = demoDiffs.filter((diff) => (!action || diff.action === action) && Math.abs(diff.delta_value) >= minValue);
    return json(envelope(rows, { result_count: rows.length }));
  }

  if (request.method === "GET" && pathname === "/consensus") {
    return json(envelope(demoSecurities));
  }

  if (request.method === "GET" && pathname === "/insiders") {
    return json(envelope([
      { ticker: "AMZN", insider_name: "Douglas Herrington", role: "CEO, Worldwide Stores", txn_code: "P", value_usd: 1240000, txn_date: "2025-05-09", source_accession: "0001018724-25-000071" },
      { ticker: "UNH", insider_name: "Stephen Hemsley", role: "Board Chair", txn_code: "P", value_usd: 5020000, txn_date: "2025-05-16", source_accession: "0000731766-25-000143" },
    ]));
  }

  const citeMatch = pathname.match(/^\/cite\/([\d-]+)$/);
  if (request.method === "GET" && citeMatch) {
    const citation = accessionPayload(citeMatch[1]);
    return citation ? json(envelope(citation)) : notFound(pathname);
  }

  if (request.method === "POST" && pathname === "/query") {
    const body = await request.json<{ query?: unknown }>().catch(() => null);
    if (!body || typeof body.query !== "string" || body.query.trim().length < 3) {
      return json(
        { error: { code: "invalid_query", message: "Provide a query string with at least 3 characters." } },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const filters = parseQuery(body.query);
    const results = demoSecurities.filter((security) =>
      (!filters.min_manager_count || security.holder_count >= filters.min_manager_count) &&
      (!filters.insider_code || security.ticker === "AMZN"),
    );
    return json(envelope({ query: body.query, filters, results }, { ai_generated: true, verify_against_filings: true }));
  }

  return notFound(pathname);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({
        event: "request_error",
        path: url.pathname,
        method: request.method,
        message: error instanceof Error ? error.message : "unknown error",
      }));
      return json(
        { error: { code: "internal_error", message: "The request could not be completed." } },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }
  },
} satisfies ExportedHandler<DatabaseEnv>;
