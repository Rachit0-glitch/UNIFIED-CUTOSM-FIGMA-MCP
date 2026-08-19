# Unified Figma MCP

Stage 1 investigation project for a Unified Figma MCP coordinator that can use Plumb and Custom MCP appropriately without modifying either existing backend.

Correct local path:

```text
C:\Users\rachi\OneDrive\Documents\figma-unified-mcp
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
