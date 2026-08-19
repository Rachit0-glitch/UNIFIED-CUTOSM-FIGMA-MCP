# Backend Lifecycle

## Process, Bridge, Plugin, Ownership

Stage 3 keeps these states separate:

```text
backend process available
bridge listening
plugin UI running inside Figma
plugin paired to bridge
backend owns current Figma execution path
```

A backend process and bridge can be running while the Figma plugin is not paired. This was repeatedly observed in Stage 2 and Stage 3.

## Plumb Lifecycle

1. Plumb MCP starts as a Node stdio server.
2. It opens a WebSocket/HTTP bridge on the first available port in `31337..31346`.
3. The Plumb Figma plugin must already be running in Figma.
4. The plugin UI scans ports and receives `plumb-hello`.
5. The plugin sends `pair` when the user clicks pair or when Plumb's own `clientStorage` auto-pair flag is already set.
6. Only after that does `plumb_status` report `plugin.connected: true`.

Important distinction: `clientStorage` auto-pair helps a running Plumb plugin pair with a server. It does not launch the plugin.

## Custom Lifecycle

1. Custom MCP starts as a Node stdio server.
2. It opens a WebSocket bridge on `39217`.
3. The Custom Figma plugin must already be running in Figma.
4. The plugin UI connects to `ws://localhost:39217` and sends `{ type: "hello", pluginVersion: "0.1.0" }`.
5. Only after that does `figma_status` report `connected: true`.

If a separate Custom server already owns `39217`, a new Custom MCP child fails with `EADDRINUSE`. This is process availability failure, not Figma ownership success.

## Stage 3 Live Lifecycle Observation

Read-only port observation showed:

```text
39217 LISTENING pid 28252
39217 ESTABLISHED with Figma process pid 16812
```

The owner was:

```text
node C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP\dist\index.js
```

A separate Unified status run could not attach to that running Custom server and reported `BACKEND_UNAVAILABLE` due `EADDRINUSE`.

## Lifecycle Conclusion

Unified can own backend child processes, or a pre-existing backend process can own a bridge. Neither form of process ownership can launch a Figma plugin runtime. Execution ownership is created by the Figma plugin lifecycle, not by the backend process alone.
