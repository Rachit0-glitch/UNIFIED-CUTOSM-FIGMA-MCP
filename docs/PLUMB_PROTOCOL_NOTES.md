# Plumb Protocol Notes

## WebSocket Pairing

Observed Plumb bridge/server behavior:

```text
server -> plugin: { t: "plumb-hello", serverVersion, sessionLabel }
plugin -> server: { t: "pair", pluginVersion }
server -> plugin: { t: "paired" }
```

The Plumb plugin can pair with multiple Plumb server sessions by port, while each server accepts one paired plugin socket.

## Request Routing

Plumb plugin UI forwards any request-like frame that has a `reqId` and string `t`:

```text
server WS frame -> UI -> plugin main: { type: "server-request", req }
plugin main -> UI: { type: "plugin-reply", reply }
UI -> server WS frame
```

The UI rewrites reqIds internally with a port prefix to avoid collisions across paired Plumb servers.

## Binary Channel

Plumb uses HTTP on the same selected port for binary data:

- `/asset/...` for inbound asset hydration during build.
- `/upload/...` for screenshot/asset bytes leaving the plugin.

This is the main complexity for production compatibility. The Stage 3.5 POC intentionally uses safe reads that do not require binary transport.

## POC Mapping

Stage 3.5 maps only a Plumb-family outline read:

```text
unified_runtime_plumb_read
  -> Unified bridge command: plumb-outline
  -> Unified plugin reads pages/top-level screen-like nodes
  -> returns { source, file, currentPage, pages, meta }
```

This proves the single runtime can carry Plumb-shaped read behavior, not that it is a drop-in Plumb plugin replacement.
