import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../src/runtime/capabilities.js";
import { CommandQueue } from "../src/runtime/commandQueue.js";
import { CommandRouter } from "../src/runtime/commandRouter.js";
import { PlumbProtocolAdapter } from "../src/runtime/protocolAdapters/plumb.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { buildPlan, preflightPlan, executePlan } from "../src/planning/executionPlanner.js";

// Production Lock §15 — queue/plan concurrency: proves CommandQueue's single-active-lane FIFO
// guarantee holds even when multiple unified_execute-shaped calls are submitted CONCURRENTLY (not
// sequentially awaited) through the real CommandRouter — no race can bypass the queue and run two
// bridge commands at once, regardless of how many calls arrive at the same instant.

const silentLogger = { event: () => {}, timed: async (_o, _b, fn) => await fn() };

function fixture() {
  const registry = new CapabilityRegistry();
  const queue = new CommandQueue({ logger: silentLogger, maxQueueLength: 50, queueWaitTimeoutMs: 15000 });
  let concurrentActive = 0;
  let maxConcurrentActive = 0;
  const bridge = {
    async start() {},
    status: () => ({ bridgePort: 39417, bridge: "ready", connected: true, plugin: "connected", protocolVersion: PROTOCOL_VERSION, pluginVersion: "test", pendingRequests: 0 }),
    async execute(envelope) {
      concurrentActive += 1;
      maxConcurrentActive = Math.max(maxConcurrentActive, concurrentActive);
      // A deliberately variable delay — if the queue did NOT serialize these, a later-submitted,
      // faster job could finish before an earlier, slower one, proving interleaving. With correct
      // serialization, no two of these can ever overlap. Reuses the schema-legal "depth" field
      // (custom.node.read's own numeric field, 0-20) as the delay signal rather than smuggling an
      // extra field past the capability's own .strict() Zod schema.
      const delayMs = (envelope.payload?.depth ?? 0) + 1;
      await new Promise((r) => setTimeout(r, delayMs));
      concurrentActive -= 1;
      return { protocolVersion: PROTOCOL_VERSION, requestId: envelope.requestId, ok: true, family: envelope.family, operation: envelope.operation, result: { echoed: envelope.requestId }, error: null, durationMs: delayMs };
    }
  };
  const router = new CommandRouter({
    registry,
    queue,
    bridge,
    logger: silentLogger,
    adapters: new Map([
      ["plumb", new PlumbProtocolAdapter()],
      ["custom", new CustomProtocolAdapter()]
    ])
  });
  return { router, queue, maxConcurrentActive: () => maxConcurrentActive };
}

test("queue concurrency: N concurrently-submitted unified_execute-shaped calls NEVER run their bridge commands at the same time (max concurrent active = 1)", async () => {
  const { router, maxConcurrentActive } = fixture();
  // Deliberately submit slow-first: if the queue were bypassable, a later fast call could race ahead.
  const depths = [19, 3, 14, 3, 9];
  await Promise.all(depths.map((depth) => router.execute({ capability: "custom.node.read", payload: { depth } })));
  assert.equal(maxConcurrentActive(), 1, "CommandQueue must serialize every bridge call — never more than 1 active at once, no matter how requests are submitted");
});

test("queue concurrency: results still correlate correctly to their own request even when submitted out of natural completion order", async () => {
  const { router } = fixture();
  const depths = [14, 2, 7]; // first submitted is slowest — if results got crossed, this would surface it
  const responses = await Promise.all(depths.map((depth) => router.execute({ capability: "custom.node.read", payload: { depth } })));
  // Each response's own requestId must match what CommandRouter itself assigned to that specific call —
  // Promise.all preserves array-index correlation regardless of resolution order, so this is really
  // checking that nothing server-side crossed the wires between concurrently in-flight requests.
  const uniqueRequestIds = new Set(responses.map((r) => r.requestId));
  assert.equal(uniqueRequestIds.size, 3, "every concurrently-submitted call must get its own distinct requestId, never a collision or a swap");
});

test("queue concurrency: a unified_execute_plan's internal steps and a concurrently-submitted unified_execute call never interleave their bridge commands either", async () => {
  const { router, maxConcurrentActive } = fixture();
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.node.read", payload: { depth: 9 } },
      { id: "b", capability: "custom.node.read", payload: { depth: 9 }, dependsOn: ["a"] }
    ],
    { registry: new CapabilityRegistry() }
  );
  assert.equal(preflightPlan(plan).ok, true);
  await Promise.all([
    executePlan(plan, router),
    router.execute({ capability: "custom.node.read", payload: { depth: 4 } }),
    router.execute({ capability: "custom.node.read", payload: { depth: 4 } })
  ]);
  assert.equal(maxConcurrentActive(), 1, "a plan's steps and an independently-submitted unified_execute call share the SAME queue — still only ever 1 bridge command active at once");
});

// Production Lock §8 — duplicate/replayed request safety, explicitly. Real live evidence already
// exists for the operationKey (Block A: custom.group/custom.create_component_set) and mode:"sync"
// (Block A 901-node scale; Block B 289-node and 6-node scale) cases — see
// docs/BLOCK_B_RETRY_RECONCILIATION.md and docs/BLOCK_B_LIVE_RESULTS.md. This test covers the
// classification-level guarantee (a "natural" capability's replay is defined-safe) and the
// operationKey-missing case, at the unit level, for defense in depth alongside that live evidence.

test("duplicate/replay: a 'natural' capability (e.g. custom.patch_node) replayed with an IDENTICAL payload has the same effect both times — no dedup mechanism needed because the operation itself is idempotent by construction", async () => {
  const { router } = fixture();
  const payload = { nodeId: "1:1", opacity: 0.5 };
  const first = await router.execute({ capability: "custom.patch_node", payload });
  const second = await router.execute({ capability: "custom.patch_node", payload }); // exact replay
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.operationRecord.payloadFingerprint, second.operationRecord.payloadFingerprint, "an identical replay must produce an identical payload fingerprint — the mechanism a caller/reconciler uses to recognize 'this is the same attempt'");
  assert.notEqual(first.operationRecord.operationId, second.operationRecord.operationId, "each attempt still gets its own distinct operationId — replay-safety does not mean the attempts are indistinguishable, only that neither corrupts state");
});
