# Plugin-Data Namespaces (H13)

## Current state

**Unified MCP's plugin (`figma-plugin/code.js`) uses zero `figma.setPluginData`/`getPluginData` calls
today.** Confirmed by direct source inspection (`grep -n "setPluginData\|getPluginData"
figma-plugin/code.js` returns no matches) as of this hardening pass. All 6 production capabilities
(`plumb.status`, `plumb.outline`, `plumb.selection.read`, `custom.status`, `custom.node.read`,
`custom.selection.read`) are pure reads — nothing is tagged, nothing is reconciled, nothing persists
plugin data anywhere.

The one thing that DID use plugin-data-adjacent bookkeeping — the shelved `custom.design.apply` WIP —
used **name-based** cleanup instead ("delete any existing sibling whose `.name` matches the new root's
name"), not a plugin-data key at all. That pattern is exactly what this document exists to forbid (see
Requirements below) and is archived, not active — see `docs/HARDENING_WORKTREE_AUDIT.md` and
`archive/design-apply-poc/`.

## Why this document exists now, before Unified has any plugin data to track

Custom MCP's P2 phase discovered a serious, real bug: one-shot tools (`figma_group`,
`figma_create_component_set`) and `figma_design`'s own sync-mode reconciliation shared a single
plugin-data key namespace (`customMcpKey`). A group tagged for one-shot idempotency looked exactly
like a stale tree node to the next sync rebuild, which silently deleted it. The fix was two
genuinely-separate namespaces (`customMcpKey` for tree reconciliation, `customMcpOperationKey` for
one-shot-tool idempotency) — see Custom MCP's `docs/P2-IMPLEMENTATION.md` for the full incident.

Unified MCP has no plugin data yet, but Block A will add capabilities that do (any keyed
reconciliation, any idempotent one-shot operation). This document is the policy those additions must
follow from their very first line of code, not a retrofit after the same class of bug recurs.

## Requirements for any future Unified plugin-data usage (Block A and beyond)

1. **Every distinct purpose gets its own, uniquely-named key.** Never reuse a key across two
   different reconciliation/idempotency mechanisms, even if they seem related. If Unified ever wraps
   Custom MCP's real `figma_design`/`figma_group`/`figma_create_component_set` (the correct way to
   eventually gain this capability — see `docs/PRE_BLOCK_A_HARDENING.md` H2/H3/H9), it should
   **delegate to Custom MCP's own real key namespaces** (`customMcpKey` / `customMcpOperationKey`)
   through the real Custom MCP tool calls, not invent a third, Unified-specific namespace that could
   collide with either.
2. **No name-based destructive cleanup, ever.** A node's `.name` is not a stable identity — two
   unrelated composions can share a root name, and name-based "delete anything matching" logic can
   destroy content it was never meant to touch. This is exactly the fragile cleanup the shelved
   `custom.design.apply` used and exactly why it was shelved rather than hardened in place.
3. **No deleting unrelated nodes.** Any cleanup/reconciliation logic must operate only on nodes it can
   prove — via a real plugin-data key match, not a name heuristic — it created or owns.
4. **Document the key here the moment it's introduced.** This file must list every namespace in use,
   its purpose, and which capability/tool writes and reads it, kept current as of the last change that
   touched plugin data.

## Namespace registry (currently empty)

| Namespace key | Purpose | Written by | Read by |
|---|---|---|---|
| _(none yet)_ | — | — | — |

Update this table the moment any future Unified capability starts using `setPluginData`/
`getPluginData` — do not let it go stale.
