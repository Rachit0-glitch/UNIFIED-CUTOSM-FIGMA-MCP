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
      throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `No protocol adapter registered for family: ${capability.family}.`, { source: capability.family });
    }
    // H9 — schema-driven validation: the capability's OWN Zod schema is the single source of truth
    // for payload shape, validated once here (with defaults applied) before any adapter or bridge
    // work happens. Adapters receive already-clean, already-defaulted data.
    const parsedPayload = capability.schema.safeParse(payload ?? {});
    if (!parsedPayload.success) {
      throw new UnifiedError(
        ERROR_CODES.INVALID_PAYLOAD,
        `${capability.id}: ${parsedPayload.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
        { source: capability.family, capability: capability.id, issues: parsedPayload.error.issues }
      );
    }
    const requestId = createRequestId();
    const envelope = adapter.toEnvelope({ capability, payload: parsedPayload.data, requestId, metadata });
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
      error: response.ok ? null : response.error || errorShape(new UnifiedError(ERROR_CODES.COMMAND_EXECUTION_FAILED, `${capability.id} failed.`, { source: capability.family })),
      response,
      durationMs,
      // H10 — reserved for a future optional read-after-write follow-up (Block A/B territory, not
      // implemented here). Present now, always null, so the response SHAPE never has to change later
      // to add it — only this field's value would start being populated.
      verification: null,
      runtime: this.bridge.status(),
      queue: this.queue.status()
    };
  }
}
