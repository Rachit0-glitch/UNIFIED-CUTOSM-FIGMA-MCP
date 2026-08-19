import { ERROR_CODES, UnifiedError, errorShape, normalizeBackendError } from "../errors.js";
import { nowIso } from "../utils.js";

export function unavailableStatus(id, error) {
  const normalized = normalizeBackendError(error);
  return {
    id,
    mcpAvailable: false,
    bridgeAvailable: null,
    pluginPaired: null,
    figmaConnected: false,
    usable: false,
    lastCheckedAt: nowIso(),
    error: errorShape(normalized)
  };
}

export class BackendAdapter {
  constructor({ id, displayName, config, logger }) {
    this.id = id;
    this.displayName = displayName;
    this.config = config;
    this.logger = logger;
  }

  getCapabilities() {
    return {
      id: this.id,
      displayName: this.displayName,
      diagnostics: ["status", "safe-read"],
      writes: false
    };
  }

  async isAvailable() {
    return (await this.getStatus()).mcpAvailable;
  }

  async isFigmaUsable() {
    return (await this.getStatus()).usable;
  }

  requirePaired(status) {
    if (!status.usable) {
      throw new UnifiedError(ERROR_CODES.BACKEND_NOT_PAIRED, `${this.id} backend is not paired with Figma.`, { status });
    }
  }
}
