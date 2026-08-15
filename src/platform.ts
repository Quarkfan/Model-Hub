import { randomUUID } from "node:crypto";
export type Code =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_REQUEST"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UPSTREAM_FAILED"
  | "UNSUPPORTED"
  | "INTERNAL";
export class HubError extends Error {
  constructor(
    readonly code: Code,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export function ok<T>(data: T, requestId: string = randomUUID()) {
  return {
    ok: true,
    data,
    meta: { requestId, timestamp: new Date().toISOString() },
  };
}
export function fail(
  code: Code,
  message: string,
  requestId: string,
  retryable = false,
  details?: Record<string, unknown>,
) {
  return {
    ok: false,
    error: { code, message, retryable, failedCenter: "model-hub", details },
    meta: { requestId, timestamp: new Date().toISOString() },
  };
}
