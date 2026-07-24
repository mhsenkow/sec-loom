import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const apiBase = process.env.SNAPSHOT_API_BASE ?? "http://127.0.0.1:8787";
const outPath = path.resolve("public/dashboard.json");

const response = await fetch(`${apiBase}/api/dashboard`, {
  headers: { Accept: "application/json" },
});

if (!response.ok) {
  throw new Error(`Failed to export dashboard snapshot: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
if (payload?.meta?.data_status !== "live" || !payload?.data) {
  throw new Error("Dashboard export did not return live data.");
}

payload.meta = {
  ...payload.meta,
  data_status: "live",
  delivery: "static_snapshot",
  note: "Synced SEC snapshot published with the site build. Not continuously refreshed until a live API is attached.",
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(payload));
console.log(`Wrote ${outPath} (${Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024)} KB)`);
