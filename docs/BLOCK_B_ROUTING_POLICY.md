# Block B §7 — Capability Routing Policy

This document states, explicitly and deterministically, which backend family (`plumb` or `custom`)
owns each capability exposed through `unified_execute`, and why. This is a **policy document**, not new
code — the actual routing already happens structurally (each capability in
`src/runtime/capabilities.js` carries its own `family`), so this doc exists to make the *reasoning*
inspectable rather than implicit.

## The rule

**Plumb owns capabilities where Block A found it already strong and sufficient. Custom owns everything
else** — full-fidelity reads, all creation, all mutation, and every advanced/verification capability
Plumb doesn't (and, per Block A's findings, doesn't need to) provide.

This is not a 50/50 split by design — it's lopsided because that's what the evidence supports: Plumb is
a read-oriented inspection tool for a live Figma session (document outline, component inventory, current
selection, connection status); Custom is the actual authoring/mutation/verification engine (compiled
from `figma-custom-mcp`, imported verbatim via the `file:` dependency established in Block A).

## Current routing table (29 capabilities)

| Family | Capability | Mutation | Why this owner |
|---|---|---|---|
| plumb | `plumb.status` | no | connection/session status is inherently a Plumb-side concern |
| plumb | `plumb.outline` | no | Block A confirmed Plumb's document outline is fast and complete — no gap to fill |
| plumb | `plumb.selection.read` | no | live selection is a Plumb-native concept; no Custom equivalent needed |
| plumb | `plumb.components` | no | component/instance inventory with cross-referenced instance counts — Block A A11 closed this gap on the Plumb side specifically because it's inventory, not full-fidelity node data |
| custom | `custom.status` | no | Custom-side backend/session status |
| custom | `custom.node.read` | no | **full-fidelity** node read (styles, variables, vector paths, effects, overrides) — Block A established Plumb's outline/selection reads are not full-fidelity, so any caller needing complete node data must use Custom |
| custom | `custom.selection.read` | no | full-fidelity selection read (mirrors `node.read`'s fidelity guarantee) |
| custom | `custom.design` | yes | the only creation/bulk-sync primitive — owns full document construction and `mode:"sync"` reconciliation |
| custom | `custom.patch_node`, `delete_node`, `reorder_node`, `move_node` | yes | single-node mutation primitives — no Plumb equivalent exists or is planned |
| custom | `custom.boolean`, `group`, `ungroup`, `create_component_set` | yes | structural/hierarchy mutation |
| custom | `custom.create_paint_style`, `list_styles`, `styles` | yes/no | style system (Custom P2) |
| custom | `custom.text_range`, `component_property`, `instance_override`, `instance_swap`, `create_instance` | yes | component/instance/text mutation (Custom P2) |
| custom | `custom.variables` | yes | variable system (Custom P2) |
| custom | `custom.set_mask` | yes | masking (Custom P2) |
| custom | `custom.diff`, `verify`, `measure` | no | measurement/diff/verification primitives (Custom P3) — these have no Plumb equivalent by design; they exist specifically to support the planner's INSPECT→MEASURE→DIFF→VERIFY cycle (§18-19) |

## Explicit non-decisions (deliberately NOT integrated)

The brief calls out two specific temptations to avoid, and Block B holds the line on both:

- **`plumb.node.read` is NOT integrated.** Block A already established that Custom's `custom.node.read`
  is the full-fidelity read path (styles, variables, vector data, effects) and Plumb's outline/selection
  reads are not. Adding a `plumb.node.read` capability "for symmetry" (so every family has a `node.read`)
  would create two reads with different fidelity guarantees and no way for a caller to know which one to
  use without already knowing the answer. No concrete unmet requirement has surfaced in Block A or Block
  B that Plumb's existing `outline`/`selection.read`/`components` don't already cover for
  inspection-only use cases.
- **`plumb.tokens` is NOT integrated.** No concrete requirement for it has appeared anywhere in Block A's
  acceptance tests, Block B's design-construction acceptance test, or any capability that currently lacks
  a way to read style/variable data (`custom.list_styles`, `custom.styles`, `custom.variables`, and
  `custom.node.read`'s `include` filters already cover token-adjacent needs on the Custom side).

Both remain easy to add later **if** a real, concrete requirement appears — but adding either now would
be exactly the kind of speculative capability §29 warns against.

## How this policy is enforced

There is no separate "routing policy" code module — the policy above is already fully expressed by the
`family` field on each entry in `STAGE4_CAPABILITIES` (`src/runtime/capabilities.js`), which
`CommandRouter` and the MCP tool schemas already use to route every `unified_execute` call. This
document is the human-readable explanation of why that data looks the way it does, kept next to
[`CAPABILITY_REGISTRY.md`](../CAPABILITY_REGISTRY.md) (the authoritative list of what each capability
does) rather than duplicating it.
