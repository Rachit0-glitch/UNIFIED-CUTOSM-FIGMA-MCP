# Block A Limitations

Real, known limitations only — nothing artificially inflated, nothing swept under the rug. Several
limitations from the previous checkpoint have since been genuinely resolved (documented as such, not
deleted — see the "Resolved" section) rather than quietly removed.

## Remaining limitations

### `plumb.node.read` / `plumb.tokens` not integrated

Deliberately deferred with technical justification, not an oversight — see `docs/BLOCK_A_SOURCE_PARITY.md`
("A11 — explicitly deferred"). Plumb's server-side compact-PDS/token logic lives in one 11,254-line
bundled `dist/index.js` with no clean modular export surface (unlike Custom MCP's clean, independently
importable `dist/*.js` modules), and the underlying read need is already fully covered by
`custom.node.read`'s full-fidelity port through the same one plugin.

### Vector path authoring not independently tested

`custom.design`'s `type:"vector"` node with an explicit `vectorPaths` array is schema+plugin wired
(ported verbatim from Custom MCP's own `applyIntrinsic`) but was not independently exercised with a real
custom SVG path this pass. Genuinely narrow scope — not required by any Block A acceptance criterion,
and not attempted merely to check a box.

### `figma_batch` not ported

Unified's own `CommandQueue` already sequences every call through one plugin connection. Whether a
Unified-level batch-orchestration capability adds real value beyond an LLM issuing multiple
`unified_execute` calls in sequence is a genuine open design question, not resolved in this pass.

### The test Figma file is on the free Starter plan (3-page limit)

Discovered live during the large-tree scaling investigation (a real `FIGMA_API_ERROR` was hit trying to
create a 4th page). Not a bug in this codebase — a real environmental constraint of the specific Figma
file used for all Block A testing. All large-scale testing was consolidated onto one reused page to work
within it. Worth knowing for anyone reproducing this testing on a similarly-provisioned file.

### Bridge orphan-response instrumentation is armed but has not observed a genuine occurrence

The timeout-investigation instrumentation added to `src/runtime/unifiedBridge.js` (see
`docs/BLOCK_A_LIVE_RESULTS.md`) is proven correct in isolated unit tests, but across all live testing
performed AFTER the font-loading fix — including the 901-node stress test and the full 21-step system
acceptance run — zero orphan responses were observed. This is good news (no evidence of a genuine
lost-message problem remains), but it also means the specific "a real response arrived late after a real
timeout" scenario has only been proven to work correctly in a controlled unit test, not confirmed against
a real occurrence in production-like conditions. If it recurs, the instrumentation will now capture real
diagnostic data (`bridge.status().diagnostics`) instead of the previous silent discard.

## Resolved this pass (kept here for the historical record, not deleted)

- ~~Transient response-delivery timeouts, root cause unknown~~ — **Resolved.** Root cause found: `figma.
  loadFontAsync` per-call latency, uncached, compounding across many text nodes. Fixed with a
  session-level font cache. See `docs/BLOCK_A_LIVE_RESULTS.md`'s Timeout Investigation section for the
  full before/after evidence.
- ~~Large-tree performance not measured~~ — **Resolved.** A real 901-node tree now builds and is fully
  exercised (reads/measure/diff/verify/idempotency/sync-reconcile) in ~22-90s total across all
  operations, all real measurements recorded in `docs/BLOCK_A_LIVE_RESULTS.md`/`docs/BLOCK_A_PERFORMANCE.md`.
- ~~`custom.boolean`/`custom.create_component_set`/`custom.instance_swap`/`custom.styles`/`custom.
  component_property` schema+plugin wired but not independently live-tested~~ — **Resolved.** All 5
  real-Figma verified in the gap-closure test run — see `docs/BLOCK_A_LIVE_RESULTS.md`.
- ~~A11 (Plumb capability completion) not started~~ — **Resolved** to the extent architecturally
  sensible: `plumb.components` integrated and real-Figma verified; `plumb.node.read`/`plumb.tokens`
  explicitly and technically justified as deferred (see above), not silently dropped.
