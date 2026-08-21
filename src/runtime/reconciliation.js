/**
 * Block B §4 — the reconciliation decision engine. A PURE function: given an ambiguous mutation
 * outcome (timeout, queue-wait-timeout, or any other status where "did Figma actually change?" is
 * unknown), it returns a RECOMMENDATION, never performs a retry itself. The brief is explicit that the
 * system must not blindly retry a mutation — this keeps a human or the calling LLM in control of the
 * actual retry decision, while making the SAFE action obvious and mechanically checkable.
 *
 * This does not duplicate custom.design's own real mode:"sync" reconciliation logic (that's real
 * Figma-plugin-sandbox behavior, ported verbatim from Custom MCP in Block A/A2) — it only decides WHEN
 * to recommend using it.
 */

const AMBIGUOUS_ERROR_CODES = new Set(["COMMAND_TIMEOUT", "QUEUE_WAIT_TIMEOUT"]);

/**
 * @param {object} args
 * @param {object} args.capability - the resolved capability definition (from CapabilityRegistry.get()),
 *   must carry `retrySafety` (see runtime/capabilities.js).
 * @param {object} args.payload - the payload that was attempted.
 * @param {object} args.error - the errorShape()-normalized error from the failed attempt (may be null
 *   for a non-error ambiguous case, e.g. a genuine orphan-response scenario surfaced separately).
 * @returns {{ action: string, safe: boolean, recommendedPayload?: object, recommendedCapability?: string, reason: string, verifyFirst?: { capability: string, payload: object } }}
 */
export function recommendReconciliation({ capability, payload, error }) {
  const isAmbiguous = !error || AMBIGUOUS_ERROR_CODES.has(error.code);
  if (!isAmbiguous) {
    // A clean, unambiguous failure (e.g. NODE_NOT_FOUND, INVALID_PAYLOAD) — Figma state is KNOWN, not
    // ambiguous. Retrying with corrected input is always fine; retrying with the SAME input will just
    // fail the same way again. Neither is "reconciliation" — there's nothing to reconcile.
    return { action: "fix_and_retry_or_give_up", safe: true, reason: `"${error.code}" is not an ambiguous outcome — Figma's state is already known, no reconciliation needed.` };
  }

  switch (capability.retrySafety) {
    case "natural":
      return {
        action: "retry_as_is",
        safe: true,
        reason: `"${capability.id}" is naturally idempotent — re-running the identical payload has the same effect (or fails cleanly, e.g. NODE_NOT_FOUND on an already-deleted target), never a duplicate mutation.`
      };

    case "operationKey": {
      const hasKey = typeof payload?.operationKey === "string" && payload.operationKey.length > 0;
      if (hasKey) {
        return {
          action: "retry_as_is",
          safe: true,
          reason: `"${capability.id}" was called with an operationKey ("${payload.operationKey}") — a retry will find and reuse the existing tagged result instead of duplicating it (live-verified in Block A).`
        };
      }
      return {
        action: "add_operation_key_before_retry",
        safe: false,
        reason: `"${capability.id}" was called WITHOUT an operationKey — a blind retry can create a duplicate. Add a stable operationKey to the payload before retrying (the same key both times makes the retry idempotent).`
      };
    }

    case "reconciliation": {
      if (capability.id === "custom.design") {
        const mode = payload?.doc?.mode ?? "create";
        if (mode === "sync") {
          return { action: "retry_as_is", safe: true, reason: `custom.design was already called with mode:"sync" — retrying is safe (verified at 901-node scale in Block A: created:0, updated:N on a repeat build).` };
        }
        return {
          action: "retry_with_modified_payload",
          safe: true,
          recommendedPayload: { ...payload, doc: { ...payload.doc, mode: "sync", prune: payload?.doc?.prune ?? false } },
          reason: `custom.design was called with mode:"${mode}" (not idempotent — a blind retry creates duplicate nodes). The safe retry is the SAME doc with mode:"sync", which reconciles against any nodes that were already created instead of duplicating them.`
        };
      }
      return {
        action: "manual_reconciliation_required",
        safe: false,
        reason: `"${capability.id}" is classified "reconciliation" but has no known automatic safe-retry payload transform defined in recommendReconciliation() — inspect real Figma state before retrying.`
      };
    }

    case "unsafe":
    default: {
      const target = payload?.nodeId ?? payload?.instanceId ?? payload?.componentId ?? null;
      return {
        action: "inspect_before_retry",
        safe: false,
        reason: `"${capability.id}" has no built-in dedup mechanism — a blind retry after an ambiguous "${error?.code ?? "unknown"}" outcome CAN create a duplicate. Read back the expected result first to determine whether the mutation already happened.`,
        verifyFirst: target ? { capability: "custom.node.read", payload: { nodeId: target, depth: 0, include: ["metadata"] } } : null
      };
    }
  }
}
