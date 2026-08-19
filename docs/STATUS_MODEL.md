# Status Model

## BackendStatus

```json
{
  "id": "plumb | custom",
  "mcpAvailable": true,
  "bridgeAvailable": true,
  "pluginPaired": true,
  "figmaConnected": true,
  "usable": true,
  "version": "0.13.2",
  "bridgePort": 31339,
  "pluginVersion": "0.13.2",
  "fileName": "Untitled",
  "lastCheckedAt": "2026-08-19T11:12:29.934Z",
  "error": null
}
```

Fields are omitted or set to `null` when they cannot be observed reliably.

## Semantics

- `mcpAvailable`: backend MCP process can be started and initialized.
- `bridgeAvailable`: bridge port/state is reported by the backend status tool.
- `pluginPaired`: backend explicitly reports a paired Figma plugin.
- `figmaConnected`: equivalent to plugin-paired for Stage 2.
- `usable`: backend can safely execute real Figma diagnostics now.
- `lastCheckedAt`: generated at every status read; status is intentionally fresh.

## Active Backend

Logic in `src/registry.js`:

```text
0 usable backends -> none
1 usable backend  -> that backend id
2 usable backends -> ambiguous
```

The coordinator does not silently choose a backend when more than one reports usable.
