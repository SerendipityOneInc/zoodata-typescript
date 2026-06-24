#!/usr/bin/env tsx
/**
 * Orchestrator: spec + classifier + extractor + renderer -> src/generated/endpoints.ts.
 *
 * Idempotent. Safe to re-run after spec changes.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { extractEndpoints } from "./codegen/extract";
import { render } from "./codegen/render";

const DEFAULT_SPEC = "openapi/openapi.v2.json";
const DEFAULT_OUT = "src/generated/endpoints.ts";

async function main(): Promise<void> {
  const specPath = resolve(process.env.ZOODATA_SPEC_PATH ?? DEFAULT_SPEC);
  const outPath = resolve(process.env.ZOODATA_CODEGEN_OUT ?? DEFAULT_OUT);

  const raw = await readFile(specPath, "utf8");
  const spec = JSON.parse(raw);

  const endpoints = extractEndpoints(spec);
  console.log(`codegen: extracted ${endpoints.length} endpoints from ${specPath}`);

  const source = render(endpoints);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, source, "utf8");
  console.log(`codegen: wrote ${outPath} (${source.length} bytes)`);
}

main().catch((err) => {
  console.error("codegen failed:", err);
  process.exit(1);
});
