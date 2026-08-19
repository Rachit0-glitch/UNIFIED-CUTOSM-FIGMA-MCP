# Unified Runtime Architecture

## Stage 3.5 POC Architecture

```text
MCP client
  -> figma-unified-mcp
      -> unified_runtime_status
      -> unified_runtime_plumb_read
      -> unified_runtime_custom_read
      -> unified_runtime_acceptance_sequence
          -> UnifiedRuntimeBridge ws://127.0.0.1:39417
              -> Unified Runtime POC Figma plugin
                  -> Figma Plugin API
                  -> Figma document
```

## Files

- `src/runtime/unifiedBridge.js`: local WebSocket bridge and request/reply tracking.
- `src/runtime/service.js`: Plumb-family, Custom-family, and acceptance-sequence operations.
- `figma-plugin/manifest.json`: Unified plugin manifest.
- `figma-plugin/ui.html`: WebSocket client and relay.
- `figma-plugin/code.js`: Figma sandbox dispatcher.

## Why This Solves The Stage 3 Blocker

Stage 3 was blocked because Unified MCP could not launch inactive plugins. Stage 3.5 uses one plugin runtime that the user launches once. After that, no backend plugin switching is required for the proof-of-concept reads.

## What It Does Not Claim

- It does not implement all Plumb tools.
- It does not implement all Custom tools.
- It does not modify or replace existing Plumb/Custom projects.
- It does not prove full binary asset/screenshot compatibility.
- It does not implement semantic capability routing.

## Smallest Production Stage 4 Architecture If POC Passes

1. Keep one Unified Figma plugin running.
2. Keep the Unified bridge as the single executor channel.
3. Add a protocol adapter layer that maps selected Plumb-family and Custom-family operations into Unified runtime commands.
4. Expand command coverage incrementally with regression tests against original Plumb and Custom.
5. Do not expose broad tool aggregation until the executor protocol is stable.
