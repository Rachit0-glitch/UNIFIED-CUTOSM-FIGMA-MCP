# Block B §12/§24 — Performance

Block A's own numbers remain the baseline (unchanged, not re-measured here — Block B added no
regression risk to the bridge/queue/plugin core path that would plausibly move them):

| Operation | Block A baseline |
|---|---|
| Bulk build, ~901 uniform nodes (`custom.design`) | ~22-24s |
| Full-fidelity read, ~1.12MB payload | ~9-10s |
| Filtered (include-scoped) read | ~0.86s |
| Single-node P3 op (measure/diff/verify) | <100ms |

## New Block B measurements

### §2B — 20 real mutations against a live document (`scripts/block-b-batch-evidence-live.mjs`)

The one precisely-instrumented Block B timing measurement, run 2026-08-21 against the real, paired
plugin:

| Workload | Total | Per-op avg |
|---|---|---|
| 20 `custom.patch_node` calls, sequential | 101ms | 5.05ms |
| the same 20 calls, concurrent (`Promise.all`) | 62ms | ~3.1ms |
| 20-node bulk creation via `custom.design` | 232ms | 11.6ms/node |

This is the evidence behind the §2B batch decision (`docs/BLOCK_B_BATCH_DECISION.md`) — real per-call
overhead is single-digit milliseconds, far below any threshold that would justify a batching primitive.

### §18-19 acceptance test — functional evidence, timing NOT separately instrumented

The 289-node landing page acceptance test (`scripts/block-b-acceptance-live.mjs`) exercised every
capability family at real scale — 45-node bulk structure creation, 60 sequential
`custom.create_instance` calls through the planner, styling/variable/mask calls, measure/diff/verify,
and a final full-depth 289-node read — and every step completed well within each capability's own
configured timeout (`custom.node.read`: 8-15s depending on capability; none were close to that ceiling
except the two `plumb.*` calls noted below). **Precise per-phase millisecond timing for this specific
run was not captured** — the test script logs full request/response payloads (already large for a
289-node tree) rather than a separate timing trace, and the structure/instance-plan calls'
console-printed JSON truncated before reaching timing fields for the larger steps. This is an honest
gap, not a fabricated number: the 20-mutation measurement above is the only sub-second-precision Block B
timing on record. If exact §18-19-scale timing is needed later, rerunning with explicit
`Date.now()` capture around each phase (already done for a few steps, not all) would close it cheaply.

### A real, non-baseline finding: `plumb.outline`/`plumb.components` were slow on one run

During the first attempt at the §18-19 acceptance test, `plumb.outline` (configured `timeoutMs: 8000`)
and `plumb.components` (configured `timeoutMs: 15000`) both hit their exact configured timeout — a
genuine `COMMAND_TIMEOUT`, not a script bug. The bridge's own orphan-response diagnostics recorded
`orphanResponseCount: 1` at the same time, meaning at least one of these commands' real response did
eventually arrive after its timeout — consistent with (not a new instance of, but the same class as) the
`figma.getNodeByIdAsync` cloud-connectivity delay already documented in `docs/BLOCK_B_LIMITATIONS.md`.
On the immediately following (fixed) run, both calls completed normally with no retry needed. Treated as
the same known environmental condition, not a new performance regression — `plumb.components`
specifically enumerates every COMPONENT/COMPONENT_SET **across the whole file**, so on a file that has
accumulated many components/instances across a long test session (as this one has), it is plausible
that's also a genuine contributing factor worth watching, not purely environmental. Not chasing this
further within Block B's scope; noted for anyone investigating Plumb-family performance later.

## What Block B did NOT do here

Per §12's own instruction to avoid fabricated benchmarks: no synthetic 100/500/1000/1500-node sweep with
a controlled, isolated timing harness was run. The 289-node §18-19 build is real evidence at a
meaningfully large, realistic (non-uniform) scale, and the 20-mutation batch-evidence measurement is
real evidence at the individual-operation level — together they cover the two ends of the spectrum the
brief cares about (single-op latency, and a large realistic build) without inventing numbers in between.
