# Architecture Options

## Option A: MCP proxy with explicit namespacing

```text
LLM -> Unified MCP -> Plumb MCP
                  -> Custom MCP
```

Pros:

- Smallest first implementation.
- Preserves existing projects unchanged.
- Clear observability and routing.
- Useful for health/status and schema inventory.

Cons:

- Does not itself solve two-plugin runtime conflict.
- Requires both backend MCPs to be callable and their plugin runtimes paired.
- Can make the system appear unified while Figma execution remains fragmented.

Fit: good U1 prototype, insufficient final architecture.

## Option B: Unified MCP plus runtime coordinator

```text
LLM -> Unified MCP -> backend MCP adapters
                  -> runtime/session coordinator
                  -> existing Plumb and Custom plugin paths, serialized
```

Pros:

- Keeps existing systems mostly unchanged.
- Adds health, locks, request IDs, and mutation serialization.
- Can prove whether dual plugin runtimes are actually viable before deeper changes.

Cons:

- Still depends on two Figma plugins if operations route through both backends.
- Cannot fix plugin lifecycle exclusivity if Figma cannot keep both active.
- Requires robust detection of paired/not paired state from both backends.

Fit: best next architecture for investigation and first real POC.

## Option C: Single unified Figma plugin/executor implementing both protocols

```text
LLM -> Unified MCP / adapters -> shared bridge -> one plugin -> Figma
```

Pros:

- Directly targets one authoritative Figma executor.
- Removes manual switching if implemented correctly.
- Gives one place for serialization, state, and recovery.

Cons:

- Highest compatibility risk.
- Plumb protocol support may require duplicating or adapting Plumb's bridge/plugin behavior.
- May require modifying Custom MCP or replacing plugin paths.
- Must handle Plumb HTTP asset channel and request vocabulary.

Fit: likely long-term architecture if dual-plugin runtime proves unreliable, but not the first coding step.

## Option D: Shared bridge, separate MCPs, single plugin adapter

```text
Plumb MCP -> adapter bridge --+
Custom MCP -> adapter bridge -+-> single plugin -> Figma
```

Pros:

- Can preserve backend MCP entry points for clients.
- Single Figma plugin runtime.
- Potentially less client-facing churn.

Cons:

- Still protocol-heavy.
- Plumb server expects its own bridge semantics.
- More moving parts than Option C if Unified MCP also exists.

Fit: alternative if MCP-level proxying is less important than runtime consolidation.

## Recommendation

Use Option B as the immediate investigative POC path, with Option C as the target if testing proves two plugin runtimes cannot coexist reliably.

Reason:

- Option A is useful but risks faking success.
- Option B can answer the critical unknowns without modifying Plumb or Custom.
- Option C should wait until we have hard evidence that one executor is required and enough protocol notes to implement it safely.
