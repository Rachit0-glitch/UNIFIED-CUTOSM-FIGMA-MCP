# Unified Figma MCP

Unified Figma MCP coordinates Plumb-family and Custom-family Figma capabilities without modifying either original backend.

Correct local path:

```text
C:\Users\rachi\OneDrive\Documents\FIGMA UNIFIED MCP
```

## Stage 4 Status

Stage 4 turns the Stage 3.5 single-plugin proof of concept into a production Unified runtime foundation:

```text
Unified MCP -> CapabilityRegistry -> CommandRouter -> ProtocolAdapter -> CommandQueue -> UnifiedBridge -> UnifiedPlugin -> Figma
```

Primary Stage 4 tools:

```powershell
node scripts\unified-probe.mjs unified_capabilities
node scripts\unified-probe.mjs unified_execute '{"capability":"plumb.outline","payload":{}}'
node scripts\unified-probe.mjs unified_execute '{"capability":"custom.node.read","payload":{"depth":1}}'
npm run stage4:live
```

Supported production runtime capabilities:

- `plumb.status`
- `plumb.outline`
- `plumb.selection.read`
- `custom.status`
- `custom.node.read`
- `custom.selection.read`

All Stage 4 capabilities are read-only. Original Plumb and original Custom are not modified.

Stage 4 docs:

- `docs/STAGE4_POC_REVIEW.md`
- `docs/STAGE4_ARCHITECTURE.md`
- `docs/UNIFIED_PROTOCOL.md`
- `docs/CAPABILITY_REGISTRY.md`
- `docs/COMMAND_ROUTING.md`
- `docs/RUNTIME_LIFECYCLE.md`
- `docs/STAGE4_TEST_PLAN.md`
- `docs/STAGE4_RESULTS.md`

## Block A Status

**`UNIFIED CAPABILITY INTEGRATION: PARTIAL`** — see `docs/BLOCK_A_FINAL_REPORT.md` for the exact-format
final report and `docs/BLOCK_A_RESULTS.md` for a shorter summary. Block A integrates the mature Plumb
and Custom MCP capability surfaces into the one hardened Unified runtime, reusing real source-of-truth
logic rather than reimplementing it (`docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md`: reuse-by-import for
pure Node logic — the actual `figma-custom-mcp` compiler/schema/diff/measure modules are a real
dependency — vs. reuse-by-porting, verbatim, for Figma-plugin-sandbox code, which must physically run
inside whichever one plugin is currently paired).

28 capabilities are now registered (up from 6 before this pass): full-fidelity reads (A1), the complete
create/update/delete/reorder write path (A2), hierarchy/reparenting (A6), components/instances/grouping
(A7), P2 advanced operations — masks, paint styles, variables (A9), and the complete P3
inspect→measure→diff→correct→verify→idempotency loop (A10) — all real-Figma-verified, including a real
local-image import (the exact P0 gap `FIGMA/PLUMB_GAP_ANALYSIS.md` documents Plumb as structurally
incapable of) and a mini-design acceptance test combining structure/typography/appearance/layout/P3/
cross-family coexistence in one composition. PARTIAL rather than COMPLETE because a large-tree stress
test, a few A7/A9 capabilities' independent live verification, and A11 (further Plumb integration)
remain — see `docs/BLOCK_A_LIMITATIONS.md` for the complete, honest accounting. Full capability
inventory: `docs/BLOCK_A_CAPABILITY_MATRIX.md`. Real-Figma test evidence: `docs/BLOCK_A_LIVE_RESULTS.md`.

## Pre-Block-A Hardening Status

**UNIFIED MCP STATUS: READY FOR BLOCK A.** Before Block A capability integration begins, this pass
resolved 15 architectural/reliability issues (H1-H15) found by a read-only audit of the Stage 4
foundation: the old dual-plugin-runtime path is now gated behind an opt-in diagnostics flag and
excluded from the default MCP tool set, the shallow `custom.design.apply` proof of concept was shelved
(archived, not deleted), capability payloads are now validated by Zod schemas before any bridge call,
the command queue is bounded with distinct `QUEUE_FULL`/`QUEUE_WAIT_TIMEOUT` errors, Unified now owns
its own `ws`/`zod` dependencies instead of reaching into `FIGMA-CUSTOM-MCP`, and structured errors
preserve their originating `source` and specific message end-to-end. All of it was verified live against
the real Unified Runtime Figma plugin, not just unit tests. Full results: `docs/HARDENING_RESULTS.md`.
Per-issue detail: `docs/PRE_BLOCK_A_HARDENING.md`. Test methods/evidence: `docs/HARDENING_TEST_PLAN.md`.

The production tool set is unchanged in shape (`unified_capabilities`, `unified_execute`,
`unified_runtime_status`), but 4 legacy diagnostic tools (`unified_status`, `unified_backends`,
`unified_active_backend`, `unified_probe_backend` — the old dual-runtime path) now require
`UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` on the server process's own environment to register at all.
See `docs/LEGACY_RUNTIME_POLICY.md`.

## Stage 1 Status

Stage 1 is documentation and verification only. The repo currently contains architecture docs, test results, and a Custom MCP SDK probe. No production coordinator implementation has been added yet.

## Key Finding

Plumb and Custom both work as real Figma MCP paths, but the current Figma workflow supports one active MCP plugin bridge at a time. Unified MCP should therefore expose explicit backend health and clear switch prompts.

## Docs

- `docs/CURRENT_SYSTEM.md`
- `docs/PLUMB_ARCHITECTURE.md`
- `docs/CUSTOM_MCP_ARCHITECTURE.md`
- `docs/PROTOCOL_MAP.md`
- `docs/CAPABILITY_MATRIX.md`
- `docs/ARCHITECTURE_OPTIONS.md`
- `docs/FAILURE_ANALYSIS.md`
- `docs/IMPLEMENTATION_RECOMMENDATION.md`
- `docs/TEST_PLAN.md`
- `docs/STAGE1_RESULTS.md`

## Diagnostic Script

```text
scripts/custom-mcp-sdk-probe.mjs
```

Example:

```powershell
node scripts\custom-mcp-sdk-probe.mjs --wait-paired --read --write
```

The script starts the existing Custom MCP server as a child process, talks MCP over stdio using the MCP SDK installed in `FIGMA-CUSTOM-MCP`, and optionally verifies status, read, write, and cleanup.

## Stage 2 Status

Stage 2 adds the first real Unified MCP coordinator runtime:

```powershell
npm run start
```

Diagnostic helpers (legacy, opt-in-gated — see Pre-Block-A Hardening Status above;
`unified-probe.mjs` auto-passes `UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` when the tool name is one of
these 4):

```powershell
node scripts\unified-probe.mjs unified_status
node scripts\unified-probe.mjs unified_probe_backend '{"backend":"plumb"}'
node scripts\unified-probe.mjs unified_probe_backend '{"backend":"custom"}'
node scripts\unified-live-sequence.mjs
```

Stage 2 docs:

- `docs/STAGE2_ARCHITECTURE.md`
- `docs/STAGE2_TEST_PLAN.md`
- `docs/STAGE2_RESULTS.md`
- `docs/BACKEND_ADAPTERS.md`
- `docs/STATUS_MODEL.md`
- `docs/ERROR_MODEL.md`


## Stage 3 Status

Stage 3 investigated automated backend handoff. Result: **AUTOMATED HANDOFF BLOCKED** under the current two-plugin architecture. Unified MCP can observe manual backend changes, but it cannot legitimately launch the inactive Figma plugin without a new plugin architecture or fragile UI automation.

Stage 3 docs:

- `docs/STAGE3_INVESTIGATION.md`
- `docs/HANDOFF_STATE_MACHINE.md`
- `docs/BACKEND_LIFECYCLE.md`
- `docs/STAGE3_TEST_PLAN.md`
- `docs/STAGE3_RESULTS.md`
- `docs/HANDOFF_BLOCKER.md`
- `docs/RUNTIME_ALTERNATIVES.md`
