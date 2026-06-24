/**
 * Failing tests for the typed exception layer.
 *
 * Contract:
 *   - Each ZooData{Sub}Error has stable `code` matching hermes-service's error code
 *     ("UNAUTHORIZED", "INSUFFICIENT_CREDITS", "RATE_LIMITED", "INVALID_REQUEST",
 *      "UPSTREAM_TIMEOUT"), the HTTP `statusCode`, an optional `requestId`, and
 *      a human `message`.
 *   - `errorFromResponse(res, body)` maps the upstream JSON envelope
 *      ({ success, error: { code, message }, meta: { requestId } }) plus the
 *      HTTP status to the right subclass. Falls back to a generic ZooDataError
 *      when no rule matches.
 *   - RateLimitError exposes `retryAfter` (seconds) from `X-RateLimit-Reset`
 *      (unix timestamp) or the `Retry-After` header.
 */
import { describe, it, expect } from "vitest";

import {
  ZooDataError,
  UnauthorizedError,
  InsufficientCreditsError,
  RateLimitError,
  ValidationError,
  UpstreamTimeoutError,
  errorFromResponse,
} from "./errors";

type Envelope = {
  success: false;
  error: { code: string; message: string };
  meta: { requestId: string; timestamp?: string };
};

function makeRes(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

function envelope(code: string, message: string, requestId = "req_test"): Envelope {
  return { success: false, error: { code, message }, meta: { requestId } };
}

describe("ZooDataError base", () => {
  it("captures code / statusCode / requestId / message", () => {
    const err = new ZooDataError("boom", { code: "X", statusCode: 500, requestId: "req_1" });
    expect(err.message).toBe("boom");
    expect(err.code).toBe("X");
    expect(err.statusCode).toBe(500);
    expect(err.requestId).toBe("req_1");
    expect(err.name).toBe("ZooDataError");
    expect(err).toBeInstanceOf(Error);
  });

  it("requestId is optional", () => {
    const err = new ZooDataError("no-req", { code: "X", statusCode: 500 });
    expect(err.requestId).toBeUndefined();
  });
});

describe("typed subclasses carry their default code + status", () => {
  it("UnauthorizedError", () => {
    const err = new UnauthorizedError("nope", { requestId: "r1" });
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.statusCode).toBe(401);
    expect(err.requestId).toBe("r1");
    expect(err).toBeInstanceOf(ZooDataError);
  });
  it("InsufficientCreditsError", () => {
    const err = new InsufficientCreditsError("broke");
    expect(err.code).toBe("INSUFFICIENT_CREDITS");
    expect(err.statusCode).toBe(402);
  });
  it("RateLimitError", () => {
    const err = new RateLimitError("slow down", { retryAfter: 30 });
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(30);
  });
  it("ValidationError", () => {
    const err = new ValidationError("bad input");
    expect(err.code).toBe("INVALID_REQUEST");
    expect(err.statusCode).toBe(422);
  });
  it("UpstreamTimeoutError", () => {
    const err = new UpstreamTimeoutError("timeout");
    expect(err.code).toBe("UPSTREAM_TIMEOUT");
    expect(err.statusCode).toBe(504);
  });
});

describe("errorFromResponse — HTTP status → typed exception", () => {
  it("401 → UnauthorizedError, surfaces upstream code + requestId", () => {
    const res = makeRes(401);
    const body = envelope("UNAUTHORIZED", "Invalid API key.", "req_a");
    const err = errorFromResponse(res, body);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe("Invalid API key.");
    expect(err.requestId).toBe("req_a");
  });

  it("402 → InsufficientCreditsError", () => {
    const res = makeRes(402);
    const body = envelope("INSUFFICIENT_CREDITS", "Out of credits.");
    expect(errorFromResponse(res, body)).toBeInstanceOf(InsufficientCreditsError);
  });

  it("422 → ValidationError", () => {
    const res = makeRes(422);
    const body = envelope("INVALID_REQUEST", "Bad fields");
    expect(errorFromResponse(res, body)).toBeInstanceOf(ValidationError);
  });

  it("429 → RateLimitError, retryAfter parsed from X-RateLimit-Reset (unix seconds)", () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 60;
    const res = makeRes(429, { "X-RateLimit-Reset": String(futureUnix) });
    const body = envelope("RATE_LIMITED", "Slow down");
    const err = errorFromResponse(res, body);
    expect(err).toBeInstanceOf(RateLimitError);
    const retry = (err as RateLimitError).retryAfter;
    expect(retry).toBeGreaterThan(50);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("429 → RateLimitError, retryAfter falls back to Retry-After header (seconds)", () => {
    const res = makeRes(429, { "Retry-After": "12" });
    const body = envelope("RATE_LIMITED", "Slow down");
    const err = errorFromResponse(res, body);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(12);
  });

  it("504 → UpstreamTimeoutError", () => {
    const res = makeRes(504);
    const body = envelope("UPSTREAM_TIMEOUT", "Upstream timed out");
    expect(errorFromResponse(res, body)).toBeInstanceOf(UpstreamTimeoutError);
  });

  it("unknown status → generic ZooDataError (not a subclass)", () => {
    const res = makeRes(500);
    const body = envelope("INTERNAL", "boom");
    const err = errorFromResponse(res, body);
    expect(err).toBeInstanceOf(ZooDataError);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err.code).toBe("INTERNAL");
    expect(err.statusCode).toBe(500);
  });

  it("missing body → falls back to status code + empty message", () => {
    const res = makeRes(503);
    const err = errorFromResponse(res, undefined);
    expect(err).toBeInstanceOf(ZooDataError);
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toContain("503");
  });
});
