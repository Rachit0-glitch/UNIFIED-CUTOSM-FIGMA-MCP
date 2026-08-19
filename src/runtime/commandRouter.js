import { ERROR_CODES, UnifiedError, errorShape } from "../errors.js";
import { createRequestId, PROTOCOL_VERSION } from "./protocol.js";

export class CommandRouter {
  constructor({ registry, adapters, bridge, queue, logger }) {
    this.registry = registry;
    this.adapters = adapters;
    this.bridge = bridge;
    this.queue = queue;
    this.logger = logger;
  }

  capabilities() {
    return {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: this.registry.list().map(({ id, family, operation, description, mutation, enabled, stage }) => ({
        id,
        family,
        operation,
        description,
        mutation,
        enabled,
        stage
      }))
    };
  }

  async execute({ capability: capabilityId, payload = {}, metadata = {} } = {}) {
    const capability = this.registry.get(capabilityId);
    const adapter = this.adapters.get(capability.family);
    if (!adapter) {
      throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `No protocol adapter registered for family: ${capability.family}.`);
    }
    const requestId = createRequestId();
    const envelope = adapter.toEnvelope({ capability, payload, requestId, metadata });
    const startedAt = Date.now();
    this.logger?.event?.({
      requestId,
      capability: capability.id,
      family: capability.family,
      operation: capability.operation,
      status: "route"
    });
    const response = await this.queue.enqueue(
      async () => await this.bridge.execute(envelope, capability.timeoutMs),
      { requestId, capability: capability.id, family: capability.family, operation: capability.operation }
    );
    const durationMs = Date.now() - startedAt;
    return {
      ok: response.ok,
      capability: capability.id,
      requestId,
      family: capability.family,
      operation: capability.operation,
      result: response.ok ? response.result : null,
      error: response.ok ? null : response.error || errorShape(new UnifiedError(ERROR_CODES.COMMAND_EXECUTION_FAILED, `${capability.id} failed.`)),
      response,
      durationMs,
      runtime: this.bridge.status(),
      queue: this.queue.status()
    };
  }
}
