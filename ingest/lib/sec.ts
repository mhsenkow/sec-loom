import type { IngestConfig } from "../config";
import type { Logger } from "./logger";

export interface SecIndexEntry {
  cik: string;
  companyName: string;
  formType: string;
  filedDate: string;
  filename: string;
  accessionNumber: string;
}

interface FilingIndex {
  directory: {
    item: Array<{
      name: string;
      type: string;
      size?: string;
    }>;
  };
}

export class SecClient {
  private nextRequestAt = 0;

  constructor(
    private readonly config: IngestConfig,
    private readonly logger: Logger,
  ) {}

  async text(url: string, maxBytes = 25_000_000) {
    const response = await this.request(url);
    assertBounded(response, maxBytes);
    return response.text();
  }

  async bytes(url: string, maxBytes = 150_000_000) {
    const response = await this.request(url);
    assertBounded(response, maxBytes);
    return new Uint8Array(await response.arrayBuffer());
  }

  async json<T>(url: string, maxBytes = 25_000_000): Promise<T> {
    const response = await this.request(url);
    assertBounded(response, maxBytes);
    return response.json() as Promise<T>;
  }

  async latestDailyIndex(
    forms: ReadonlySet<string>,
    fromDate = new Date(),
  ): Promise<{ date: string; entries: SecIndexEntry[] }> {
    for (let daysBack = 0; daysBack < 10; daysBack += 1) {
      const candidate = new Date(fromDate);
      candidate.setUTCDate(candidate.getUTCDate() - daysBack);
      try {
        return await this.dailyIndex(candidate, forms);
      } catch (error) {
        if ((error as HttpError).status === 404) continue;
        throw error;
      }
    }
    throw new Error("No SEC daily master index was available in the last 10 days");
  }

  async dailyIndex(dateValue: Date, forms: ReadonlySet<string>) {
    const date = compactDate(dateValue);
    const quarter = Math.floor(dateValue.getUTCMonth() / 3) + 1;
    const url = `https://www.sec.gov/Archives/edgar/daily-index/${dateValue.getUTCFullYear()}/QTR${quarter}/master.${date}.idx`;
    const body = await this.text(url);
    return {
      date,
      entries: parseMasterIndex(body).filter((entry) => forms.has(entry.formType)),
    };
  }

  filingBaseUrl(cik: string, accessionNumber: string) {
    return `https://www.sec.gov/Archives/edgar/data/${stripLeadingZeros(cik)}/${accessionNumber.replaceAll("-", "")}`;
  }

  async filingIndex(cik: string, accessionNumber: string) {
    const baseUrl = this.filingBaseUrl(cik, accessionNumber);
    const index = await this.json<FilingIndex>(`${baseUrl}/index.json`);
    return { baseUrl, items: index.directory.item };
  }

  private async request(url: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.throttle();
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": this.config.SEC_USER_AGENT,
            "Accept-Encoding": "gzip, deflate",
            Accept: "application/json,text/plain,application/xml,text/xml,*/*",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) return response;
        const error = new HttpError(response.status, `${response.status} ${response.statusText} for ${url}`);
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
        const retryAfter = Number(response.headers.get("retry-after") ?? 0);
        await sleep(Math.max(retryAfter * 1_000, 500 * 2 ** attempt));
      } catch (error) {
        lastError = error;
        if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
          throw error;
        }
        this.logger.warn("sec_request_retry", {
          url,
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : "unknown",
        });
        await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`SEC request failed: ${url}`);
  }

  private async throttle() {
    const interval = 1_000 / this.config.SEC_MAX_REQUESTS_PER_SECOND;
    const now = Date.now();
    const wait = Math.max(0, this.nextRequestAt - now);
    this.nextRequestAt = Math.max(now, this.nextRequestAt) + interval;
    if (wait > 0) await sleep(wait);
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parseMasterIndex(body: string): SecIndexEntry[] {
  const divider = body.indexOf("--------------------------------------------------------------------------------");
  if (divider < 0) throw new Error("SEC master index divider was not found");
  return body
    .slice(divider)
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [cikRaw, companyName, formType, filedDate, filename] = line.split("|");
      const accessionNumber = filename?.match(/(\d{10}-\d{2}-\d{6})\.txt$/)?.[1];
      if (!cikRaw || !companyName || !formType || !filedDate || !filename || !accessionNumber) {
        return null;
      }
      return {
        cik: cikRaw.padStart(10, "0"),
        companyName,
        formType,
        filedDate,
        filename,
        accessionNumber,
      };
    })
    .filter((entry): entry is SecIndexEntry => entry !== null);
}

function assertBounded(response: Response, maxBytes: number) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} bytes: ${response.url}`);
  }
}

function compactDate(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function stripLeadingZeros(value: string) {
  return value.replace(/^0+/, "") || "0";
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
