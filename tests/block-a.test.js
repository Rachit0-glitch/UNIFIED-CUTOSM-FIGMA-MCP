import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE4_CAPABILITIES, CapabilityRegistry } from "../src/runtime/capabilities.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";

function getCapability(id) {
  return new CapabilityRegistry(STAGE4_CAPABILITIES).get(id);
}

// A1 — full-fidelity reads (resolves H3).

test("A1: custom.node.read accepts a valid include category array", () => {
  const capability = getCapability("custom.node.read");
  const parsed = capability.schema.safeParse({ include: ["geometry", "text"] });
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.include, ["geometry", "text"]);
});

test("A1: custom.node.read rejects an unknown include category before the bridge is ever called", () => {
  const capability = getCapability("custom.node.read");
  const parsed = capability.schema.safeParse({ include: ["not-a-real-category"] });
  assert.equal(parsed.success, false);
});

test("A1: custom.selection.read accepts include and keeps depth default", () => {
  const capability = getCapability("custom.selection.read");
  const parsed = capability.schema.safeParse({ include: ["appearance"] });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.depth, 1);
});

test("A1: CustomProtocolAdapter forwards include onto the outgoing envelope for node.read", () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.node.read");
  const envelope = adapter.toEnvelope({
    capability,
    payload: { depth: 3, nodeId: "1:1", include: ["geometry", "appearance"] },
    requestId: "req-1"
  });
  assert.deepEqual(envelope.payload, { depth: 3, nodeId: "1:1", include: ["geometry", "appearance"] });
});

test("A1: CustomProtocolAdapter omits include when not provided (no stray undefined key)", () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.node.read");
  const envelope = adapter.toEnvelope({ capability, payload: { depth: 1 }, requestId: "req-2" });
  assert.equal("include" in envelope.payload, false);
});

test("A1: all 8 readback categories from Custom MCP's own figma_node are valid include values", () => {
  const categories = ["geometry", "layout", "appearance", "text", "component", "variables", "styles", "metadata"];
  const capability = getCapability("custom.node.read");
  for (const category of categories) {
    const parsed = capability.schema.safeParse({ include: [category] });
    assert.equal(parsed.success, true, `expected "${category}" to be a valid include category`);
  }
});
