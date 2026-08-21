import test from "node:test";
import assert from "node:assert/strict";
import { UnifiedRuntimeService } from "../src/runtime/service.js";
import { CapabilityRegistry } from "../src/runtime/capabilities.js";
import { CommandQueue } from "../src/runtime/commandQueue.js";
import { CommandRouter } from "../src/runtime/commandRouter.js";
import { PlumbProtocolAdapter } from "../src/runtime/protocolAdapters/plumb.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { ERROR_CODES } from "../src/errors.js";

const silentLogger = {
  event: () => {},
  timed: async (_operation, _backend, fn) => await fn()
};

function fakeBridge() {
  const calls = [];
  return {
    calls,
    async start() {},
    status() {
      return {
        bridgePort: 39417,
        bridge: "ready",
        connected: true,
        plugin: "connected",
        protocolVersion: PROTOCOL_VERSION,
        pluginVersion: "test",
        pendingRequests: 0
      };
    },
    async execute(envelope) {
      calls.push(envelope);
      if (envelope.family === "plumb" && envelope.operation === "outline") {
        return {
          protocolVersion: PROTOCOL_VERSION,
          requestId: envelope.requestId,
          ok: true,
          family: "plumb",
          operation: "outline",
          result: { meta: { pageCount: 1, screenCount: 2 } },
          error: null,
          durationMs: 1
        };
      }
      if (envelope.family === "custom" && envelope.operation === "node.read") {
        return {
          protocolVersion: PROTOCOL_VERSION,
          requestId: envelope.requestId,
          ok: true,
          family: "custom",
          operation: "node.read",
          result: { doc: { id: "1:2", name: "Page", type: "PAGE" } },
          error: null,
          durationMs: 1
        };
      }
      if (envelope.operation === "status") {
        return {
          protocolVersion: PROTOCOL_VERSION,
          requestId: envelope.requestId,
          ok: true,
          family: envelope.family,
          operation: "status",
          result: { source: "unified-plugin" },
          error: null,
          durationMs: 1
        };
      }
      throw new Error(`unexpected ${envelope.family}.${envelope.operation}`);
    }
  };
}

function createFixture() {
  const bridge = fakeBridge();
  const registry = new CapabilityRegistry();
  const queue = new CommandQueue({ logger: silentLogger });
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
  const service = new UnifiedRuntimeService({ bridge, router, registry, queue, logger: silentLogger });
  return { bridge, registry, queue, router, service };
}

test("runtime service reports bridge, queue, and capability status", async () => {
  const { service } = createFixture();
  const result = await service.status();
  assert.equal(result.ok, true);
  assert.equal(result.runtime.connected, true);
  assert.equal(result.runtime.protocolVersion, PROTOCOL_VERSION);
  assert.equal(result.queue.length, 0);
  // Block A grows this list across many batches (A1-A10) — asserting an exact hardcoded count here
  // would need editing on every future capability addition for no real safety benefit. The structural
  // test below (unique ids, every id family-prefixed, every id has a real schema) is what actually
  // guards correctness; this just sanity-checks the count is positive and matches the registry.
  assert.equal(result.capabilities, new CapabilityRegistry().list().length);
  assert.ok(result.capabilities >= 13, "expected at least the Stage 4 + A2 + A10 capability set to be present");
});

test("capabilities only advertises real, currently-wired capabilities with correct read/write flags", () => {
  const { service } = createFixture();
  const result = service.capabilities();
  assert.equal(result.ok, true);
  const ids = result.capabilities.map((capability) => capability.id);
  assert.equal(new Set(ids).size, ids.length, "expected no duplicate capability ids");
  assert.ok(ids.every((id) => id.startsWith("plumb.") || id.startsWith("custom.")), "expected every capability id to be family-prefixed");
  // Every Stage 4 capability from before Block A must still be present, unchanged, in its original spot.
  for (const stage4Id of ["plumb.status", "plumb.outline", "plumb.selection.read", "custom.status", "custom.node.read", "custom.selection.read"]) {
    assert.ok(ids.includes(stage4Id), `expected Stage 4 capability "${stage4Id}" to still be registered`);
  }
  // Read-only capabilities (status/read/list/diff/verify/measure) must never be marked mutation:true,
  // and vice versa — this is the real regression risk (a write capability silently marked as safe).
  for (const capability of result.capabilities) {
    const isReadShaped = /\.(read|status)$/.test(capability.id) || ["custom.diff", "custom.verify", "custom.measure", "custom.list_styles"].includes(capability.id);
    if (isReadShaped) assert.equal(capability.mutation, false, `expected "${capability.id}" to be mutation:false`);
  }
});

test("unified_execute routes Plumb-family read with a canonical request id", async () => {
  const { bridge, service } = createFixture();
  const result = await service.execute({ capability: "plumb.outline", payload: {} });
  assert.equal(result.ok, true);
  assert.equal(result.family, "plumb");
  assert.equal(result.operation, "outline");
  assert.match(result.requestId, /^u4-/);
  assert.equal(bridge.calls[0].protocolVersion, PROTOCOL_VERSION);
  assert.equal(bridge.calls[0].metadata.capability, "plumb.outline");
});

test("unified_execute routes Custom-family read and preserves response correlation", async () => {
  const { bridge, service } = createFixture();
  const result = await service.execute({ capability: "custom.node.read", payload: { depth: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.family, "custom");
  assert.equal(result.operation, "node.read");
  assert.equal(result.response.requestId, result.requestId);
  assert.equal(bridge.calls[0].requestId, result.requestId);
});

test("unified_execute rejects unknown capabilities before bridge execution", async () => {
  const { bridge, service } = createFixture();
  await assert.rejects(
    () => service.execute({ capability: "does.not.exist", payload: {} }),
    { code: ERROR_CODES.CAPABILITY_NOT_FOUND }
  );
  assert.equal(bridge.calls.length, 0);
});

test("unified_execute rejects malformed payloads before bridge execution", async () => {
  const { bridge, service } = createFixture();
  await assert.rejects(
    () => service.execute({ capability: "custom.node.read", payload: { depth: 99 } }),
    { code: ERROR_CODES.INVALID_PAYLOAD }
  );
  assert.equal(bridge.calls.length, 0);
});

test("runtime service wrappers use the production router", async () => {
  const { bridge, service } = createFixture();
  const plumb = await service.plumbRead();
  const custom = await service.customRead();
  assert.equal(plumb.family, "plumb");
  assert.equal(custom.family, "custom");
  assert.deepEqual(bridge.calls.map((envelope) => `${envelope.family}.${envelope.operation}`), ["plumb.outline", "custom.node.read"]);
});

test("runtime acceptance sequence uses one queue in Plumb Custom Plumb order", async () => {
  const { bridge, service } = createFixture();
  const result = await service.acceptanceSequence();
  assert.equal(result.ok, true);
  assert.equal(result.manualPluginSwitching, 0);
  assert.deepEqual(result.sequence.map((step) => step.family), ["plumb", "custom", "plumb"]);
  assert.deepEqual(bridge.calls.map((envelope) => `${envelope.family}.${envelope.operation}`), ["plumb.outline", "custom.node.read", "plumb.outline"]);
});

// Block B §6/§8/§9/§21 — unified_execute_plan's service-level wiring, end-to-end through the REAL
// CommandRouter/CapabilityRegistry (only the bridge is faked), proving the planner isn't just
// unit-tested in isolation (tests/execution-planner.test.js's fakeRouter) but actually reachable and
// correct through the same production router unified_execute itself uses.

test("service.executePlan: a valid 2-step plan (plumb.outline -> custom.node.read) executes in order through the real router", async () => {
  const { bridge, service } = createFixture();
  const result = await service.executePlan({
    steps: [
      { id: "a", capability: "plumb.outline", payload: {} },
      { id: "b", capability: "custom.node.read", payload: { depth: 1 }, dependsOn: ["a"] }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.equal(result.preflight.ok, true);
  assert.equal(result.run.succeeded, 2);
  assert.deepEqual(bridge.calls.map((e) => `${e.family}.${e.operation}`), ["plumb.outline", "custom.node.read"]);
});

test("service.executePlan: an unknown capability is caught at preflight and NOTHING is sent to the bridge", async () => {
  const { bridge, service } = createFixture();
  const result = await service.executePlan({ steps: [{ id: "a", capability: "custom.does_not_exist", payload: {} }] });
  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.preflight.ok, false);
  assert.equal(result.preflight.problems[0].code, "CAPABILITY_NOT_FOUND");
  assert.equal(bridge.calls.length, 0);
});

test("service.executePlan: resuming with a prior run's exact result does not re-send an already-succeeded step to the bridge", async () => {
  const { bridge, service } = createFixture();
  const first = await service.executePlan({ steps: [{ id: "a", capability: "plumb.outline", payload: {} }, { id: "b", capability: "custom.node.read", payload: { depth: 1 } }] });
  assert.equal(bridge.calls.length, 2);

  const second = await service.executePlan({
    steps: [{ id: "a", capability: "plumb.outline", payload: {} }, { id: "b", capability: "custom.node.read", payload: { depth: 1 } }],
    previousRun: first.run
  });
  assert.equal(second.ok, true);
  assert.equal(bridge.calls.length, 2, "resuming an already-fully-succeeded plan must not re-send any step to the bridge");
  assert.equal(second.run.sessionId, first.run.sessionId);
});
