import test from "node:test";
import assert from "node:assert/strict";
import { UnifiedRuntimeService } from "../src/runtime/service.js";

const silentLogger = {
  timed: async (_operation, _backend, fn) => await fn()
};

function fakeBridge() {
  const calls = [];
  return {
    calls,
    async start() {},
    status() { return { bridgePort: 39417, connected: true, pluginVersion: "test" }; },
    async request(cmd) {
      calls.push(cmd);
      if (cmd === "plumb-outline") return { meta: { pageCount: 1, screenCount: 2 } };
      if (cmd === "custom-node") return { doc: { id: "1:2", name: "Page", type: "PAGE" } };
      throw new Error(`unexpected ${cmd}`);
    }
  };
}

test("runtime service reports bridge status", async () => {
  const bridge = fakeBridge();
  const service = new UnifiedRuntimeService({ bridge, logger: silentLogger });
  const result = await service.status();
  assert.equal(result.ok, true);
  assert.equal(result.runtime.connected, true);
});

test("runtime service routes Plumb-family read", async () => {
  const bridge = fakeBridge();
  const service = new UnifiedRuntimeService({ bridge, logger: silentLogger });
  const result = await service.plumbRead();
  assert.equal(result.family, "plumb");
  assert.deepEqual(bridge.calls, ["plumb-outline"]);
});

test("runtime service routes Custom-family read", async () => {
  const bridge = fakeBridge();
  const service = new UnifiedRuntimeService({ bridge, logger: silentLogger });
  const result = await service.customRead();
  assert.equal(result.family, "custom");
  assert.deepEqual(bridge.calls, ["custom-node"]);
});

test("runtime acceptance sequence uses one bridge in Plumb Custom Plumb order", async () => {
  const bridge = fakeBridge();
  const service = new UnifiedRuntimeService({ bridge, logger: silentLogger });
  const result = await service.acceptanceSequence();
  assert.equal(result.ok, true);
  assert.equal(result.manualPluginSwitching, 0);
  assert.deepEqual(result.sequence.map((step) => step.family), ["plumb", "custom", "plumb"]);
  assert.deepEqual(bridge.calls, ["plumb-outline", "custom-node", "plumb-outline"]);
});
