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
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

export class UnifiedError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "UnifiedError";
    this.code = code;
    this.details = details;
  }
}

export function errorShape(error) {
  if (error instanceof UnifiedError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error)
  };
}

export function normalizeBackendError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (error instanceof UnifiedError) return error;
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return new UnifiedError(ERROR_CODES.BACKEND_TIMEOUT, message);
  }
  if (lower.includes("eaddrinuse") || lower.includes("address already in use")) {
    return new UnifiedError(ERROR_CODES.BACKEND_UNAVAILABLE, message);
  }
  if (lower.includes("no figma plugin is paired") || lower.includes("not paired") || lower.includes("plugin paired") === false && lower.includes("open the") && lower.includes("plugin")) {
    return new UnifiedError(ERROR_CODES.BACKEND_NOT_PAIRED, message);
  }
  if (lower.includes("figma") && lower.includes("unavailable")) {
    return new UnifiedError(ERROR_CODES.FIGMA_UNAVAILABLE, message);
  }
  return new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, message);
}
