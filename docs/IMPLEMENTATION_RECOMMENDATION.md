# Implementation Recommendation

## Decision

Build a Unified MCP as a managed coordinator with two backend adapters:

- Plumb adapter for high-level design reads, screenshots, asset discovery, PDS extraction, and Plumb DSL writes.
- Custom adapter for deterministic Figma execution, strict DSL writes, direct node CRUD, read-back verification, local image import, variables/styles/components, and cleanup.

## Stage 2 Scope

Stage 2 should implement only the coordinator foundation:

- `unified_status`
- backend health normalization
- backend selection policy
- Plumb status/read adapter
- Custom status/read adapter through MCP SDK stdio
- explicit error when the required Figma plugin is not the active paired bridge
- no production design-building workflow yet

## Backend Selection Policy

Default routing:

| Need | Backend |
| --- | --- |
| Outline, selection, node extraction, screenshots, assets | Plumb |
| Strict authored design doc | Custom |
| Absolute positioning, overlapping layout, local image import | Custom |
| Direct patch/delete/reorder/read-back | Custom |
| High-level page composition from Plumb DSL | Plumb |
| Cleanup of known node id | Custom |

## Plugin Switching Rule

Because the current Figma workflow supports one active MCP plugin bridge at a time, Unified MCP should not silently retry on the other backend. It should return a clear state such as:

```json
{
  "ok": false,
  "needsBackend": "plumb",
  "message": "Switch Figma to the Plumb plugin bridge, then retry."
}
```

## Do Not Do In Stage 2

- Do not patch Plumb.
- Do not patch Custom MCP.
- Do not build a shared Figma plugin yet.
- Do not implement P2/P3 feature work.
- Do not infer concurrent plugin support from source code alone; treat user-confirmed one-active-bridge behavior as the runtime constraint.
