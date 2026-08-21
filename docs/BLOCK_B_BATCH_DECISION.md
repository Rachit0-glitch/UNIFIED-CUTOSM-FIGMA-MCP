# Block B §2B — The `figma_batch` Decision

**Decision: DO NOT implement a `figma_batch` capability.** CommandQueue (`src/runtime/commandQueue.js`)
plus the execution planner (`src/planning/executionPlanner.js`) already provide everything a batch
primitive would offer, and real evidence shows no actual performance problem to solve.

## The brief's own bar for building one

> "Only implement a batch primitive if real evidence shows a real problem (excessive round trips,
> partial mutation, latency, rollback difficulty, ordering ambiguity)."

Each of these five was checked against the real system, not assumed:

### 1. Latency — checked against a real Figma document, no problem found

Live test: [`scripts/block-b-batch-evidence-live.mjs`](../scripts/block-b-batch-evidence-live.mjs), run
2026-08-21 against a real, paired plugin and a real `"Block A Scratch"` page.

| Workload | Total | Per-op |
|---|---|---|
| 20 real `custom.patch_node` mutations, sequential (today's only mechanism) | 101ms | 5.05ms avg |
| the same 20 mutations, submitted concurrently (`Promise.all`, no batch primitive needed) | 62ms | ~3.1ms avg |
| 20-node bulk creation via `custom.design` (the existing efficient bulk-creation primitive) | 232ms | 11.6ms/node |

100ms for 20 real, individually-targeted mutations against a live document is not a latency problem by
any reasonable production bar — well inside Block A's own established single-op budget (<100ms per P3
op). There is no "excessive round trips" finding here to act on.

### 2. Concurrent submission already closes most of the gap, with zero new code

Firing the same 20 mutations concurrently (just not `await`-ing each one before sending the next) already
completed in 61% of the sequential time. This is available to any caller **today**, with no batch
primitive — `unified_execute` calls are independent and CommandQueue safely serializes whatever arrives
concurrently server-side. A batch primitive's main latency argument (fewer round trips) is only a
meaningful win if per-round-trip overhead is large; it measured at ~2-5ms here, not a scale worth adding
a new primitive and a new failure-mode surface for.

### 3. CommandQueue is a strict single-active-lane FIFO — batching cannot bypass it

`CommandQueue#drain()` only ever runs one job at a time (`if (this.active || this.items.length === 0)
return;`), whether the caller submits 20 separate `execute()` calls or one hypothetical batch of 20 ops.
**A batch primitive would not reduce the number of bridge→plugin→Figma round trips** — each individual
mutation still needs its own Figma API call inside the plugin sandbox — it would only reduce the number
of local MCP-tool-call round trips, which the measurement above shows are cheap. There is no queue-level
bottleneck a batch wrapper would relieve.

### 4. Partial mutation — already fully handled, and handled better than a flat batch array could

Every `unified_execute` call already returns its own `ok`/`error`/`operationRecord` independent of any
others. For anything beyond "N mutations of the same shape," the **execution planner** (§6/§8) is the
correct tool, not a batch primitive: it gives per-step results, `dependsOn`-based ordering, a `blocked`
status for steps whose dependency failed (never silently skipped), checkpoint tracking, and
resume-without-re-execution (`resumePlan`) — a strictly richer partial-failure story than a same-shape
batch array could express (a heterogeneous plan across `custom`/`plumb` capabilities, with real
dependencies, is not expressible as a flat batch of identical-shape ops in the first place).

### 5. Rollback / atomicity — a batch primitive doesn't solve this, and must never claim to

Figma mutations are not transactional regardless of whether they're sent individually or batched;
"rollback" always means reconciliation (§4: inspect real state, decide whether to fix forward), never a
true undo. Wrapping ops in a batch envelope and calling it "atomic" would be exactly the false claim §2B
explicitly warns against. Nothing about batching changes this reality — the reconciliation engine
(`src/runtime/reconciliation.js`) is the actual mechanism for handling a failure partway through a
multi-step build, whether that build was expressed as individual calls or a plan.

### 6. Ordering ambiguity — none exists

CommandQueue enforces strict FIFO submission order; the planner enforces explicit `dependsOn` ordering on
top of that. Neither individual calls nor planned execution have any ordering ambiguity today.

## What this means for callers

- **A handful of independent mutations of the same shape** (e.g. patch 20 nodes' opacity): fire them
  concurrently via existing `unified_execute` calls — no new primitive needed, ~40% faster than strict
  sequencing per the measurement above.
- **A large, uniform tree to create**: use `custom.design` — already the efficient bulk-creation
  primitive (901 nodes in one call, proven in Block A).
- **An ordered, dependency-aware, checkpointed multi-step build across heterogeneous capabilities**: use
  the execution planner (`buildPlan`/`preflightPlan`/`executePlan`/`resumePlan`) — this is precisely what
  §18-19's design-construction acceptance test exercises.

None of these three real use cases is better served by a `figma_batch` primitive than by what already
exists. This decision may be revisited if a concrete, evidenced requirement appears later (per §29, that
bar applies to re-opening this too) — none has appeared in Block A or Block B to date.
