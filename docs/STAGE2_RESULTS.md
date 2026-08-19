# Stage 2 Results

## Executive Summary

Stage 2 implemented a first real Unified MCP coordinator runtime. It starts as its own MCP stdio server, registers Plumb and Custom as independent backend adapters, returns normalized status, determines the active backend, and routes read-only diagnostics through the selected backend.

No Plumb or Custom source files were modified.

## Architecture

```text
MCP client
  -> figma-unified-mcp
      -> unified_status / unified_backends / unified_active_backend / unified_probe_backend
      -> BackendRegistry
          -> PlumbAdapter  -> Plumb MCP child  -> Plumb plugin -> Figma
          -> CustomAdapter -> Custom MCP child -> Custom plugin -> Figma
```

## Backend Adapter Implementation

- `src/adapters/plumb.js`: calls `plumb_status` and `plumb_outline`.
- `src/adapters/custom.js`: calls `figma_status` and `figma_node`.
- `src/registry.js`: registers adapters and determines active backend.
- `src/coordinator.js`: provides unified status/backends/active/probe operations.
- `src/mcp/stdioClient.js`: newline-delimited JSON-RPC MCP client used by adapters and test scripts.
- `src/mcp/server.js`: minimal Unified MCP stdio server.

## Status Model

The normalized status model includes:

```text
id, mcpAvailable, bridgeAvailable, pluginPaired, figmaConnected, usable,
version, bridgePort, pluginVersion, fileName, lastCheckedAt, error
```

Unknown/unobserved values are `null` or omitted; pairing is never inferred merely from process availability.

## Active Backend Logic

```text
usable backends = statuses where pluginPaired === true and usable === true
0 -> none
1 -> backend id
2+ -> ambiguous
```

## Tools Added

- `unified_status`
- `unified_backends`
- `unified_active_backend`
- `unified_probe_backend`

## Tests

Unit:

- backend registry
- normalized status behavior through coordinator mocks
- active backend detection: none, Plumb, Custom, ambiguous
- backend unavailable / not found handling
- timeout helper
- error normalization

Integration helpers:

- `scripts/unified-probe.mjs`
- `scripts/unified-live-sequence.mjs`

## Real Figma Results

| Test | Result | Evidence |
| --- | --- | --- |
| S2-A Plumb active | PASS | Unified status detected `activeBackend: "plumb"`; Plumb probe returned file `Untitled`, 3 pages, 4 screens. |
| S2-B Custom active | PASS | Same running Unified process detected `activeBackend: "custom"`; Custom probe returned page `Headphone Hero`, node id `8:3`, type `PAGE`, child count 2. |
| S2-C Live backend change | PASS | One persistent Unified MCP process detected Custom after manual switch, then Plumb after manual switch back. |
| S2-D Wrong backend probe | PASS | Custom active -> Plumb probe returned `BACKEND_NOT_PAIRED`; earlier Plumb active -> Custom probe safely failed while Plumb remained usable. |
| S2-E No active backend | PASS | With neither plugin paired to the Unified backend children, status returned `activeBackend: "none"` while both MCP processes were available. |
| S2-F Final regression | PASS | Direct Plumb status/outline passed; direct Custom SDK status/read passed with plugin `0.1.0` on `39217` and real page `Headphone Hero`. |

## Observed Live Evidence

Custom active through persistent Unified process:

```json
{
  "activeBackend": "custom",
  "custom": {
    "mcpAvailable": true,
    "bridgeAvailable": true,
    "pluginPaired": true,
    "bridgePort": 39217,
    "pluginVersion": "0.1.0"
  },
  "diagnostic": {
    "kind": "figma_node",
    "nodeId": "8:3",
    "nodeName": "Headphone Hero",
    "nodeType": "PAGE",
    "childCount": 2
  }
}
```

Plumb active after switch-back through persistent Unified process:

```json
{
  "activeBackend": "plumb",
  "plumb": {
    "mcpAvailable": true,
    "bridgeAvailable": true,
    "pluginPaired": true,
    "bridgePort": 31339,
    "pluginVersion": "0.13.2",
    "fileName": "Untitled"
  },
  "diagnostic": {
    "kind": "outline",
    "fileName": "Untitled",
    "pageCount": 3,
    "screenCount": 4
  }
}
```


Final independent Custom regression:

```json
{
  "bridgePort": 39217,
  "connected": true,
  "pluginVersion": "0.1.0",
  "read": {
    "nodeId": "8:3",
    "nodeName": "Headphone Hero",
    "nodeType": "PAGE",
    "children": ["Button instance", "P2 Composition"]
  }
}
```
## Regression State

Plumb independent = PASS
Custom independent = PASS

## Existing-System Modifications

NONE. Stage 2 only modified files inside the Unified MCP project.

A stale background Custom MCP process from Stage 1 was stopped before live Stage 2 testing so the Unified coordinator could own the Custom backend child. No source, config, port, manifest, or backend code was changed.

## Known Limitations

- Automatic plugin switching is not implemented.
- Full backend tool aggregation is not implemented.
- The coordinator starts backend MCP children; it does not attach to an already-running Custom MCP process on `39217`.
- The current Figma workflow still supports one active plugin bridge at a time.
- The MCP server implementation is intentionally minimal and only supports the Stage 2 tool surface.

## Stage 3 Recommendation

The smallest safe next step is a switch-coordinator protocol that returns explicit user-facing switch instructions and retries only after a fresh status confirms the required backend is paired. Do not expose full Plumb/Custom tool aggregation until switching semantics are stable.

