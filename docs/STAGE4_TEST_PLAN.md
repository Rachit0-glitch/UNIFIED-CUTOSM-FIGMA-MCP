# Stage 4 Test Plan

## S4-A - Production Runtime Boot

Purpose: Verify Unified MCP/runtime starts before plugin pairing.
Preconditions: No required Figma plugin connection.
Capability: `unified_runtime_status`.
Payload: `{}`.
Expected route: MCP -> runtime bridge status.
Expected Figma result: before plugin, bridge ready and plugin disconnected; after launching Unified plugin, plugin connected.
Cleanup: keep plugin open for later tests.
Failure meaning: runtime cannot provide persistent execution foundation.
Regression check: no original Plumb or Custom source changes.

## S4-B - Plumb Family Read

Purpose: Verify production path Plumb read.
Preconditions: Unified plugin connected.
Capability: `plumb.outline`.
Payload: `{}`.
Expected route: `unified_execute` -> registry -> Plumb adapter -> queue -> bridge -> Unified plugin -> Figma.
Expected Figma result: pages and top-level screens from the open file.
Cleanup: none.
Failure meaning: Plumb-family execution not proven on production path.
Regression check: no original Plumb source changes.

## S4-C - Custom Family Read

Purpose: Verify production path Custom read.
Preconditions: Same Unified plugin remains connected.
Capability: `custom.node.read`.
Payload: `{ "depth": 1 }`.
Expected route: `unified_execute` -> registry -> Custom adapter -> queue -> bridge -> Unified plugin -> Figma.
Expected Figma result: current page or requested node data.
Cleanup: none.
Failure meaning: Custom-family execution not proven on production path.
Regression check: no original Custom source changes.

## S4-D - Cross-Family Sequence

Purpose: Verify one plugin can execute both families repeatedly.
Preconditions: Same Unified plugin remains connected.
Capability: `plumb.outline`, `custom.node.read`, `plumb.outline`, `custom.node.read`.
Payload: `{}` and `{ "depth": 1 }`.
Expected route: four sequential `unified_execute` calls through the same queue and bridge.
Expected Figma result: real Plumb-style outline and Custom-style page data in alternating order.
Cleanup: none.
Failure meaning: shared runtime not reliable across families.
Regression check: manual plugin switching 0, plugin restarts 0, UI automation 0.

## S4-E - Request Correlation

Purpose: Verify response IDs match request IDs.
Preconditions: Unified plugin connected.
Capability: sequential `plumb.status`, `custom.status`, `plumb.outline`.
Payload: `{}`.
Expected route: router generates unique request IDs and bridge validates matching response IDs.
Expected Figma result: all responses correlate to their originating request.
Cleanup: none.
Failure meaning: unsafe protocol foundation for future batching/retries.
Regression check: no side effects.

## S4-F - Invalid Capability

Purpose: Verify unknown capabilities fail safely.
Preconditions: Unified MCP running.
Capability: `does.not.exist`.
Payload: `{}`.
Expected route: registry rejects before bridge/plugin.
Expected Figma result: no Figma call.
Cleanup: none.
Failure meaning: router may leak unknown commands into plugin.
Regression check: no side effects.

## S4-G - Malformed Payload

Purpose: Verify payload validation fails safely.
Preconditions: Unified MCP running.
Capability: `custom.node.read`.
Payload: `{ "depth": 99 }`.
Expected route: Custom adapter rejects before bridge/plugin.
Expected Figma result: no Figma call.
Cleanup: none.
Failure meaning: adapter validation is insufficient.
Regression check: no side effects.

## S4-H - Plugin Disconnect / Reconnect

Purpose: Verify runtime survives plugin close/reopen.
Preconditions: Unified MCP running, Unified plugin connected.
Capability: `unified_runtime_status`, then `plumb.outline` after reconnect.
Payload: `{}`.
Expected route: status observes disconnect; reconnect restores ready state; read succeeds.
Expected Figma result: real outline after reconnect.
Cleanup: keep or close plugin as needed.
Failure meaning: lifecycle/recovery is not production-ready.
Regression check: no MCP restart required.

## S4-I - Optional Disposable Write

Purpose: Not included in Stage 4.
Preconditions: none.
Capability: none.
Payload: none.
Expected route: none.
Expected Figma result: no write and no cleanup required.
Cleanup: none.
Failure meaning: not applicable.
Regression check: no Figma mutation.

## S4-J - Original System Regression

Purpose: Verify original Plumb and Custom still work after Unified runtime changes.
Preconditions: User manually runs original Plumb plugin, then original Custom plugin.
Capability: original `plumb_status` / `plumb_outline`; original Custom `figma_status` / `figma_node` through existing probe.
Payload: read-only.
Expected route: original systems only.
Expected Figma result: both pair and read real Figma state.
Cleanup: none.
Failure meaning: Stage 4 regressed an existing system.
Regression check: required final gate.
