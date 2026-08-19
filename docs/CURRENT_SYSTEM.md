# Current System

## Codex MCP registrations

Observed in `C:\Users\rachi\.codex\config.toml`:

| Server | Registration |
| --- | --- |
| `plumb` | `node C:\Users\rachi\AppData\Roaming\npm\node_modules\plumb-mcp\dist\index.js` |
| `figma-custom` | `node C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP\dist\index.js` |
| `figma-bridge` | `npx -y @gethopp/figma-mcp-bridge` |

Important distinction: the currently exposed callable Figma bridge tools in this Codex session are from `mcp__figma_bridge`, which aligns with the `figma-bridge` registration, not the Custom MCP repository's `figma_status` / `figma_design` tool names. Tool search returned no callable Custom MCP tools for `figma_status`, `figma_design`, `figma_patch_node`, or `figma_batch`.

## Plumb MCP

Observed source/install:

- Package: `plumb-mcp` version `0.13.2`.
- Entry point: `dist/index.js`.
- Figma plugin: `figma-plugin/manifest.json`, `figma-plugin/ui.html`, `figma-plugin/code.js`.
- Transport to MCP client: MCP over stdio via `StdioServerTransport`.
- Local Figma bridge: combined HTTP + WebSocket server bound to first free port in `31337..31346` on `127.0.0.1`.
- Live status: Plumb MCP reachable; plugin paired on port `31338`; plugin version `0.13.2`; file `Untitled`; 5 screens; selection `SONIC Headphones Hero - MCP Build`.
- REST path: not configured; `FIGMA_TOKEN` absent.

Observed data flow:

```text
Codex
  |
  | MCP stdio tool call
  v
Plumb MCP server
  |
  | WebSocket request frames: get-node, get-assets, get-screenshot, apply-design, etc.
  | HTTP channel: binary upload/download for screenshots and assets
  v
Plumb Figma plugin UI
  |
  | postMessage to plugin main
  v
Plumb plugin main code
  |
  | Figma Plugin API
  v
Figma document
```

Pairing notes:

- Plugin UI scans ports `31337..31346`.
- Server sends `plumb-hello`.
- Plugin sends `{ t: "pair", pluginVersion }`.
- Server accepts one paired Plumb plugin at a time and rejects another with `pair-rejected`.
- Plumb plugin UI supports pairing to multiple Plumb server sessions by port, but each Plumb server accepts only one paired Plumb plugin.

## Custom Figma MCP repository

Observed source:

`C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP`

Key files:

- `package.json` name `figma-custom-mcp`, version `0.1.0`.
- `src/index.ts`: creates `McpServer`, creates `Bridge`, registers tools, connects stdio transport.
- `src/bridge/server.ts`: WebSocket bridge server.
- `src/tools.ts`: Custom MCP tool definitions.
- `figma-plugin/manifest.json`: Custom plugin manifest.
- `figma-plugin/ui.html`: WebSocket client UI.
- `figma-plugin/code.js`: Figma API executor.

Observed Custom MCP data flow from source:

```text
Codex / MCP client
  |
  | MCP stdio tool call
  v
figma-custom-mcp dist/index.js
  |
  | Bridge.request(cmd, args)
  v
WebSocket bridge ws://127.0.0.1:39217
  |
  | JSON: { type: "request", reqId, cmd, args }
  v
Custom Figma plugin UI
  |
  | parent.postMessage({ pluginMessage: { kind: "server-request", reqId, cmd, args } })
  v
Custom Figma plugin main code
  |
  | dispatches command to Figma Plugin API handler
  v
Figma document
  |
  | figma.ui.postMessage({ kind: "reply", reqId, ok, payload/error })
  v
Plugin UI
  |
  | WebSocket JSON reply
  v
Custom bridge
  |
  | MCP text result
  v
Codex / MCP client
```

Transport and pairing:

- Default port: `39217`, override by `FIGMA_CUSTOM_MCP_PORT`.
- Timeout default: `FIGMA_CUSTOM_MCP_TIMEOUT_MS` or 20000 ms.
- Plugin manifest allows only `ws://localhost:39217`.
- Plugin UI connects automatically to `ws://localhost:39217` and sends `{ type: "hello", pluginVersion: "0.1.0" }`.
- Bridge tracks one socket; a new connection replaces the previous plugin socket.
- If no plugin is paired, bridge throws: `No Figma plugin is paired (bridge listening on ws://127.0.0.1:39217)...`.

Custom MCP command dispatcher in plugin main supports:

`apply-plan`, `get-node`, `patch-node`, `delete-node`, `reorder-node`, `get-screenshot`, `boolean-op`, `group-nodes`, `ungroup-node`, `create-component-set`, `create-paint-style`, `list-styles`, `move-node`, `set-mask`, `component-property`, `instance-override`, `instance-swap`, `create-instance`, `variables`, `styles`, `text-range`.

## Live runtime status

Observed through read-only tool calls in this session:

| Backend | MCP reachable | Bridge reachable | Plugin/runtime |
| --- | --- | --- | --- |
| Plumb | Yes | Yes, `31338` | Paired, sees file |
| `mcp__figma_bridge` | Yes | Responds | `list_files` returned `[]` |
| Custom MCP source | Present locally | Source bridge is `39217` | Not callable in current Codex tool surface |

## Unknowns

- Why `figma-custom` is registered but its tools are not exposed in this session.
- Whether the Custom MCP process failed startup, was shadowed by tool discovery, or is not selected by this Codex app/tool layer.
- Whether Plumb plugin and Custom plugin can be open and paired simultaneously in the same Figma document in this current environment. Source code intends non-conflicting ports, but live Custom MCP plugin pairing was not observed.
