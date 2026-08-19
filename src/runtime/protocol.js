import { randomUUID } from "node:crypto";
import { ERROR_CODES, UnifiedError } from "../errors.js";
import { nowIso } from "../utils.js";

export const PROTOCOL_VERSION = "1.0";

export function createRequestId(prefix = "u4") {
  return `${prefix}-${randomUUID()}`;
}

export function createCommandEnvelope({ requestId = createRequestId(), family, operation, payload = {}, metadata = {} }) {
  if (!family || !operation) {
    throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, "Command envelope requires family and operation.");
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    family,
    operation,
    payload: payload ?? {},
    metadata: {
      createdAt: nowIso(),
      ...metadata
    }
  };
}

export function createResponseEnvelope({ request, ok, result = null, error = null, durationMs = 0 }) {
  return {
    protocolVersion: request.protocolVersion,
    requestId: request.requestId,
    ok: Boolean(ok),
    family: request.family,
    operation: request.operation,
    result,
    error,
    durationMs
  };
}

export function validateCommandEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, "Command envelope must be an object.");
  }
  if (envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw new UnifiedError(
      ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION,
      `Unsupported protocol version: ${envelope.protocolVersion || "missing"}.`,
      { expected: PROTOCOL_VERSION, received: envelope.protocolVersion }
    );
  }
  if (!envelope.requestId || typeof envelope.requestId !== "string") {
    throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, "Command envelope requires a string requestId.");
  }
  if (!["plumb", "custom"].includes(envelope.family)) {
    throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Unsupported command family: ${envelope.family || "missing"}.`);
  }
  if (!envelope.operation || typeof envelope.operation !== "string") {
    throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, "Command envelope requires a string operation.");
  }
  if (envelope.payload !== undefined && (envelope.payload === null || typeof envelope.payload !== "object" || Array.isArray(envelope.payload))) {
    throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "Command payload must be an object.");
  }
  return envelope;
}

export function validateResponseEnvelope(response, requestId) {
  if (!response || typeof response !== "object") {
    throw new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, "Plugin response envelope must be an object.");
  }
  if (response.protocolVersion !== PROTOCOL_VERSION) {
    throw new UnifiedError(ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION, `Unsupported response protocol version: ${response.protocolVersion || "missing"}.`);
  }
  if (response.requestId !== requestId) {
    throw new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, "Plugin response requestId did not match the pending request.", {
      expected: requestId,
      received: response.requestId
    });
  }
  if (typeof response.ok !== "boolean") {
    throw new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, "Plugin response requires boolean ok.");
  }
  return response;
}
