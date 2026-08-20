# Block A Test Plan

Following the brief's own batch discipline (§25-26): every batch is unit-tested, then real-Figma-tested,
before the next batch starts. This file grows one section per batch, in order. Sections for
not-yet-started batches are stubs naming what will be tested, not filled-in results.

## A1 — Full-fidelity reads

**Scope**: `custom.node.read`/`custom.selection.read` gain the complete 8-category field set
(geometry/layout/appearance/text/component/variables/styles/metadata) via a verbatim port of Custom
MCP's real serializer, plus an `include` category filter using the exact same category names Custom
MCP's own `figma_node` tool accepts.

**Unit tests** (`tests/block-a.test.js`): schema accepts a valid `include` array; schema rejects an
unknown category; `custom.selection.read` accepts `include` and keeps its depth default;
`CustomProtocolAdapter` forwards `include` onto the outgoing envelope when present and omits the key
entirely when absent (no stray `undefined`); all 8 real category names validate. 6/6 pass, part of the
project's 49/49 total.

**Real Figma test**: `scripts/block-a-a1-live.mjs`, persistent session (same pattern as the hardening
pass's live scripts — see `docs/HARDENING_TEST_PLAN.md` Test H-D's root-cause note on why one-shot
probes can't pair). Two runs were needed: the first run found two real issues (both fixed and
re-verified, not glossed over):

1. `figma-plugin/ui.html` carries its own separate `PLUGIN_VERSION` constant (sent in the WebSocket
   `hello` handshake, which is what the bridge actually reports) — `code.js`'s constant was bumped but
   `ui.html`'s was not, so `unified_runtime_status` kept reporting the old version even though the new
   serializer was demonstrably running (the field-level data already showed the new rich fields). Fixed:
   `ui.html`'s constant bumped to match.
2. The test's own "metadata-only read has `visible` but not geometry" assertion targeted the PAGE root
   node — but Figma's `PageNode` has no `visible` property at all (only `SceneNode` subtypes do), so the
   assertion was checking the wrong node, not a capability defect. Fixed: retargeted to the actual FRAME.

Second run, after both fixes, with the plugin reloaded again: **8/8 steps PASS.**
- Plugin paired and reported the correct new version.
- An unfiltered `custom.node.read` returned the full rich field set (fills, cornerRadius, constraints,
  sizing, opacity, absoluteBoundingBox, parentId/index) — fields that did not exist in the pre-A1
  minimal serializer.
- `include:["geometry"]` returned only geometry-shaped fields, confirming the filter is not decorative.
- `include:["metadata"]` on the real FRAME returned `visible` but no geometry fields.
- An unknown include category was rejected with `INVALID_PAYLOAD` before the bridge was ever called.
- `custom.selection.read` still works with the new serializer.
- `plumb.selection.read` is unaffected — still its own compact format, proving the two families didn't
  get blurred together.

**Result: A1 — REAL FIGMA VERIFIED, PASS.**

**Caveat carried forward from the hardening pass**: the live test document is still a single empty
FRAME. Category coverage (geometry/layout/appearance/metadata) was exercised against a real node; `text`
and `component`/`variables` category coverage was NOT exercised, since no TEXT or COMPONENT/INSTANCE
node exists yet in the test document. This is an honest gap, not a hidden one — it will be exercised
naturally in A3 (text) and A7/A9 (components/instances) once those batches create the relevant node
types to read back.

## A2 — Basic create/update/delete (write path)

**Scope**: `custom.design` (wraps `figma_design`, via the real imported compiler), `custom.patch_node`,
`custom.delete_node`, `custom.reorder_node`.
**Result: REAL FIGMA VERIFIED, PASS (12/12)** after finding and fixing a real bug (patch fields not
wrapped into the `props` object the plugin expects) — full account in `docs/BLOCK_A_LIVE_RESULTS.md`.
Exercised the brief's own Foundational Real-Figma Write Test (§27) exactly: create frame, create child,
read child, update child, read child, delete child, verify delete — plus a `dryRun` check and an
invalid-node-id error-code check.

## A3 — Typography

**Result: REAL FIGMA VERIFIED, PASS**, via the mini-design test (`scripts/block-a-mini-design.mjs`) —
3 distinct typography levels (eyebrow/heading/subcopy) with different family/weight/size/lineHeight/
letterSpacing, read back and confirmed correct. `custom.text_range` (per-substring styling) is schema+
plugin wired but not independently live-tested this pass — its first live attempt caught a real test
bug (a bare TEXT node used as a DesignDoc root, correctly rejected by the real compiler), and was not
re-run standalone after the fix since the mini-design test's own text coverage superseded it.

## A4 — Appearance

**Result: REAL FIGMA VERIFIED, PASS**, via the mini-design test — solid fill, 8px corner radius, a real
drop-shadow effect (correct blur radius read back), and a 1px stroke on the visual card, all confirmed
via `custom.node.read`. Gradients not independently tested this pass.

## A5 — Layout (Auto Layout)

**Result: REAL FIGMA VERIFIED, PASS**, via the mini-design test — nested `row`/`col` auto-layout with
authored gap (64) and padding ([80,80,80,80]) both confirmed present and correct on the real node, plus
a resize test confirming the auto-layout-positioned CTA child remained coherent afterward.

## A6 — Hierarchy / structural operations

**Scope**: `custom.move_node` (reparent with visual-position-preserving transform math).
**Result: REAL FIGMA VERIFIED, PASS** — reparented a node under a component and confirmed its absolute
page-space position was unchanged (within float tolerance) despite the coordinate-space change.

## A7 — Components / instances / reusability

**Scope**: `custom.boolean`, `custom.group`, `custom.ungroup`, `custom.create_component_set`,
`custom.create_instance`, `custom.instance_override`, `custom.instance_swap`.
**Result: REAL FIGMA VERIFIED for group/ungroup/create_instance/instance_override; schema+plugin wired
but not independently live-tested for boolean/create_component_set/instance_swap.** `custom.group`'s
`operationKey` idempotency was specifically verified — a second identical call reused the existing group
instead of creating a duplicate, exactly matching the source's own documented idempotency guarantee.

## A8 — Vectors / images / asset-level capabilities

**Result: REAL FIGMA VERIFIED, PASS** for the headline capability — a real local PNG
(`FIGMA/assets/platter.png`) imported via a `file:` URI landed as a genuine `IMAGE` fill with a real
Figma `imageHash`, not a placeholder or stock-photo substitute. This is the exact P0 gap
`FIGMA/PLUMB_GAP_ANALYSIS.md` §15 documents Plumb as structurally incapable of — confirmed closed.
Vector path authoring (`vectorPaths`) and SVG import not independently tested this pass.

## A9 — P2 advanced capability integration

**Scope**: `custom.set_mask`, `custom.create_paint_style`, `custom.list_styles`, `custom.styles`,
`custom.component_property`, `custom.variables`.
**Result: REAL FIGMA VERIFIED for set_mask/create_paint_style/list_styles/variables** (collection
creation, variable creation, set_value, node-kind bind — a FLOAT variable genuinely bound to a real
node's opacity field). `custom.styles`/`custom.component_property` schema+plugin wired but not
independently live-tested this pass. One real transient issue was found and investigated on
`variables.set_value` (see `docs/BLOCK_A_LIMITATIONS.md`) — confirmed non-reproducible on retry, but
honestly documented rather than dismissed.

## A10 — P3 precision/verification integration

**Result: REAL FIGMA VERIFIED, PASS.** The complete inspect → measure → diff → correct → verify →
idempotency loop (brief §14's exact required workflow) was run against a real controlled composition
through Unified: `custom.measure` (gap/bounds/containment/alignment), `custom.diff` (including the real
radius→cornerRadius field-mapping fix diff.ts's own source comments document), `custom.verify` (before
and after a deliberate correction), and — critically — **idempotency**: re-running the same verify call
twice in a row produced byte-for-byte identical results, satisfying the brief's explicit §23 mandatory
requirement.

## A11 — Plumb integration completion

**Not executed this pass.** `plumb.node.read`, `plumb.tokens`, `plumb.components` remain unintegrated —
see `docs/BLOCK_A_CAPABILITY_MATRIX.md`. What WAS verified: `plumb.outline`/`plumb.selection.read`
(already live since Stage 4) correctly see content built via the new Custom-family write capabilities,
through the same one plugin connection, with zero manual switching (the mini-design test's cross-family
step).

## Mini-design acceptance (brief §21/§46-48)

**Result: REAL FIGMA VERIFIED, PASS, 12/12, first try.** `scripts/block-a-mini-design.mjs` — a real
hero-section composition combining structure, geometry, typography, appearance, layout, and a local
image import in one `custom.design` call, then a full P3 pass (measure/verify/idempotency) and a
cross-family Plumb read against the same live content, then cleanup. See `docs/BLOCK_A_LIVE_RESULTS.md`
for the full breakdown.
