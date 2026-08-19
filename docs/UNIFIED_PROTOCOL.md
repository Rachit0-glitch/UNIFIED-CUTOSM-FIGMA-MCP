# Unified Protocol

## Version

Current production protocol version:

```text
1.0
```

No version negotiation is implemented in Stage 4. Unsupported versions are rejected with `UNSUPPORTED_PROTOCOL_VERSION`.

## Command Envelope

Every command crossing Unified MCP -> Unified Bridge -> Unified Plugin uses:

```json
{
  "protocolVersion": "1.0",
  "requestId": "u4-uuid",
  "family": "plumb",
  "operation": "outline",
  "payload": {},
  "metadata": {
    "createdAt": "2026-08-19T00:00:00.000Z",
    "capability": "plumb.outline"
  }
}
```

Required fields:

- `protocolVersion`
- `requestId`
- `family`
- `operation`
- `payload`

Optional field:

- `metadata`

Supported families:

- `plumb`
- `custom`

## Response Envelope

Every plugin response returns:

```json
{
  "protocolVersion": "1.0",
  "requestId": "u4-uuid",
  "ok": true,
  "family": "plumb",
  "operation": "outline",
  "result": {},
  "error": null,
  "durationMs": 24
}
```

Failure responses return:

```json
{
  "protocolVersion": "1.0",
  "requestId": "u4-uuid",
  "ok": false,
  "family": "custom",
  "operation": "node.read",
  "result": null,
  "error": {
    "code": "FIGMA_API_ERROR",
    "message": "Node not found: 1:2"
  },
  "durationMs": 2
}
```

## Correlation

The bridge stores pending requests by `requestId`. A response with a mismatched or missing request ID is rejected as a protocol error.

## Transport Frames

Bridge to plugin UI:

```json
{
  "type": "command",
  "envelope": {}
}
```

Plugin UI to bridge:

```json
{
  "type": "response",
  "envelope": {}
}
```

Plugin hello:

```json
{
  "type": "hello",
  "pluginVersion": "0.2.0-stage4",
  "protocolVersion": "1.0"
}
```
