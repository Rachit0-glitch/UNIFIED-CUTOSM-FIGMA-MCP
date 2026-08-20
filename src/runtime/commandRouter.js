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
    // Block A / A10 — a "compound" capability (custom.measure/custom.diff/custom.verify) doesn't map
    // to one protocol envelope at all: it needs to read N existing nodes (each its own bridge round
    // trip, still queued individually to preserve the single-plugin-connection FIFO invariant) and then
    // run pure Node-side comparison logic (the real, imported figma-custom-mcp diff.js/measure.js) on
    // the results — there is no adapter/envelope/single-bridge-call shape that fits that. See
    // src/runtime/compoundCapabilities.js.
    if (capability.compound) {
      const parsedPayload = capability.schema.safeParse(payload ?? {});
      if (!parsedPayload.success) {
        throw new UnifiedError(
          ERROR_CODES.INVALID_PAYLOAD,
          `${capability.id}: ${parsedPayload.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
          { source: capability.family, capability: capability.id, issues: parsedPayload.error.issues }
        );
      }
      const requestId = createRequestId();
      const startedAt = Date.now();
      let result;
      let error = null;
      try {
        result = await capability.handler({ payload: parsedPayload.data, bridge: this.bridge, queue: this.queue, requestId, capability });
      } catch (e) {
        error = errorShape(e instanceof UnifiedError ? e : new UnifiedError(ERROR_CODES.COMMAND_EXECUTION_FAILED, e instanceof Error ? e.message : String(e), { source: capability.family }));
      }
      return {
        ok: error === null,
        capability: capability.id,
        requestId,
        family: capability.family,
        operation: capability.operation,
        result: error === null ? result : null,
        error,
        response: { protocolVersion: PROTOCOL_VERSION, requestId, ok: error === null, family: capability.family, operation: capability.operation, result: error === null ? result : null, error, durationMs: Date.now() - startedAt },
        durationMs: Date.now() - startedAt,
        verification: null,
        runtime: this.bridge.status(),
        queue: this.queue.status()
      };
    }
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
    // Block A / A2 — `toEnvelope` may be async now (e.g. CustomProtocolAdapter compiling a `custom.design`
    // DesignDoc via the real figma-custom-mcp compiler, which does async asset resolution). `await` on a
    // plain synchronous return value is a no-op, so every existing adapter's behavior is unchanged.
    const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload.data, requestId, metadata });
    const startedAt = Date.now();
    // Block A / A2 — `custom.design`'s dryRun mode short-circuits here: the adapter already did real
    // validation + compilation (via the actual figma-custom-mcp compiler), so a dry run never touches
    // the queue or bridge at all, exactly like figma_design's own dryRun contract. `dryRunResult` is
    // internal to this process, never a real protocol envelope.
    if (envelope && envelope.dryRunResult) {
      return {
        ok: true,
        capability: capability.id,
        requestId,
        family: capability.family,
        operation: capability.operation,
        result: envelope.dryRunResult,
        error: null,
        response: { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, family: capability.family, operation: capability.operation, result: envelope.dryRunResult, error: null, durationMs: Date.now() - startedAt },
        durationMs: Date.now() - startedAt,
        verification: null,
        runtime: this.bridge.status(),
        queue: this.queue.status()
      };
    }
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
