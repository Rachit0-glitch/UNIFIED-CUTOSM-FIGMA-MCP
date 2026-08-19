# Command Routing

## Stage 4 Route

```text
unified_execute
       |
       v
CapabilityRegistry.lookup(capability)
       |
       v
CommandRouter
       |
       v
Family Protocol Adapter
       |
       v
CommandQueue
       |
       v
UnifiedRuntimeBridge.execute(envelope)
       |
       v
Unified Plugin family handler
```

## Explicit Routing Only

Stage 4 does not infer the best backend from natural language. The caller must pass a concrete capability ID such as:

```json
{
  "capability": "custom.node.read",
  "payload": {
    "depth": 1
  }
}
```

## Failure Points

- Missing or unknown capability: `CAPABILITY_NOT_FOUND`.
- Disabled capability: `CAPABILITY_DISABLED`.
- Invalid payload: `INVALID_PAYLOAD`.
- Unsupported protocol version: `UNSUPPORTED_PROTOCOL_VERSION`.
- Plugin disconnected: `PLUGIN_DISCONNECTED`.
- Command timeout: `COMMAND_TIMEOUT`.

## Queue Semantics

The queue runs one command at a time. A failed command releases the queue and does not block later commands.
