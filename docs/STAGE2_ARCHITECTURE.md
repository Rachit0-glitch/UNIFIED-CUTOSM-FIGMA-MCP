# Stage 2 Architecture

## Scope

Stage 2 implements the minimum safe Unified MCP coordinator foundation. It does not merge, patch, or replace Plumb or Custom MCP.

## Runtime Diagram

```text
MCP client
  -> figma-unified-mcp
      -> BackendRegistry
          -> PlumbAdapter  -> Plumb MCP stdio child  -> Plumb plugin bridge  -> Figma
          -> CustomAdapter -> Custom MCP stdio child -> Custom plugin bridge -> Figma
```

The Unified MCP server is a separate MCP stdio process. Backend adapters manage one child MCP client per Unified server lifetime and refresh status on each call.

## Tools

Stage 2 exposes only:

- `unified_status`
- `unified_backends`
- `unified_active_backend`
- `unified_probe_backend`

No Plumb tool aggregation, Custom tool aggregation, automatic switching, design generation, or mutation routing was added.

## Process Lifecycle

- Plumb and Custom are treated as external dependencies.
- Adapters spawn backend MCP child processes lazily when needed.
- A child is reused across status/probe calls for the same Unified MCP process.
- Child processes are closed on Unified MCP process exit.
- The coordinator does not start/stop Figma plugins.
- The coordinator does not modify ports, manifests, bridge protocols, or backend source.

## Dynamic Status

`unified_status` polls both adapters each time. Pairing state is not permanently cached, so manual plugin switches can be detected during the same Unified MCP process lifetime.
