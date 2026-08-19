import { ERROR_CODES, UnifiedError } from "../../errors.js";
import { createCommandEnvelope } from "../protocol.js";

function assertObject(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "Custom payload must be an object.");
  }
}

function normalizeDepth(payload, fallback = 1) {
  const depth = payload.depth === undefined ? fallback : Number(payload.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > 6) {
    throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "Custom depth must be an integer from 0 to 6.");
  }
  return depth;
}

export class CustomProtocolAdapter {
  family = "custom";

  toEnvelope({ capability, payload = {}, requestId, metadata = {} }) {
    assertObject(payload);
    let normalized = {};
    if (capability.operation === "node.read") {
      if (payload.nodeId !== undefined && typeof payload.nodeId !== "string") {
        throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "custom.node.read payload.nodeId must be a string when provided.");
      }
      normalized = {
        depth: normalizeDepth(payload, 1),
        ...(payload.nodeId ? { nodeId: payload.nodeId } : {})
      };
    } else if (capability.operation === "selection.read") {
      normalized = { depth: normalizeDepth(payload, 1) };
    } else if (capability.operation !== "status") {
      throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Unsupported Custom operation: ${capability.operation}.`);
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
