# Problem Statement

## User-facing goal

One Codex or Claude session should be able to use both Plumb capabilities and Custom Figma MCP capabilities in one continuous Figma workflow, without manual switching between competing Figma plugin runtimes.

## Verified symptoms

- Plumb MCP is reachable and currently paired to its Figma plugin on port `31338`.
- The `figma-bridge` MCP exposed in this session is reachable but reports no connected Figma files.
- `figma-custom` is registered in Codex config but its expected tool names are not exposed in this session.
- A prior attempt to use both available MCPs for a design build failed because the exposed `figma-bridge` returned `No plugin connected`, while Plumb remained usable.
- Plumb can build into Figma, but its high-level image handling may substitute placeholders when local image ingestion is not in the expected asset path.

## Verified architecture constraints

- Plumb and Custom use different ports and different Figma plugins.
- Plumb uses WebSocket plus HTTP on `31337..31346`.
- Custom uses WebSocket only on `39217`.
- Both systems rely on a Figma plugin UI runtime staying open for plugin-side execution.
- Both bridge layers track a single meaningful paired plugin socket per backend.

## Strong hypotheses

- The main integration failure is not simply that two MCP servers exist. MCP clients can register multiple servers.
- The fragile point is the Figma-side runtime/session layer: if the required plugin is not open and paired, backend tool availability at the MCP layer does not imply executable Figma capability.
- A pure MCP tool aggregator would be insufficient unless it also solves runtime ownership, pairing, or routing to one active executor.
- The currently exposed `mcp__figma_bridge` is a third bridge, not the Custom MCP described in the handoff, so testing it does not prove Custom MCP readiness.

## Unknowns / needs testing

- Whether Figma desktop can keep Plumb and Custom plugin UIs simultaneously alive and connected in the same file under normal workflow conditions.
- Whether Custom MCP failed to start in Codex, was hidden by tool discovery, or was not loaded because of naming/registration issues.
- Whether Plumb protocol can be proxied to a different plugin without modifying Plumb.
- Whether Custom plugin can execute Plumb-compatible request frames.
- Whether one unified plugin can safely expose both protocol surfaces.

## Non-goals for this phase

- Do not finish Custom MCP P2 work.
- Do not implement P3 autonomous design loops.
- Do not patch Plumb.
- Do not refactor Custom MCP.
- Do not report success merely because multiple MCP servers respond.
