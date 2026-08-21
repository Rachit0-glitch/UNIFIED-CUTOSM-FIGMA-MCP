import { createHash, randomUUID } from "node:crypto";
import { ERROR_CODES, UnifiedError, errorShape } from "../errors.js";
import { createRequestId, PROTOCOL_VERSION } from "./protocol.js";
import { checkPayloadShape } from "./limits.js";

/**
 * Block B §3 — the operation model. Every mutating (and, for consistency, every) capability call now
 * carries enough identity to answer "what exactly was attempted, and can it safely be attempted
 * again?" without introducing a new subsystem — this is purely additive metadata on the existing
 * response shape (see CommandRouter.execute()'s returned `operation` field), so no Block A test that
 * reads `result.ok`/`result.result`/`result.error` etc. is affected.
 *
 * `operationId` identifies the LOGICAL attempt (stable across this one `execute()` call); `requestId`
 * (unchanged, pre-existing) identifies the wire-level envelope sent to the plugin. They are equal for
 * every capability today (one envelope per operation), but are kept as distinct concepts because a
 * future retry/reconciliation attempt for the SAME operationId would mint a new requestId.
 */
export function fingerprintPayload(payload) {
  // A simple, deterministic content fingerprint — not a security hash, just an identity aid so two
  // operations targeting the same capability+payload can be recognized as "the same attempt" for
  // reconciliation purposes (see docs/BLOCK_B_RETRY_RECONCILIATION.md).
  try {
    return createHash("sha256").update(JSON.stringify(payload ?? {})).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/** Best-effort extraction of "what node/target did this operation act on," for diagnostics — never
 * throws, never required to be present (many capabilities, e.g. plumb.outline, have no single target). */
function extractTarget(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.nodeId ?? payload.instanceId ?? payload.componentId ?? null;
}

export const OPERATION_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  RECONCILED: "reconciled"
});


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
    // Block B §25/§26 — runs BEFORE the capability's own (possibly recursive) Zod schema ever sees
    // this payload; see limits.js's checkPayloadShape for why this must exist and must be iterative.
    const shapeCheck = checkPayloadShape(payload);
    if (!shapeCheck.ok) {
      throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, `${capability.id}: ${shapeCheck.reason}`, { source: capability.family, capability: capability.id });
    }
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
      const operationId = randomUUID();
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
        queue: this.queue.status(),
        // Block B §3 — operation identity/status, additive (never removes any existing field above).
        operationRecord: this.#operationRecord({ operationId, capability, payload: parsedPayload.data, startedAt, error })
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
        queue: this.queue.status(),
        operationRecord: this.#operationRecord({ operationId: randomUUID(), capability, payload: parsedPayload.data, startedAt, error: null, dryRun: true })
      };
    }
    this.logger?.event?.({
      requestId,
      capability: capability.id,
      family: capability.family,
      operation: capability.operation,
      status: "route"
    });
    const operationId = randomUUID();
    let response;
    try {
      response = await this.queue.enqueue(
        async () => await this.bridge.execute(envelope, capability.timeoutMs),
        { requestId, operationId, capability: capability.id, family: capability.family, operation: capability.operation }
      );
    } catch (queueError) {
      // Block B §3/§5 — a QUEUE_FULL/QUEUE_WAIT_TIMEOUT rejection never reached the bridge at all (the
      // command was never sent to Figma), which is real, useful status information distinct from a
      // COMMAND_TIMEOUT (sent, but no reply in time) — both must still produce a proper operationRecord,
      // not throw past this point and lose operation identity.
      const normalized = queueError instanceof UnifiedError ? queueError : new UnifiedError(ERROR_CODES.COMMAND_EXECUTION_FAILED, queueError instanceof Error ? queueError.message : String(queueError), { source: capability.family });
      const error = errorShape(normalized);
      const durationMs = Date.now() - startedAt;
      return {
        ok: false,
        capability: capability.id,
        requestId,
        family: capability.family,
        operation: capability.operation,
        result: null,
        error,
        response: null,
        durationMs,
        verification: null,
        runtime: this.bridge.status(),
        queue: this.queue.status(),
        operationRecord: this.#operationRecord({ operationId, capability, payload: parsedPayload.data, startedAt, error, neverReachedBridge: true })
      };
    }
    const durationMs = Date.now() - startedAt;
    const error = response.ok ? null : response.error || errorShape(new UnifiedError(ERROR_CODES.COMMAND_EXECUTION_FAILED, `${capability.id} failed.`, { source: capability.family }));
    return {
      ok: response.ok,
      capability: capability.id,
      requestId,
      family: capability.family,
      operation: capability.operation,
      result: response.ok ? response.result : null,
      error,
      response,
      durationMs,
      // H10 — reserved for a future optional read-after-write follow-up (Block A/B territory, not
      // implemented here). Present now, always null, so the response SHAPE never has to change later
      // to add it — only this field's value would start being populated.
      verification: null,
      runtime: this.bridge.status(),
      queue: this.queue.status(),
      operationRecord: this.#operationRecord({ operationId, capability, payload: parsedPayload.data, startedAt, error })
    };
  }

  /**
   * Block B §3 — builds the operationRecord: enough identity to answer "what exactly was attempted,
   * and can it safely be attempted again?" `retrySafety` comes from the capability's own metadata (see
   * runtime/capabilities.js and docs/BLOCK_B_RETRY_RECONCILIATION.md) — this method never decides
   * retry-safety itself, only reports the capability's declared classification alongside this attempt's
   * outcome.
   */
  #operationRecord({ operationId, capability, payload, startedAt, error, dryRun = false, neverReachedBridge = false }) {
    let status;
    if (dryRun) status = OPERATION_STATUS.SUCCEEDED;
    else if (error === null) status = OPERATION_STATUS.SUCCEEDED;
    else if (error.code === ERROR_CODES.COMMAND_TIMEOUT || error.code === ERROR_CODES.QUEUE_WAIT_TIMEOUT) status = OPERATION_STATUS.TIMED_OUT;
    else status = OPERATION_STATUS.FAILED;
    return {
      operationId,
      capability: capability.id,
      family: capability.family,
      mutation: capability.mutation,
      retrySafety: capability.retrySafety || "unclassified",
      target: extractTarget(payload),
      payloadFingerprint: fingerprintPayload(payload),
      status,
      dryRun,
      neverReachedBridge,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString()
    };
  }
}
