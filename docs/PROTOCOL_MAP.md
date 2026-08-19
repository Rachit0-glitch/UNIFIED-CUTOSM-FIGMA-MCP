# Protocol Map

## Plumb

| Layer | Transport | Endpoint | Notes |
| --- | --- | --- | --- |
| MCP client to server | stdio MCP | `plumb-mcp/dist/index.js` | Tool calls exposed directly in this Codex task. |
| Server to plugin | WebSocket | first free `127.0.0.1:31337..31346` | Stage 1 paired on `31338`. |
| Binary channel | HTTP | same selected port | Used for assets/screenshots/uploads. |
| Plugin to Figma | Figma Plugin API | Figma desktop/plugin runtime | Requires Plumb plugin panel active. |

Observed Plumb status response fields to normalize:

- `server.name`
- `server.version`
- `plugin.connected`
- `plugin.bridgePort`
- `plugin.pluginVersion`
- `plugin.fileName`
- `plugin.screens`
- `plugin.selection`
- `rest.configured`

## Custom MCP

| Layer | Transport | Endpoint | Notes |
| --- | --- | --- | --- |
| MCP client to server | stdio MCP | `FIGMA-CUSTOM-MCP/dist/index.js` | Tools not exposed directly in current Codex task; SDK probe verified them. |
| Server to plugin | WebSocket | `ws://127.0.0.1:39217` | Single plugin socket. New socket replaces old. |
| Plugin UI to main | `postMessage` | Figma plugin sandbox | UI forwards bridge requests to main code. |
| Plugin to Figma | Figma Plugin API | Figma desktop/plugin runtime | Requires Custom MCP plugin panel active. |

Observed Custom status response fields to normalize:

- `bridgePort`
- `connected`
- `pluginVersion`
- `note`

## Unified Health Shape

Recommended normalized health record:

```json
{
  "backend": "plumb | custom",
  "mcp": "pass | fail",
  "bridge": "pass | fail",
  "plugin": "paired | not_paired",
  "port": 31338,
  "pluginVersion": "0.13.2",
  "details": {}
}
```

## Important Stage 1 Finding

The user's current Figma workflow supports only one active MCP plugin bridge at a time. Unified MCP must make backend selection explicit instead of assuming both plugins can be paired simultaneously in the live Figma UI.
