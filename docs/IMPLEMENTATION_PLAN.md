# Implementation Plan

## U0 - Investigation baseline (current)

Status: started.

Deliverables:

- Separate project created at `C:\Users\rachi\Documents\figma-unified-mcp`.
- Existing systems inspected read-only.
- Current architecture, protocol notes, capability matrix, and options documented.

## U1 - Unified MCP skeleton

Build a minimal standards-compliant MCP server with:

- `unified_status`
- static config for backend registrations
- structured backend health model
- JSON logging with request id, backend, tool, duration, result/error

No Figma mutations in U1.

## U2 - Backend discovery

Implement read-only backend discovery:

- Detect Plumb process/tool availability.
- Detect Custom MCP process/tool availability.
- Detect whether `figma-custom` tools are exposed or whether a child MCP client must be used.
- Normalize states: `READY`, `MCP_UNAVAILABLE`, `BRIDGE_UNAVAILABLE`, `PLUGIN_NOT_PAIRED`, `UNKNOWN`.

## U3 - Explicit namespaced routing

Expose a tiny proof set only:

- `plumb.status` or proxy equivalent.
- one Plumb read operation, likely outline or selection.
- `custom.status` once Custom MCP invocation is available.
- one Custom read operation, likely node/page read.

Do not aggregate every tool yet.

## U4 - Safe mutation serialization

Add a single FIFO mutation lock for Figma-affecting writes.

Rules:

- Reads can be concurrent only when proven safe.
- Writes are serialized by default.
- No rollback is promised.
- Every mutation records backend and result.

## U5 - Runtime coexistence test

Critical test:

1. One client session talks only to Unified MCP.
2. Plumb plugin is paired.
3. Custom plugin is paired.
4. Execute one Plumb read/write and one Custom read/write without manually switching plugins.
5. Inspect resulting Figma state.

If this fails because only one plugin can remain active, stop and move to shared executor design.

## U6 - Shared executor design spike

Only if U5 fails:

- Design single plugin capable of accepting Custom commands and Plumb-compatible frames.
- Decide whether to adapt Plumb above the bridge or emulate the Plumb plugin protocol.
- Identify required changes to existing systems before implementing any.

## First proof-of-concept test

Smallest meaningful test:

```text
Unified MCP
  -> unified_status reports Plumb paired and Custom status accurately
  -> Plumb read: outline or selection succeeds
  -> Custom read: page/node read succeeds
  -> Custom write: create or patch a harmless test node succeeds
  -> Plumb read verifies the node is visible in the same Figma file
```

This test must run without the user manually closing one plugin and opening another between operations.

## Existing-system changes

Required now: none.

Potential later changes, not approved yet:

- Fix Codex exposure/startup for `figma-custom` if the registration is broken.
- Add read-only status endpoint/tool shape if Custom MCP status cannot be consumed by a child MCP client.
- Build a shared plugin/executor only if coexistence testing fails.
