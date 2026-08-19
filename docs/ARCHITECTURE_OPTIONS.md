# Architecture Options

## Option A: Thin Router MCP

A Unified MCP server exposes one tool surface and routes each call to either Plumb or Custom based on capability.

Pros:

- Smallest Stage 2 implementation.
- Preserves Plumb and Custom as independent projects.
- Easy to reason about and test.

Cons:

- Must handle active-plugin switching because the user's Figma workflow currently supports one connected MCP bridge at a time.
- Needs backend lifecycle/error normalization.

## Option B: Managed Backend Coordinator

A Unified MCP server owns child processes for Plumb and Custom, performs health checks, and routes calls through adapters.

Pros:

- Most deterministic from an agent perspective.
- Can normalize MCP, bridge, plugin, and tool errors.
- Can prevent duplicate Custom `39217` listener conflicts.

Cons:

- More process management complexity.
- Still cannot force both Figma plugins to be paired if the Figma UI only allows one active bridge.

## Option C: Shared Figma Plugin

Create a new single Figma plugin that implements both Plumb-like and Custom-like bridge commands.

Pros:

- Solves one-active-plugin limitation at the Figma layer.
- Cleanest long-term runtime model.

Cons:

- Not Stage 2-sized.
- Risks reimplementing or vendoring Plumb behavior.
- Violates the current instruction to avoid modifying/replacing Plumb and Custom during Stage 1.

## Option D: Documentation-Only Manual Switch

Do not coordinate backend processes; document when the user must switch plugins.

Pros:

- Lowest implementation risk.
- Matches current live workflow.

Cons:

- Poor agent ergonomics.
- No unified tool contract.
- Easy to accidentally call the wrong backend.

## Recommendation

Start Stage 2 with Option B in a deliberately narrow form: a managed backend coordinator with explicit backend status, read-only health tools, and a small capability router. Do not attempt Option C until the router proves the required behavior and the plugin switching limitation remains the dominant bottleneck.
