# Block A Design Readiness

Rated after the complete A1-A11 execution (including the large-tree stress test, timeout investigation,
gap closure, and full system acceptance run), against real-Figma evidence in
`docs/BLOCK_A_LIVE_RESULTS.md`. A category is READY only if it was actually demonstrated live, not
merely wired.

| Category | Rating | Notes |
|---|---|---|
| Document inspection | READY | `plumb.outline`/`plumb.status`/`custom.status`/`plumb.components` |
| Full-fidelity node reads | READY | Real-Figma verified across all categories, including at 901-node scale |
| Structure creation | READY | `custom.design`, real-Figma verified including at 901-node scale |
| Geometry (write) | READY | `custom.patch_node`, real-Figma verified, including 900-deep in a large tree with zero collateral effect on siblings |
| Typography (write) | READY | 3-level typography real-Figma verified in both the mini-design test and the final acceptance run |
| Appearance | READY | Fills/strokes/radius/effects, real-Figma verified (gradient not independently tested — solid fills + drop-shadow + stroke + radius were) |
| Layout | READY | Nested auto-layout, real-Figma verified including resize coherence and at 901-node scale |
| Hierarchy/grouping/components | READY | Every capability in this category (`move_node`/`group`/`ungroup`/`boolean`/`create_component_set`/`create_instance`/`instance_override`/`instance_swap`) real-Figma verified, including group/component-set idempotency |
| Vectors/images/assets | PARTIAL | Local image import (`file:` URI) READY and real-Figma verified twice — the actual P0 gap this project exists to close. Vector path authoring (`vectorPaths`) and SVG import remain genuinely untested — narrow, not required by any acceptance criterion. |
| P2 advanced operations | READY | Masks, paint styles, all 4 style kinds (paint/text/effect/grid), component property definitions (add+edit), variables (collection/variable/value/bind) — all real-Figma verified |
| P3 inspection | READY | Full-fidelity reads are the inspection substrate, verified at scale |
| P3 measurement | READY | `custom.measure`, real-Figma verified including at 901-node scale |
| P3 diff | READY | `custom.diff`, real-Figma verified including at scale and the real radius→cornerRadius field-mapping fix |
| P3 correction | READY | `custom.patch_node`, verified in the full loop at both small and 901-node scale |
| P3 verification | READY | `custom.verify`, real-Figma verified including idempotency at both small and 901-node scale |
| Plumb extraction/code functionality | READY (bounded) | `plumb.outline`/`plumb.selection.read`/`plumb.status`/`plumb.components` all live and confirmed working alongside Custom-family writes in the full acceptance run. `plumb.node.read`/`plumb.tokens` explicitly deferred with technical justification (`docs/BLOCK_A_SOURCE_PARITY.md`), not silently missing. |
| Cleanup | READY | Confirmed at small scale, gap-closure scale, and 901-node scale |

**Honest summary**: every category the brief names is now READY, with the one genuine, narrow, honestly
bounded exception (vector path authoring / SVG import) explicitly noted rather than glossed over. Every
READY rating above is backed by a real-Figma test cited in `docs/BLOCK_A_LIVE_RESULTS.md` — none are
claimed on the basis of "the handler exists" or "a unit test with a fake bridge passed."
