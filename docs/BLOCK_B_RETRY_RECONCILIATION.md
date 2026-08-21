# Block B §4 — Retry & Reconciliation

The brief's core instruction: **"DO NOT blindly retry mutation. Execute → ambiguous response → inspect
actual Figma state → determine if mutation happened → reconcile → retry only if required."** This
document is the reference for how that's implemented — split across two deliberately separate pieces
with no overlap:

1. **Classification** (`src/runtime/capabilities.js`) — a static, per-capability answer to "what kind of
   retry-safety does this capability have," computed once when capabilities are loaded.
2. **Recommendation** (`src/runtime/reconciliation.js`) — a pure function, `recommendReconciliation()`,
   that takes a classification + an actual ambiguous failure and recommends an action. It never performs
   a retry itself — the caller (the LLM) stays in control of the actual retry decision.

Neither piece is a "retry engine" that automatically retries anything. That is deliberate: an automatic
retry loop hidden inside the router would be exactly the "blindly retry" behavior §4 prohibits, just
moved one layer down instead of removed.

## When does "ambiguous" even apply?

Only two outcomes are treated as ambiguous: `COMMAND_TIMEOUT` and `QUEUE_WAIT_TIMEOUT` — cases where the
command may or may not have reached/executed on the real Figma document. Every other error code (e.g.
`NODE_NOT_FOUND`, `INVALID_PAYLOAD`, `INVALID_HIERARCHY`) is **not** ambiguous — Figma's state is already
known in those cases (the operation cleanly did not happen), so `recommendReconciliation` returns
`fix_and_retry_or_give_up` immediately, with no further classification needed.

## The four retry-safety classes

| Class | Meaning | Members | Recommended action on ambiguous failure |
|---|---|---|---|
| `natural` | Safe to retry as-is; either genuinely idempotent or fails cleanly on a repeat | `custom.patch_node`, `delete_node`, `reorder_node`, `move_node`, `ungroup`, `create_paint_style`, `styles`, `text_range`, `instance_override`, `instance_swap`, `set_mask` | `retry_as_is` |
| `operationKey` | Safe **only** with a caller-supplied stable key | `custom.group`, `custom.create_component_set` | `retry_as_is` if `payload.operationKey` is present, else `add_operation_key_before_retry` |
| `reconciliation` | Not safe as authored, but has a known safe retry *mode* | `custom.design` | `retry_as_is` if `doc.mode==="sync"` already; otherwise `retry_with_modified_payload` — the same doc, with `doc.mode` forced to `"sync"` |
| `unsafe` | No dedup mechanism exists anywhere in the stack | `custom.boolean`, `custom.create_instance`, `custom.component_property`, `custom.variables` | `inspect_before_retry`, with a concrete `verifyFirst` read to run first when the payload has an identifiable target |

Full per-capability reasoning (including *why* each specific one is classified the way it is) lives as
inline comments next to the `RETRY_SAFETY` map in `src/runtime/capabilities.js` — not duplicated here, to
avoid the two drifting out of sync.

## Live evidence for the `reconciliation` class

`custom.design`'s `mode:"sync"` retry path is the one classification backed by large-scale live proof:
Block A's 901-node stress test re-ran the identical build with `mode:"sync"` and got `created:0,
updated:N` — zero duplication. Block B's vector acceptance test (`scripts/block-b-vector-acceptance.mjs`)
repeated this at smaller scale with the same result. This is why `custom.design` is the one capability in
the `reconciliation` class with a fully automated `recommendedPayload` transform in
`recommendReconciliation()` — every other capability in a non-`natural`/`operationKey` class genuinely
requires the caller to inspect real state, because no equivalent safe-retry mode has been proven for them.

## `verifyFirst` — what "inspect before retry" actually means

For `unsafe` capabilities, `recommendReconciliation` extracts whatever identifiable target the payload
does carry (`nodeId`/`instanceId`/`componentId` — even when it's the *source* of the operation rather
than its not-yet-known result, e.g. `custom.create_instance`'s `componentId` is the template being
instanced, not the new instance) and returns a concrete `{capability: "custom.node.read", payload:
{nodeId, depth:0, include:["metadata"]}}` the caller can run first. When no identifiable target exists at
all (e.g. `custom.variables`'s `create_variable` action, which has no `nodeId`/`instanceId`/
`componentId` anywhere in its payload), `verifyFirst` is honestly `null` — there is nothing concrete to
check, and the reconciliation module does not pretend otherwise.

## How this composes with the execution planner

The planner (`src/planning/executionPlanner.js`) does not call `recommendReconciliation` automatically
either — a failed/timed-out step is reported as `failed`/`timed_out` in the run result, and it is up to
the caller to decide (using `recommendReconciliation`, if they choose) what to do before calling
`resumePlan`. This keeps the same "recommend, never auto-retry" boundary intact at the plan level, not
just the single-capability level.
