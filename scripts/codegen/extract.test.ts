/**
 * Snapshot tests for the endpoint extractor.
 *
 * Locks two things:
 *  - When run against the live spec, exactly 27 endpoints come out
 *    (matching the plan's v1 surface count).
 *  - The shape of an extracted endpoint matches the Endpoint contract.
 */
import { describe, it, expect } from "vitest";
import specJson from "../../openapi/openapi.v2.json" with { type: "json" };

import { extractEndpoints, type Endpoint } from "./extract";

const spec = specJson as Parameters<typeof extractEndpoints>[0];

describe("extractEndpoints", () => {
  it("yields exactly 27 endpoints from the v1 spec", () => {
    const endpoints = extractEndpoints(spec);
    expect(endpoints).toHaveLength(27);
  });

  it("every endpoint has operationId, method, primary CliPath", () => {
    const endpoints = extractEndpoints(spec);
    for (const ep of endpoints) {
      expect(ep.method).toMatch(/^(get|post)$/);
      expect(ep.operationId).toBeTruthy();
      expect(ep.primary.length).toBeGreaterThan(0);
    }
  });

  it("at least the 4 promoted webtools have aliases", () => {
    const endpoints = extractEndpoints(spec);
    const promoted = endpoints.filter((e) => e.primary.length === 1);
    const promotedVerbs = promoted.map((e) => e.primary[0]).sort();
    expect(promotedVerbs).toEqual(["crawl", "map", "scrape", "search"]);
    for (const ep of promoted) {
      expect(ep.aliases.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("crawl status endpoint is flagged as having path params", () => {
    const endpoints = extractEndpoints(spec);
    const crawlStatus = endpoints.find(
      (e) => e.primary[0] === "crawl" && e.primary[1] === "status",
    ) as Endpoint;
    expect(crawlStatus).toBeDefined();
    expect(crawlStatus.hasPathParams).toBe(true);
  });

  it("POST endpoints have request bodies", () => {
    const endpoints = extractEndpoints(spec);
    const postEndpoints = endpoints.filter((e) => e.method === "post");
    for (const ep of postEndpoints) {
      expect(ep.hasRequestBody).toBe(true);
    }
  });
});
