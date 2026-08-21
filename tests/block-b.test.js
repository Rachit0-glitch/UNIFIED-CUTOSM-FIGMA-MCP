import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE4_CAPABILITIES, CapabilityRegistry } from "../src/runtime/capabilities.js";
import { CommandRouter, fingerprintPayload, OPERATION_STATUS } from "../src/runtime/commandRouter.js";
import { CommandQueue } from "../src/runtime/commandQueue.js";
import { PlumbProtocolAdapter } from "../src/runtime/protocolAdapters/plumb.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";
import { ERROR_CODES } from "../src/errors.js";

function getCapability(id) {
  return new CapabilityRegistry(STAGE4_CAPABILITIES).get(id);
}

function fakeBridge(behavior) {
  const calls = [];
  return {
    calls,
    status: () => ({ connected: true }),
    async execute(envelope, timeoutMs) {
      calls.push(envelope);
      return await behavior(envelope, timeoutMs);
    }
  };
}

function fixture(behavior, queueOpts = {}) {
  const bridge = fakeBridge(behavior);
  const registry = new CapabilityRegistry(STAGE4_CAPABILITIES);
  const queue = new CommandQueue({ logger: null, ...queueOpts });
  const router = new CommandRouter({
    registry,
    adapters: new Map([
      ["plumb", new PlumbProtocolAdapter()],
      ["custom", new CustomProtocolAdapter()]
    ]),
    bridge,
    queue,
    logger: null
  });
  return { bridge, router, queue };
}

// §3 — operation model

test("§3: every execute() result carries an operationRecord with a real operationId, target, and status", async () => {
  const { router } = fixture(async (envelope) => ({ ok: true, result: { doc: { id: "1:1" } } }));
  const result = await router.execute({ capability: "custom.patch_node", payload: { nodeId: "1:1", opacity: 0.5 } });
  assert.ok(result.operationRecord);
  assert.equal(typeof result.operationRecord.operationId, "string");
  assert.ok(result.operationRecord.operationId.length > 10);
  assert.equal(result.operationRecord.target, "1:1");
  assert.equal(result.operationRecord.status, OPERATION_STATUS.SUCCEEDED);
  assert.equal(result.operationRecord.capability, "custom.patch_node");
  assert.equal(result.operationRecord.mutation, true);
  assert.equal(result.operationRecord.retrySafety, "natural");
  assert.ok(result.operationRecord.startedAt);
  assert.ok(result.operationRecord.completedAt);
});

test("§3: two calls to execute() for the same capability produce two DIFFERENT operationIds", async () => {
  const { router } = fixture(async () => ({ ok: true, result: {} }));
  const a = await router.execute({ capability: "custom.delete_node", payload: { nodeId: "1:1" } });
  const b = await router.execute({ capability: "custom.delete_node", payload: { nodeId: "1:1" } });
  assert.notEqual(a.operationRecord.operationId, b.operationRecord.operationId);
});

test("§3: operationRecord.status is TIMED_OUT for a COMMAND_TIMEOUT, not a generic FAILED", async () => {
  const { UnifiedError } = await import("../src/errors.js");
  const { router } = fixture(async () => {
    throw new UnifiedError(ERROR_CODES.COMMAND_TIMEOUT, "timed out");
  });
  const result = await router.execute({ capability: "custom.patch_node", payload: { nodeId: "1:1" } });
  assert.equal(result.ok, false);
  assert.equal(result.operationRecord.status, OPERATION_STATUS.TIMED_OUT);
});

test("§3: a dryRun custom.design call gets a real operationRecord marked dryRun:true, status SUCCEEDED", async () => {
  const { router } = fixture(async () => ({ ok: true, result: {} }));
  const result = await router.execute({
    capability: "custom.design",
    payload: { doc: { version: "1", root: { id: "r", type: "frame", width: 10, height: 10 } }, dryRun: true }
  });
  assert.equal(result.operationRecord.dryRun, true);
  assert.equal(result.operationRecord.status, OPERATION_STATUS.SUCCEEDED);
});

test("§3: fingerprintPayload is deterministic for the same payload and differs for different payloads", () => {
  const a = fingerprintPayload({ nodeId: "1:1", x: 5 });
  const b = fingerprintPayload({ nodeId: "1:1", x: 5 });
  const c = fingerprintPayload({ nodeId: "1:1", x: 6 });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("§3: a QUEUE_FULL rejection at the router level still returns a real operationRecord instead of throwing past execute()", async () => {
  const { router } = fixture(async () => ({ ok: true, result: {} }), { maxQueueLength: 0 });
  const result = await router.execute({ capability: "custom.patch_node", payload: { nodeId: "1:1" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ERROR_CODES.QUEUE_FULL);
  assert.equal(result.operationRecord.neverReachedBridge, true);
  assert.equal(result.operationRecord.status, OPERATION_STATUS.FAILED);
});

// §4 — retry-safety classification

test("§4: every mutating capability has an explicit, non-'unclassified' retrySafety", () => {
  for (const capability of STAGE4_CAPABILITIES) {
    if (!capability.mutation) continue;
    assert.notEqual(capability.retrySafety, "unclassified", `expected ${capability.id} to have an explicit retrySafety classification`);
    assert.ok(["natural", "operationKey", "reconciliation", "unsafe"].includes(capability.retrySafety), `expected ${capability.id}'s retrySafety to be one of the 4 real classes, got "${capability.retrySafety}"`);
  }
});

test("§4: custom.design is classified 'reconciliation' (mode:create is not naturally retry-safe, mode:sync is)", () => {
  assert.equal(getCapability("custom.design").retrySafety, "reconciliation");
});

test("§4: custom.group/custom.create_component_set are classified 'operationKey' (live-verified idempotent in Block A)", () => {
  assert.equal(getCapability("custom.group").retrySafety, "operationKey");
  assert.equal(getCapability("custom.create_component_set").retrySafety, "operationKey");
});

test("§4: read-only capabilities (including compound P3 ones) are classified 'natural'", () => {
  for (const id of ["custom.node.read", "custom.diff", "custom.verify", "custom.measure", "plumb.outline"]) {
    assert.equal(getCapability(id).retrySafety, "natural", `expected ${id} to be 'natural'`);
  }
});

test("§4: custom.create_instance and custom.boolean are classified 'unsafe' (no dedup mechanism — a blind retry can create a duplicate)", () => {
  assert.equal(getCapability("custom.create_instance").retrySafety, "unsafe");
  assert.equal(getCapability("custom.boolean").retrySafety, "unsafe");
});
