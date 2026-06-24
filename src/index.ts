/**
 * Public entry for @zoodata/sdk.
 *
 * Re-exports the generated ZooData class and the hand-written exception
 * hierarchy. Consumers do:
 *
 *     import { ZooData } from "@zoodata/sdk";
 *
 *     const client = new ZooData({ apiKey: process.env.ZOODATA_API_KEY! });
 *     const md = await client.scrape({ url: "https://example.com" });
 *     const products = await client.ecommerce.amazon.products.search({
 *       keyword: "wireless earbuds",
 *     });
 */
export { ZooData, makeEndpoints, type ZooDataApi } from "./generated/endpoints";
export type { ClientOptions, RetryOptions } from "./client";
export {
  ZooDataError,
  UnauthorizedError,
  InsufficientCreditsError,
  RateLimitError,
  ValidationError,
  UpstreamTimeoutError,
} from "./errors";
export type { paths } from "./generated/types";
