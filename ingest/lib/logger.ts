type Level = "debug" | "info" | "warn" | "error";

const rank: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(minimum: Level) {
  const emit = (level: Level, event: string, details: Record<string, unknown> = {}) => {
    if (rank[level] < rank[minimum]) return;
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...details,
    });
    if (level === "error") console.error(entry);
    else if (level === "warn") console.warn(entry);
    else console.log(entry);
  };

  return {
    debug: (event: string, details?: Record<string, unknown>) => emit("debug", event, details),
    info: (event: string, details?: Record<string, unknown>) => emit("info", event, details),
    warn: (event: string, details?: Record<string, unknown>) => emit("warn", event, details),
    error: (event: string, details?: Record<string, unknown>) => emit("error", event, details),
  };
}

export type Logger = ReturnType<typeof createLogger>;
