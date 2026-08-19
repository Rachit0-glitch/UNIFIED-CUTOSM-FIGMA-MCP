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
  assert.equal(result.capabilities, 6);
});

test("capabilities only advertises the Stage 4 production slice", () => {
  const { service } = createFixture();
  const result = service.capabilities();
  assert.equal(result.ok, true);
  assert.deepEqual(result.capabilities.map((capability) => capability.id), [
    "plumb.status",
    "plumb.outline",
    "plumb.selection.read",
    "custom.status",
    "custom.node.read",
    "custom.selection.read"
  ]);
  assert.equal(result.capabilities.every((capability) => capability.mutation === false), true);
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
