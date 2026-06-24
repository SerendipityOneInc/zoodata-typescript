/**
 * Typed exception layer for the ZooData SDK.
 *
 * Mirrors hermes-service's error code system (UNAUTHORIZED /
 * INSUFFICIENT_CREDITS / RATE_LIMITED / INVALID_REQUEST / UPSTREAM_TIMEOUT)
 * so callers can `catch (err) { if (err instanceof RateLimitError) {...} }`
 * without poking at HTTP status codes themselves.
 */

export type ErrorBody = {
  success?: false;
  error?: { code?: string; message?: string };
  meta?: { requestId?: string };
};

interface ZooDataErrorInit {
  code: string;
  statusCode: number;
  requestId?: string;
}

export class ZooDataError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId?: string;

  constructor(message: string, init: ZooDataErrorInit) {
    super(message);
    this.name = "ZooDataError";
    this.code = init.code;
    this.statusCode = init.statusCode;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }
}

interface SubclassInit {
  requestId?: string;
}

function withRequestId(
  base: { code: string; statusCode: number },
  requestId: string | undefined,
): ZooDataErrorInit {
  return requestId !== undefined ? { ...base, requestId } : base;
}

export class UnauthorizedError extends ZooDataError {
  constructor(message: string, init: SubclassInit = {}) {
    super(message, withRequestId({ code: "UNAUTHORIZED", statusCode: 401 }, init.requestId));
    this.name = "UnauthorizedError";
  }
}

export class InsufficientCreditsError extends ZooDataError {
  constructor(message: string, init: SubclassInit = {}) {
    super(message, withRequestId({ code: "INSUFFICIENT_CREDITS", statusCode: 402 }, init.requestId));
    this.name = "InsufficientCreditsError";
  }
}

interface RateLimitInit extends SubclassInit {
  retryAfter?: number;
}

export class RateLimitError extends ZooDataError {
  readonly retryAfter?: number;

  constructor(message: string, init: RateLimitInit = {}) {
    super(message, withRequestId({ code: "RATE_LIMITED", statusCode: 429 }, init.requestId));
    this.name = "RateLimitError";
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
  }
}

export class ValidationError extends ZooDataError {
  constructor(message: string, init: SubclassInit = {}) {
    super(message, withRequestId({ code: "INVALID_REQUEST", statusCode: 422 }, init.requestId));
    this.name = "ValidationError";
  }
}

export class UpstreamTimeoutError extends ZooDataError {
  constructor(message: string, init: SubclassInit = {}) {
    super(message, withRequestId({ code: "UPSTREAM_TIMEOUT", statusCode: 504 }, init.requestId));
    this.name = "UpstreamTimeoutError";
  }
}

function parseRetryAfter(response: Response): number | undefined {
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset) {
    const ts = Number.parseInt(reset, 10);
    if (Number.isFinite(ts)) {
      const seconds = ts - Math.floor(Date.now() / 1000);
      if (seconds > 0) return seconds;
    }
  }
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return undefined;
}

export function errorFromResponse(response: Response, body: ErrorBody | undefined): ZooDataError {
  const requestId = body?.meta?.requestId;
  const upstreamMessage = body?.error?.message;
  const upstreamCode = body?.error?.code;
  const message = upstreamMessage ?? `HTTP ${response.status}`;
  const init: SubclassInit = requestId !== undefined ? { requestId } : {};

  switch (response.status) {
    case 401:
      return new UnauthorizedError(message, init);
    case 402:
      return new InsufficientCreditsError(message, init);
    case 422:
      return new ValidationError(message, init);
    case 429: {
      const retryAfter = parseRetryAfter(response);
      return new RateLimitError(message, retryAfter !== undefined ? { ...init, retryAfter } : init);
    }
    case 504:
      return new UpstreamTimeoutError(message, init);
    default:
      return new ZooDataError(message, {
        code: upstreamCode ?? "UNKNOWN",
        statusCode: response.status,
        ...(requestId !== undefined ? { requestId } : {}),
      });
  }
}
