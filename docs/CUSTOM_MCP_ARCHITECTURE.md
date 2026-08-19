# Custom MCP Architecture

## Role

Custom MCP is the lower-level deterministic Figma execution backend. It complements Plumb with strict schema validation, local image support, absolute/overlapping layout, direct node CRUD, read-back, styles, variables, component operations, and batch-style orchestration.

## Runtime

Observed repo:

```text
C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP
```

Observed package: `figma-custom-mcp` version `0.1.0`.

Codex registration:

```text
node C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP\dist\index.js
```

Stage 1 live result with Custom plugin active:

- MCP reachable: yes.
- Bridge port: `39217`.
- Plugin paired: yes.
- Plugin version: `0.1.0`.
- Read path: passed with `figma_node`.
- Write path: passed with `figma_design`.
- Cleanup: passed with `figma_delete_node`.

## Data Flow

```text
MCP client
  -> figma-custom-mcp stdio server
  -> WebSocket bridge ws://127.0.0.1:39217
  -> Custom Figma plugin UI
  -> postMessage to plugin main
  -> Figma Plugin API command handler
  -> Figma document
```

## Pairing

The plugin UI connects automatically to `ws://localhost:39217` and sends:

```json
{ "type": "hello", "pluginVersion": "0.1.0" }
```

The bridge reports pairing via `figma_status`:

```json
{
  "bridgePort": 39217,
  "connected": true,
  "pluginVersion": "0.1.0",
  "note": "Plugin paired."
}
```

## Tool Surface Observed

The Stage 1 SDK probe listed 24 tools:

```text
figma_batch, figma_boolean, figma_component_property,
figma_create_component_set, figma_create_instance,
figma_create_paint_style, figma_delete_node, figma_design,
figma_diff, figma_group, figma_instance_override,
figma_instance_swap, figma_list_styles, figma_move_node,
figma_node, figma_patch_node, figma_reorder_node,
figma_screenshot, figma_set_mask, figma_styles,
figma_text_range, figma_ungroup, figma_variables
```

## Stage 1 Probe Behavior

The official Codex dynamic tool surface did not expose Custom's `figma_*` tools directly in this task, despite `figma-custom` being registered in `config.toml`. To avoid changing the existing Custom repo or Codex config, Stage 1 added a diagnostic MCP client in this repo:

```text
scripts/custom-mcp-sdk-probe.mjs
```

That script starts the Custom MCP server as a child process, speaks MCP over stdio using the official MCP SDK installed in the Custom repo, and optionally calls status/read/write/cleanup.

## Constraints For Unified MCP

- Do not open a raw WebSocket to the Custom bridge for diagnostics; the bridge treats any new WebSocket connection as the plugin socket and replaces the real plugin connection.
- Use MCP calls to Custom, not direct WebSocket probes.
- If an existing `39217` listener is already running, a second Custom server fails with `EADDRINUSE`; Stage 2 needs either a managed child-process lifecycle or an alternate transport strategy.
