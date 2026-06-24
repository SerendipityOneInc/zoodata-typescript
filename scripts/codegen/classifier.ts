/**
 * OpenAPI path → SDK/CLI tree position.
 *
 * Pure function. No I/O. Tested in classifier.test.ts.
 */

export type CliPath = string[];

export type Classification =
  | { primary: CliPath; aliases?: CliPath[] }
  | { skip: true; reason: string };

const PROMOTED_WEBTOOLS = new Set(["scrape", "search", "crawl", "map"]);
const AMAZON_IMPLICIT_GROUPS = new Set(["products", "reviews", "markets", "keywords"]);

export function classify(path: string): Classification {
  // Out of scope: vision / generative AI
  if (path.startsWith("/openapi/v2/model/")) {
    return { skip: true, reason: "model/* is out of v1 CLI scope" };
  }

  // Account
  if (path === "/openapi/v2/account/balance") {
    return { primary: ["account", "balance"] };
  }

  // Webtools
  const webtoolsMatch = path.match(/^\/openapi\/v2\/webtools\/(.+)$/);
  if (webtoolsMatch) {
    const rest = webtoolsMatch[1]!;

    // /webtools/crawl/{job_id} — poll endpoint
    if (rest.startsWith("crawl/")) {
      return {
        primary: ["crawl", "status"],
        aliases: [["webtools", "crawl", "status"]],
      };
    }

    // Promoted verbs (top-level + webtools alias)
    if (PROMOTED_WEBTOOLS.has(rest)) {
      return {
        primary: [rest],
        aliases: [["webtools", rest]],
      };
    }

    // Other webtools endpoints stay nested (scrape-interactive, etc.)
    return { primary: ["webtools", rest] };
  }

  // TikTok
  const tiktokMatch = path.match(/^\/openapi\/v2\/tiktok\/(.+)$/);
  if (tiktokMatch) {
    const segments = tiktokMatch[1]!.split("/");
    // tiktok/realtime/product → products realtime (mirror Amazon's collapse)
    if (segments[0] === "realtime" && segments[1] === "product") {
      return { primary: ["ecommerce", "tiktok", "products", "realtime"] };
    }
    return { primary: ["ecommerce", "tiktok", ...segments] };
  }

  // Amazon implicit — Amazon endpoints in spec have no "amazon" prefix
  if (path === "/openapi/v2/categories") {
    return { primary: ["ecommerce", "amazon", "categories"] };
  }
  if (path === "/openapi/v2/realtime/reviews") {
    return { primary: ["ecommerce", "amazon", "reviews", "realtime"] };
  }
  if (path === "/openapi/v3/realtime/product") {
    return { primary: ["ecommerce", "amazon", "products", "realtime"] };
  }
  const amazonMatch = path.match(/^\/openapi\/v2\/([a-z-]+)\/(.+)$/);
  if (amazonMatch) {
    const group = amazonMatch[1]!;
    const rest = amazonMatch[2]!;
    if (AMAZON_IMPLICIT_GROUPS.has(group)) {
      return { primary: ["ecommerce", "amazon", group, rest] };
    }
  }

  return { skip: true, reason: `unrecognised path pattern: ${path}` };
}
