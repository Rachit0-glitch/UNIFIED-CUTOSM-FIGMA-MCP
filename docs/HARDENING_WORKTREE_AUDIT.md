# Hardening Worktree Audit

Written before any hardening changes were made, per the hardening pass's own "first action" requirement.
Committed baseline: `a26ac52` ("Add Stage 4 production unified runtime"), branch `main`, in sync with
`origin/main`. No destructive git operation was run to produce this document — it is a plain read of
`git status`/`git diff`.

## Uncommitted state found

**6 modified, 1 untracked** — exactly matching the read-only audit's earlier finding.

| File | Change | What it does |
|---|---|---|
| `figma-plugin/code.js` | +153/-0 (approx) | Adds `customDesignApply`/`createDesignNode`/`countDesignNodes` and a `"design.apply"` handler entry in the `custom` family dispatch table |
| `figma-plugin/ui.html` | 1 line | Bumps `PLUGIN_VERSION` from `"0.2.0-stage4"` to `"0.3.0-unified-design"` |
| `package.json` | +2/-1 | Adds `build-headphone-hero-unified.mjs` to the `check` script's syntax-check chain and adds a `build:headphone-hero` npm script |
| `src/runtime/capabilities.js` | +10 | Adds a `custom.design.apply` capability entry (`mutation: true`, `stage: "hero-build"`) |
| `src/runtime/protocolAdapters/custom.js` | +9 | Adds envelope normalization for the `"design.apply"` operation |
| `tests/runtime.test.js` | +26/-2 | Adds a fake-bridge branch for `design.apply`, bumps the expected capability count from 6 to 7, adds `custom.design.apply` to the expected capability-id list and the mutation-capability list, adds one new test routing a `design.apply` call through the router |
| `scripts/build-headphone-hero-unified.mjs` (untracked) | new file, 107 lines | A CLI script that builds the "Sonic Headphone Hero" composition — the same composition already built for real through the mature Custom MCP project earlier — through `custom.design.apply` instead |

## What this change actually is

An in-progress attempt to prove `custom.design.apply` end-to-end by rebuilding a known, previously-real
composition through it. Reading `customDesignApply`/`createDesignNode` in `figma-plugin/code.js`
confirms this is a **from-scratch reimplementation**, not a delegation to the real Custom MCP: a
different document version string (`"unified-design-v1"` vs. Custom MCP's `"1"`), only 5 of Custom
MCP's 10 node types, no absolute/overlapping positioning (`layoutPositioning` is never set — the
literal reason Custom MCP exists over Plumb), no auto-layout, no strict schema validation (plain
duck-typed field reads), no `file:`-path local image import (data URIs only), and a name-based
"delete anything with a matching root name first" cleanup instead of Custom MCP's proven keyed
reconciliation. This matches exactly what the earlier read-only audit flagged as CRITICAL (finding
"Uncommitted `custom.design.apply` reimplements Custom MCP from scratch, badly").

## Does it belong to Block A?

Yes, structurally — `custom.design.apply` is capability-integration work (mutating Figma through the
`custom` family), which is explicitly Block A's job, not pre-Block-A hardening's. Its presence in the
working tree, uncommitted, with its own tests already bumped to expect it, is exactly the kind of
"premature capability work disguised as infrastructure" this hardening pass exists to resolve before
Block A begins for real.

## Decision (H2)

**Shelved, not reworked.** Per the hardening brief's own stated preference and its explicit
"do not integrate full Custom P0–P3 in this hardening pass" constraint, reworking this to genuinely
delegate to the real Custom MCP would itself be Block-A-scale integration work (spawning/depending on
the real Custom MCP process from inside the Unified plugin, handling its real response shapes,
carrying forward its real idempotency namespace, etc.) — not a hardening-pass-sized fix.

- All production code changes above (plugin handler, capability entry, protocol adapter branch,
  plugin-version bump, package.json script wiring) are **removed** from the active/production tree.
- `tests/runtime.test.js` is **reverted** to its committed baseline — every line of its diff was
  `design.apply`-specific test coverage for code that no longer exists in production.
- The `figma-plugin/code.js` diff and `scripts/build-headphone-hero-unified.mjs` are preserved for
  historical/reference purposes only, moved to `archive/design-apply-poc/` (untracked by any build/test
  script, not registered as a capability, not reachable from the MCP tool surface). A short README in
  that folder explains what it is and why it isn't active, with a pointer back to this document.
- `package.json`'s `check`/scripts additions are removed (they referenced the archived script by its
  old path).

This resolves the finding cleanly: there is no weak Custom reimplementation left active in production
Unified MCP, and the historical artifact remains available if Block A's real integration work ever
wants to compare against what an earlier, naive attempt looked like.

## Safe to preserve as-is (no action needed)

`tests/coordinator.test.js` was not modified in the uncommitted diff — it already tests the legacy
`BackendRegistry`/`UnifiedCoordinator` path against **hand-constructed fake adapters**, never spawning
a real process. It remains valid, accurate unit coverage of that code path regardless of H1's gating
decision (which changes MCP-tool *exposure*, not the underlying coordinator/registry classes
themselves — see `docs/LEGACY_RUNTIME_POLICY.md`).
