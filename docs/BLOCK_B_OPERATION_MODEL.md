# Block B §3/§17 — Operation Model & Error Taxonomy Mapping

## §3: the operation record

Every `CommandRouter.execute()` call now returns an additive `operationRecord` field alongside the
existing `{ok, result, error, operation}` response shape (`src/runtime/commandRouter.js`,
`#operationRecord()`). It is deliberately named `operationRecord`, not `operation`, because
`operation: capability.operation` (a string like `"node.read"`) already existed and this is not a
replacement for it.

Fields, and why each exists:

| Field | Purpose |
|---|---|
| `operationId` | `crypto.randomUUID()` — the one identifier that answers "which specific attempt was this," across retries |
| `capability`, `family`, `mutation` | copied from the resolved capability definition — lets a caller reason about the attempt without re-resolving the capability |
| `retrySafety` | one of `natural` / `operationKey` / `reconciliation` / `unsafe` (see below) — the answer to "can this be safely retried" |
| `target` | best-effort `nodeId`/`instanceId`/`componentId` extracted from the payload — the thing a caller should read back to check real state |
| `payloadFingerprint` | `sha256(JSON.stringify(payload)).slice(0,16)` — lets two attempts be recognized as "the same requested mutation" without storing the full payload |
| `status` | `queued` / `running` / `succeeded` / `failed` / `timed_out` / `reconciled` (`OPERATION_STATUS` enum) |
| `dryRun`, `neverReachedBridge` | distinguishes "we know Figma's state didn't change" (dry-run, or the queue itself rejected the command before it ever reached the plugin) from an ambiguous outcome |
| `startedAt` / `completedAt` | ISO timestamps, for latency and staleness reasoning |

This directly answers §3's stated purpose — "what was attempted, can it safely be retried" — without
introducing a database or any persistent store; `operationRecord` is computed fresh on every response
and is cheap enough to attach unconditionally.

`requestId`, `parentOperationId`, and `sequence` (also named in §3) are intentionally **not** separate
fields on `operationRecord` today:
- `requestId` already exists one level down, on the bridge's `CommandEnvelope`
  (`src/runtime/protocol.js`) — every bridge round-trip already carries one, and `operationId` is a
  superset concern (it exists even for compound/dry-run paths that never reach the bridge at all).
- `parentOperationId` / `sequence` are supplied by the **execution planner** (§6/§8) instead, at the
  step level (`step.id`, `step.dependsOn`) — see `docs/BLOCK_B_ARCHITECTURE.md`. Duplicating them onto
  every individual `operationRecord` would mean two systems tracking the same ordering information;
  the planner is the single source of truth for plan-level sequencing.

## §4: retry-safety classification

Every mutating capability in `src/runtime/capabilities.js` carries a `retrySafety` classification,
applied via a single `RETRY_SAFETY` lookup table (not scattered per-capability) so the full
classification is auditable in one place:

- **`natural`** — safe to blind-retry as-is. Applies to single-target mutations whose own semantics are
  already idempotent or fail cleanly on a repeat (`custom.patch_node`, `delete_node`, `reorder_node`,
  `move_node`, `ungroup`, `create_paint_style`, `styles`, `text_range`, `instance_override`,
  `instance_swap`, `set_mask`). Example: retrying `delete_node` on an already-deleted node returns
  `NODE_NOT_FOUND`, not corruption.
- **`operationKey`** — safe **only** if the caller supplied a stable `operationKey` in the payload.
  Applies to `custom.group` and `custom.create_component_set`, both verified live in Block A: a repeat
  call with the same key finds and reuses the existing tagged result instead of duplicating it.
- **`reconciliation`** — not safe as originally authored, but has a distinct safe retry *mode*. Applies
  only to `custom.design`: the safe retry is not "call it again," it's "call it again with
  `doc.mode:"sync"`," proven at 901-node scale in Block A (`created:0, updated:N` on a repeat build).
- **`unsafe`** — no dedup mechanism exists anywhere in the stack. Applies to `custom.boolean`,
  `custom.create_instance`, `custom.component_property`, `custom.variables`. A blind retry here can
  create a duplicate boolean result, a duplicate instance, a duplicate property override, or a
  duplicate variable. The caller **must** inspect real Figma state before retrying.

The decision of *what to do* given a classification and an ambiguous failure is implemented separately,
as a pure function, in `src/runtime/reconciliation.js`'s `recommendReconciliation()` — see
`docs/BLOCK_B_RETRY_RECONCILIATION.md`. `commandRouter.js` and `capabilities.js` only classify;
`reconciliation.js` only recommends; neither ever performs a retry itself, by design (§4: "DO NOT
blindly retry mutation").

## §17: error taxonomy mapping

§17 asks for errors normalized into: `VALIDATION_ERROR`, `CAPABILITY_NOT_FOUND`,
`UNSUPPORTED_OPERATION`, `TARGET_NOT_FOUND`, `INVALID_HIERARCHY`, `FONT_ERROR`, `FIGMA_API_ERROR`,
`PLUGIN_DISCONNECTED`, `COMMAND_TIMEOUT`, `RECONCILIATION_FAILED`, `VERIFICATION_FAILED`,
`INTERNAL_ERROR`. Rather than introduce a second, parallel set of codes for categories `ERROR_CODES`
(`src/errors.js`) already covers under an established name (which would itself be a taxonomy defect —
two codes meaning the same failure class), the mapping is:

| §17 category | Actual code used | Why not renamed |
|---|---|---|
| `VALIDATION_ERROR` | `INVALID_PAYLOAD` | already thrown by every Zod schema `.strict()` failure across the whole request path (Block A); renaming would be a pure churn change with zero behavioral benefit |
| `CAPABILITY_NOT_FOUND` | `CAPABILITY_NOT_FOUND` | already an exact match |
| `UNSUPPORTED_OPERATION` | `INVALID_COMMAND` | already covers "no such family.operation combination exists" |
| `TARGET_NOT_FOUND` | `NODE_NOT_FOUND` | already covers "nodeId/instanceId/componentId does not resolve in the live document" (Block A / A2) |
| `INVALID_HIERARCHY` | `INVALID_HIERARCHY` | **new in Block B** — no prior equivalent existed; added for parent/child structural violations (e.g. an invalid `parentId`, an attempt to nest a node under its own descendant) |
| `FONT_ERROR` | `FONT_ERROR` | **new in Block B** — no prior equivalent existed; added for font-load/availability failures distinct from a generic `FIGMA_API_ERROR` |
| `FIGMA_API_ERROR` | `FIGMA_API_ERROR` | already an exact match |
| `PLUGIN_DISCONNECTED` | `PLUGIN_DISCONNECTED` | already an exact match |
| `COMMAND_TIMEOUT` | `COMMAND_TIMEOUT` | already an exact match (see also `QUEUE_WAIT_TIMEOUT`, a deliberately distinct H7 code for "never started running" vs. "ran too long") |
| `RECONCILIATION_FAILED` | `RECONCILIATION_FAILED` | **new in Block B** — surfaced when a recommended reconciliation action itself cannot be completed (e.g. the verify-first read also fails) |
| `VERIFICATION_FAILED` | `VERIFICATION_FAILED` | **new in Block B** — distinct from `custom.verify`'s normal "diffs found" result; reserved for the verification *operation itself* failing to run, not for a clean diff report |
| `INTERNAL_ERROR` | `INTERNAL_ERROR` | already an exact match |

Every code above is still wrapped by `errorShape()` (`src/errors.js`), which preserves the original
`message` and any `details`/`source` alongside the `code` — normalization never destroys the specific
underlying cause, per §17's explicit requirement.
