# Stage 4 POC Review

## Purpose

Stage 3.5 proved that one persistent Unified Figma plugin can serve both Plumb-family and Custom-family read operations. Stage 4 turns that proof into a production execution foundation without modifying original Plumb or original Custom.

## KEEP

- The single Unified plugin architecture.
- The `39417` Unified runtime bridge port, centralized in config.
- The bridge-owned WebSocket connection between Unified MCP and the Unified plugin.
- The real-Figma proof path: Unified MCP -> Unified bridge -> Unified plugin -> Figma Plugin API.
- The read-only Plumb-family outline operation as the first Plumb capability.
- The read-only Custom-family node operation as the first Custom capability.
- The Stage 3.5 docs as historical evidence.

## REFACTOR

- Replace string command names such as `plumb-outline` and `custom-node` with canonical command envelopes.
- Move command ownership into explicit capability metadata instead of inferring from strings.
- Split runtime responsibilities into a capability registry, command router, protocol adapters, bridge, queue, and plugin handlers.
- Convert the plugin's small switch into family-specific handler maps.
- Expand runtime status from a diagnostic bridge status into protocol, plugin, queue, and pending-request health.
- Add request IDs at the router boundary and preserve them through every bridge/plugin response.

## REPLACE

- Replace POC request frames:

```json
{ "type": "request", "reqId": "...", "cmd": "plumb-outline", "args": {} }
```

with production frames:

```json
{ "type": "command", "envelope": { "protocolVersion": "1.0", "requestId": "...", "family": "plumb", "operation": "outline", "payload": {} } }
```

- Replace POC response frames:

```json
{ "type": "reply", "reqId": "...", "ok": true, "payload": {} }
```

with production response envelopes that include protocol version, request ID, family, operation, success state, result/error, and duration.

## REMOVE LATER

- Stage 3.5 compatibility method names may remain as wrapper MCP tools for continuity, but they should call the Stage 4 router internally.
- The dependency on Custom's installed `ws` package should eventually become a Unified project dependency. It remains acceptable for Stage 4 because installing dependencies into original Custom is forbidden and the dependency already exists locally.

## Temporary Assumptions

- Stage 4 exposes a small read-only production capability slice, not all Plumb or Custom tools.
- Figma commands are serialized through one local queue.
- The Unified plugin is the only runtime plugin used during Unified acceptance testing.
- Original Plumb and original Custom regressions are still manual-plugin-run tests because those systems remain independent.

## Production-Reusable Components

- Unified bridge startup and plugin connection lifecycle.
- Unified plugin reconnect behavior.
- Safe read handlers that inspect current Figma state.
- MCP tool plumbing in `src/server.js`.

## Protocol Assumptions

- Protocol version `1.0` is the first production protocol.
- Unsupported versions must fail with a normalized error.
- Every bridge command must carry a request ID.
- Responses must be correlated by that same request ID.

## Error Assumptions

- Unknown capabilities fail in Unified MCP before reaching the plugin.
- Malformed payloads fail in protocol adapters before reaching the plugin when possible.
- Runtime disconnects fail pending operations safely.
- Plugin execution failures return response envelopes instead of crashing the bridge.

## Bridge Assumptions

- One bridge process owns one authoritative plugin socket.
- A newer plugin connection replaces the previous socket.
- Disconnect clears plugin status and rejects pending requests.
- Normal plugin reconnect should not require restarting Unified MCP.

## Plugin Assumptions

- One Unified plugin can dispatch both Plumb-family and Custom-family handlers.
- Handler support is intentionally limited to the Stage 4 capability registry.
- The plugin should not attempt to load or call original Plumb or Custom plugin code.
