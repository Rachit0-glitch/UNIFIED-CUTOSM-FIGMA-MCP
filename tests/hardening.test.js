import test from "node:test";
import assert from "node:assert/strict";
import { createTools, legacyDiagnosticsEnabled } from "../src/server.js";
import { CapabilityRegistry, STAGE4_CAPABILITIES } from "../src/runtime/capabilities.js";
import { CommandQueue } from "../src/runtime/commandQueue.js";
import { CommandRouter } from "../src/runtime/commandRouter.js";
import { PlumbProtocolAdapter } from "../src/runtime/protocolAdapters/plumb.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { ERROR_CODES, UnifiedError, errorShape, normalizeBackendError } from "../src/errors.js";
import { MAX_READ_DEPTH } from "../src/runtime/limits.js";

const silentLogger = { event: () => {}, timed: async (_o, _b, fn) => await fn() };

function fakeBridge(overrides = {}) {
  const calls = [];
  return {
    calls,
    async start() {},
    status: () => ({ bridgePort: 39417, bridge: "ready", connected: true, plugin: "connected", protocolVersion: PROTOCOL_VERSION, pluginVersion: "test", pendingRequests: 0 }),
    async execute(envelope) {
      calls.push(envelope);
      if (overrides.execute) return await overrides.execute(envelope);
      return { protocolVersion: PROTOCOL_VERSION, requestId: envelope.requestId, ok: true, family: envelope.family, operation: envelope.operation, result: {}, error: null, durationMs: 1 };
    }
  };
}

function fixture(bridgeOverrides) {
  const bridge = fakeBridge(bridgeOverrides);
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
  return { bridge, registry, queue, router };
}

// --------------------------------------------------------------------- H1 --

test("H1: legacyDiagnosticsEnabled is false by default", () => {
  assert.equal(legacyDiagnosticsEnabled({}), false);
});

test("H1: production tool set excludes all 4 legacy Stage-2 tools when the flag is unset", () => {
  const tools = createTools({ runtime: {} }, {});
  for (const name of ["unified_status", "unified_backends", "unified_active_backend", "unified_probe_backend"]) {
    assert.equal(name in tools, false, `${name} must not be registered without the opt-in flag`);
  }
  assert.ok("unified_capabilities" in tools);
  assert.ok("unified_execute" in tools);
  assert.ok("unified_runtime_status" in tools);
});

test("H1: legacy Stage-2 tools register only when UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true", () => {
  const tools = createTools({ runtime: {} }, { UNIFIED_ENABLE_LEGACY_DIAGNOSTICS: "true" });
  for (const name of ["unified_status", "unified_backends", "unified_active_backend", "unified_probe_backend"]) {
    assert.ok(name in tools, `${name} must register when the opt-in flag is set`);
    assert.match(tools[name].description, /LEGACY DIAGNOSTICS ONLY/);
  }
});

test("H5: the 3 redundant Stage-3.5 POC tools carry a DEPRECATED description; unified_runtime_status does not", () => {
  const tools = createTools({ runtime: {} }, {});
  for (const name of ["unified_runtime_plumb_read", "unified_runtime_custom_read", "unified_runtime_acceptance_sequence"]) {
    assert.match(tools[name].description, /^DEPRECATED/);
  }
  assert.doesNotMatch(tools.unified_runtime_status.description, /DEPRECATED/);
  assert.match(tools.unified_runtime_status.description, /PRODUCTION STATUS/);
});

// --------------------------------------------------------------------- H9 --

test("H9: a valid payload passes schema validation and reaches the bridge", async () => {
  const { bridge, router } = fixture();
  const result = await router.execute({ capability: "custom.node.read", payload: { nodeId: "1:2", depth: 3 } });
  assert.equal(result.ok, true);
  assert.equal(bridge.calls.length, 1);
});

test("H9: an unknown field is rejected before the bridge is ever called (strict schema)", async () => {
  const { bridge, router } = fixture();
  await assert.rejects(() => router.execute({ capability: "custom.node.read", payload: { nodeId: "1:2", bogusField: true } }), { code: ERROR_CODES.INVALID_PAYLOAD });
  assert.equal(bridge.calls.length, 0);
});

test("H9: a wrong nested type is rejected before the bridge is ever called", async () => {
  const { bridge, router } = fixture();
  await assert.rejects(() => router.execute({ capability: "custom.node.read", payload: { nodeId: 12345 } }), { code: ERROR_CODES.INVALID_PAYLOAD });
  assert.equal(bridge.calls.length, 0);
});

test("H9: depth beyond MAX_READ_DEPTH is rejected before the bridge is ever called", async () => {
  const { bridge, router } = fixture();
  await assert.rejects(() => router.execute({ capability: "custom.node.read", payload: { depth: MAX_READ_DEPTH + 1 } }), { code: ERROR_CODES.INVALID_PAYLOAD });
  assert.equal(bridge.calls.length, 0);
});

test("H9: a missing required field is rejected (plumb.probeBackend-shaped example: outline page must be a string, not a number)", async () => {
  const { bridge, router } = fixture();
  await assert.rejects(() => router.execute({ capability: "plumb.outline", payload: { page: 42 } }), { code: ERROR_CODES.INVALID_PAYLOAD });
  assert.equal(bridge.calls.length, 0);
});

test("H9: schema defaults apply — omitting depth uses the capability's own default, visible in the outgoing envelope", async () => {
  const { bridge, router } = fixture();
  await router.execute({ capability: "custom.node.read", payload: {} });
  assert.equal(bridge.calls[0].payload.depth, 1);
  await router.execute({ capability: "plumb.selection.read", payload: {} });
  assert.equal(bridge.calls[1].payload.depth, 2);
});

// -------------------------------------------------------------------- H14 --

test("H14: constructing a CapabilityRegistry with a duplicate id throws instead of silently shadowing", () => {
  const dup = [...STAGE4_CAPABILITIES, { ...STAGE4_CAPABILITIES[0] }];
  assert.throws(() => new CapabilityRegistry(dup), { code: ERROR_CODES.INVALID_COMMAND });
});

test("H14: the real STAGE4_CAPABILITIES list has no duplicate ids (regression guard)", () => {
  assert.doesNotThrow(() => new CapabilityRegistry());
});

// --------------------------------------------------------------------- H7 --

test("H7: enqueue rejects with QUEUE_FULL once maxQueueLength is reached, without disturbing what's already running", async () => {
  const queue = new CommandQueue({ logger: silentLogger, maxQueueLength: 1, queueWaitTimeoutMs: 5000 });
  let releaseFirst;
  const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue(async () => { await firstDone; return "first"; }, { requestId: "r1" });
  // first is now "active"; queue a second item to fill capacity (maxQueueLength: 1)
  const second = queue.enqueue(async () => "second", { requestId: "r2" });
  await assert.rejects(queue.enqueue(async () => "third", { requestId: "r3" }), { code: ERROR_CODES.QUEUE_FULL });
  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
});

test("H7: a queued item that waits past queueWaitTimeoutMs rejects with QUEUE_WAIT_TIMEOUT and does not poison later commands", async () => {
  const queue = new CommandQueue({ logger: silentLogger, maxQueueLength: 10, queueWaitTimeoutMs: 30 });
  let releaseFirst;
  const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
  const first = queue.enqueue(async () => { await firstDone; return "first"; }, { requestId: "r1" });
  const second = queue.enqueue(async () => "second", { requestId: "r2", family: "custom", operation: "node.read" });
  await assert.rejects(second, { code: ERROR_CODES.QUEUE_WAIT_TIMEOUT });
  releaseFirst();
  assert.equal(await first, "first");
  // queue must still be fully functional afterward
  const third = await queue.enqueue(async () => "third", { requestId: "r3" });
  assert.equal(third, "third");
});

test("H7: QUEUE_WAIT_TIMEOUT is never raised once an item has actually started executing (long execution != long wait)", async () => {
  const queue = new CommandQueue({ logger: silentLogger, maxQueueLength: 10, queueWaitTimeoutMs: 30 });
  // Nothing ahead of it, so it starts immediately — execution itself may run past queueWaitTimeoutMs
  // without that ever becoming a QUEUE_WAIT_TIMEOUT (that's COMMAND_TIMEOUT's job, at the bridge layer).
  const result = await queue.enqueue(async () => { await new Promise((r) => setTimeout(r, 60)); return "slow-but-running"; }, { requestId: "r1" });
  assert.equal(result, "slow-but-running");
});

// -------------------------------------------------------------------- H11 --

test("H11: errorShape preserves source alongside code and the specific original message", () => {
  const error = new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, "custom.node.read: nodeId must be a string when provided.", { source: "custom", capability: "custom.node.read" });
  const shape = errorShape(error);
  assert.equal(shape.code, ERROR_CODES.INVALID_PAYLOAD);
  assert.equal(shape.source, "custom");
  assert.equal(shape.message, "custom.node.read: nodeId must be a string when provided.");
  assert.equal(shape.details.capability, "custom.node.read");
});

test("H11: a router-level validation failure surfaces source=family and the specific field-level message, not a generic one", async () => {
  const { router } = fixture();
  try {
    await router.execute({ capability: "custom.node.read", payload: { depth: 999 } });
    assert.fail("expected rejection");
  } catch (error) {
    const shape = errorShape(error);
    assert.equal(shape.code, ERROR_CODES.INVALID_PAYLOAD);
    assert.equal(shape.source, "custom");
    assert.match(shape.message, /depth/i);
  }
});

// --------------------------------------------------------------------- H6 --

test("H6: normalizeBackendError prefers an existing structured code over message-text matching", () => {
  // Message text alone would classify this as BACKEND_TIMEOUT ("timed out"), but a structured
  // UnifiedError must never be reclassified by its message wording.
  const structured = new UnifiedError(ERROR_CODES.BACKEND_NOT_PAIRED, "operation timed out after 10ms, plugin not paired");
  assert.equal(normalizeBackendError(structured).code, ERROR_CODES.BACKEND_NOT_PAIRED);
});

test("H6: normalizeBackendError prefers a plain object's own .code before falling back to substring matching", () => {
  const pluginShapedError = { code: "FIGMA_API_ERROR", message: "timed out while waiting, but this is actually a Figma API error" };
  assert.equal(normalizeBackendError(pluginShapedError).code, "FIGMA_API_ERROR");
});

test("H6: message-wording changes do not alter classification when no structured code is present (fallback path only)", () => {
  const a = normalizeBackendError(new Error("Plugin operation timed out"));
  const b = normalizeBackendError(new Error("The command has timed out waiting for a response"));
  assert.equal(a.code, ERROR_CODES.BACKEND_TIMEOUT);
  assert.equal(b.code, ERROR_CODES.BACKEND_TIMEOUT);
});

// -------------------------------------------------------------------- H10 --

test("H10: execute() results always carry a reserved (currently-null) verification field, so the response shape never needs to change to add it later", async () => {
  const { router } = fixture();
  const result = await router.execute({ capability: "custom.status", payload: {} });
  assert.ok("verification" in result);
  assert.equal(result.verification, null);
});
