# Stage 4 Architecture

## Resulting Shape

```text
Unified MCP Server
       |
       v
UnifiedRuntimeService
       |
       +-- CapabilityRegistry
       +-- CommandRouter
       +-- CommandQueue
       +-- RuntimeStatus
       |
       v
Protocol Adapters
       |
       +-- PlumbProtocolAdapter
       +-- CustomProtocolAdapter
       |
       v
UnifiedRuntimeBridge
       |
       v
Unified Runtime Plugin
       |
       v
Figma Plugin API
```

## Production Responsibilities

- `src/runtime/capabilities.js`: source of truth for Stage 4 supported capabilities.
- `src/runtime/commandRouter.js`: validates capability IDs, selects the family adapter, creates a request ID, and sends the canonical command envelope into the queue.
- `src/runtime/commandQueue.js`: serializes all Figma-bound commands one at a time.
- `src/runtime/protocol.js`: protocol version, request IDs, command envelope validation, and response envelope validation.
- `src/runtime/protocolAdapters/plumb.js`: validates and translates the Stage 4 Plumb-family slice.
- `src/runtime/protocolAdapters/custom.js`: validates and translates the Stage 4 Custom-family slice.
- `src/runtime/unifiedBridge.js`: owns the WebSocket server, authoritative plugin socket, pending request map, timeouts, correlation, disconnect handling, and runtime health.
- `figma-plugin/code.js`: validates command envelopes and dispatches to family-specific Figma read handlers.
- `figma-plugin/ui.html`: reconnecting WebSocket relay between the bridge and plugin main thread.

## Deliberate Limits

Stage 4 does not aggregate all Plumb and Custom tools. It establishes the production substrate with a small read-only capability slice. The original Plumb and Custom projects remain untouched.

## Runtime Port

The Unified runtime defaults to `39417` through `UNIFIED_RUNTIME_PORT`. The value is centralized in `src/config.js` and the Stage 4 plugin UI.

## Execution Model

Commands are serialized:

```text
unified_execute
  -> CapabilityRegistry
  -> CommandRouter
  -> ProtocolAdapter
  -> CommandQueue
  -> UnifiedRuntimeBridge
  -> Unified Plugin
  -> Figma
```

Unknown capabilities fail at the router and are not sent to Figma.

Malformed payloads fail in the protocol adapter when possible and are not sent to Figma.

Plugin execution failures return canonical response envelopes.
