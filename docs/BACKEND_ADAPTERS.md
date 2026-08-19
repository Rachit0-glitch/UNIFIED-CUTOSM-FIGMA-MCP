# Backend Adapters

## Interface

Adapters provide a consistent coordinator-facing shape:

```js
getStatus()
isAvailable()
isFigmaUsable()
getCapabilities()
executeDiagnostic({ type: "safe-read" })
```

The coordinator sees normalized status and diagnostic results, while backend protocol details remain inside each adapter.

## PlumbAdapter

Source: `src/adapters/plumb.js`

Responsibilities:

- starts/reuses Plumb MCP over stdio,
- calls `plumb_status`,
- detects bridge port, plugin pairing, file name, screen count, and Plumb version,
- calls `plumb_outline` for safe read diagnostics,
- maps failures into normalized errors.

Safe diagnostic evidence is page/screen outline data only. No write is performed.

## CustomAdapter

Source: `src/adapters/custom.js`

Responsibilities:

- starts/reuses Custom MCP over stdio,
- calls `figma_status`,
- detects bridge port, plugin pairing, and plugin version,
- calls `figma_node` with depth 1 metadata include for safe read diagnostics,
- maps failures into normalized errors.

Safe diagnostic evidence is current page/node metadata only. No write is performed.

## Configuration

Source: `src/config.js`

Centralized fields:

- `UNIFIED_PLUMB_COMMAND`
- `UNIFIED_PLUMB_ARGS`
- `UNIFIED_PLUMB_CWD`
- `UNIFIED_CUSTOM_COMMAND`
- `UNIFIED_CUSTOM_ARGS`
- `UNIFIED_CUSTOM_CWD`
- `FIGMA_CUSTOM_MCP_PORT`
- `UNIFIED_PROBE_TIMEOUT_MS`
- `UNIFIED_PAIR_WAIT_MS`
- `UNIFIED_LOG_LEVEL`

Machine-local defaults are centralized in configuration, not scattered through adapters.
