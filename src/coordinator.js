import { ERROR_CODES, UnifiedError, errorShape } from "./errors.js";
import { determineActiveBackend } from "./registry.js";

export class UnifiedCoordinator {
  constructor({ registry, logger }) {
    this.registry = registry;
    this.logger = logger;
  }

  async status() {
    return await this.logger.timed("unified_status", "all", async () => {
      const backends = await this.registry.statuses();
      const activeBackend = determineActiveBackend(backends);
      return { ok: true, activeBackend, backends };
    });
  }

  async backends() {
    return await this.logger.timed("unified_backends", "all", async () => {
      const statuses = await this.registry.statuses();
      return {
        backends: this.registry.capabilities().map((capability) => ({
          ...capability,
          available: statuses[capability.id]?.mcpAvailable === true,
          usable: statuses[capability.id]?.usable === true,
          pluginPaired: statuses[capability.id]?.pluginPaired ?? null
        }))
      };
    });
  }

  async activeBackend() {
    return await this.logger.timed("unified_active_backend", "all", async () => {
      const status = await this.status();
      return { ok: true, activeBackend: status.activeBackend };
    });
  }

  async probeBackend({ backend }) {
    return await this.logger.timed("unified_probe_backend", backend || "unknown", async () => {
      if (!backend) {
        return { ok: false, error: errorShape(new UnifiedError(ERROR_CODES.BACKEND_NOT_FOUND, "Missing required backend argument.")) };
      }
      try {
        const adapter = this.registry.get(backend);
        return await adapter.executeDiagnostic({ type: "safe-read" });
      } catch (error) {
        return { ok: false, backend, error: errorShape(error) };
      }
    });
  }
}
