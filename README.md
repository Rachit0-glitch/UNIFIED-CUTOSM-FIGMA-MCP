# Unified Figma MCP

Stage 1 investigation project for a Unified Figma MCP coordinator that can use Plumb and Custom MCP appropriately without modifying either existing backend.

Correct local path:

```text
C:\Users\rachi\OneDrive\Documents\FIGMA UNIFIED MCP
```

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

Diagnostic helpers:

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

