/**
 * Failing tests for the HTTP runtime client.
 *
 * Contract:
 *  - constructor accepts { apiKey, baseUrl?, retry? }; defaults to prod base.
 *  - request<T>({ method, path, body?, query? }) returns parsed JSON on 2xx.
 *  - injects `Authorization: Bearer <apiKey>` on every request.
 *  - on 4xx (except 429), throws the typed exception from errors.ts WITHOUT retry.
 *  - on 429/5xx, retries up to N times with exponential backoff + jitter.
 *  - respects Retry-After (seconds) for 429 retry delay.
 *  - reads X-RateLimit-Remaining + X-RateLimit-Reset and throttles when 0.
 */
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse, delay } from "msw";

import { server } from "./test-setup";
import { HttpClient } from "./client";
import {
  UnauthorizedError,
  InsufficientCreditsError,
  RateLimitError,
  ValidationError,
  UpstreamTimeoutError,
  ZooDataError,
} from "./errors";

const BASE = "https://api.example.test/openapi/v2";

function envelope(data: unknown) {
  return {
    success: true,
    data,
    meta: { requestId: "req_test", timestamp: "2026-01-01T00:00:00Z" },
  };
}

function errEnvelope(code: string, message: string, requestId = "req_test") {
  return { success: false, error: { code, message }, meta: { requestId } };
}

function makeClient(overrides: Partial<{ baseUrl: string; retry: { attempts: number; backoffMs: number; maxBackoffMs: number } }> = {}) {
  return new HttpClient({
    apiKey: "hms_test_key",
    baseUrl: BASE,
    retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 5 },
    ...overrides,
  });
}

describe("HttpClient — request shape", () => {
  it("sends Authorization: Bearer <apiKey>", async () => {
    let captured: string | null = null;
    server.use(
      http.post(`${BASE}/products/search`, ({ request }) => {
        captured = request.headers.get("authorization");
        return HttpResponse.json(envelope({ items: [] }));
      }),
    );
    const client = makeClient();
    await client.request({ method: "POST", path: "/products/search", body: { keyword: "x" } });
    expect(captured).toBe("Bearer hms_test_key");
  });

  it("POST body is serialized as JSON with Content-Type set", async () => {
    let body: unknown = null;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/products/search`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        body = await request.json();
        return HttpResponse.json(envelope({ items: [] }));
      }),
    );
    const client = makeClient();
    await client.request({ method: "POST", path: "/products/search", body: { keyword: "earbuds", pageSize: 50 } });
    expect(contentType).toContain("application/json");
    expect(body).toEqual({ keyword: "earbuds", pageSize: 50 });
  });

  it("returns parsed JSON on 2xx", async () => {
    server.use(
      http.get(`${BASE}/account/balance`, () => HttpResponse.json(envelope({ creditsRemaining: 1000 }))),
    );
    const client = makeClient();
    const result = await client.request<{ success: true; data: { creditsRemaining: number } }>({
      method: "GET",
      path: "/account/balance",
    });
    expect(result.data.creditsRemaining).toBe(1000);
  });
});

describe("HttpClient — error mapping", () => {
  it("401 → UnauthorizedError, no retry", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/products/search`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("UNAUTHORIZED", "Invalid API key.", "req_x"), { status: 401 });
      }),
    );
    const client = makeClient();
    await expect(
      client.request({ method: "POST", path: "/products/search", body: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls).toBe(1);
  });

  it("402 → InsufficientCreditsError, no retry", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/account/balance`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("INSUFFICIENT_CREDITS", "Out of credits."), { status: 402 });
      }),
    );
    const client = makeClient();
    await expect(client.request({ method: "GET", path: "/account/balance" })).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(calls).toBe(1);
  });

  it("422 → ValidationError, no retry", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/products/search`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("INVALID_REQUEST", "Bad fields"), { status: 422 });
      }),
    );
    const client = makeClient();
    await expect(
      client.request({ method: "POST", path: "/products/search", body: { bad: true } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toBe(1);
  });

  it("504 → UpstreamTimeoutError (no retry on 504, treated as final)", async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/webtools/scrape`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("UPSTREAM_TIMEOUT", "Upstream timed out"), { status: 504 });
      }),
    );
    const client = makeClient();
    await expect(
      client.request({ method: "POST", path: "/webtools/scrape", body: { url: "x" } }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
    expect(calls).toBe(1);
  });

  it("Unknown 5xx → generic ZooDataError after retries exhausted", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("INTERNAL", "boom"), { status: 500 });
      }),
    );
    const client = makeClient({ retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 5 } });
    const err = await client.request({ method: "GET", path: "/x" }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(ZooDataError);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
    expect(calls).toBe(2);
  });
});

describe("HttpClient — retry behavior", () => {
  it("retries on 5xx, succeeds on 2nd attempt", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json(errEnvelope("INTERNAL", "boom"), { status: 500 });
        }
        return HttpResponse.json(envelope({ ok: true }));
      }),
    );
    const client = makeClient({ retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 5 } });
    const result = await client.request<{ success: true; data: { ok: boolean } }>({
      method: "GET",
      path: "/x",
    });
    expect(result.data.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("retries on 429 with Retry-After (seconds)", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json(errEnvelope("RATE_LIMITED", "slow"), {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        return HttpResponse.json(envelope({ ok: true }));
      }),
    );
    const client = makeClient({ retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 5 } });
    const result = await client.request<{ success: true; data: { ok: boolean } }>({
      method: "GET",
      path: "/x",
    });
    expect(result.data.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("after exhausting retries on 429, throws RateLimitError", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("RATE_LIMITED", "slow"), { status: 429 });
      }),
    );
    const client = makeClient({ retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 5 } });
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(calls).toBe(2);
  });

  it("does NOT retry on 4xx (other than 429)", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        calls++;
        return HttpResponse.json(errEnvelope("UNAUTHORIZED", "no"), { status: 401 });
      }),
    );
    const client = makeClient({ retry: { attempts: 5, backoffMs: 1, maxBackoffMs: 5 } });
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(calls).toBe(1);
  });
});

describe("HttpClient — rate-limit throttling", () => {
  it("delays next request when X-RateLimit-Remaining: 0 and Reset is in the near future", async () => {
    const futureSec = Math.floor(Date.now() / 1000) + 1; // ~1 second window
    let firstAt = 0;
    let secondAt = 0;
    let count = 0;
    server.use(
      http.get(`${BASE}/x`, () => {
        count++;
        const now = Date.now();
        if (count === 1) firstAt = now;
        else secondAt = now;
        return HttpResponse.json(envelope({ count }), {
          headers: count === 1
            ? { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(futureSec) }
            : { "X-RateLimit-Remaining": "59", "X-RateLimit-Reset": String(futureSec) },
        });
      }),
    );
    const client = makeClient();
    await client.request({ method: "GET", path: "/x" });
    await client.request({ method: "GET", path: "/x" });
    const gap = secondAt - firstAt;
    expect(gap).toBeGreaterThanOrEqual(500); // throttled at least ~half the window
  }, 5000);
});

describe("HttpClient — defaults", () => {
  it("uses default baseUrl https://api.zoodata.ai/openapi/v2 when not specified", async () => {
    let url: string | null = null;
    server.use(
      http.get("https://api.zoodata.ai/openapi/v2/account/balance", ({ request }) => {
        url = request.url;
        return HttpResponse.json(envelope({ creditsRemaining: 1 }));
      }),
    );
    const client = new HttpClient({ apiKey: "hms_x" });
    await client.request({ method: "GET", path: "/account/balance" });
    expect(url).toBe("https://api.zoodata.ai/openapi/v2/account/balance");
  });
});
