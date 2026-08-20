# Block A Limitations

Real, known limitations only — nothing artificially inflated, nothing swept under the rug.

## Transient response-delivery timeouts

Observed at least 5 times across this session's live testing, on different operations each time
(`custom.design`, `custom.node.read`, `custom.delete_node`, `custom.variables`): a call reports
`COMMAND_TIMEOUT` (8000ms, zero response ever arrives) even though the underlying Figma-side operation
either already succeeded or succeeds cleanly on immediate retry. Confirmed NOT a data-correctness issue
every time it was investigated — the operation's real effect (a deleted node staying deleted, a design
compiling and building correctly) was independently verified via a follow-up read. One instance (a
`custom.variables` `set_value` call) was confirmed as a genuinely failed attempt, not merely a lost
response to a real success — the value had NOT been written when checked immediately after the timeout,
and only landed on retry.

**Root cause not identified** — this environment has no access to Figma's own devtools/console, so the
exact failure point (a dropped WebSocket frame, a UI-thread stall under rapid successive round trips, a
timing edge case in Figma's own `postMessage` relay) could not be isolated. It appears correlated with
long bursts of rapid sequential calls (never observed on an isolated, first call after pairing) but this
is an observation, not a proven cause.

**Practical impact**: low. Every occurrence resolved on a single retry, with no observed data corruption
or partial-state issue. A real MCP client (an LLM session, not a test script) would see a normal
`COMMAND_TIMEOUT` error and could reasonably retry or re-verify state — exactly the kind of scenario
`custom.verify`/`custom.diff` exist to make cheap and safe.

**Recommendation for future hardening** (not attempted in this pass — would require either sustained
Figma-side diagnostic access or a purpose-built stress-test harness beyond this pass's scope): consider
whether `timeoutMs` defaults are too tight for a subset of operations, and whether the bridge/queue layer
would benefit from an opt-in single-retry-on-timeout policy for idempotent read operations specifically
(never for mutations, where a blind retry could double-apply a change).

## `figma_batch` not yet ported

Custom MCP's own multi-operation batch/orchestration tool was intentionally not ported this pass.
Unified's `CommandQueue` already sequences every call through one plugin connection, so the question of
whether a Unified-level equivalent adds real value (vs. an LLM simply issuing multiple `unified_execute`
calls in sequence) is open, not decided — flagged in `docs/BLOCK_A_CAPABILITY_MATRIX.md`.

## Large-tree performance not re-measured under real load

The mini-design test built a genuinely non-trivial tree (a 2-column hero section with nested auto-
layout, multiple text nodes, a styled button, and a real image), but it's still small (roughly a dozen
nodes) relative to the 500-1000-node stress scenario the pre-Block-A hardening pass's own performance
doc flagged as unmeasured. `docs/BLOCK_A_PERFORMANCE.md` remains honest about this — a genuine large-tree
measurement is deferred, not because it's unimportant, but because building 500+ throwaway nodes purely
to produce a number would not itself demonstrate anything about real design-construction quality.

## Deferred Plumb-family capabilities

`plumb.node.read`, `plumb.tokens`, `plumb.components`, and several other Plumb tools remain unintegrated
— see `docs/BLOCK_A_CAPABILITY_MATRIX.md` for the complete per-capability status and reasoning. Every
Plumb capability actually needed for this pass's acceptance tests (`plumb.outline`, `plumb.selection.
read`, `plumb.status`) was already live since Stage 4 and is confirmed working correctly alongside every
new Custom-family capability in the mini-design test's cross-family step.

## Read fidelity for text/component categories under real content

A1's live verification exercised `geometry`/`layout`/`appearance`/`metadata` categories against a real
FRAME node, but not `text`/`component`/`variables` categories against a real TEXT/COMPONENT/INSTANCE
node at the time (no such node existed yet). This gap has since been closed indirectly — the mini-design
test read back a real TEXT node's `fontFamily`/`fontSize`/`lineHeight`/`characters` successfully — but a
COMPONENT/INSTANCE-specific full-fidelity read (`variantProperties`, `componentPropertyDefinitions`,
`mainComponentId` via the async `getMainComponentAsync()` path) was exercised only implicitly (through
`custom.create_instance`'s own result, not through a dedicated `custom.node.read` call with
`include:["component"]`) — a narrow remaining gap, not a broad one.
