# Stage 3.5 Investigation

## Architectural Conclusion Under Test

Stage 3 showed that zero-manual-switch handoff is blocked with two separate Figma plugins. Stage 3.5 investigates whether one Figma-side runtime can receive both Plumb-family and Custom-family command shapes.

## VERIFIED FACTS

### Plumb Protocol

- Plumb MCP runs as a Node stdio MCP server.
- Plumb opens a WebSocket/HTTP bridge on `127.0.0.1:31337..31346`.
- Plumb's plugin UI scans those ports.
- The server sends `plumb-hello`.
- The plugin sends `pair` and receives `paired`.
- Plumb plugin UI forwards request frames with `reqId` and string `t` to plugin main as `server-request`.
- Plumb request families include reads such as node/outline/search/components/assets/screenshot and writes such as `apply-design`.
- Plumb's binary asset/screenshot paths use the HTTP side of the bridge.
- Plumb can auto-pair after its plugin is already running via Figma `clientStorage`; this does not launch the plugin.

### Custom Protocol

- Custom MCP runs as a Node stdio MCP server.
- Custom opens a WebSocket bridge on `39217`.
- Custom plugin UI connects to `ws://localhost:39217` and sends `{ type: "hello", pluginVersion: "0.1.0" }`.
- Custom server sends `{ type: "request", reqId, cmd, args }`.
- Custom UI forwards to plugin main as `{ kind: "server-request", reqId, cmd, args }`.
- Plugin main replies via UI as `{ kind: "reply", reqId, ok, payload, error }`.
- UI sends the reply back over WebSocket as `{ type: "reply", reqId, ok, payload, error }`.

### Unified Runtime POC

- A third plugin can be created inside the Unified MCP project without modifying Plumb or Custom.
- A third bridge port, `39417`, avoids collision with Plumb and Custom.
- The proof-of-concept protocol can carry a Plumb-family `plumb-outline` read and a Custom-family `custom-node` read through the same plugin runtime.

## STRONG HYPOTHESES

- A single plugin can implement enough of both command families to eliminate plugin switching for a production Unified runtime.
- Full Plumb compatibility will require a protocol adapter, especially for Plumb's HTTP asset/screenshot channels and request-id routing.
- Full Custom compatibility is simpler because the Custom command protocol is already command/args/reply oriented.

## UNKNOWNS

- Whether full Plumb `apply-design`, asset export, screenshot upload, and future Plumb request types should be reimplemented, adapted, or proxied.
- Whether Plumb should become an upstream compiler/authoring backend while Unified owns only the Figma executor.
- Whether a stable Plumb plugin-side protocol contract can be maintained without depending on internal Plumb implementation details.
- How much of Custom's write surface should move to the Unified plugin versus remain in the existing Custom plugin for backwards compatibility.

## Feasibility Decision Before Live Test

The single-runtime architecture is feasible enough to prototype because the hard Stage 3 blocker was plugin launching, not the Figma Plugin API itself. One user-launched Unified plugin can stay running and receive multiple command families without switching.
