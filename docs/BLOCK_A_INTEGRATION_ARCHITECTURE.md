# Block A Integration Architecture

## The core problem

Unified MCP runs exactly one Figma plugin (`figma-plugin/code.js` in this repo). Plumb and Custom each
have their own separate, mature Figma plugin. Only one plugin can be paired with Figma at a time (this
was Stage 3's "automated handoff blocked" finding, and remains true — Block A does not revisit it).

So integrating a Plumb or Custom capability into Unified always means: **the logic that used to run
inside Plumb's or Custom's own plugin sandbox must now run inside Unified's plugin sandbox instead.**
There is no way around that — Figma plugins have no module system, no dynamic `require`, no way to load
code from another plugin at runtime. The only question is *how* that logic gets there.

## Two different kinds of source-of-truth logic, two different reuse mechanisms

**1. Pure Node-side logic (validation, compilation, diffing, measurement) — REUSE BY IMPORT.**

Custom MCP's `src/compiler.ts`, `src/design-schema.ts`, `src/diff.ts`, `src/measure.ts` (compiled to
`dist/*.js`) run in the Custom MCP **server** process, not inside the Figma plugin sandbox. They have no
dependency on the `figma` global. This code is genuinely importable by Unified MCP's own server-side
`CommandRouter`/protocol-adapter layer, the same way any Node package is imported. Where Block A wraps a
Custom capability whose validation/compilation is pure Node logic, **the correct move is to depend on
these modules directly** (or the equivalent compiled output), not to re-derive equivalent Zod schemas or
a second DSL compiler by reading the source and retyping it. Re-deriving would silently drift from the
real source of truth the moment Custom MCP's schema changes.

**2. Figma-plugin-sandbox logic (everything that calls a real `figma.*` API) — REUSE BY PORTING.**

`figma-plugin/code.js` in FIGMA-CUSTOM-MCP (and the equivalent in Plumb) runs inside Figma's plugin
sandbox and cannot be imported by anything — it's not a module, it's the entire bundled program Figma
loads. For this code, "reuse" cannot mean `import`; it has to mean **porting the exact same function
bodies into Unified's own plugin file, verbatim, adapted only to Unified's envelope/dispatch shape.**

This is NOT the same mistake as the shelved `custom.design.apply` WIP. That WIP was a **weaker,
independently-reasoned approximation** — different document-version string, half the node types, no
strict validation, name-based cleanup instead of keyed. Porting is different in kind: it is copying the
actual, currently-shipping, already-real-Figma-tested function bodies (e.g. `serializeNode`,
`serializeNodeProperties`, `applyIntrinsic`, `handlePatchNode`) with no independent re-derivation at all.
The test for "is this a port or a reimplementation" is: **could a diff between the source file and the
ported file be produced, showing only mechanical adaptation (envelope shape, dispatch wiring) and zero
behavioral changes?** If yes, it's a port. If the diff would show new logic, different validation, or
different coverage, it's a reimplementation and must not happen per the Block A brief's central rule.

Every port must carry a comment naming its exact source (`figma-plugin/code.js:LINE-LINE` in the
original project) so a future audit can re-diff it against any upstream change.

## A1 precedent (first applied integration)

Full-fidelity reads (`custom.node.read`/`custom.selection.read`) are the first capability integrated
under this architecture. Concretely:

- `serializeNode`/`serializeNodeProperties`/`mixedSafe`/`READBACK_CATEGORIES` were ported **verbatim**
  from `FIGMA-CUSTOM-MCP/figma-plugin/code.js:31-33,721,728-886` into
  `FIGMA UNIFIED MCP/figma-plugin/code.js`. Zero new fields were added; zero fields were removed; the
  8-category `include` filter (`geometry`/`layout`/`appearance`/`text`/`component`/`variables`/
  `styles`/`metadata`) is character-for-character the same set Custom MCP's own `figma_node` tool
  accepts (`FIGMA-CUSTOM-MCP/src/tools.ts`'s `include` param) — reused as the Zod enum in
  `src/runtime/capabilities.js`'s `ReadbackCategorySchema`, not re-typed as separate strings.
- Plumb-family reads (`plumb.selection.read`, `plumb.outline`) deliberately kept their OWN pre-existing
  compact serializer (`plumbSerializeNode`), unaffected by A1 — per the "do not force identical
  semantics" principle (Block A brief §11), Plumb's compact read format and Custom's rich read format
  are genuinely different tools for genuinely different callers, not two skins on one serializer.

## Ownership principle (applied)

The Plumb gap analysis (`FIGMA/PLUMB_GAP_ANALYSIS.md`, a source-verified audit already on disk) already
worked out a detailed Plumb-vs-Custom ownership split (§39 of that document). Block A adopts it directly
rather than re-deriving ownership from scratch — see `docs/BLOCK_A_CAPABILITY_MATRIX.md` for the full
per-capability table. Summary:

| Category | Owner | Why |
|---|---|---|
| Auto-layout composition, typography, fills/strokes/effects/blend modes, variables, styles (minus paint), extraction/inspection, export (PNG/SVG) | **Plumb** | Already mature, already reliable, already covers this completely — reimplementing would be pure waste. |
| Absolute/overlapping positioning, free (non-auto-layout) canvases, local/data-URI image import, per-corner radius, strict `.strict()`-schema validation | **Custom** | Confirmed P0 gaps in Plumb (Plumb's own plugin can often already DO these things — the DSL compiler just never reaches them); Custom MCP was built specifically to fill these. |
| Boolean operations, masks (write), sections/stars/polygons, true GROUP nodes, component sets/variants, paint styles, single-node patch/delete/reorder/move, component property definitions, instance overrides/swap, bound-variable writes on ordinary nodes, rich text-range styling, P3 inspect/diff/verify/measure | **Custom** | Plumb has no equivalent at all; Custom MCP's P1-P3 work built these as real, tested capabilities. |

Full-fidelity reads (A1, this batch) belong to Custom's `custom.*` family specifically because Custom's
serializer is the one with genuinely complete category coverage (Plumb's own read path is also strong,
per the gap analysis §26, but has a different compact shape suited to different callers — not replaced
here, kept as its own family).

## What Block A does NOT do architecturally

- It does not give Unified's plugin a way to reach into Plumb's or Custom's *running* server process —
  every port is a standalone copy inside Unified's own plugin file, with zero runtime dependency on
  either original plugin being present or paired.
- It does not modify `FIGMA-CUSTOM-MCP` or the original Plumb project in any way. Every port's source is
  read, never written.
- It does not attempt semantic routing ("the LLM says 'add a shadow', pick a backend automatically") —
  capability IDs remain explicit (`plumb.*` / `custom.*`), matching Block A brief §44.
