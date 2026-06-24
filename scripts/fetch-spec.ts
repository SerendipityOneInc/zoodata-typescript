#!/usr/bin/env tsx
/**
 * Fetch the public OpenAPI v2 spec from hermes-web's proxy and commit it to
 * openapi/openapi.v2.json. The proxy unwraps hermes-service's
 * custom_openapi() output (filtered to /openapi/* paths, with
 * include_in_schema=False endpoints already hidden), so the snapshot
 * persisted here is exactly the public surface CLI should wrap.
 *
 * Env vars (all optional):
 *   ZOODATA_SPEC_URL  — full proxy URL; defaults to prod
 *   ZOODATA_SPEC_OUT  — output path; defaults to ./openapi/openapi.v2.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_URL = "https://zoodata.ai/api/v1/openapi-spec";
const DEFAULT_OUT = "openapi/openapi.v2.json";

type Wrapped = { spec: unknown; gatewayUrl?: string };

async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) {
      const delay = 500 * 2 ** i;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error("fetch-spec: all attempts failed");
}

async function main(): Promise<void> {
  const url = process.env.ZOODATA_SPEC_URL ?? DEFAULT_URL;
  const out = resolve(process.env.ZOODATA_SPEC_OUT ?? DEFAULT_OUT);

  console.log(`fetch-spec: GET ${url}`);
  const res = await fetchWithRetry(url);
  const body = (await res.json()) as Wrapped;

  if (!body || typeof body !== "object" || !("spec" in body)) {
    throw new Error("fetch-spec: response missing `spec` field");
  }

  const spec = body.spec;
  if (!spec || typeof spec !== "object") {
    throw new Error("fetch-spec: `spec` field is not an object");
  }

  const paths = (spec as { paths?: Record<string, unknown> }).paths ?? {};
  const pathCount = Object.keys(paths).length;
  if (pathCount === 0) {
    throw new Error("fetch-spec: spec has zero paths — refusing to overwrite");
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(spec, null, 2) + "\n", "utf8");
  console.log(`fetch-spec: wrote ${out} (${pathCount} paths)`);
}

main().catch((err) => {
  console.error("fetch-spec failed:", err);
  process.exit(1);
});
