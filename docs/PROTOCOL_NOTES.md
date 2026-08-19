# Protocol Notes

## Plumb

```text
MCP client
  -> stdio MCP server (`plumb-mcp/dist/index.js`)
  -> local HTTP/WebSocket bridge on first free `127.0.0.1:31337..31346`
  -> Plumb Figma plugin UI WebSocket
  -> plugin main via postMessage
  -> Figma Plugin API
```

Observed WebSocket server messages:

- Server to plugin: `{ t: "plumb-hello", serverVersion, sessionLabel }`
- Plugin to server: `{ t: "pair", pluginVersion }`
- Server to plugin: `{ t: "paired" }` or `{ t: "pair-rejected", reason }`
- Server requests include reqId-bearing frames such as `get-node`, `get-assets`, `get-screenshot`, `get-search`, `get-components`, `apply-design`, `apply-foundations`.
- Plugin replies include `selection`, `inventory`, `node`, `assets`, `screenshot`, `search`, `components`, `apply-progress`, `applied`, `foundations`, `motion`, `pong`.

Binary channel:

- HTTP `GET /asset/:ref.:ext` for inbound staged build assets.
- HTTP `POST /upload/...` for screenshot/asset bytes from plugin to bridge.

Lifecycle:

- Server accepts one paired plugin socket; additional Plumb plugin pairing is rejected by a paired server.
- Plugin UI scans and can connect to multiple Plumb server ports.
- On paired socket close, Plumb resets pairing-scoped state and rejects pending requests.

## Custom MCP

```text
MCP client
  -> stdio MCP server (`FIGMA-CUSTOM-MCP/dist/index.js`)
  -> WebSocket bridge `ws://127.0.0.1:39217`
  -> Custom plugin UI WebSocket
  -> plugin main via postMessage
  -> Figma Plugin API
```

Observed bridge messages:

- Plugin to bridge: `{ type: "hello", pluginVersion: "0.1.0" }`
- Bridge to plugin: `{ type: "request", reqId, cmd, args }`
- Plugin to bridge: `{ type: "reply", reqId, ok, payload, error }`
- Plugin to bridge: `{ type: "progress", reqId, phase, done, total, note }`

Observed plugin-main command names:

- `apply-plan`
- `get-node`
- `patch-node`
- `delete-node`
- `reorder-node`
- `get-screenshot`
- `boolean-op`
- `group-nodes`
- `ungroup-node`
- `create-component-set`
- `create-paint-style`
- `list-styles`
- `move-node`
- `set-mask`
- `component-property`
- `instance-override`
- `instance-swap`
- `create-instance`
- `variables`
- `styles`
- `text-range`

Lifecycle:

- Bridge stores one socket and plugin version.
- A new connection replaces the previous socket.
- Progress heartbeats reset the timeout.
- No document-level transaction/rollback exists for batch operations.

## Interop observations

- Plumb and Custom protocols are not identical.
- Both use reqId-bearing request/reply frames over local WebSocket through a Figma plugin UI.
- Plumb additionally requires an HTTP binary channel and has protocol-specific asset hydration.
- A shared executor is possible in principle only if it implements enough of both protocol surfaces or if one protocol is adapted above the bridge layer.
- A simple MCP proxy does not remove the need for an active paired Figma runtime.
