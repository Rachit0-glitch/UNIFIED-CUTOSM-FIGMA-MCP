# Block A Results

**This is a checkpoint document, updated after each integration batch — not a one-time final report.**
Block A's own brief mandates batch-by-batch integration with real-Figma testing after each batch
(§25-26), explicitly warning against integrating many operations and testing only at the end. This
document reflects exactly one batch (A1) completed so far, honestly, rather than a premature full-Block-A
verdict.

## Result (checkpoint after A1)

**UNIFIED CAPABILITY INTEGRATION: PARTIAL**

Real, verified progress exists (full inventory of both source systems, an architecture decision with a
working precedent, and one fully real-Figma-tested integration batch). Design-critical categories —
create, update, delete, typography, appearance, layout, hierarchy, P2 advanced operations, and P3
diff/verify/measure — remain entirely unintegrated. This is not a failure of A1; it is simply that A1
was scoped to reads only, per the batch plan, and the remaining ~10 batches have not been executed yet.

## Capability inventory

- Plumb: 23 tools inspected (source-verified via `FIGMA/PLUMB_GAP_ANALYSIS.md`, a fresh source-line-cited
  audit already on disk, cross-checked against the tool array in `dist/index.js`).
- Custom: 26 tools inspected (read directly from live current `FIGMA-CUSTOM-MCP/src/tools.ts` in this
  session, not memory).
- Full breakdown: `docs/BLOCK_A_CAPABILITY_MATRIX.md`.

## Integrated capability count

- **1 new capability enriched this batch**: `custom.node.read`/`custom.selection.read` upgraded from
  geometry+metadata-only to full 8-category fidelity (geometry/layout/appearance/text/component/
  variables/styles/metadata), with an `include` filter.
- Carried over from Stage 4 / pre-Block-A hardening (unchanged this batch): `plumb.status`,
  `plumb.outline`, `plumb.selection.read`, `custom.status` — 4 capabilities.
- **Total live production capabilities: 6** (same 6 capability IDs as before A1 — A1 enriched two of
  them rather than adding new IDs, since full-fidelity reads are a richer version of the same
  `custom.node.read`/`custom.selection.read` operations, not new operations).

## Deferred capability count

45 capabilities across both families remain planned (A2-A11) or explicitly deferred with reasons — see
`docs/BLOCK_A_CAPABILITY_MATRIX.md` for the exact per-capability list and rationale. Nothing was silently
dropped; every Plumb/Custom tool inspected has an explicit status (INTEGRATED/PLANNED/DEFERRED/NOT
NEEDED) and, where DEFERRED or NOT NEEDED, a stated reason.

## Ownership summary

See `docs/BLOCK_A_CAPABILITY_MATRIX.md`'s "Ownership summary" table and
`docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md`'s ownership principle section — condensed from the Plumb gap
analysis's own §39 rather than re-derived from scratch.

## Read fidelity

Full 8-category coverage now live for Custom-family reads (A1). Exact property lists per category match
Custom MCP's own real serializer verbatim (see `docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md`) — no
properties were added or dropped versus the source of truth. Plumb-family reads remain their own
pre-existing compact format, unaffected by A1, per the "do not force identical semantics" principle.

## Write coverage

**None yet.** Create/update/delete are entirely unintegrated at this checkpoint (A2, not started).

## P2 integration

**None yet** (A9, not started).

## P3 integration

**None yet** (A10, not started). Note: A1's full-fidelity reads are a prerequisite for meaningful P3
diff/verify work later, since those tools need to compare against accurately-read live state.

## Plumb code/extraction integration

`plumb.outline`/`plumb.status`/`plumb.selection.read` live since Stage 4. `plumb.node.read`/
`plumb.tokens`/`plumb.components` planned (A11, not started).

## Large-tree performance

Not yet measured — see `docs/BLOCK_A_PERFORMANCE.md` for why this is deliberately deferred to a batch
that actually builds a non-trivial tree (A6/A7), rather than measured against artificial filler content.

## Mini-design acceptance

Not yet attempted — requires the write path (A2+) to exist first.

## Cross-family result

Not yet meaningfully testable beyond what A1 already proved: a single persistent session correctly
served both `plumb.selection.read` (compact format, unaffected) and `custom.node.read`/
`custom.selection.read` (new full-fidelity format) back-to-back through the same paired plugin, with zero
manual switching — see `docs/BLOCK_A_TEST_PLAN.md`, A1 section, final two verification steps.

## Manual switching

**0** across all A1 testing — one plugin reload was needed after each code change (twice total, expected
and normal development iteration, not "manual switching" in the dual-plugin sense Block A's
requirements target).

## Runtime restarts

**0** — the same persistent Unified MCP process and bridge served every A1 test call.

## Existing-system modifications

```text
Plumb: NONE
Custom: NONE
Custom P0-P3: NONE
```
Confirmed by `git status` in `FIGMA-CUSTOM-MCP` and the Plumb installation directory being untouched —
every A1 change is inside `FIGMA UNIFIED MCP` only.

## Regression

Not re-run this checkpoint (no reason to expect a change — A1 touched only Custom-family read
serialization inside Unified's own plugin; the pre-Block-A hardening pass's regression evidence for
original Plumb/Custom still stands). Will be re-run before any future checkpoint that claims a final
Block A verdict.

## Remaining gaps (become input to the next A1→A11 batches, not Block B)

- A2 (basic create/update/delete write path) — next up, and the brief's own recommended immediate next
  batch.
- A3-A11 — text, appearance, geometry writes, layout, hierarchy/components, images/assets, P2 advanced
  operations, P3 diff/verify/measure, high-value Plumb extraction tools (`plumb.node.read`,
  `plumb.tokens`, `plumb.components`).
- A large-tree performance measurement once enough real structure exists to make it meaningful.
- A decision on `figma_batch` (Custom's own multi-op orchestration tool) vs. relying on Unified's
  existing `CommandQueue` sequencing — flagged in the capability matrix, not resolved yet.

---

## UNIFIED CAPABILITY INTEGRATION: PARTIAL
(Checkpoint after batch A1 of an estimated 11. Not a stopping point — continues with A2 next.)
