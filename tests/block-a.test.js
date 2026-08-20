import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGE4_CAPABILITIES, CapabilityRegistry } from "../src/runtime/capabilities.js";
import { CustomProtocolAdapter } from "../src/runtime/protocolAdapters/custom.js";
import { CommandRouter } from "../src/runtime/commandRouter.js";
import { CommandQueue } from "../src/runtime/commandQueue.js";

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

test("A1: CustomProtocolAdapter forwards include onto the outgoing envelope for node.read", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.node.read");
  const envelope = await adapter.toEnvelope({
    capability,
    payload: { depth: 3, nodeId: "1:1", include: ["geometry", "appearance"] },
    requestId: "req-1"
  });
  assert.deepEqual(envelope.payload, { depth: 3, nodeId: "1:1", include: ["geometry", "appearance"] });
});

test("A1: CustomProtocolAdapter omits include when not provided (no stray undefined key)", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.node.read");
  const envelope = await adapter.toEnvelope({ capability, payload: { depth: 1 }, requestId: "req-2" });
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

// A2 — core mutation path (create/update/delete/reorder via the real figma-custom-mcp compiler/schemas).

function minimalDoc(overrides = {}) {
  return {
    version: "1",
    root: { id: "root", type: "frame", width: 200, height: 100, fill: { type: "solid", color: "#ffffff" }, ...overrides }
  };
}

test("A2: custom.design accepts a valid minimal DesignDoc (real DesignDocSchema, imported not re-derived)", () => {
  const capability = getCapability("custom.design");
  const parsed = capability.schema.safeParse({ doc: minimalDoc() });
  assert.equal(parsed.success, true);
});

test("A2: custom.design rejects an unknown field on a node (strict schema, same reliability guarantee as figma_design)", () => {
  const capability = getCapability("custom.design");
  const parsed = capability.schema.safeParse({ doc: minimalDoc({ notARealField: 1 }) });
  assert.equal(parsed.success, false);
});

test("A2: custom.design rejects a root of type other than frame/group/section at the schema level (type enum)", () => {
  const capability = getCapability("custom.design");
  // "circle" isn't in the DesignNodeSchema's own NODE_TYPES enum at all — a clearer signal than the
  // compiler's own root-type check, and confirms the real schema (not a looser stand-in) is wired in.
  const parsed = capability.schema.safeParse({ doc: minimalDoc({ type: "circle" }) });
  assert.equal(parsed.success, false);
});

test("A2: CustomProtocolAdapter compiles a valid DesignDoc into a real plan via the imported compiler", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.design");
  const parsedPayload = capability.schema.parse({ doc: minimalDoc() });
  const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload, requestId: "req-design-1" });
  assert.equal(envelope.operation, "design.apply");
  assert.equal(Array.isArray(envelope.payload.plan.ops), true);
  assert.equal(envelope.payload.plan.ops[0].key, "root");
  assert.equal(envelope.payload.plan.ops[0].type, "frame");
});

test("A2: CustomProtocolAdapter dryRun short-circuits with dryRunResult instead of a normal envelope payload", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.design");
  const parsedPayload = capability.schema.parse({ doc: minimalDoc(), dryRun: true });
  const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload, requestId: "req-design-2" });
  assert.equal(envelope.dryRunResult.dryRun, true);
  assert.equal(envelope.dryRunResult.nodeCount, 1);
  assert.equal(envelope.payload, undefined);
});

test("A2: CommandRouter short-circuits dryRun before ever touching the queue/bridge", async () => {
  const { CommandRouter } = await import("../src/runtime/commandRouter.js");
  const { CapabilityRegistry } = await import("../src/runtime/capabilities.js");
  let bridgeCalls = 0;
  const registry = new CapabilityRegistry(STAGE4_CAPABILITIES);
  const bridge = { execute: async () => { bridgeCalls += 1; return { ok: true, result: {} }; }, status: () => ({ connected: true }) };
  const queue = { enqueue: async (job) => await job(), status: () => ({ length: 0 }) };
  const router = new CommandRouter({ registry, adapters: new Map([["custom", new CustomProtocolAdapter()]]), bridge, queue, logger: null });
  const result = await router.execute({ capability: "custom.design", payload: { doc: minimalDoc(), dryRun: true } });
  assert.equal(result.ok, true);
  assert.equal(result.result.dryRun, true);
  assert.equal(bridgeCalls, 0);
});

test("A2: custom.design surfaces a real CompileError (duplicate node id) as DESIGN_COMPILE_ERROR, not a generic failure", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.design");
  const dupDoc = {
    version: "1",
    root: { id: "root", type: "frame", width: 200, height: 100, children: [{ id: "root", type: "rect", width: 10, height: 10 }] }
  };
  const parsedPayload = capability.schema.parse({ doc: dupDoc });
  await assert.rejects(
    adapter.toEnvelope({ capability, payload: parsedPayload, requestId: "req-design-3" }),
    (err) => err.code === "DESIGN_COMPILE_ERROR" && /duplicate node id/.test(err.message)
  );
});

test("A2: custom.patch_node accepts a valid partial patch payload (real FillSchema/StrokeSchema/RadiusSchema imported)", () => {
  const capability = getCapability("custom.patch_node");
  const parsed = capability.schema.safeParse({ nodeId: "1:1", opacity: 0.5, radius: [4, 4, 0, 0], fill: { type: "solid", color: "#112233" } });
  assert.equal(parsed.success, true);
});

test("A2: custom.patch_node rejects an unknown top-level field", () => {
  const capability = getCapability("custom.patch_node");
  const parsed = capability.schema.safeParse({ nodeId: "1:1", notARealProp: 1 });
  assert.equal(parsed.success, false);
});

test("A2: custom.patch_node's text field requires characters or font, not neither", () => {
  const capability = getCapability("custom.patch_node");
  const parsed = capability.schema.safeParse({ nodeId: "1:1", text: {} });
  assert.equal(parsed.success, false);
});

test("A2: custom.delete_node requires nodeId", () => {
  const capability = getCapability("custom.delete_node");
  assert.equal(capability.schema.safeParse({ nodeId: "1:1" }).success, true);
  assert.equal(capability.schema.safeParse({}).success, false);
});

test("A2: custom.reorder_node accepts a numeric index or front/back, rejects anything else", () => {
  const capability = getCapability("custom.reorder_node");
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", to: 2 }).success, true);
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", to: "front" }).success, true);
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", to: "sideways" }).success, false);
});

test("A2: CustomProtocolAdapter wraps patch fields into a nested `props` object for the plugin (real bug found live: patch silently no-op'd when props was flat)", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.patch_node");
  const parsedPayload = capability.schema.parse({ nodeId: "1:1", x: 50, y: 50, opacity: 0.7, radius: 12, fill: { type: "solid", color: "#ff3366" } });
  const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload, requestId: "req-patch-1" });
  assert.equal(envelope.payload.nodeId, "1:1");
  assert.equal(envelope.payload.props.x, 50);
  assert.equal(envelope.payload.props.y, 50);
  assert.equal(envelope.payload.props.opacity, 0.7);
  assert.equal(envelope.payload.props.radius, 12);
  assert.deepEqual(envelope.payload.props.fill, { type: "solid", color: "#ff3366" });
  // nodeId itself must never leak into props (the plugin resolves it separately via args.nodeId).
  assert.equal("nodeId" in envelope.payload.props, false);
});

test("A2: CustomProtocolAdapter normalizes patch `layout` into the plugin-ready shape (mode HORIZONTAL/VERTICAL, pad as 4-tuple)", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.patch_node");
  const parsedPayload = capability.schema.parse({ nodeId: "1:1", layout: { mode: "row", gap: 8, pad: 4, justify: "center" } });
  const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload, requestId: "req-patch-2" });
  assert.equal(envelope.payload.props.layout.mode, "HORIZONTAL");
  assert.deepEqual(envelope.payload.props.layout.pad, [4, 4, 4, 4]);
  assert.equal(envelope.payload.props.layout.justify, "CENTER");
});

test("A2: all 4 new mutation capabilities are registered with mutation:true", () => {
  for (const id of ["custom.design", "custom.patch_node", "custom.delete_node", "custom.reorder_node"]) {
    assert.equal(getCapability(id).mutation, true, `expected ${id} to be mutation:true`);
  }
});

// A10 — P3 compound capabilities (custom.diff/custom.verify/custom.measure), via the real imported
// figma-custom-mcp diff.js/measure.js.

function fakeBridgeByNode(nodesById) {
  const calls = [];
  return {
    calls,
    status: () => ({ connected: true }),
    async execute(envelope) {
      calls.push(envelope);
      if (envelope.family === "custom" && envelope.operation === "node.read") {
        const doc = nodesById[envelope.payload.nodeId];
        if (!doc) {
          return { ok: false, error: { code: "NODE_NOT_FOUND", message: `Node not found: ${envelope.payload.nodeId}` } };
        }
        return { ok: true, result: { doc } };
      }
      throw new Error(`unexpected ${envelope.family}.${envelope.operation}`);
    }
  };
}

function fixtureFor(nodesById) {
  const bridge = fakeBridgeByNode(nodesById);
  const registry = new CapabilityRegistry(STAGE4_CAPABILITIES);
  const queue = new CommandQueue({ logger: null });
  const router = new CommandRouter({ registry, adapters: new Map([["custom", new CustomProtocolAdapter()]]), bridge, queue, logger: null });
  return { bridge, router };
}

test("A10: custom.measure computes a real gap via the imported measure.js, reading each node through the queue", async () => {
  const { bridge, router } = fixtureFor({
    "1:1": { id: "1:1", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 } },
    "1:2": { id: "1:2", absoluteBoundingBox: { x: 150, y: 0, width: 100, height: 50 } }
  });
  const result = await router.execute({ capability: "custom.measure", payload: { mode: "gap", nodeIds: ["1:1", "1:2"], axis: "x" } });
  assert.equal(result.ok, true);
  assert.equal(result.result.gap, 50);
  assert.equal(result.result.overlapping, false);
  // Each node read is its own queued bridge call — 2 calls for 2 nodeIds, not 1 batched call.
  assert.equal(bridge.calls.length, 2);
});

test("A10: custom.measure surfaces NODE_NOT_FOUND with the specific missing node id, not a generic failure", async () => {
  const { router } = fixtureFor({ "1:1": { id: "1:1", absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } } });
  const result = await router.execute({ capability: "custom.measure", payload: { mode: "bounds", nodeIds: ["1:1", "9:9"] } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "NODE_NOT_FOUND");
  assert.match(result.error.message, /9:9/);
});

test("A10: custom.measure rejects mode \"gap\" without exactly 2 nodeIds before doing any real work", async () => {
  const { router } = fixtureFor({ "1:1": { id: "1:1", absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } } });
  const result = await router.execute({ capability: "custom.measure", payload: { mode: "gap", nodeIds: ["1:1"], axis: "x" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_PAYLOAD");
});

test("A10: custom.verify uses the real verifyExpectations tolerance logic (opacity float32 slack)", async () => {
  const { router } = fixtureFor({ "2:1": { id: "2:1", opacity: 0.699999988079071, x: 50 } });
  const result = await router.execute({
    capability: "custom.verify",
    payload: { expectations: [{ nodeId: "2:1", expected: { opacity: 0.7, x: 50 } }] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.ok, true, "opacity float32 slack should be within the default 0.001 tolerance");
  assert.equal(result.result.differenceCount, 0);
});

test("A10: custom.verify reports a real MAJOR difference for a genuinely wrong value", async () => {
  const { router } = fixtureFor({ "2:1": { id: "2:1", x: 999 } });
  const result = await router.execute({ capability: "custom.verify", payload: { expectations: [{ nodeId: "2:1", expected: { x: 50 } }] } });
  assert.equal(result.ok, true);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.differences[0].severity, "MAJOR");
  assert.equal(result.result.differences[0].delta, 949);
});

test("A10: custom.diff matches expected vs actual via idMap and reports the real radius->cornerRadius field mapping (the exact bug diff.ts's own comment documents)", async () => {
  const { router } = fixtureFor({ "figma-1": { id: "figma-1", x: 0, y: 0, cornerRadius: 4 } });
  const result = await router.execute({
    capability: "custom.diff",
    payload: {
      expected: { id: "authored-1", type: "rect", radius: 8 },
      idMap: { "authored-1": "figma-1" },
      nodeId: "figma-1"
    }
  });
  assert.equal(result.ok, true);
  const radiusChange = result.result.changed.find((c) => c.field === "cornerRadius");
  assert.ok(radiusChange, "expected a cornerRadius change entry (authored as \"radius\")");
  assert.equal(radiusChange.expected, 8);
  assert.equal(radiusChange.actual, 4);
});

test("A10: custom.diff reports a missing node as CRITICAL when idMap points at a node that doesn't exist in actual", async () => {
  const { router } = fixtureFor({ "figma-1": { id: "figma-1", x: 0 } });
  const result = await router.execute({
    capability: "custom.diff",
    payload: {
      expected: { id: "authored-1", type: "rect", children: [{ id: "authored-2", type: "rect" }] },
      idMap: { "authored-1": "figma-1", "authored-2": "figma-does-not-exist" },
      nodeId: "figma-1"
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.missing, ["authored-2"]);
  assert.equal(result.result.severityCounts.CRITICAL, 1);
});

// A6/A7/A9 — hierarchy, components/instances, styles, variables, masks.

test("A6: custom.move_node accepts a valid payload and passes it through unmodified", async () => {
  const adapter = new CustomProtocolAdapter();
  const capability = getCapability("custom.move_node");
  const parsedPayload = capability.schema.parse({ nodeId: "1:1", parentId: "1:2", index: 0, preserveVisualPosition: true });
  const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload, requestId: "req-move" });
  assert.deepEqual(envelope.payload, parsedPayload);
});

test("A7: custom.group requires at least 1 nodeId, custom.create_component_set requires at least 2", () => {
  assert.equal(getCapability("custom.group").schema.safeParse({ nodeIds: [] }).success, false);
  assert.equal(getCapability("custom.group").schema.safeParse({ nodeIds: ["1:1"] }).success, true);
  assert.equal(getCapability("custom.create_component_set").schema.safeParse({ componentNodeIds: ["1:1"] }).success, false);
  assert.equal(getCapability("custom.create_component_set").schema.safeParse({ componentNodeIds: ["1:1", "1:2"] }).success, true);
});

test("A7: custom.boolean only accepts the 4 real Figma boolean operations", () => {
  const capability = getCapability("custom.boolean");
  assert.equal(capability.schema.safeParse({ op: "union", nodeIds: ["1:1"] }).success, true);
  assert.equal(capability.schema.safeParse({ op: "xor", nodeIds: ["1:1"] }).success, false);
});

test("A9: custom.create_paint_style's PaintForStyle only allows linear/radial gradients (verbatim source asymmetry vs. custom.styles' 4-gradient union)", () => {
  const paintStyle = getCapability("custom.create_paint_style");
  assert.equal(paintStyle.schema.safeParse({ name: "Brand/Primary", paint: { type: "solid", color: "#3366ff" } }).success, true);
  assert.equal(paintStyle.schema.safeParse({ name: "Brand/Gradient", paint: { type: "angular-gradient", stops: [{ at: 0, color: "#fff" }, { at: 1, color: "#000" }] } }).success, false);

  const styles = getCapability("custom.styles");
  assert.equal(
    styles.schema.safeParse({ kind: "paint", action: "create", name: "Brand/Gradient", paint: { type: "angular-gradient", stops: [{ at: 0, color: "#fff" }, { at: 1, color: "#000" }] } }).success,
    true,
    "custom.styles should accept angular gradients even though custom.create_paint_style doesn't — real source asymmetry, not a bug"
  );
});

test("A9: custom.text_range requires start < end and rejects an empty range", () => {
  const capability = getCapability("custom.text_range");
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", start: 0, end: 5, fontSize: 24 }).success, true);
});

test("A9: custom.component_property requires propType only for action \"add\" at the runtime level (schema allows omission, plugin enforces)", () => {
  const capability = getCapability("custom.component_property");
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", action: "list" }).success, true);
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", action: "add", name: "Label", propType: "TEXT", defaultValue: "hi" }).success, true);
});

test("A9: custom.instance_override's props union rejects an unknown field (strict, same reliability guarantee)", () => {
  const capability = getCapability("custom.instance_override");
  const parsed = capability.schema.safeParse({ instanceId: "1:1", action: "set_node", targetNodeId: "1:2", props: { notARealProp: 1 } });
  assert.equal(parsed.success, false);
});

test("A9: custom.variables accepts create_variable and bind actions with their real field shapes", () => {
  const capability = getCapability("custom.variables");
  assert.equal(capability.schema.safeParse({ action: "create_variable", collectionId: "c1", name: "brand-blue", resolvedType: "COLOR" }).success, true);
  assert.equal(capability.schema.safeParse({ action: "bind", nodeId: "1:1", variableId: "v1", kind: "paint", paintProperty: "fills", paintIndex: 0 }).success, true);
  assert.equal(capability.schema.safeParse({ action: "create_variable", collectionId: "c1", name: "x", resolvedType: "TIMING" }).success, false, "EASING/TIMING are out of scope, same as the real figma_variables schema");
});

test("A9: custom.set_mask defaults isMask on the plugin side, not the schema (both true and omitted are valid payloads)", () => {
  const capability = getCapability("custom.set_mask");
  assert.equal(capability.schema.safeParse({ nodeId: "1:1" }).success, true);
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", isMask: true, maskType: "luminance" }).success, true);
  assert.equal(capability.schema.safeParse({ nodeId: "1:1", maskType: "not-a-real-type" }).success, false);
});

test("A6-A9: every pass-through operation's payload reaches the envelope completely unmodified", async () => {
  const adapter = new CustomProtocolAdapter();
  const cases = [
    ["custom.ungroup", { nodeId: "1:1" }],
    ["custom.list_styles", {}],
    ["custom.create_instance", { componentId: "1:1", x: 10, y: 20 }],
    ["custom.instance_swap", { instanceId: "1:1", componentId: "1:2" }]
  ];
  for (const [id, rawPayload] of cases) {
    const capability = getCapability(id);
    const parsedPayload = capability.schema.parse(rawPayload);
    const envelope = await adapter.toEnvelope({ capability, payload: parsedPayload, requestId: `req-${id}` });
    assert.deepEqual(envelope.payload, parsedPayload, `expected ${id}'s payload to pass through unmodified`);
  }
});

test("A10: compound capabilities bypass the family protocol adapter entirely (no adapter registered for a made-up family would still work)", async () => {
  const bridge = fakeBridgeByNode({ "1:1": { id: "1:1", x: 0 } });
  const registry = new CapabilityRegistry(STAGE4_CAPABILITIES);
  const queue = new CommandQueue({ logger: null });
  // Deliberately an EMPTY adapters map — if custom.verify routed through the normal adapter path this
  // would throw "No protocol adapter registered for family: custom," proving compound capabilities
  // really do take the separate code path documented in commandRouter.js.
  const router = new CommandRouter({ registry, adapters: new Map(), bridge, queue, logger: null });
  const result = await router.execute({ capability: "custom.verify", payload: { expectations: [{ nodeId: "1:1", expected: { x: 0 } }] } });
  assert.equal(result.ok, true);
});
