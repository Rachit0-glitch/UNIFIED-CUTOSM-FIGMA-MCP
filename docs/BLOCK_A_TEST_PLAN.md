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

**Scope** (planned, not yet started): `custom.design` (wraps `figma_design`), `custom.patch_node`,
`custom.delete_node`, `custom.reorder_node`; `plumb.design` (wraps `plumb_design`).
**Test plan**: the brief's own Foundational Real-Figma Write Test (§27) — create frame, create child,
read child, update child, read child, delete child, verify delete — through Unified, on a scratch page.

## A3-A11

Stubs — will be filled in as each batch is executed. See `docs/BLOCK_A_CAPABILITY_MATRIX.md` for what
each batch covers.
