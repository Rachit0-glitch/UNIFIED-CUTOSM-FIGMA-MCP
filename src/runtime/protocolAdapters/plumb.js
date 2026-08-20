import { ERROR_CODES, UnifiedError } from "../../errors.js";
import { createCommandEnvelope } from "../protocol.js";

/**
 * H9 (pre-Block-A hardening) — payload shape/bounds are now validated once by CommandRouter against
 * the capability's own Zod schema (see runtime/capabilities.js) before this adapter ever runs. This
 * adapter's only remaining job is mapping already-clean, already-defaulted data onto the envelope's
 * operation-specific shape — no more manual type/bounds checks duplicated here.
 */
export class PlumbProtocolAdapter {
  family = "plumb";

  toEnvelope({ capability, payload = {}, requestId, metadata = {} }) {
    let normalized = {};
    if (capability.operation === "outline") {
      normalized = payload.page ? { page: payload.page } : {};
    } else if (capability.operation === "selection.read") {
      normalized = { depth: payload.depth, notes: Boolean(payload.notes), maxTokens: payload.maxTokens };
    } else if (capability.operation === "components") {
      normalized = {};
    } else if (capability.operation !== "status") {
      throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Unsupported Plumb operation: ${capability.operation}.`, { source: this.family });
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
