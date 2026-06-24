/**
 * HTTP runtime client for the ZooData SDK.
 *
 * Responsibilities:
 *  - inject Authorization: Bearer <apiKey> on every request
 *  - serialize POST bodies as JSON
 *  - on 4xx (except 429), throw the typed exception immediately
 *  - on 504, throw UpstreamTimeoutError immediately (no retry — upstream
 *    has its own circuit breaker)
 *  - on 429 / non-504 5xx, retry with exponential backoff + jitter,
 *    honoring Retry-After for 429
 *  - rate-limit aware: when the last response said X-RateLimit-Remaining: 0,
 *    delay the next request until X-RateLimit-Reset
 *
 * Endpoint wrappers (in src/generated/) build on top of this; this layer
 * stays endpoint-agnostic.
 */
import { errorFromResponse, type ErrorBody } from "./errors";

export interface RetryOptions {
  attempts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  retry?: RetryOptions;
}

export interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

const DEFAULT_BASE_URL = "https://api.zoodata.ai/openapi/v2";
const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  backoffMs: 200,
  maxBackoffMs: 30_000,
};
const MAX_THROTTLE_WAIT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly retry: Required<RetryOptions>;
  private throttleRemaining: number | null = null;
  private throttleResetUnix: number | null = null;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.retry = { ...DEFAULT_RETRY, ...opts.retry };
  }

  async request<T = unknown>(req: RequestOptions): Promise<T> {
    await this.applyThrottle();

    const url = this.buildUrl(req.path, req.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (req.body !== undefined) headers["Content-Type"] = "application/json";

    let lastError: unknown;
    for (let attempt = 0; attempt < this.retry.attempts; attempt++) {
      const init: RequestInit = { method: req.method, headers };
      if (req.body !== undefined) init.body = JSON.stringify(req.body);

      const response = await fetch(url, init);
      this.recordThrottleState(response);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const errorBody = (await response.json().catch(() => undefined)) as ErrorBody | undefined;
      const err = errorFromResponse(response, errorBody);

      const isLastAttempt = attempt === this.retry.attempts - 1;
      const retryable = isRetryableStatus(response.status);
      if (!retryable || isLastAttempt) {
        throw err;
      }

      lastError = err;
      const waitMs = this.computeBackoff(response, attempt);
      if (waitMs > 0) await sleep(waitMs);
    }

    // Defensive: loop always either returns or throws. Re-throw last seen.
    throw lastError ?? new Error("HttpClient: exhausted retries without an error");
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    let url = `${this.baseUrl}${normalizedPath}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }

  private recordThrottleState(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining !== null) {
      const n = Number.parseInt(remaining, 10);
      if (Number.isFinite(n)) this.throttleRemaining = n;
    }
    const reset = response.headers.get("x-ratelimit-reset");
    if (reset !== null) {
      const n = Number.parseInt(reset, 10);
      if (Number.isFinite(n)) this.throttleResetUnix = n;
    }
  }

  private async applyThrottle(): Promise<void> {
    if (this.throttleRemaining !== 0 || this.throttleResetUnix === null) return;
    const nowSec = Date.now() / 1000;
    if (nowSec >= this.throttleResetUnix) return;
    const waitMs = Math.min((this.throttleResetUnix - nowSec) * 1000, MAX_THROTTLE_WAIT_MS);
    if (waitMs > 0) await sleep(waitMs);
  }

  private computeBackoff(response: Response, attempt: number): number {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter !== null) {
        const seconds = Number.parseInt(retryAfter, 10);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
      }
    }
    const base = this.retry.backoffMs * 2 ** attempt;
    const jitter = Math.random() * this.retry.backoffMs;
    return Math.min(base + jitter, this.retry.maxBackoffMs);
  }
}

function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;
  if (status === 504) return false; // upstream circuit breaker; do not pile on
  return status >= 500 && status < 600;
}
