# Block B — Known Limitations (living document, updated as work progresses)

This is an honest, current accounting of what Block B has **not yet** closed, kept up to date as work
continues — not a final report (see `docs/BLOCK_B_FINAL_REPORT.md` for that, once written).

## Environmental (not a Unified/Custom MCP defect)

- **Transient Figma-cloud connectivity delay on freshly-paired sessions.** `figma.getNodeByIdAsync`
  under `documentAccess:"dynamic-page"` has twice produced a real `FIGMA_API_ERROR: "Unable to establish
  connection to Figma after 10 seconds"` shortly after a fresh plugin pairing (see
  `docs/BLOCK_B_LIVE_RESULTS.md`). Confirmed reproducible, confirmed not caused by the bridge/router/
  plugin code. Recurs occasionally; not something Block B can fix since it's Figma's own cloud
  connectivity, not local code.
- **Starter-plan 3-page cap** (carried over from Block A, per §27): all Block A/B live tests reuse the
  `"Block A Scratch"` page for this reason. Production logic does not assume a 3-page maximum anywhere —
  this is purely a test-environment constraint.

## Genuinely open (Block B work not yet done)

- **§21 (interruption/resume acceptance)**: a controlled interruption during a multi-stage build, then
  reconnect → inspect real state → resume remaining steps → verify, all in ONE combined live test. Not
  run as a single script — the two halves ARE each independently proven live: §14's reconnect test
  showed a real plugin disconnect immediately and safely rejects an in-flight request
  (`PLUGIN_DISCONNECTED`, never a silent hang or a double mutation), and §18-19/the planner's resume
  tests showed resuming a multi-step plan after a failure works correctly (including a real
  `unified_execute_plan` resume). `unified_execute_plan`'s single-call, run-to-completion shape (see
  `docs/BLOCK_B_ARCHITECTURE.md`) makes triggering a disconnect at a precise mid-plan moment from an
  external script structurally awkward — the composition of the two already-proven halves is real
  evidence, but a genuinely combined "disconnect while a plan is actively mid-flight, then resume the
  same plan" live test has not been run as one script. This is the one item in this document where the
  evidence is compositional rather than a single direct test — flagged explicitly rather than glossed
  over.
- **§24 (scale acceptance with a realistic node-type mixture)**: substantially addressed by §18-19 (289
  real nodes, a genuine mixture of frames/auto-layout/text/component+instances/vector/mask/styles/
  variables) — not re-run at Block A's larger 901-node scale with this same mixture; not blocking, since
  §18-19 already demonstrates the mixture works and Block A already demonstrated the scale (with a
  simpler, uniform mixture) separately.
- **§26 (resource limits), remainder**: `MAX_PAYLOAD_DEPTH`/`MAX_PAYLOAD_NODES` (payload shape) are now
  real and enforced (see below); still no Block B-specific cap on max plan steps, beyond Block A's
  existing queue-length/queue-wait-timeout limits. §18-19's 62-step plan (60 instance-creation steps in
  one plan) ran with no issue, so no evidenced need for a cap has appeared yet.
- **§30 documentation**: `BLOCK_B_PERFORMANCE.md` and `BLOCK_B_FINAL_REPORT.md` are still pending
  (architecture, routing policy, operation model, retry/reconciliation, batch decision, failure tests,
  live results, and this limitations doc are done).

## Resolved this session (no longer limitations)

- Vector/SVG authoring — closed (§23), see `docs/BLOCK_B_LIVE_RESULTS.md`.
- Operation model, retry-safety classification, reconciliation engine, execution planner with real
  dependency ordering/checkpoints/resume — built and unit-tested.
- The execution planner's MCP-reachability gap — it had zero MCP surface (unreachable by any real
  caller) until this session; closed via `unified_execute_plan` (`src/server.js`,
  `src/runtime/service.js`), with 3 new tests proving it works end-to-end through the real
  `CommandRouter`.
- `createdIds`/`createdTargets` gap — a creation step's result-only id (e.g. `custom.design`'s
  `result.ids`) was previously invisible to the planner's "what did this run create" tracking; fixed and
  unit-tested (2 new tests).
- `connectionGeneration` tracking — built, unit-tested, spot-confirmed live.
- `INVALID_HIERARCHY` and `FONT_ERROR` — designed, implemented, and live-verified against a real Figma
  document (§15/§17), including finding and fixing a real, unrelated bug (`ui.html`'s independently
  drifted `PLUGIN_VERSION` constant).
- §2B (`figma_batch` decision) — evidenced and closed: no primitive needed, see
  `docs/BLOCK_B_BATCH_DECISION.md`.
- §25/§26 (security/input-safety review, payload shape limits) — a REAL bug found and fixed: a
  pathologically deep payload made Zod's own `safeParse()` throw an uncaught `RangeError` instead of a
  clean validation error, because `custom.design`'s recursive schema has no built-in depth limit. Fixed
  with an iterative pre-check (`checkPayloadShape`, `src/runtime/limits.js`) run before any schema sees
  the payload. Also verified (not a bug): `__proto__`/`constructor` keys in a JSON payload create inert
  own-properties after `JSON.parse`, never real prototype pollution, and are independently rejected by
  every capability's `.strict()` schema anyway. See `docs/BLOCK_B_ARCHITECTURE.md`'s "A real
  stack-overflow bug found and fixed" section and `tests/security-hardening.test.js` (8 tests).
- 140/140 unit tests passing throughout, `npm run check` clean throughout.
- §14/§11 (connection recovery, font-cache lifecycle) — closed with a REAL plugin close/reopen cycle
  (not a fake transport): a genuine disconnect and reconnect were observed, `connectionGeneration`
  correctly incremented (1→2), the queue recovered cleanly, pre-restart-created nodes remained readable,
  and font resolution on a brand-new font weight worked cleanly post-reconnect (direct evidence the font
  cache correctly reset on the new plugin runtime). 7/7 real assertions across
  `scripts/block-b-reconnect-live.mjs` + a standalone follow-up. See `docs/BLOCK_B_LIVE_RESULTS.md`.
- Planner live verification (`scripts/block-b-planner-live.mjs`) — completed, 9/9 PASS against the real,
  paired plugin through the real `unified_execute_plan` MCP tool.
- **§18-19 (main design-construction acceptance test)** — completed, **27/27 PASS**: a real 289-node
  landing page (component + 60 instances, styles, variables, a mask, a vector badge) built and verified
  through the full required PREFLIGHT→PLAN→EXECUTE→CHECKPOINT→INSPECT→MEASURE→DIFF→CORRECT→VERIFY→VERIFY
  AGAIN sequence, plus a real intentional-failure→INSPECT STATE→RECONCILE→RESUME→VERIFY cycle and a
  final cross-family Plumb inspection, all through the same one plugin. Found and fixed 7 test-script
  bugs (not product bugs) and one genuine, already-documented environmental finding along the way — full
  detail in `docs/BLOCK_B_LIVE_RESULTS.md`.
- §22 (batch acceptance) — closed: §18-19's 62-step plan (60 real `custom.create_instance` calls in one
  `unified_execute_plan`) is exactly the "heterogeneous, multi-capability workload through the planner"
  proof §22 asked for, on top of §2B's decision not to build a separate batch primitive.
- **§20 (idempotency acceptance)** — completed, **8/8 PASS**
  (`scripts/block-b-idempotency-live.mjs`): a real design built once, then the byte-identical objective
  re-run twice via `mode:"sync"` — both re-runs `created:0`, a real read confirmed the node count stayed
  at 6 (not 12), and `custom.verify` against the real post-build state passed with zero corrective
  mutation, proving genuine convergence rather than a one-time "returned ok." Also surfaced a
  generalizable finding: an auto-layout ("hug") frame's authored `width`/`height` is only a hint unless
  `sizing` is explicitly set to `"fixed"` — verification must check the real post-build state, not the
  DesignDoc's authored values (the same pattern independently hit in §18-19). See
  `docs/BLOCK_B_LIVE_RESULTS.md`.
