# Production Readiness — Final State

Written at the close of the Production Lock task (post-Block-B), for anyone returning to this project
months later with no other context. This is the single document meant to answer "what is the current
state, and what must I NOT casually change."

## 1. Architecture (frozen)

```
AI Client (LLM)
   │
   │  unified_capabilities   — list production capabilities
   │  unified_execute        — run ONE capability
   │  unified_execute_plan   — run an ordered, already-decided list of capability steps
   │  unified_runtime_status — bridge/plugin/queue health
   ▼
Unified MCP (src/server.js) → UnifiedRuntimeService (src/runtime/service.js)
   ▼
CommandRouter (src/runtime/commandRouter.js)
   — resolves capability, validates payload shape+schema, attaches operationRecord
   ▼
CommandQueue (src/runtime/commandQueue.js) — strict single-active-lane FIFO
   ▼
UnifiedRuntimeBridge (src/runtime/unifiedBridge.js) — one WebSocket, ws://127.0.0.1:39417
   ▼
figma-plugin/code.js + ui.html  — the ONE Unified Runtime plugin, never switched
   ▼
Figma
```

This shape is now frozen. Do not: introduce a second plugin, rewrite the queue/bridge/router core,
re-enable the legacy dual-runtime path by default, or modify the original Plumb/Custom MCP packages.

## 2. Current capability count

**29 capabilities**: 4 Plumb, 25 Custom (see `docs/CAPABILITY_REGISTRY.md` for the full table). Every
capability's metadata (`id`, `family`, `operation`, `description`, `mutation`, `enabled`, `stage`,
`schema`, `timeoutMs`, `retrySafety`) is complete — verified this pass (found and fixed: the 3 compound
P3 capabilities, `custom.diff`/`custom.verify`/`custom.measure`, were missing an explicit `timeoutMs`;
now documented as per-internal-read, matching their real enforced behavior — see
`src/runtime/compoundCapabilities.js`).

## 3. Current MCP tools

Production (always registered): `unified_capabilities`, `unified_execute`, `unified_execute_plan`,
`unified_runtime_status`, plus 3 explicitly-labeled-DEPRECATED convenience wrappers
(`unified_runtime_plumb_read`, `unified_runtime_custom_read`, `unified_runtime_acceptance_sequence`,
kept only because existing tests exercise the underlying service methods — not a hidden or accidental
surface, their descriptions say DEPRECATED and point back to `unified_execute`).

Gated (`UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` only): `unified_status`, `unified_backends`,
`unified_active_backend`, `unified_probe_backend` — the old dual-runtime diagnostic path. Not registered
in a normal production session. See `docs/LEGACY_RUNTIME_POLICY.md`.

## 4. Runtime path

Single plugin, single bridge, single command queue. No parallel execution path exists or should be
added. `figma-plugin/manifest.json` names exactly one plugin (`Unified Runtime`).

## 5. Plumb/Custom ownership (frozen policy)

Plumb owns: `status`, `outline`, `selection.read`, `components` (inspection-only, proven strong in Block
A). Custom owns everything else: full-fidelity reads, all creation/mutation, all P2 (styles, variables,
masks, component/instance mechanics), all P3 (measure/diff/verify). `plumb.node.read` and
`plumb.tokens` remain deliberately NOT ported — Custom's full-fidelity read path already covers what
they would provide, and no concrete unmet requirement has appeared across Block A, Block B, or this
Production Lock pass. Do not port either "for symmetry." Full reasoning:
`docs/BLOCK_B_ROUTING_POLICY.md`.

## 6. Operation model

Every `unified_execute`/`unified_execute_plan` response carries an `operationRecord`: `operationId`,
`capability`, `family`, `mutation`, `retrySafety`, `target`, `payloadFingerprint`, `status`
(`queued`/`running`/`succeeded`/`failed`/`timed_out`/`reconciled`), `dryRun`, `neverReachedBridge`,
timestamps. See `docs/BLOCK_B_OPERATION_MODEL.md`.

## 7. Retry model (frozen classification)

Every mutating capability is classified `natural` / `operationKey` / `reconciliation` / `unsafe`. Full
table and reasoning: `docs/BLOCK_B_RETRY_RECONCILIATION.md`. Re-audited this pass (Production Lock §7):
classification still matches actual behavior — confirmed via `tests/production-lock.test.js`'s
duplicate/replay test (a `natural` capability's identical replay produces an identical payload
fingerprint, a distinct operationId, and no corruption) plus the pre-existing live evidence in
`docs/BLOCK_B_LIVE_RESULTS.md` (operationKey dedup for `custom.group`/`custom.create_component_set`,
`mode:"sync"` reconciliation for `custom.design` at both 901-node and 289-node/6-node scale).

## 8. Reconciliation behavior

`src/runtime/reconciliation.js`'s `recommendReconciliation()` is a pure function — it recommends, never
auto-retries. No mutating capability is ever automatically retried on an ambiguous outcome; the caller
(the LLM) must decide, informed by the recommendation. This did not change in Production Lock.

## 9. Execution planner + mid-flight interruption/resume (closed this pass)

`unified_execute_plan` executes an ordered, already-decided list of steps with dependency ordering,
checkpoints, and resumability. **New this pass**: an optional `pauseAtCheckpoint` parameter — the
smallest production-safe addition identified to make a genuine, externally-observable mid-plan pause
possible (not a database, not a workflow engine — see `src/planning/executionPlanner.js`'s own comment
for the full reasoning). A step's status can now be `paused` (deliberate, not a failure) distinct from
`blocked` (a dependency failure).

This closed Block B's one remaining documented limitation. Live-proven end to end
(`scripts/production-lock-interruption-live.mjs`, 14/14 PASS) against a REAL plugin disconnect/
reconnect: plan starts → several steps complete → deliberately paused at a checkpoint → plugin
genuinely disconnects → an attempt to continue the SAME plan while disconnected fails safely
(`PLUGIN_DISCONNECTED`, no mutation) → plugin genuinely reconnects (`connectionGeneration` increments)
→ real Figma state inspected → the SAME session (same `sessionId`) resumes → remaining steps complete →
verify → verify again (zero corrective mutation) → confirmed zero duplication.

## 10. Connection recovery

Real plugin close/reopen: proven safe (Block B's `scripts/block-b-reconnect-live.mjs`, 7/7, and this
pass's interruption test, both independently). `connectionGeneration` (a diagnostics-only monotonic
counter, never used to gate correctness — correctness stays purely `requestId`-based) increments
correctly across every real reconnect observed across this entire project. Font cache
(`loadedFontKeys` in `figma-plugin/code.js`) correctly resets on every genuinely new plugin runtime
(verified live in Block B).

## 11. MCP-process-restart boundary (closed this pass, honestly)

**The planner holds NO server-side session state.** Every `run` object returned by
`unified_execute_plan` is the ONLY copy of that execution's state — resuming means the caller passes
that exact object back in `previousRun`. Consequence, proven live this pass
(`scripts/production-lock-process-restart-live.mjs`, 8/8 PASS): a real MCP server process can be killed
and replaced with a brand-new process, and a paused plan resumes correctly against the new process,
**as long as the caller (the LLM/client) retained the `run` object**. If the caller ALSO loses that
object (e.g., a conversation reset without saving it), the plan state is genuinely gone — nothing is
persisted to disk. This is stated as an honest limitation, not glossed over: no database or file-based
persistence was added, because no evidenced need for surviving a *caller-side* memory loss (as opposed
to a server-process restart, which IS handled) has appeared. If that need appears later, the smallest
addition would be an opt-in "write the last N `run` objects to a local JSON file" — deliberately not
built speculatively.

## 12. Timeout behavior

| Capability class | Timeout | Source |
|---|---|---|
| Most single-bridge-call capabilities | 8000ms | `src/runtime/capabilities.js` |
| `plumb.components` (whole-file enumeration) | 15000ms | `src/runtime/capabilities.js` |
| Compound P3 (`custom.diff`/`verify`/`measure`) | 15000ms **per internal read** (not a single cap on the whole op — see item 2) | `src/runtime/compoundCapabilities.js` |
| Queue wait (before a command even starts) | 15000ms | `src/runtime/commandQueue.js` |

Measured evidence: single mutations complete in single-digit milliseconds against a warm connection
(`docs/BLOCK_B_PERFORMANCE.md`); the only observed timeouts in this whole project were either a genuine,
reproducible Figma-cloud connectivity delay on `getNodeByIdAsync` (environmental, documented in
`docs/BLOCK_B_LIMITATIONS.md`) or the deliberately-injected `PLUGIN_DISCONNECTED` cases in this pass's
interruption test. No evidence of timeouts being too short (causing false failures) or too long (causing
hangs) has appeared — not blindly re-tuned without evidence, per instruction.

## 13. Performance baseline

See `docs/BLOCK_B_PERFORMANCE.md` for full detail. Headline numbers: 20 real mutations in 101ms
sequential / 62ms concurrent; a real 289-node landing page (mixed frames/auto-layout/text/component+
instances/vector/mask/styles/variables) built and fully verified through the whole acceptance sequence;
Block A's 901-node uniform stress test remains the large-scale baseline, unmodified since Block A.

## 14. Known environment limits

- Figma Starter-plan 3-page cap on the test environment — all live tests reuse one page for this
  reason; production code does not assume a 3-page maximum anywhere.
- A recurring, genuine, reproducible `figma.getNodeByIdAsync` cloud-connectivity delay under
  `documentAccess:"dynamic-page"`, observed multiple times across Block B and this pass. Not a
  Unified/Custom MCP defect.

## 15. What is intentionally deferred (not a gap — a decision)

- `figma_batch`: not built. Real measured evidence (`docs/BLOCK_B_BATCH_DECISION.md`) shows
  `CommandQueue` + the planner already suffice; a batch primitive would only reduce already-cheap local
  MCP round trips, not the dominant Figma-side latency, and risks a false "atomic" claim.
- `plumb.node.read` / `plumb.tokens`: not ported (item 5).
- Persistent (disk-backed) execution-session storage: not built (item 11) — no evidenced need for
  surviving caller-side memory loss, only server-process restart (which is already handled).
- A configurable max-plan-step cap: not added — `unified_execute_plan` has run 62-step real plans with
  no issue; no evidenced need for a cap yet.

## 16. What MUST NOT be modified casually

- The original `FIGMA-CUSTOM-MCP` package (a separate git repo, confirmed clean/untouched this pass) and
  the globally-installed `plumb-mcp` npm package. Unified imports their real modules; it must never fork
  or reimplement them.
- `CommandQueue`'s single-active-lane FIFO guarantee (re-verified this pass,
  `tests/production-lock.test.js`) — do not add concurrency here "for speed"; correctness (one bridge
  command at a time) is load-bearing for the whole retry-safety/reconciliation model.
- The retry-safety classification in `src/runtime/capabilities.js` — changing a capability's class
  without re-verifying its actual behavior would silently invalidate the reconciliation guidance callers
  rely on.
- `figma-plugin/manifest.json` — must continue to name exactly one plugin.

## 17. Block C status

**NOT STARTED.** No Block C functionality exists anywhere in this codebase. This document, and the
Production Lock commit that accompanies it, is the frozen baseline Block C (whenever it begins) should
build from.
