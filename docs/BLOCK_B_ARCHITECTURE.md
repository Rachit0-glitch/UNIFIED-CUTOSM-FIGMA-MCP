# Block B — Architecture

Block B adds a production-hardening layer on top of Block A's execution substrate. Every addition here
is **additive**: the Block A architecture (AI Client → Unified MCP → Unified Coordinator/Runtime →
Plumb+Custom families → ONE Unified Runtime Figma plugin → Figma) is unchanged in shape. Nothing in
Block A was rewritten, replaced, or weakened — see `docs/BLOCK_B_LIMITATIONS.md` and the regression
counts in each doc for the evidence trail.

```
AI Client (LLM)
   │
   │  unified_execute            (Block A — one capability, one call)
   │  unified_execute_plan       (Block B — an ordered, already-decided list of capability steps)
   ▼
Unified MCP (src/server.js)
   │
   ▼
UnifiedRuntimeService (src/runtime/service.js)
   │                                    ┌── buildPlan / preflightPlan / executePlan / resumePlan
   │                                    │   (src/planning/executionPlanner.js — Block B §6/§8/§9)
   ├─ .execute()  ──────────────────────┤
   └─ .executePlan() ───────────────────┘
   │
   ▼
CommandRouter (src/runtime/commandRouter.js)
   │   - resolves capability (CapabilityRegistry, src/runtime/capabilities.js)
   │   - validates payload (Zod schema, .strict())
   │   - now ALSO attaches operationRecord to every response (Block A §3)
   │
   ▼
CommandQueue (src/runtime/commandQueue.js)   — strict single-active-lane FIFO, unchanged from Block A
   │
   ▼
UnifiedRuntimeBridge (src/runtime/unifiedBridge.js)
   │   - now ALSO tracks connectionGeneration (Block B §14/§16)
   │
   ▼  (one WebSocket, ws://127.0.0.1:39417)
figma-plugin/code.js + ui.html  (the ONE Unified Runtime plugin — never switched)
   │   - now ALSO throws INVALID_HIERARCHY / FONT_ERROR with real detail (Block B §15/§17)
   ▼
Figma
```

## What each Block B piece is, and why it lives where it does

| Piece | File(s) | Purpose |
|---|---|---|
| Operation model | `src/runtime/commandRouter.js` (`#operationRecord`, `fingerprintPayload`, `OPERATION_STATUS`) | attaches `operationId`/`status`/`target`/`payloadFingerprint`/etc. to every response, additive to the existing `{ok,result,error}` shape |
| Retry-safety classification | `src/runtime/capabilities.js` (`RETRY_SAFETY` map) | tags every mutating capability `natural`/`operationKey`/`reconciliation`/`unsafe` — see `docs/BLOCK_B_RETRY_RECONCILIATION.md` |
| Reconciliation decision engine | `src/runtime/reconciliation.js` (`recommendReconciliation`) | a pure function: given an ambiguous failure + a capability's classification, recommends what to do — never retries anything itself |
| Execution planner | `src/planning/executionPlanner.js` (`buildPlan`/`preflightPlan`/`executePlan`/`resumePlan`) | validates and executes an ordered, already-decided list of steps through the real `CommandRouter`; doubles as the "design execution session" (§8) via its return value — no separate session store |
| Planner's MCP surface | `src/runtime/service.js` (`executePlan`), `src/server.js` (`unified_execute_plan` tool) | the ONLY way a real caller reaches the planner; without this the planner module would be unreachable dead code from the MCP side (a Block B gap found and closed this session) |
| Connection generation | `src/runtime/unifiedBridge.js` (`connectionGeneration`) | a diagnostics-only monotonic counter for which physical plugin connection is paired — never used to gate correctness (that stays purely `requestId`-based) |
| New error codes | `src/errors.js` (`INVALID_HIERARCHY`, `FONT_ERROR`, `RECONCILIATION_FAILED`, `VERIFICATION_FAILED`), wired in `figma-plugin/code.js` | see `docs/BLOCK_B_OPERATION_MODEL.md` for the full §17 taxonomy mapping (most categories reuse existing Block A codes under a different name) |
| Payload shape guard | `src/runtime/limits.js` (`checkPayloadShape`, `MAX_PAYLOAD_DEPTH`, `MAX_PAYLOAD_NODES`), called from `CommandRouter.execute()` before any schema validation | §25/§26 — an iterative (non-recursive) pre-check rejecting pathologically deep/wide payloads with a clean `INVALID_PAYLOAD` before they ever reach a capability's own (possibly recursive) Zod schema — see "A real stack-overflow bug found and fixed" below |
| Routing policy | `docs/BLOCK_B_ROUTING_POLICY.md` | no code — documents why Plumb/Custom own what they own (already fully expressed by each capability's `family` field) |
| Batch decision | `docs/BLOCK_B_BATCH_DECISION.md` | no code — the deliberate decision NOT to build `figma_batch`, with real measured evidence |

## Why the planner is not a workflow engine

`buildPlan`/`executePlan` take an already-fully-decided list of `{capability, payload, dependsOn?,
checkpoint?}` steps. There is no template language, no conditional branching, no "reference a prior
step's not-yet-known output" mechanism. This is deliberate (§6/§29): the LLM remains the design
intelligence and decides *what* the steps are, exactly as it already decides which capability to call
with `unified_execute`; the planner's only job is mechanical — validate, order by `dependsOn`, execute
through the real router, track checkpoints, and support resuming a partially-completed run.

**Consequence**: a step cannot depend on another step's Figma-assigned id at plan-authoring time (e.g.
"patch the node `custom.design` is about to create" cannot be expressed as one plan, because that id
doesn't exist until execution). The correct pattern — proven in
`scripts/block-b-planner-live.mjs` — is two `unified_execute_plan` calls: create, inspect the real
`createdIds` in the first call's result, then plan the next step with the now-known id. This is not a
limitation to work around; it is the intended division of responsibility between the LLM (dynamic
decisions) and the planner (deterministic execution of decisions already made).

## `createdIds` vs `target` — a real gap found and closed this session

`operationRecord.target` (Block A/B §3) is a best-effort SCALAR extracted from the **payload**
(`nodeId`/`instanceId`/`componentId`) — it can only ever point at something the caller already knew
about. A creation step like `custom.design` has no such payload field; what it created only appears in
the **result** (`result.ids`, a map of the caller's own doc-authored logical ids to real Figma ids).
Without reading the result too, every creation step's contribution to "what did this run actually
create" (§8) would be silently lost. `executePlan` now also extracts `createdIds` from
`result.ids` when present, and folds both sources into the run-level `createdTargets` array. See the
comment at the top of `executePlan`'s per-step result construction in `src/planning/executionPlanner.js`
for the exact reasoning, and `tests/execution-planner.test.js`'s two `createdIds` tests for verification.

## A real stack-overflow bug found and fixed (§25/§26)

Several capability schemas — notably `custom.design`'s `DesignNodeSchema`, defined recursively via
Zod's `z.lazy()` in the imported `figma-custom-mcp` package — have no built-in nesting-depth limit. A
pathologically deep payload (verified with 50,000 nested frames) made Zod's own `safeParse()` — which is
documented to never throw — actually throw an uncaught `RangeError: Maximum call stack size exceeded`,
because the stack exhaustion happens deep inside Zod's own recursive parsing, before `safeParse`'s
try/catch wrapping ever gets a chance to run. That RangeError propagated out of
`CommandRouter.execute()` uncaught (no try/catch wrapped that call site), which `unified_execute`'s own
handler in `src/server.js` does catch and normalize — but only down to a generic `INTERNAL_ERROR`, not
the clean, structured `INVALID_PAYLOAD` §17/§25/§26 all require for a validation-shaped failure.

Fixed with `checkPayloadShape()` (`src/runtime/limits.js`), run BEFORE any capability's schema sees the
payload. It must be — and is — **iterative** (an explicit array-based stack, not recursion): a recursive
depth-checker would have exactly the stack-exhaustion problem it exists to prevent. It exits as soon as
depth exceeds the limit, so it stays cheap (verified under 500ms) even against a 500,000-level-deep
payload it never fully walks. Defaults (`MAX_PAYLOAD_DEPTH=200`, `MAX_PAYLOAD_NODES=200000`) are
generous relative to any real design — Block A's 901-node tree was ~2 levels deep, mostly siblings, not
a deep chain — so no legitimate payload is at risk of false rejection.

Separately verified (not a bug, but worth recording as evidence per §25): `__proto__`/`constructor`
keys in an incoming JSON payload create ordinary OWN data properties after `JSON.parse` (V8's
`JSON.parse` never triggers the prototype-accessor semantics `obj.__proto__ = x` would), so no actual
prototype pollution is possible via this path regardless of what any schema does. Every capability's
`.strict()` Zod schema additionally rejects such keys outright as "unrecognized keys," giving a second,
independent layer of rejection. See `tests/security-hardening.test.js` for the full proof (8 tests).

## Regression discipline

Every addition above was verified with `node --check` (syntax), `npm test` (full suite, currently
132/132), and — for everything with an observable effect on live Figma behavior — a real script against
the paired Unified Runtime plugin (see `docs/BLOCK_B_LIVE_RESULTS.md`). No Block A test was modified to
make it pass; no Block A capability's semantics changed.
