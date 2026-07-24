import { z } from "zod";

const environmentSchema = z.object({
  SEC_USER_AGENT: z.string().min(8).refine((value) => value.includes("@"), {
    message: "SEC_USER_AGENT must include a monitored email address",
  }),
  DATABASE_URL: z.string().url(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("sec-loom-raw"),
  OPENFIGI_API_KEY: z.string().optional(),
  SEC_MAX_REQUESTS_PER_SECOND: z.coerce.number().min(1).max(10).default(8),
  INGEST_CONCURRENCY: z.coerce.number().min(1).max(12).default(4),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type IngestConfig = z.infer<typeof environmentSchema> & {
  r2Configured: boolean;
};

export function loadConfig(): IngestConfig {
  const parsed = environmentSchema.parse(process.env);
  const r2Values = [
    parsed.R2_ACCOUNT_ID,
    parsed.R2_ACCESS_KEY_ID,
    parsed.R2_SECRET_ACCESS_KEY,
  ];
  const configuredCount = r2Values.filter(Boolean).length;
  if (configuredCount > 0 && configuredCount < r2Values.length) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must be configured together",
    );
  }
  return { ...parsed, r2Configured: configuredCount === r2Values.length };
}
