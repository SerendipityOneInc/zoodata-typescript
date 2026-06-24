/**
 * Integration smoke for the public ZooData SDK.
 *
 * Doesn't exhaustively test every endpoint (each wrapper is a thin
 * pass-through; the trust boundary is the codegen template). Instead
 * verifies that the class shape is wired up correctly:
 *
 *  - top-level promoted verbs (scrape/search/crawl/map) callable
 *  - crawl.status accessible as a function via Object.assign
 *  - ecommerce.amazon / ecommerce.tiktok nested paths reach HttpClient
 *  - webtools alias points to the same handler as the promoted one
 *  - account.balance works for the GET-no-body case
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "./test-setup";
import { ZooData } from "./index";

const BASE = "https://api.example.test";

function envelope(data: unknown) {
  return {
    success: true,
    data,
    meta: { requestId: "req_sdk", timestamp: "2026-01-01T00:00:00Z" },
  };
}

function makeClient() {
  return new ZooData({
    apiKey: "hms_test_key",
    baseUrl: BASE,
    retry: { attempts: 1, backoffMs: 1, maxBackoffMs: 5 },
  });
}

describe("ZooData class shape", () => {
  it("exposes promoted top-level verbs", () => {
    const c = makeClient();
    expect(typeof c.scrape).toBe("function");
    expect(typeof c.search).toBe("function");
    expect(typeof c.crawl).toBe("function");
    expect(typeof c.map).toBe("function");
  });

  it("exposes crawl.status alongside crawl as a function", () => {
    const c = makeClient();
    expect(typeof c.crawl).toBe("function");
    // Object.assign attaches .status to the same function instance.
    expect(typeof (c.crawl as unknown as { status: unknown }).status).toBe("function");
  });

  it("exposes the ecommerce/amazon nested tree", () => {
    const c = makeClient();
    expect(typeof c.ecommerce.amazon.products.search).toBe("function");
    expect(typeof c.ecommerce.amazon.products.realtime).toBe("function");
    expect(typeof c.ecommerce.amazon.reviews.analysis).toBe("function");
    expect(typeof c.ecommerce.amazon.markets.search).toBe("function");
    expect(typeof c.ecommerce.amazon.keywords.detail).toBe("function");
    expect(typeof c.ecommerce.amazon.categories).toBe("function");
  });

  it("exposes the ecommerce/tiktok nested tree", () => {
    const c = makeClient();
    expect(typeof c.ecommerce.tiktok.products.search).toBe("function");
    expect(typeof c.ecommerce.tiktok.products.realtime).toBe("function");
    expect(typeof c.ecommerce.tiktok.creators.search).toBe("function");
    expect(typeof c.ecommerce.tiktok.videos.search).toBe("function");
    expect(typeof c.ecommerce.tiktok.categories).toBe("function");
  });

  it("exposes webtools alias as the SAME function as the promoted top-level", () => {
    const c = makeClient();
    expect(c.webtools.scrape).toBe(c.scrape);
    expect(c.webtools.search).toBe(c.search);
    expect(c.webtools.map).toBe(c.map);
    // After Object.assign, crawl gains .status — same identity for promoted + alias
    expect(c.webtools.crawl).toBe(c.crawl);
  });
});

describe("ZooData wraps HttpClient end-to-end", () => {
  it("ecommerce.amazon.products.search hits POST /openapi/v2/products/search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/openapi/v2/products/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(envelope({ items: [{ asin: "B07X" }] }));
      }),
    );
    const c = makeClient();
    // Cast to any here because the live spec types are vast — the runtime
    // path is what we're verifying, not the schema (already tested via tsc).
    const result = await c.ecommerce.amazon.products.search({ keyword: "earbuds" } as never);
    expect(body).toEqual({ keyword: "earbuds" });
    // The real spec returns `data` as an array of typed Product objects; for this
    // smoke we only care that the runtime path/method/body are correct, so we
    // cast through unknown to peek at the fake-shape the msw handler returned.
    const fake = result as unknown as { data: { items: { asin: string }[] } };
    expect(fake.data.items[0]!.asin).toBe("B07X");
  });

  it("account.balance hits GET /openapi/v2/account/balance with no body", async () => {
    let receivedMethod: string | null = null;
    let receivedBody: string | null = null;
    server.use(
      http.get(`${BASE}/openapi/v2/account/balance`, async ({ request }) => {
        receivedMethod = request.method;
        receivedBody = await request.text();
        return HttpResponse.json(envelope({ creditsRemaining: 100 }));
      }),
    );
    const c = makeClient();
    await c.account.balance();
    expect(receivedMethod).toBe("GET");
    expect(receivedBody).toBe("");
  });

  it("crawl.status interpolates jobId into the path", async () => {
    let receivedUrl: string | null = null;
    server.use(
      http.get(`${BASE}/openapi/v2/webtools/crawl/:jobId`, ({ request }) => {
        receivedUrl = request.url;
        return HttpResponse.json(envelope({ status: "completed" }));
      }),
    );
    const c = makeClient();
    await (c.crawl as unknown as { status: (id: string) => Promise<unknown> }).status("job_abc123");
    expect(receivedUrl).toContain("/openapi/v2/webtools/crawl/job_abc123");
  });
});
