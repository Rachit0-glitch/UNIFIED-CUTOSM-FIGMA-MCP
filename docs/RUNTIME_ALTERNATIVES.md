# Runtime Alternatives

## Alternative A - Single Unified Figma Plugin

```text
Unified MCP -> Unified Plugin -> Figma
```

One plugin remains running inside Figma and receives all execution commands. Backend-specific capabilities are implemented or adapted behind that one runtime.

Pros:

- Solves the one-plugin-at-a-time constraint.
- Gives Unified one authoritative execution owner.
- Enables real zero-manual-switch workflows.

Cons:

- Requires a new plugin and careful protocol design.
- Risks duplicating Plumb behavior if implemented too aggressively.
- Needs approval because it changes the runtime architecture beyond Stage 3.

Migration impact:

- Keep Plumb/Custom as external references initially.
- Implement only a narrow executor protocol first.
- Add capability coverage incrementally after proof.

## Alternative B - Shared Execution Bridge

```text
Plumb Adapter ----+
                  v
            Shared Executor -> One Plugin -> Figma
                  ^
Custom Adapter ---+
```

Adapters translate high-level Plumb/Custom diagnostic/write intents into one shared executor protocol.

Pros:

- Preserves separation of backend concerns at the MCP layer.
- Avoids launching multiple Figma plugins.
- Can be tested incrementally.

Cons:

- Requires protocol mapping.
- Some Plumb features rely on Plumb's current plugin request vocabulary and asset HTTP channel.
- Still likely requires a new or modified plugin executor.

Migration impact:

- Start with safe read/status and a tiny write proof.
- Defer full Plumb feature parity.

## Alternative C - Protocol Compatibility Layer

```text
Plumb MCP -> Plumb Protocol Adapter -> Unified Executor
Custom MCP --------------------------> Unified Executor
```

The Unified executor understands enough of Plumb's plugin-side protocol and Custom's command protocol to host both over one Figma plugin runtime.

Pros:

- Avoids reimplementing Plumb MCP's host-side logic.
- Keeps Plumb as an upstream process.
- Potentially allows existing Plumb tools to keep working through an adapter.

Cons:

- Plumb protocol compatibility is non-trivial, including WebSocket request routing and HTTP asset upload/download flows.
- Tight coupling to Plumb internals may be brittle unless Plumb exposes a stable adapter interface.

Migration impact:

- Requires a formal protocol map and compatibility test suite.
- Should begin with `plumb_status`, `plumb_outline`, and one asset-free request.

## Alternative D - Explicit Manual Switch Coordinator

```text
Unified MCP -> detects required backend -> returns precise switch instruction -> verifies after user switch
```

This is not zero-manual-switch, but it is reliable and fits current platform constraints.

Pros:

- Safe with current architecture.
- No backend or plugin source changes.
- Better user experience than opaque failures.

Cons:

- Does not satisfy Stage 3's zero-manual-switch target.
- Still depends on human action.

Migration impact:

- Could be Stage 3.5 if zero-manual-switch architecture needs more design approval.

## Recommendation

Pursue Alternative A or B next, but only after architecture review. The smallest safe next step is a new proof-of-concept Unified Figma plugin that does one status/read command and one Custom-like diagnostic through a single always-running plugin runtime. Do not reimplement all of Plumb casually.
