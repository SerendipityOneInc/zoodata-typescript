/**
 * Walk an OpenAPI 3.1 spec, classify each (path, method), and produce
 * a flat list of endpoints ready for the renderer.
 */
import { classify, type CliPath } from "./classifier";

export type HttpMethod = "get" | "post";

export interface Endpoint {
  path: string;               // e.g., /openapi/v2/products/search
  method: HttpMethod;
  operationId: string;
  description: string;
  primary: CliPath;
  aliases: CliPath[];
  hasRequestBody: boolean;    // POST with body
  hasPathParams: boolean;     // e.g., /webtools/crawl/{job_id}
}

type SpecPathItem = Partial<Record<HttpMethod, SpecOperation>> & {
  parameters?: SpecParameter[];
};

interface SpecOperation {
  operationId?: string;
  description?: string;
  summary?: string;
  parameters?: SpecParameter[];
  requestBody?: { content?: Record<string, unknown> };
}

interface SpecParameter {
  in: string;
  name: string;
}

interface Spec {
  paths: Record<string, SpecPathItem>;
}

export function extractEndpoints(spec: Spec): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ["get", "post"] as const) {
      const op = item[method];
      if (!op) continue;
      const cls = classify(path);
      if ("skip" in cls) continue;
      const allParams = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      endpoints.push({
        path,
        method,
        operationId: op.operationId ?? deriveOperationId(method, path),
        description: (op.description ?? op.summary ?? "").trim(),
        primary: cls.primary,
        aliases: cls.aliases ?? [],
        hasRequestBody: Boolean(op.requestBody),
        hasPathParams: allParams.some((p) => p.in === "path"),
      });
    }
  }
  return endpoints;
}

function deriveOperationId(method: string, path: string): string {
  return `${method}_${path.replace(/\W+/g, "_")}`;
}
