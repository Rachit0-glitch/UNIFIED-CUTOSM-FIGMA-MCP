# Hardening Test Plan

Layers, same discipline as every prior stage: unit tests for pure logic, real end-to-end stdio for the
MCP tool-gating behavior itself, and real Figma for anything that touches the plugin/bridge.

## Test H-A — Normal MCP tool surface

**Method**: spawn the real server (`node src/index.js`) via `StdioMcpClient`, call `tools/list` with no
`UNIFIED_ENABLE_LEGACY_DIAGNOSTICS` set, then attempt `tools/call` on `unified_status` directly.
**Result**: REAL STDIO VERIFIED. `tools/list` returns exactly 6 tools (`unified_capabilities`,
`unified_execute`, `unified_runtime_status`, `unified_runtime_plumb_read`,
`unified_runtime_custom_read`, `unified_runtime_acceptance_sequence`) — none of the 4 legacy tools.
Calling `unified_status` directly returns `"Unknown tool: unified_status"` from the live server, not a
mocked assertion.

## Test H-B — Diagnostics opt-in

**Method**: same real spawn, with `UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` passed via the child
process's own `env`.
**Result**: REAL STDIO VERIFIED. `tools/list` returns all 10 tools, including the 4 legacy ones.
`scripts/unified-probe.mjs unified_status` (which auto-enables the flag when the named tool is one of
the 4 legacy tools) returned a real result including `activeBackend: "custom"` — meaning it genuinely
spawned the original Custom MCP process and it genuinely detected a paired plugin. Turning the
opt-in signal off (naming a production tool instead) reverts to Test H-A's behavior.

## Test H-C — Original dual-runtime problem cannot be triggered accidentally

**Method**: source-level trace of every tool in the default (no-flag) registration —
`unified_capabilities`, `unified_execute`, `unified_runtime_status`, and the 3 deprecated
`unified_runtime_*` tools all resolve to `coordinator.runtime.*` methods, which only ever touch
`UnifiedRuntimeBridge`/`CommandRouter`/`CommandQueue`/`CapabilityRegistry` (`src/runtime/service.js`).
None of them hold a reference to `BackendRegistry` or the original `PlumbAdapter`/`CustomAdapter` at
all — those only exist on `coordinator.registry` / `coordinator.status()` etc., reachable exclusively
through the 4 gated legacy tools.
**Result**: CODE-VERIFIED (structural — no code path exists, not merely untested) + confirmed by Test
H-A's live result (nothing in the default tool set could reach the legacy path even if it wanted to).

## Test H-D — Single Unified plugin, cross-family sequence

**Method**: `unified runtime status` → Unified plugin paired → plumb-family read → custom-family read →
plumb-family read, all through `unified_execute`, via the real paired Unified Figma plugin.
**Requirement**: manual plugin switching = 0, plugin restart = 0, runtime restart = 0, UI automation = 0.
**Result**: REAL FIGMA VERIFIED. `scripts/hardening-live.mjs`, run against the actual Unified Runtime
plugin (one persistent `StdioMcpClient` session kept alive for the whole sequence — see the root-cause
note below). Sequence executed: `unified_runtime_status` → `unified_capabilities` →
`plumb.outline` → `custom.node.read` → `plumb.outline` → `custom.node.read`, all `ok: true`, all through
the single paired Unified plugin. Manual plugin switching = 0 (only the one Unified plugin was ever
open), plugin restart = 0, runtime restart = 0, UI automation = 0 — the human only had to have the
plugin open once at the start. Also covered in the same run: `does.not.exist` correctly rejected with
`CAPABILITY_NOT_FOUND` and `custom.node.read` with `depth: 999` correctly rejected with `INVALID_PAYLOAD`
before ever reaching the bridge (`queue.length` stayed 0 in both cases) — real-Figma confirmation of
Test H-H's schema layer, not just the unit-test simulation.

**Root cause note (worth recording)**: earlier pairing attempts via `node scripts/unified-probe.mjs
unified_runtime_status` reported "not paired - retrying" in the plugin UI even with the plugin visibly
open. Root cause: `unified-probe.mjs` (and every other one-shot CLI probe) spawns a brand-new
`node src/index.js` child per invocation via `StdioMcpClient.connect()`, and its `finally` block calls
`client.close()` immediately after one tool call — killing the child and, with it, the
`UnifiedRuntimeBridge` WebSocketServer on port 39417 within well under a second. A Figma plugin retrying
its WebSocket connection never gets a stable target from a server that exists for a fraction of a
second. `scripts/hardening-live.mjs` and `scripts/hardening-live-hk.mjs` fix this by keeping ONE
persistent connection (and thus one persistent bridge) alive for the whole test session — the plugin
paired within seconds of the persistent server starting. This is a real operational finding, not a
defect in the production runtime itself (a real MCP client, e.g. Claude Desktop/Code, holds its stdio
connection open for the session's lifetime exactly like these scripts do — only the one-shot CLI probe
scripts have this transient-server characteristic).

## Test H-E — Queue limit

**Method**: `CommandQueue` constructed with `maxQueueLength: 1`; one long-running job occupies the
active slot, a second fills the queue, a third is rejected with `QUEUE_FULL`; releasing the first
proves the queue remains fully functional afterward.
**Result**: UNIT VERIFIED (`tests/hardening.test.js`, H7 tests).

## Test H-F — Queue wait timeout

**Method**: `CommandQueue` constructed with `queueWaitTimeoutMs: 30`; a second queued item (behind a
still-running first item) is proven to reject with `QUEUE_WAIT_TIMEOUT` without ever starting, and a
third command queued afterward still completes normally (no poisoning). A separate test proves a
command that starts immediately and simply runs long is never mistaken for one that waited too long.
**Result**: UNIT VERIFIED (`tests/hardening.test.js`, H7 tests).

## Test H-G — Error preservation

**Method**: construct a `UnifiedError` with a `source` in its details; confirm `errorShape()` promotes
`source` to a top-level field alongside `code` and the original `message`. Separately, trigger a real
router-level validation failure and confirm the surfaced error carries `source: "custom"` and a
field-specific message (not a generic one).
**Result**: UNIT VERIFIED (`tests/hardening.test.js`, H11 tests).

## Test H-H — Schema-driven validation

**Method**: for `custom.node.read` and `plumb.outline`: valid payload → reaches the bridge; unknown
field → `INVALID_PAYLOAD`, bridge never called; wrong nested type (`nodeId` as a number) →
`INVALID_PAYLOAD`, bridge never called; depth beyond `MAX_READ_DEPTH` → `INVALID_PAYLOAD`, bridge never
called; omitted optional field → capability's own schema default applied, visible in the outgoing
envelope.
**Result**: UNIT VERIFIED (`tests/hardening.test.js`, H9 tests) — zero Figma side effects in every
failure case, confirmed by asserting `bridge.calls.length === 0`.

## Test H-I — Own dependency

**Method**: `npm install` run from Unified's own directory; confirm `node_modules/ws` and
`node_modules/zod` exist there; confirm `loadConfig()`'s resolved `wsModulePath` points inside
Unified's own tree, not `FIGMA-CUSTOM-MCP`.
**Result**: REAL VERIFIED. `node_modules/ws/package.json` and `node_modules/zod/package.json` both
exist under Unified's own `node_modules`; `loadConfig(process.env).runtime.wsModulePath` resolves to
`...\FIGMA UNIFIED MCP\node_modules\ws\wrapper.mjs`.

## Test H-J — Deep read performance

**Method**: read the real Figma page through the paired Unified plugin at depth 1/5/10/20, record
bytes/round-trip time for each.
**Result**: REAL FIGMA VERIFIED, with an honest caveat. `scripts/hardening-live.mjs` measured
`custom.node.read` at depth 1/5/10/20 against the actual live document:

| depth | ok | elapsedMs | bytes |
|-------|----|-----------|-------|
| 1     | true | 10 | 1108 |
| 5     | true | 7  | 1136 |
| 10    | true | 6  | 1136 |
| 20    | true | 7  | 1136 |

All four succeeded with stable, low latency and near-identical payload size. **Caveat**: the live test
document currently contains exactly one empty frame (no nested children), so this does not exercise
payload growth under a genuinely deep/wide tree — it proves depth-bounded reads are stable and fast at
every depth up to the `MAX_READ_DEPTH` ceiling, not that a large real tree stays small. A true
large-tree stress measurement (many nested frames/components) is legitimate remaining work, reasonably
deferred to Block A when real content construction is in scope — recorded here rather than silently
dropped.

## Test H-K — Disconnect / reconnect

**Method**: with the Unified plugin paired and a successful read proven, close the plugin, confirm
pending requests reject safely and the Unified MCP process itself stays alive (does not crash), then
reopen the plugin and confirm a fresh read succeeds.
**Result**: REAL FIGMA VERIFIED. `scripts/hardening-live-hk.mjs`, one persistent session throughout.
Sequence: confirmed initial pairing → human closed the Unified Runtime plugin in Figma → bridge
transitioned `connected: true` → `false` within one 3s poll interval, Unified MCP process itself stayed
alive throughout (no crash, `unified_runtime_status` kept responding normally with `connected: false`)
→ human reopened the plugin → bridge transitioned back to `connected: true` (new `connectedAt`
timestamp, confirming a fresh WebSocket handshake, not a stale cached state) → `plumb.outline`
immediately after reconnect returned `ok: true` with the real page data. No pending-request scenario was
exercised (no in-flight command existed at the moment of disconnect in this run), so "pending requests
reject safely" specifically is CODE-VERIFIED (via `UnifiedRuntimeBridge`'s existing disconnect-handling
logic, unchanged by this pass) + covered by pre-existing unit tests, not independently re-demonstrated
live in this run.

## Test H-L — Original system regression

**Method**: confirm the original Plumb MCP and original Custom MCP still pair and read successfully,
completely independent of any Unified MCP hardening change (neither was modified).
**Result**: Custom side FULLY VERIFIED, Plumb side PROCESS-LEVEL VERIFIED. Test H-B's live run of the
(still-available, opt-in-gated) legacy diagnostic path against the real original Custom MCP process
returned `activeBackend: "custom"` with `usable: true` — full pairing-level confirmation that the
original Custom MCP + its already-paired plugin still work correctly through the unmodified
`CustomAdapter`/`StdioMcpClient` path.

For Plumb, `node scripts/unified-probe.mjs unified_probe_backend '{"backend":"plumb"}'` (real stdio,
not mocked) spawned the real original Plumb MCP server process and got back a valid structured status
(`mcpAvailable: true`, `bridgeAvailable: true`, `version: "0.13.2"`) — proving the original, completely
untouched Plumb MCP server and its bridge still start and respond correctly. `pluginPaired: false` in
that result reflects that no separate original Plumb plugin instance was open in Figma at the time (only
the Unified Runtime plugin was, on a different bridge port) — not a regression, and not something this
hardening pass could plausibly have caused, since zero original Plumb files were modified. Full
plugin-pairing-level confirmation for Plumb specifically (mirroring Custom's `usable: true` result) was
not re-collected in this pass, since it would require another manual plugin swap the hardening brief
explicitly asks this pass to minimize, for a check whose outcome is already structurally guaranteed by
"we never touched this code."
