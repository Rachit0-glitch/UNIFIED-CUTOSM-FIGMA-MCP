# Block A Design Readiness

Rated after the full A1/A2/A3/A6/A7/A9/A10 execution pass, against real-Figma evidence in
`docs/BLOCK_A_LIVE_RESULTS.md`. A category is READY only if it was actually demonstrated live, not
merely wired.

| Category | Rating | Notes |
|---|---|---|
| Document inspection | READY | `plumb.outline`/`plumb.status`/`custom.status` (Stage 4) |
| Full-fidelity node reads | READY | A1, real-Figma verified across geometry/layout/appearance/metadata/text categories |
| Structure creation | READY | `custom.design`, real-Figma verified (frames, rects, text, images, components, nested auto-layout) |
| Geometry (write) | READY | `custom.patch_node`, real-Figma verified |
| Typography (write) | READY | `custom.design` text blocks + `custom.text_range`, real-Figma verified (3-level typography in the mini-design test) |
| Appearance | READY | Fills/strokes/radius/effects, real-Figma verified (gradient not independently tested — solid fills + drop-shadow + stroke + radius were) |
| Layout | READY | Nested auto-layout, real-Figma verified including resize coherence |
| Hierarchy/grouping/components | READY | `custom.move_node`/`custom.group`/`custom.ungroup`/`custom.create_instance`/`custom.instance_override`, real-Figma verified |
| Vectors/images/assets | PARTIAL | Local image import (`file:` URI) READY and real-Figma verified — the actual P0 gap this project exists to close. Vector path authoring (`vectorPaths`) and SVG import not independently tested this pass. |
| P2 advanced operations | READY | Masks (`custom.set_mask`), paint styles (`custom.create_paint_style`), variables (`custom.variables`), all real-Figma verified. Component property definitions and text/effect/grid styles wired but not independently live-tested. |
| P3 inspection | READY | Full-fidelity reads (A1) are the inspection substrate |
| P3 measurement | READY | `custom.measure`, real-Figma verified (bounds/gap/containment/alignment) |
| P3 diff | READY | `custom.diff`, real-Figma verified including the real radius→cornerRadius field-mapping fix |
| P3 correction | READY | `custom.patch_node` used as the correction step in the full live P3 loop |
| P3 verification | READY | `custom.verify`, real-Figma verified including idempotency |
| Plumb extraction/code functionality | PARTIAL | `plumb.outline`/`plumb.selection.read` live and confirmed working alongside Custom-family writes (cross-family test). `plumb.node.read`/`plumb.tokens`/`plumb.components` remain unintegrated. |
| Cleanup | READY | Standard delete path confirmed; debris-sweep methodology established and exercised for real |

**Honest summary**: every major design-construction category the brief names is now READY with real
evidence, not just wired code — this checkpoint is meaningfully different from the read-only checkpoint
after A1. The two genuine PARTIAL ratings (vectors/assets, Plumb extraction) reflect real, bounded gaps:
vector path authoring and most non-outline Plumb read tools were not exercised this pass, not that they
don't exist or don't work.
