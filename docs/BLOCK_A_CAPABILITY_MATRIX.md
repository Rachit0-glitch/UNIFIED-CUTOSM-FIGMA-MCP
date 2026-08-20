# Block A Capability Matrix

Source inventory, not memory: Plumb's 23 tools and their source-verified strengths/gaps come from
`FIGMA/PLUMB_GAP_ANALYSIS.md` (a fresh, source-line-cited audit of the installed
`plumb-mcp` package, already on disk from recent work — cross-checked against `dist/index.js:9689-9711`
for the tool list itself). Custom MCP's 26 tools come from reading the live current
`FIGMA-CUSTOM-MCP/src/tools.ts` directly in this session (not from memory or older docs).

Legend — **Integration status**: INTEGRATED (wired into Unified today) / PLANNED (next batch) /
DEFERRED (real Block-A-adjacent work, out of scope for this pass, reason given) / NOT NEEDED.

## Plumb-family capabilities (23 tools)

| Capability | Read/Write | Preferred owner | Unified ID | Integration status | Notes |
|---|---|---|---|---|---|
| `plumb_status` | read | Plumb | `plumb.status` | INTEGRATED (Stage 4) | |
| `plumb_outline` | read | Plumb | `plumb.outline` | INTEGRATED (Stage 4) | |
| `plumb_node` | read | Plumb | `plumb.node.read` | PLANNED (A11) | Full compact-PDS read; distinct from `custom.node.read`'s rich format — see Integration Architecture doc, ownership principle |
| `plumb_tokens` | read | Plumb | `plumb.tokens` | PLANNED (A11) | Color/spacing/radius/shadow token extraction — no Custom equivalent |
| `plumb_selection` | read | Plumb | `plumb.selection.read` | INTEGRATED (Stage 4) | |
| `plumb_assets` | read/export | Plumb | `plumb.assets` | PLANNED (A8) | |
| `plumb_screenshot` | read/export | Plumb | `plumb.screenshot` | PLANNED (A8) | Overlaps `figma_screenshot` (Custom) — Plumb kept as default since export/scale gap is Custom's real advantage only for scale param |
| `plumb_describe` | read | Plumb | `plumb.describe` | DEFERRED | Narrative/LLM-facing description tool — lower priority than structural reads |
| `plumb_search` | read | Plumb | `plumb.search` | DEFERRED | Useful but not required for Block A's core acceptance flow |
| `plumb_components` | read | Plumb | `plumb.components` | PLANNED (A7) | Component/design-system extraction, no Custom equivalent |
| `plumb_verify` | read/analysis | OVERLAP — Plumb (visual) vs Custom `figma_verify`/`figma_diff` (structural) | `plumb.verify` | DEFERRED | Screenshot-diff-based; genuinely different mechanism from Custom's structural diff — worth keeping both, not urgent for Block A |
| `plumb_fit` | read/analysis | Plumb | — | DEFERRED | Wraps `plumb_verify` with scoring — Block B territory (autonomous scoring), explicitly out of Block A scope per brief §24 |
| `plumb_query` | read | Plumb | `plumb.query` | DEFERRED | Pattern-filtered read — nice-to-have, not required for acceptance |
| `plumb_fig_outline` / `plumb_fig_node` | read (offline) | Plumb | — | NOT NEEDED | Offline `.fig` file parsing, no live-Figma dependency, out of scope for a live design-construction system |
| `plumb_design` | **write** | Plumb | `plumb.design` | PLANNED (A2/A6) | The core Plumb write path — auto-layout, typography, fills/strokes/effects, all its mature strengths (gap analysis §37) |
| `plumb_brand` | write | Plumb | `plumb.brand` | DEFERRED | Styles/variables-only wrapper around `apply-design` — lower priority than the core write path |
| `plumb_studio*` (4 tools) | write | Plumb | — | NOT NEEDED | Content-generation wrappers around `apply-design`; Unified should expose the primitive (`plumb.design`), not opinionated content generators — an LLM using Unified can already build the same result by calling `plumb.design` directly |
| `plumb_source` | read (external) | Plumb | — | DEFERRED | Web stock-image search; useful but secondary to local asset import (Custom, P0 gap analysis §15) |
| `plumb_review` | read/analysis | Plumb | — | NOT NEEDED | LLM-graded review — Block B/C territory (autonomous judgment), not Block A |

**Duplication avoided**: per the gap analysis §37/§39, everything Plumb already does well (auto-layout,
typography, fills/strokes/effects, blend modes, variables, most style kinds, extraction depth, PNG/SVG
export) is explicitly NOT reimplemented anywhere in Custom or planned for reimplementation in Unified —
Unified's job is to expose Plumb's own `plumb_design`/`plumb_node` etc., not rebuild them.

## Custom-family capabilities (26 tools, read live from `FIGMA-CUSTOM-MCP/src/tools.ts`)

| Capability | Read/Write | Preferred owner | Unified ID | Integration status | Notes |
|---|---|---|---|---|---|
| `figma_status` | read | Custom | `custom.status` | INTEGRATED (Stage 4) | |
| `figma_design` | **write** | Custom | `custom.design` | **INTEGRATED (A2)** | Absolute positioning, local image import (real-Figma verified with an actual local PNG — see `docs/BLOCK_A_LIVE_RESULTS.md`), strict validation |
| `figma_node` | read | Custom | `custom.node.read` | **INTEGRATED (A1)** | Full-fidelity, ported verbatim from the real serializer — see `docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md` |
| `figma_patch_node` | **write** | Custom | `custom.patch_node` | **INTEGRATED (A2)** | The primary P3 correction tool — real bug found and fixed live (props-wrapping), see `docs/BLOCK_A_LIVE_RESULTS.md` |
| `figma_delete_node` | **write** | Custom | `custom.delete_node` | **INTEGRATED (A2)** | |
| `figma_reorder_node` | **write** | Custom | `custom.reorder_node` | **INTEGRATED (A2)** | |
| `figma_screenshot` | read/export | Custom | `custom.screenshot` | DEFERRED | Not ported this pass — Plumb's own screenshot/outline path covered acceptance-test needs; flagged for a future batch |
| `figma_boolean` | **write** | Custom | `custom.boolean` | **INTEGRATED (A7)** | Plugin handler ported and schema-wired; not independently live-tested this pass (tree-DSL `type:"boolean"` create path, which shares the same `handleApplyPlan`, was exercised via A2's port) |
| `figma_group` | **write** | Custom | `custom.group` | **INTEGRATED (A7)** | Real-Figma verified, including operationKey idempotency (second call with the same key reuses the existing group) |
| `figma_ungroup` | **write** | Custom | `custom.ungroup` | **INTEGRATED (A7)** | Real-Figma verified |
| `figma_create_component_set` | **write** | Custom | `custom.create_component_set` | **INTEGRATED (A7)** | Schema+plugin wired; not independently live-tested this pass |
| `figma_create_paint_style` | **write** | Custom | `custom.create_paint_style` | **INTEGRATED (A9)** | Real-Figma verified |
| `figma_list_styles` | read | Custom | `custom.list_styles` | **INTEGRATED (A9)** | Real-Figma verified |
| `figma_move_node` | **write** | Custom | `custom.move_node` | **INTEGRATED (A6)** | Real-Figma verified, including visual-position preservation across the reparent |
| `figma_set_mask` | **write** | Custom | `custom.set_mask` | **INTEGRATED (A9)** | Real-Figma verified |
| `figma_component_property` | **write** | Custom | `custom.component_property` | **INTEGRATED (A9)** | Schema+plugin wired; not independently live-tested this pass |
| `figma_instance_override` | **write** | Custom | `custom.instance_override` | **INTEGRATED (A7)** | Real-Figma verified (`set_node` action) |
| `figma_instance_swap` | **write** | Custom | `custom.instance_swap` | **INTEGRATED (A7)** | Schema+plugin wired; not independently live-tested this pass |
| `figma_create_instance` | **write** | Custom | `custom.create_instance` | **INTEGRATED (A7)** | Real-Figma verified |
| `figma_variables` | **write** | OVERLAP — Plumb (collections/modes/aliases, gap analysis §21) vs Custom (fuller bind/unbind incl. paint/effect/layoutGrid kinds) | `custom.variables` | **INTEGRATED (A9)** | Real-Figma verified: create_collection, create_variable, set_value, bind (node-kind, FLOAT→opacity) |
| `figma_styles` | **write** | Custom | `custom.styles` | **INTEGRATED (A9)** | Schema+plugin wired; paint-kind create path exercised indirectly via `custom.create_paint_style`'s shared mechanism, text/effect/grid kinds not independently live-tested this pass |
| `figma_text_range` | **write** | Custom | `custom.text_range` | **INTEGRATED (A3/A9)** | Schema+plugin wired; live test caught a real test bug (text authored as a DesignDoc root, correctly rejected by the compiler) — not independently re-run after the fix, superseded by the mini-design test's own successful typography coverage |
| `figma_batch` | orchestration | Custom | `custom.batch` | DEFERRED | Multi-op orchestration; Unified's own `CommandQueue` already sequences calls — evaluate whether this is still needed once individual capabilities are wired, or whether Unified should get its own equivalent. Flagged, not decided in this pass. |
| `figma_diff` | read/analysis (P3) | Custom | `custom.diff` | **INTEGRATED (A10)** | Real-Figma verified, including the exact radius→cornerRadius field-mapping fix diff.ts's own source documents |
| `figma_verify` | read/analysis (P3) | Custom | `custom.verify` | **INTEGRATED (A10)** | Real-Figma verified, including idempotency (repeated verify produces an identical result) |
| `figma_measure` | read/analysis (P3) | Custom | `custom.measure` | **INTEGRATED (A10)** | Real-Figma verified (bounds/gap/containment/alignment modes) |

## Summary counts

- Plumb: 23 tools inspected. 4 integrated (Stage 4), 6 planned, 10 deferred (documented reasons), 3 not needed.
- Custom: 26 tools inspected. **24 integrated** (1 Stage 4 + 23 across A1/A2/A3/A6/A7/A9/A10 this
  execution), 1 deferred (`figma_screenshot`, Plumb's export path covered acceptance needs), 1 deferred
  pending a decision (`figma_batch`), 0 not needed.

## Ownership summary (condensed from `docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md`)

| Domain | Owner |
|---|---|
| Auto-layout composition, typography (bulk), fills/strokes/effects/blend modes, variables (collections/modes/aliases), text/effect/grid styles, extraction depth, PNG/SVG export | Plumb |
| Absolute/overlapping positioning, local/data-URI image import, per-corner radius, strict validation, full-fidelity single-node reads | Custom |
| Boolean ops, masks (write), true groups, component sets/variants, paint styles, single-node patch/delete/reorder/move, component property definitions, instance overrides/swap, rich per-range text styling, bound-variable writes beyond text-style size/line-height | Custom |
| P3 inspect/diff/verify/measure | Custom (only implementation that exists) |
| Component/token/design-system extraction, narrative description, visual-diff verification, web asset search | Plumb (no Custom equivalent, not needed) |

No capability is integrated into both families redundantly — every OVERLAP row above is either resolved
by picking the stronger implementation for the same operation (`plumb.variables` collections/modes vs.
`custom.variables` bind/unbind — both kept, since they cover genuinely different value-binding
mechanics) or explicitly deferred for a later decision (`figma_batch` vs. Unified's own queue).
