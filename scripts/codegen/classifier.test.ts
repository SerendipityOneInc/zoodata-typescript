/**
 * Failing tests for the OpenAPI path → CLI/SDK tree classifier.
 *
 * Rules (from plan):
 *  - /openapi/v2/model/*           → skip (Out of Scope: vision / generative)
 *  - /openapi/v2/account/balance   → ["account", "balance"]
 *  - /openapi/v2/webtools/{scrape,search,crawl,map}  → top-level promoted
 *      AND a "webtools/<verb>" alias for symmetry with spec namespace
 *  - /openapi/v2/webtools/crawl/{job_id}              → ["crawl", "status"]
 *      AND ["webtools", "crawl", "status"] alias
 *  - /openapi/v2/webtools/scrape-interactive          → ["webtools", "scrape-interactive"]
 *  - /openapi/v2/tiktok/realtime/product              → ["ecommerce", "tiktok", "products", "realtime"]
 *  - /openapi/v2/tiktok/<rest>                        → ["ecommerce", "tiktok", ...rest]
 *  - /openapi/v3/realtime/product                     → ["ecommerce", "amazon", "products", "realtime"]
 *  - /openapi/v2/realtime/reviews                     → ["ecommerce", "amazon", "reviews", "realtime"]
 *  - /openapi/v2/categories                           → ["ecommerce", "amazon", "categories"]
 *  - /openapi/v2/{products,reviews,markets,keywords}/<rest>
 *                                                     → ["ecommerce", "amazon", group, ...rest]
 *  - anything else                                     → skip with reason
 */
import { describe, it, expect } from "vitest";

import { classify } from "./classifier";

describe("classifier — out of scope", () => {
  it("/openapi/v2/model/* paths are skipped", () => {
    expect(classify("/openapi/v2/model/ecommerce-rerank")).toMatchObject({ skip: true });
    expect(classify("/openapi/v2/model/video/generations")).toMatchObject({ skip: true });
    expect(classify("/openapi/v2/model/fashion-image-search")).toMatchObject({ skip: true });
  });

  it("unknown path patterns are skipped", () => {
    expect(classify("/something/unrecognised")).toMatchObject({ skip: true });
  });
});

describe("classifier — account", () => {
  it("/openapi/v2/account/balance → [account, balance]", () => {
    expect(classify("/openapi/v2/account/balance")).toEqual({
      primary: ["account", "balance"],
    });
  });
});

describe("classifier — webtools (with promotion)", () => {
  it.each([
    ["scrape"],
    ["search"],
    ["crawl"],
    ["map"],
  ])("/openapi/v2/webtools/%s → primary=[%s], alias=[webtools,%s]", (verb) => {
    expect(classify(`/openapi/v2/webtools/${verb}`)).toEqual({
      primary: [verb],
      aliases: [["webtools", verb]],
    });
  });

  it("/openapi/v2/webtools/crawl/{job_id} → [crawl, status] with alias", () => {
    expect(classify("/openapi/v2/webtools/crawl/{job_id}")).toEqual({
      primary: ["crawl", "status"],
      aliases: [["webtools", "crawl", "status"]],
    });
  });

  it("/openapi/v2/webtools/scrape-interactive stays in webtools (no promotion)", () => {
    expect(classify("/openapi/v2/webtools/scrape-interactive")).toEqual({
      primary: ["webtools", "scrape-interactive"],
    });
  });
});

describe("classifier — Amazon (implicit)", () => {
  it.each([
    ["/openapi/v2/products/search", ["ecommerce", "amazon", "products", "search"]],
    ["/openapi/v2/products/competitors", ["ecommerce", "amazon", "products", "competitors"]],
    ["/openapi/v2/products/history", ["ecommerce", "amazon", "products", "history"]],
    ["/openapi/v2/categories", ["ecommerce", "amazon", "categories"]],
    ["/openapi/v2/markets/search", ["ecommerce", "amazon", "markets", "search"]],
    ["/openapi/v2/reviews/search", ["ecommerce", "amazon", "reviews", "search"]],
    ["/openapi/v2/reviews/analysis", ["ecommerce", "amazon", "reviews", "analysis"]],
    ["/openapi/v2/realtime/reviews", ["ecommerce", "amazon", "reviews", "realtime"]],
    ["/openapi/v3/realtime/product", ["ecommerce", "amazon", "products", "realtime"]],
    ["/openapi/v2/keywords/detail", ["ecommerce", "amazon", "keywords", "detail"]],
    ["/openapi/v2/keywords/trend", ["ecommerce", "amazon", "keywords", "trend"]],
    [
      "/openapi/v2/keywords/search-results",
      ["ecommerce", "amazon", "keywords", "search-results"],
    ],
    ["/openapi/v2/keywords/extends", ["ecommerce", "amazon", "keywords", "extends"]],
    [
      "/openapi/v2/keywords/product-traffic-terms",
      ["ecommerce", "amazon", "keywords", "product-traffic-terms"],
    ],
    [
      "/openapi/v2/keywords/competitor-product-keywords",
      ["ecommerce", "amazon", "keywords", "competitor-product-keywords"],
    ],
  ])("%s → %j", (path, expected) => {
    expect(classify(path)).toEqual({ primary: expected });
  });
});

describe("classifier — TikTok", () => {
  it.each([
    [
      "/openapi/v2/tiktok/products/search",
      ["ecommerce", "tiktok", "products", "search"],
    ],
    [
      "/openapi/v2/tiktok/realtime/product",
      ["ecommerce", "tiktok", "products", "realtime"],
    ],
    ["/openapi/v2/tiktok/categories", ["ecommerce", "tiktok", "categories"]],
    [
      "/openapi/v2/tiktok/creators/search",
      ["ecommerce", "tiktok", "creators", "search"],
    ],
    [
      "/openapi/v2/tiktok/videos/search",
      ["ecommerce", "tiktok", "videos", "search"],
    ],
  ])("%s → %j", (path, expected) => {
    expect(classify(path)).toEqual({ primary: expected });
  });
});

describe("classifier — coverage of v1 surface", () => {
  it("classifies exactly 27 endpoints from the live spec (no skips counted)", async () => {
    // sanity: running classifier across the full spec produces 27 non-skipped paths
    // (+ 12 model/* skipped) per the plan
    const specModule = await import("../../openapi/openapi.v2.json", {
      with: { type: "json" },
    });
    const spec = specModule.default as { paths: Record<string, unknown> };
    const allPaths = Object.keys(spec.paths);
    let kept = 0;
    let skipped = 0;
    for (const p of allPaths) {
      const r = classify(p);
      if ("skip" in r && r.skip) skipped++;
      else kept++;
    }
    expect(kept).toBe(27);
    expect(skipped).toBe(12);
  });
});
