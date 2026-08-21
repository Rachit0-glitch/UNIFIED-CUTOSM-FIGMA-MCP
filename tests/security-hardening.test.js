import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../src/runtime/capabilities.js";
import { CommandQueue } from "../src/runtime/commandQueue.js";
import { CommandRouter } from "../src/runtime/commandRouter.js";
import { PlumbProtocolAdapter } from "../src/runtime/protocolAdapters/plumb.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { ERROR_CODES } from "../src/errors.js";
import { checkPayloadShape, MAX_PAYLOAD_DEPTH } from "../src/runtime/limits.js";

// Block B §25/§26 — a real bug found this session: capability schemas built with z.lazy() (notably
// custom.design's recursive DesignNodeSchema) have no built-in depth limit, so a pathologically deep
// payload made Zod's OWN safeParse() throw a raw, uncaught RangeError instead of returning
// {success:false} — see limits.js's checkPayloadShape for the full story. These tests prove the fix.

const silentLogger = { event: () => {}, timed: async (_o, _b, fn) => await fn() };

function fixture() {
  const registry = new CapabilityRegistry();
  const queue = new CommandQueue({ logger: silentLogger });
  const bridge = {
    async start() {},
    status: () => ({ bridgePort: 39417, bridge: "ready", connected: true, plugin: "connected", protocolVersion: PROTOCOL_VERSION, pluginVersion: "test", pendingRequests: 0 }),
    async execute(envelope) {
      return { protocolVersion: PROTOCOL_VERSION, requestId: envelope.requestId, ok: true, family: envelope.family, operation: envelope.operation, result: {}, error: null, durationMs: 1 };
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
  return { router };
}

function buildDeepNode(depth) {
  let node = { id: "leaf", type: "rect", width: 1, height: 1 };
  for (let i = 0; i < depth; i++) {
    node = { id: `n${i}`, type: "frame", width: 1, height: 1, children: [node] };
  }
  return node;
}

test("checkPayloadShape: a shallow, realistic payload passes", () => {
  const result = checkPayloadShape({ doc: { version: "1", page: "X", root: buildDeepNode(3) } });
  assert.equal(result.ok, true);
});

test("checkPayloadShape: a non-object payload (null/string/number) always passes — nothing to walk", () => {
  assert.equal(checkPayloadShape(null).ok, true);
  assert.equal(checkPayloadShape("x").ok, true);
  assert.equal(checkPayloadShape(42).ok, true);
});

test("checkPayloadShape: a payload nested well past MAX_PAYLOAD_DEPTH is rejected with a clear reason", () => {
  const result = checkPayloadShape({ root: buildDeepNode(MAX_PAYLOAD_DEPTH + 50) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exceeds the maximum allowed depth/);
});

test("checkPayloadShape: a very wide (not deep) payload that exceeds the node-count cap is also rejected", () => {
  const wide = { items: Array.from({ length: 250000 }, (_, i) => ({ id: i })) };
  const result = checkPayloadShape(wide, { maxNodes: 200000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /more than 200000 nested values/);
});

test("checkPayloadShape: exits early (does not walk the whole structure) once depth is exceeded, so it stays cheap on pathological input", () => {
  const start = Date.now();
  const result = checkPayloadShape({ root: buildDeepNode(500000) });
  const elapsed = Date.now() - start;
  assert.equal(result.ok, false);
  assert.ok(elapsed < 500, `expected an early exit well under 500ms, took ${elapsed}ms`);
});

test("CommandRouter.execute: a pathologically deep custom.design payload fails cleanly with INVALID_PAYLOAD instead of an uncaught RangeError", async () => {
  const { router } = fixture();
  const payload = { doc: { version: "1", page: "Block A Scratch", root: buildDeepNode(50000) } };
  await assert.rejects(
    () => router.execute({ capability: "custom.design", payload }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_PAYLOAD);
      assert.match(error.message, /nesting exceeds the maximum allowed depth/);
      return true;
    }
  );
});

test("CommandRouter.execute: __proto__/constructor keys in a payload are rejected as unrecognized keys, never silently accepted or acted on", async () => {
  const { router } = fixture();
  const raw = '{"nodeId":"1:1","__proto__":{"polluted":true},"constructor":{"x":1}}';
  const payload = JSON.parse(raw);
  await assert.rejects(
    () => router.execute({ capability: "custom.patch_node", payload }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.INVALID_PAYLOAD);
      assert.match(error.message, /Unrecognized key/);
      return true;
    }
  );
  // and, independent of Unified MCP's own schema, confirm the JS-level property is inert: JSON.parse
  // creates "__proto__" as a normal OWN data property, never the accessor — no actual prototype
  // pollution occurs regardless of what a schema does or doesn't reject.
  assert.equal(Object.getPrototypeOf(payload), Object.prototype);
  assert.equal(({}).polluted, undefined);
});

test("CommandRouter.execute: a normal, valid payload is completely unaffected by the new shape check", async () => {
  const { router } = fixture();
  const response = await router.execute({ capability: "custom.patch_node", payload: { nodeId: "1:1", x: 10 } });
  assert.equal(response.ok, true);
});
