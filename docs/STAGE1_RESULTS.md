# Stage 1 Results

Date: 2026-08-19
Project path: `C:\Users\rachi\OneDrive\Documents\figma-unified-mcp`

## Summary

Stage 1 is an investigation and architecture-lock stage only. No Plumb source or Custom MCP source was modified. The unified project contains documentation plus one SDK-based diagnostic script for Custom MCP probing.

## Baseline Results

| Test | Result | Evidence |
| --- | --- | --- |
| S1-A1 Plumb status | PASS | `plumb_status` returned Plumb MCP `0.13.2`, bridge `31338`, plugin paired, file `Untitled`. |
| S1-A2 Plumb read | PASS | `plumb_outline` returned real pages/screens including `Headphone Hero` and `P2 Composition`. |
| S1-A3 Plumb write + cleanup | PARTIAL / DEFERRED | Plumb write path exists, but exposed Plumb tools do not include direct delete cleanup. Avoided adding a new disposable node in this final Stage 1 run. |
| S1-B1 Custom status | PASS | SDK probe listed 24 Custom tools and `figma_status` returned bridge `39217`, connected `true`, plugin `0.1.0` when Custom plugin was active. |
| S1-B2 Custom read | PASS | `figma_node` returned current page `Headphone Hero` with real Figma child nodes. |
| S1-B3 Custom write + cleanup | PASS | `figma_design` created disposable root `38:9` with 3 nodes; `figma_delete_node` deleted it. |
| S1-C1 Dual-system observation | SEQUENTIAL PASS | Plumb and Custom both work when their plugin bridge is active. User confirmed only one MCP can be connected in Figma at one time, so concurrent paired operation is not assumed. |
| S1-D1 Architecture probe | PASS | `scripts/custom-mcp-sdk-probe.mjs` normalized Custom MCP status/read/write/cleanup through MCP stdio without editing Custom. |
| S1-E1 Regression | PASS | After switching back to Plumb, `plumb_status` returned plugin paired on `31338`; `plumb_outline` returned the real `Untitled` file with 3 pages and 4 screens. Custom had been restored on `39217` after the live probe. |

## Custom Live Probe Output Highlights

```json
{
  "port": 39217,
  "status": {
    "connected": true,
    "pluginVersion": "0.1.0",
    "note": "Plugin paired."
  },
  "read": { "ok": true },
  "write": {
    "ok": true,
    "result": {
      "rootId": "38:9",
      "created": 3,
      "updated": 0,
      "deleted": 0,
      "warnings": []
    }
  },
  "cleanup": {
    "ok": true,
    "result": { "deleted": true }
  }
}
```

## Architecture Lock

Use a Unified MCP coordinator with explicit backend adapters. Treat Plumb and Custom as independent backends. Do not merge their source projects. Do not assume simultaneous Figma plugin pairing in the current user workflow.

## Final Plumb Regression

```json
{
  "connected": true,
  "bridgePort": 31338,
  "pluginVersion": "0.13.2",
  "fileName": "Untitled",
  "pageCount": 3,
  "screenCount": 4
}
```

## Stop Point

Stage 1 stops here. The next stage should implement only coordinator health/status and routing foundation unless the user explicitly authorizes more.

