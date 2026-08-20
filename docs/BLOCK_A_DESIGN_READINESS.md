# Block A Design Readiness

Rated as of this checkpoint (A1 complete, A2-A11 planned but not started). Ratings will change as later
batches land — this file is updated per batch, not written once at the end.

| Category | Rating | Notes |
|---|---|---|
| Document inspection | READY | `plumb.outline`/`plumb.status`/`custom.status` already production (Stage 4) |
| Full-fidelity node reads | READY | A1, complete and real-Figma-verified this checkpoint |
| Structure creation | BLOCKED | `custom.design`/`plumb.design` not yet wired (A2) |
| Geometry (write) | BLOCKED | `custom.patch_node` not yet wired (A2) |
| Typography (write) | BLOCKED | `custom.text_range`, `plumb.design` text blocks not yet wired (A3) |
| Appearance | BLOCKED | fills/strokes/effects writes not yet wired (A4, via `custom.patch_node`/`plumb.design`) |
| Layout | BLOCKED | auto-layout writes not yet wired (A6, via `plumb.design`) |
| Hierarchy/grouping/components | BLOCKED | `custom.group`/`custom.create_component_set`/etc. not yet wired (A7) |
| Vectors/images/assets | BLOCKED | not yet wired (A8) |
| P2 advanced operations | BLOCKED | mask/instance-override/variables/styles not yet wired (A9) |
| P3 inspection | PARTIAL | Unified's own full-fidelity read (A1) now gives raw material for inspection; `custom.diff`/`custom.verify`/`custom.measure` themselves not yet wired (A10) |
| P3 measurement | BLOCKED | `custom.measure` not yet wired (A10) |
| P3 diff | BLOCKED | `custom.diff` not yet wired (A10) |
| P3 correction | BLOCKED | `custom.patch_node` not yet wired (A2/A10) |
| P3 verification | BLOCKED | `custom.verify` not yet wired (A10) |
| Plumb extraction/code functionality | PARTIAL | `plumb.outline`/`plumb.selection.read` live; `plumb.node.read`/`plumb.tokens`/`plumb.components` planned (A11) |
| Cleanup | READY | Standard node-delete path will cover this once A2 lands; no cleanup-specific gap |

**Honest summary**: this checkpoint gives Unified a genuinely complete read/inspection foundation
(document structure + full-fidelity single-node reads) but zero write capability yet. That is expected —
A1 was deliberately the first batch precisely because every later write/correction/verification batch
benefits from full-fidelity reads already being in place (you need to be able to read a node correctly
before you can usefully diff/verify it). No category is claimed READY that isn't actually demonstrated.
