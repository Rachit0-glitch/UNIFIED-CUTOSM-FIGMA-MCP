import { ERROR_CODES, UnifiedError } from "../../errors.js";
import { createCommandEnvelope } from "../protocol.js";

function assertObject(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "Plumb payload must be an object.");
  }
}

function normalizedSelectionPayload(payload) {
  const depth = payload.depth === undefined ? 2 : Number(payload.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > 6) {
    throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "Plumb selection depth must be an integer from 0 to 6.");
  }
  return {
    depth,
    notes: Boolean(payload.notes),
    maxTokens: payload.maxTokens === undefined ? undefined : Number(payload.maxTokens)
  };
}

export class PlumbProtocolAdapter {
  family = "plumb";

  toEnvelope({ capability, payload = {}, requestId, metadata = {} }) {
    assertObject(payload);
    let normalized = {};
    if (capability.operation === "outline") {
      if (payload.page !== undefined && typeof payload.page !== "string") {
        throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "plumb.outline payload.page must be a string when provided.");
      }
      normalized = payload.page ? { page: payload.page } : {};
    } else if (capability.operation === "selection.read") {
      normalized = normalizedSelectionPayload(payload);
    } else if (capability.operation !== "status") {
      throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Unsupported Plumb operation: ${capability.operation}.`);
    }
    return createCommandEnvelope({
      requestId,
      family: this.family,
      operation: capability.operation,
      payload: normalized,
      metadata: { capability: capability.id, ...metadata }
    });
  }
}
