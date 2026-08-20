# Archived: `custom.design.apply` proof-of-concept

Not active code. Not referenced by any production path, capability registry entry, test, or npm
script. Kept only for historical reference per the pre-Block-A hardening pass — see
`docs/HARDENING_WORKTREE_AUDIT.md` and `docs/PRE_BLOCK_A_HARDENING.md` (issue H2) for the full
reasoning behind shelving this.

## What's here

- `figma-plugin-code.js.diff` — the uncommitted diff against `figma-plugin/code.js` that added a
  `customDesignApply`/`createDesignNode`/`countDesignNodes` handler for a `"design.apply"` operation.
- `build-headphone-hero-unified.mjs` — the CLI script that exercised it, rebuilding the "Sonic
  Headphone Hero" composition (already built for real through the mature Custom MCP project) through
  this shallow reimplementation instead.

## Why it was shelved rather than reworked

It reimplements a fraction of what Custom MCP's real `figma_design` already does correctly — a
different document schema, 5 of Custom MCP's 10 node types, no absolute/overlapping positioning, no
auto-layout, no strict validation, no local `file:` image import, and name-based (not keyed) cleanup.
Reworking it to genuinely delegate to the real, mature Custom MCP implementation is real
capability-integration work — Block A's job, not a hardening pass's. Shelving it now means Block A
starts from a clean registry with no misleading, half-working mutation capability already sitting in
it.

## If Block A wants this later

Don't resurrect this code. Delegate to the real Custom MCP tools (`figma_design`, `figma_patch_node`,
etc.) the way `docs/PRE_BLOCK_A_HARDENING.md`'s H9 schema-driven capability architecture and H3
serializer-extension points are designed to support — that's what they exist for.
