export const ERROR_CODES = Object.freeze({
  BACKEND_NOT_FOUND: "BACKEND_NOT_FOUND",
  BACKEND_UNAVAILABLE: "BACKEND_UNAVAILABLE",
  BACKEND_NOT_PAIRED: "BACKEND_NOT_PAIRED",
  FIGMA_UNAVAILABLE: "FIGMA_UNAVAILABLE",
  BACKEND_PROTOCOL_ERROR: "BACKEND_PROTOCOL_ERROR",
  BACKEND_TIMEOUT: "BACKEND_TIMEOUT",
  AMBIGUOUS_ACTIVE_BACKEND: "AMBIGUOUS_ACTIVE_BACKEND",
  INVALID_COMMAND: "INVALID_COMMAND",
  UNSUPPORTED_PROTOCOL_VERSION: "UNSUPPORTED_PROTOCOL_VERSION",
  CAPABILITY_NOT_FOUND: "CAPABILITY_NOT_FOUND",
  CAPABILITY_DISABLED: "CAPABILITY_DISABLED",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
  PLUGIN_DISCONNECTED: "PLUGIN_DISCONNECTED",
  COMMAND_TIMEOUT: "COMMAND_TIMEOUT",
  COMMAND_EXECUTION_FAILED: "COMMAND_EXECUTION_FAILED",
  FIGMA_API_ERROR: "FIGMA_API_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // H7 (pre-Block-A hardening) — distinct from COMMAND_TIMEOUT: that code means "the capability
  // itself ran too long," these two mean "the command never even started running." Conflating queue
  // wait with execution timeout would hide a busy-runtime problem behind what looks like a slow-
  // capability problem.
  QUEUE_FULL: "QUEUE_FULL",
  QUEUE_WAIT_TIMEOUT: "QUEUE_WAIT_TIMEOUT",
  // Block A / A2 — specific mutation-path error codes (brief §18: never respond to a meaningful
  // Figma failure with a generic message when specific context exists).
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  DESIGN_COMPILE_ERROR: "DESIGN_COMPILE_ERROR",
  // Block B — the remaining genuinely new error categories §17 asks for. Existing codes already cover
  // most of §17's taxonomy under different names (see docs/BLOCK_B_OPERATION_MODEL.md for the exact
  // mapping: INVALID_PAYLOAD = VALIDATION_ERROR, NODE_NOT_FOUND = TARGET_NOT_FOUND, INVALID_COMMAND =
  // UNSUPPORTED_OPERATION) — those are NOT duplicated here, since two codes for one failure class would
  // itself be a taxonomy defect. Only the categories with no existing equivalent are added.
  INVALID_HIERARCHY: "INVALID_HIERARCHY",
  FONT_ERROR: "FONT_ERROR",
  RECONCILIATION_FAILED: "RECONCILIATION_FAILED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED"
});

export class UnifiedError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "UnifiedError";
    this.code = code;
    this.details = details;
  }
}

/**
 * H11 (pre-Block-A hardening) — the normalized shape now always includes `source` (which family/
 * origin the error came from, e.g. "plumb"/"custom"/"unified") whenever the caller supplied one via
 * `details.source`, promoted to a top-level field rather than buried inside `details`. The specific
 * original `message` is never discarded in favor of just the `code` — both are always present.
 */
export function errorShape(error) {
  if (error instanceof UnifiedError) {
    const { source, ...restDetails } = error.details && typeof error.details === "object" ? error.details : {};
    const details = Object.keys(restDetails).length ? restDetails : error.details;
    return { code: error.code, message: error.message, source: source ?? null, details: details ?? null };
  }
  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
    source: null,
    details: null
  };
}

/**
 * H6 (pre-Block-A hardening) — legacy-diagnostics-only fallback classification (used by the gated
 * Stage-2 adapters, see docs/LEGACY_RUNTIME_POLICY.md). Structured errors are always preferred first:
 * an already-`UnifiedError` (or any error carrying its own `.code`) is returned as-is, never
 * reclassified by message text. Substring matching only ever applies to genuinely unstructured
 * errors (e.g. a raw Node.js `ECONNREFUSED`/`Error` with no `.code` at all) — it is not, and was
 * never, the classification path for the production Stage 4 execution route (CommandRouter's own
 * errors are UnifiedError instances or plugin-supplied `{code, message}` shapes from the start).
 */
export function normalizeBackendError(error) {
  if (error instanceof UnifiedError) return error;
  if (error && typeof error === "object" && typeof error.code === "string") {
    return new UnifiedError(error.code, error.message ?? String(error), error.details);
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return new UnifiedError(ERROR_CODES.BACKEND_TIMEOUT, message);
  }
  if (lower.includes("eaddrinuse") || lower.includes("address already in use")) {
    return new UnifiedError(ERROR_CODES.BACKEND_UNAVAILABLE, message);
  }
  if (lower.includes("no figma plugin is paired") || lower.includes("not paired") || (lower.includes("plugin paired") === false && lower.includes("open the") && lower.includes("plugin"))) {
    return new UnifiedError(ERROR_CODES.BACKEND_NOT_PAIRED, message);
  }
  if (lower.includes("figma") && lower.includes("unavailable")) {
    return new UnifiedError(ERROR_CODES.FIGMA_UNAVAILABLE, message);
  }
  return new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, message);
}
