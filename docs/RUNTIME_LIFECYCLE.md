# Runtime Lifecycle

## Boot

Before the Unified plugin connects:

```json
{
  "bridge": "ready",
  "plugin": "disconnected",
  "connected": false
}
```

The MCP process remains alive and ready for the plugin to connect.

## Pairing

When the Unified plugin UI connects over WebSocket, it sends:

```json
{
  "type": "hello",
  "pluginVersion": "0.2.0-stage4",
  "protocolVersion": "1.0"
}
```

The bridge records plugin version, protocol version, and connection time.

## Execution

Commands flow through the queue and bridge. Pending requests are tracked by request ID and cleared on response, timeout, bridge close, or plugin disconnect.

## Disconnect

If the plugin closes:

- bridge status changes to disconnected,
- plugin version is cleared,
- pending requests fail with `PLUGIN_DISCONNECTED`,
- MCP remains alive.

## Reconnect

Reopening the Unified plugin connects to the same running bridge. No Unified MCP restart is required when the bridge process is still active.

## Shutdown

When the MCP process exits, the bridge closes and pending requests fail with `RUNTIME_UNAVAILABLE`.
