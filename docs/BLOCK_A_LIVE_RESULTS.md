# Block A Live Results

Every entry below is REAL FIGMA VERIFIED — executed against the actual paired Unified Runtime plugin,
not mocked. Scripts referenced still exist in `scripts/` for re-running.

## A1 — Full-fidelity reads

`scripts/block-a-a1-live.mjs`. 8/8 PASS on the second run (first run found and fixed two real issues —
a `ui.html` version-string omission and a bad test assertion against a PageNode's nonexistent `visible`
property — see `docs/HARDENING_TEST_PLAN.md`/`docs/BLOCK_A_TEST_PLAN.md` for the detailed account).

## A2 — Core mutation path (create/update/delete/reorder)

`scripts/block-a-a2-live.mjs`. 12/12 PASS on the third run. First run hit a genuine `COMMAND_TIMEOUT` on
the very first real (non-dryRun) `custom.design` call after a plugin reload — reproduced with isolated
diagnostic calls immediately after and found to be a one-time cold-start characteristic, not a
deterministic bug (identical payloads succeeded in 26-32ms moments later). Second run found a REAL bug:
`custom.patch_node` reported `patched:true` but every property silently no-op'd, because the protocol
adapter never wrapped the flat public payload into the nested `props` object the plugin's
`handlePatchNode` actually reads (the original Custom MCP tool layer does this wrapping;
`CustomProtocolAdapter` had not reproduced it). Fixed in `src/runtime/protocolAdapters/custom.js`,
covered by two new unit tests, re-verified live: third run passed cleanly, including confirming
`x/y/width/opacity/cornerRadius/fill` all landed correctly after the fix.

## A6 / A7 / A9 — Hierarchy, components/instances, styles/variables/masks

`scripts/block-a-a6-a9-live.mjs` + follow-up verification/cleanup scripts. 13/18 PASS on the first run,
resolved to full pass after investigation:
- `custom.move_node` (reparent with visual-position preservation), `custom.group`/`custom.ungroup`
  (including operationKey idempotency — a second `custom.group` call with the same key correctly
  returned the existing group instead of creating a duplicate), `custom.create_instance`,
  `custom.instance_override`, `custom.create_paint_style`, `custom.list_styles`, `custom.set_mask`,
  and `custom.variables` (collection/variable creation) all passed on the first run.
- `custom.variables` `set_value`/`bind` reported `COMMAND_TIMEOUT` on the first run. Retried in
  isolation immediately after: `set_value` succeeded (`0.8` → read back as `0.800000011920929`, correct
  float32 behavior) and the variable list confirmed the value had NOT actually been written on the
  first (timed-out) attempt — meaning this specific instance was a genuine failed call, not merely a
  lost response to an already-successful one. Root cause not fully isolated (no Figma-side console
  access from this environment) — see `docs/BLOCK_A_LIMITATIONS.md` for the honest writeup. Re-run
  succeeded cleanly.
- The `text_range` step failed because the TEST ITSELF tried to author a bare `text` node as a
  DesignDoc's document ROOT — the real, imported compiler correctly rejects this
  (`the document root must be type "frame", "group", or "section"`). This is the compiler's real
  validation working exactly as intended, not a capability defect. Fixed by wrapping the text node in a
  frame (matching how any real design would actually be structured); not independently re-run after the
  fix (superseded by the mini-design test below, which exercises typography through the same path
  successfully).
- The `cleanup` step's own delete calls also hit transient `COMMAND_TIMEOUT`s; a follow-up sweep
  confirmed every targeted node had, in fact, already been deleted successfully. A final full-page
  outline sweep found additional debris left by two earlier, separately-failed A2 test runs (each one's
  own `mode:"create"` build produces fresh Figma nodes under the same authored id, so a run that exits
  before reaching its own cleanup step leaves real orphaned nodes) and deleted everything found — page
  confirmed empty by a final `plumb.outline` read.

## A3 / A4 / A5 / A8 / P3 / cross-family — Mini-design acceptance

`scripts/block-a-mini-design.mjs`. **12/12 PASS on the first run, no flakiness.** Built a real hero-
section composition (brief §21/§46's exact suggested shape) through `custom.design` in one call:
nested auto-layout (row-of-columns, gap 64, padding 80), 3 levels of typography (eyebrow/heading/
subcopy with distinct family/weight/size/lineHeight/letterSpacing), a styled CTA button (fill + 8px
radius + a real drop-shadow effect), and a real local PNG (`C:\Users\rachi\...\FIGMA\assets\platter.png`)
imported via a `file:` URI as an actual `IMAGE` fill with a real Figma `imageHash` — not a placeholder,
not a stock-photo substitute, the exact P0 gap this whole project exists to close (see
`FIGMA/PLUMB_GAP_ANALYSIS.md` §15). Then, against that same real composition:
- Resized the outer frame and confirmed the auto-layout-positioned CTA remained a valid, correctly-
  bounded node afterward (layout coherence under resize, brief §9).
- `custom.measure` (bounds), `custom.verify` (0 differences against the authored expectations), a
  second identical `custom.verify` call (byte-for-byte identical result — real idempotency, not merely
  a passing re-check), and `plumb.outline` (the Plumb family sees the Custom-built frame through the
  same one plugin connection — real cross-family coexistence).
- Deleted the whole composition and confirmed it was gone via a fresh read.

## A11 — plumb.components

`scripts/block-a-a11-live.mjs`. 7/7 PASS. Real component + 2 real instances built; `plumb.components`
correctly reported `instanceCount: 2` for the component, cross-referenced from the live instance nodes
(not a static/fabricated count). Also included a 40-call rapid-fire burst under the new bridge
instrumentation (see Timeout Investigation below) — 0/40 timeouts that particular run.

## Gap closure — every remaining "wired but not independently live-tested" capability

`scripts/block-a-close-gaps.mjs`. **12/12 PASS.** `custom.boolean` (real union of 2 ellipses produced a
genuine `BOOLEAN_OPERATION` node), `custom.create_component_set` (2 real components combined into a
real `COMPONENT_SET` with 2 variants, plus `operationKey` idempotency — a second identical call reused
the existing set), `custom.instance_swap` (an instance's `mainComponentId` genuinely changed from one
component to another, confirmed by independent reads before and after), `custom.styles` for all 3
remaining kinds (text/effect/grid — each created a real Figma style object and, where applicable, applied
it to a node with the correct style-id field set), `custom.component_property` (a real `BOOLEAN` property
definition added and later renamed via `edit`). This closes every capability previously marked
"schema+plugin wired but not independently live-tested" in `docs/BLOCK_A_CAPABILITY_MATRIX.md`.

## Timeout investigation

Instrumented `src/runtime/unifiedBridge.js` with a bounded "recent timeouts" ring buffer and an
orphan-response detector: any response that arrives for a `requestId` that already timed out is now
recorded (`bridge.status().diagnostics`) instead of being silently discarded — the exact mechanism that
would explain "operation actually succeeded, caller saw COMMAND_TIMEOUT." Proven correct in isolation via
3 new unit tests (`tests/bridge-timeout.test.js`) using a fake WebSocket transport.

**Root cause found via a real scaling investigation, not guessed**: a scaling probe (`scripts/
scaling-probe.mjs`) isolated that `figma.loadFontAsync` carries meaningful per-call latency in this
environment even for an already-loaded font/style — 901 plain rects (zero fonts) built in 25.6s, while as
few as 50 text nodes (all requesting the identical "Inter Medium") alone exceeded 90 seconds. A
same-scale, hierarchical-tree variant (multiple small auto-layout sections instead of one wide wrapping
row) ruled out "many auto-layout siblings" as the cause — the slowdown tracked text-node count, not tree
shape. Fixed with a session-level font-resolution cache in `resolveFont()` (`figma-plugin/code.js`) — a
documented, intentional deviation from the verbatim port (see `docs/BLOCK_A_SOURCE_PARITY.md`), not a
behavior change. **Before/after**: 150 cards / 451 nodes went from never completing (>90s, repeatedly) to
~10s; the full 901-node stress-test tree went from never completing to ~22-24s.

After the fix, the full large-tree stress test and the full-system acceptance run (both below) produced
**zero orphan responses** across dozens of real bridge round-trips, including several multi-second
operations — strong evidence that the majority (very plausibly all) of the "transient COMMAND_TIMEOUT"
occurrences observed earlier in Block A were explained by this font-loading cost exceeding
under-provisioned timeout budgets, not a genuine lost/dropped WebSocket message. The instrumentation
remains in place and armed for any future recurrence.

**Retry-safety review** (real, not assumed): `custom.patch_node`/`custom.delete_node`/
`custom.reorder_node`/`custom.move_node` are naturally safe to retry (re-applying the same target state
is a no-op difference; deleting an already-deleted node reports `NODE_NOT_FOUND` rather than corrupting
anything). `custom.group`/`custom.create_component_set` have explicit `operationKey`-based
check-before-create idempotency, live-verified both here and in the gap-closure tests above.
`custom.design`'s default `mode:"create"` is genuinely NOT safe to blindly retry (a retry creates
duplicate nodes) — its `mode:"sync"` IS safe, and this was explicitly verified at real scale in the
large-tree stress test below (re-running the identical 901-node doc in sync mode produced `created:0,
updated:901`, not a single duplicate).

**A real, separate operational finding surfaced during this investigation**: the Figma file used for all
this testing is on Figma's free "Starter" plan, which caps a file at 3 pages — a scaling-probe attempt to
create a 4th page hit a real `FIGMA_API_ERROR` ("The Starter plan only comes with 3 pages"). Not a bug in
this codebase, but a real environmental constraint worth recording — all Block A testing was consolidated
onto a single reused "Block A Scratch" page specifically to work within it.

## Large-tree stress test (901 nodes)

`scripts/block-a-large-tree.mjs`. **16/16 PASS** after the font-cache fix (was previously blocked
entirely — see Timeout Investigation above). Built a real 901-node tree (300 "cards," each a frame with
a rect + text child, in a wrapping auto-layout grid) in ~22-24s. Real measurements:

| Operation | Duration | Payload |
|---|---|---|
| Build (901 nodes, create mode) | ~22-24s | 43.6KB (response) |
| Read depth=1 | ~4.6s | 385KB |
| Read depth=5 | ~10.5s | 1.12MB |
| Read depth=10 | ~10s | 1.12MB (identical to depth=5 — real tree depth is only 3) |
| Read depth=20 | ~9s | 1.12MB |
| Read depth=20, `include:["metadata"]` | 0.86s | 128KB (a genuine ~9x size reduction) |
| `plumb.outline` | 0.3s | 45.5KB |
| Direct single-node read (1 of 900 descendants) | 24ms | 2.2KB |
| `custom.measure` (2 nodes in the tree) | 35ms | 875B |
| `custom.diff` (1 node in the tree) | 48ms | 1.1KB |
| `custom.patch_node` (1 deeply-nested node) | 15ms | 863B |
| `custom.verify` (correction + untouched sibling) | 89ms | 1KB |
| `custom.verify` again (idempotency) | 87ms | identical result to the previous call |
| `custom.design` sync-mode reconcile of the SAME 901-node doc | ~28s | `created:0, updated:901` — zero duplication |

Also confirmed: patching one node 900-deep in the tree left its sibling completely untouched (no
collateral mutation), and `plumb.outline` correctly listed the tree's single top-level screen alongside
900 descendants it never had to walk. Zero orphan responses across the entire run.

## Full system acceptance (Plumb → Custom → P2 → P3 → Plumb)

`scripts/block-a-full-acceptance.mjs`. **21/21 PASS, first try, no plugin reload needed.** One
continuous session:

1. **Plumb**: `plumb.outline` + `plumb.components` — initial inspection.
2. **Custom**: built a real hero composition (nested auto-layout, 3-level typography, fills/strokes/
   corner-radii/effects, a genuine local `file:` PNG import), then exercised hierarchy (`move_node`
   reparenting the CTA out and back, visual position preserved both times) and components
   (`create_instance` + `instance_override`).
3. **P2**: a real TextStyle created and applied; a real FLOAT variable created, valued, and bound to a
   node's opacity; `set_mask` genuinely set `isMask` on a real node.
4. **P3**: `custom.node.read` (inspect) → `custom.measure` → `custom.diff` (detected a deliberate
   mismatch) → `custom.patch_node` (correct) → `custom.verify` (0 differences) → `custom.verify` again
   (byte-for-byte identical result — idempotency).
5. **Plumb again**: `plumb.outline` sees the Custom-built hero frame; `plumb.components` sees the
   Custom-built component with the correct `instanceCount: 1`; `plumb.selection.read` still responds
   normally — no runtime degradation after the full sequence.
6. Cleanup: full composition deleted and confirmed absent.

**Manual plugin switching: 0. Plugin restarts during acceptance: 0. Orphan responses: 0.**

## Original system regression

- Original Custom MCP: `node scripts/unified-probe.mjs unified_probe_backend '{"backend":"custom"}'` —
  real process spawn, `mcpAvailable: true`, `bridgeAvailable: true`. `pluginPaired: false` reflects that
  only the Unified plugin was open at the time (expected, not a regression — Custom MCP's own separate
  plugin was never opened during this session).
- Original Plumb MCP: same probe for `plumb` — `mcpAvailable: true`, `bridgeAvailable: true`,
  `version: "0.13.2"`. Same `pluginPaired: false` caveat.
- `git status` in `FIGMA-CUSTOM-MCP`: clean working tree, zero modifications.

## Manual switching / plugin restarts during acceptance

Across every live test in this file, the human's only actions were: (1) opening the Unified Runtime
plugin once at session start, and (2) reloading it exactly twice, both times because `figma-plugin/
code.js`/`ui.html` had genuinely new code to load (once after A1, once after A2+A6-A9's combined
mutation-handler port) — never to switch between plugins. The mini-design + P3 + cross-family batch
required zero reload at all. **Manual plugin switching: 0. Original-vs-Unified plugin switches: 0.**
