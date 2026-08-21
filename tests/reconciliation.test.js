import { test } from "node:test";
import assert from "node:assert/strict";
import { recommendReconciliation } from "../src/runtime/reconciliation.js";
import { STAGE4_CAPABILITIES, CapabilityRegistry } from "../src/runtime/capabilities.js";

function cap(id) {
  return new CapabilityRegistry(STAGE4_CAPABILITIES).get(id);
}

test("recommendReconciliation: an unambiguous error (NODE_NOT_FOUND) needs no reconciliation", () => {
  const rec = recommendReconciliation({ capability: cap("custom.patch_node"), payload: { nodeId: "1:1" }, error: { code: "NODE_NOT_FOUND" } });
  assert.equal(rec.action, "fix_and_retry_or_give_up");
  assert.equal(rec.safe, true);
});

test("recommendReconciliation: a 'natural' capability with a genuine timeout is always safe to retry as-is", () => {
  const rec = recommendReconciliation({ capability: cap("custom.patch_node"), payload: { nodeId: "1:1" }, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "retry_as_is");
  assert.equal(rec.safe, true);
});

test("recommendReconciliation: an 'operationKey' capability WITH a key is safe to retry as-is", () => {
  const rec = recommendReconciliation({ capability: cap("custom.group"), payload: { nodeIds: ["1:1", "1:2"], operationKey: "my-group" }, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "retry_as_is");
  assert.equal(rec.safe, true);
});

test("recommendReconciliation: an 'operationKey' capability WITHOUT a key is flagged unsafe, with a clear fix", () => {
  const rec = recommendReconciliation({ capability: cap("custom.group"), payload: { nodeIds: ["1:1", "1:2"] }, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "add_operation_key_before_retry");
  assert.equal(rec.safe, false);
});

test("recommendReconciliation: custom.design in create mode recommends switching to mode:sync, preserving the rest of the doc", () => {
  const payload = { doc: { version: "1", page: "P", root: { id: "r", type: "frame", width: 10, height: 10 } } };
  const rec = recommendReconciliation({ capability: cap("custom.design"), payload, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "retry_with_modified_payload");
  assert.equal(rec.safe, true);
  assert.equal(rec.recommendedPayload.doc.mode, "sync");
  assert.equal(rec.recommendedPayload.doc.page, "P");
  assert.equal(rec.recommendedPayload.doc.root.id, "r");
});

test("recommendReconciliation: custom.design already in sync mode is safe to retry as-is (no further transform needed)", () => {
  const payload = { doc: { version: "1", mode: "sync", root: { id: "r", type: "frame", width: 10, height: 10 } } };
  const rec = recommendReconciliation({ capability: cap("custom.design"), payload, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "retry_as_is");
  assert.equal(rec.safe, true);
});

test("recommendReconciliation: an 'unsafe' capability (custom.create_instance) recommends inspecting state first, with a concrete read to run", () => {
  // custom.create_instance's payload identifies the SOURCE component via componentId — that's not the
  // same node as the (not-yet-known) new instance, but it's still the best available identifiable
  // target for a sanity read, so verifyFirst correctly resolves it rather than giving up.
  const rec = recommendReconciliation({ capability: cap("custom.create_instance"), payload: { componentId: "1:1" }, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "inspect_before_retry");
  assert.equal(rec.safe, false);
  assert.equal(rec.verifyFirst.payload.nodeId, "1:1");
});

test("recommendReconciliation: an 'unsafe' capability with NO identifiable target at all correctly returns a null verifyFirst (nothing concrete to check)", () => {
  const rec = recommendReconciliation({ capability: cap("custom.variables"), payload: { action: "create_variable", collectionId: "c1", name: "x", resolvedType: "FLOAT" }, error: { code: "COMMAND_TIMEOUT" } });
  assert.equal(rec.action, "inspect_before_retry");
  assert.equal(rec.verifyFirst, null);
});

test("recommendReconciliation: an 'unsafe' capability WITH an identifiable target suggests exactly what to read to check", () => {
  const rec = recommendReconciliation({ capability: cap("custom.boolean"), payload: { op: "union", nodeIds: ["1:1"], resultKey: "x" }, error: { code: "QUEUE_WAIT_TIMEOUT" } });
  assert.equal(rec.action, "inspect_before_retry");
  // custom.boolean's payload has no top-level nodeId (it's nodeIds, plural) — verifyFirst correctly comes back null rather than guessing.
  assert.equal(rec.verifyFirst, null);
});

test("recommendReconciliation: every mutating capability's classification produces a decision without throwing", () => {
  for (const capability of STAGE4_CAPABILITIES) {
    if (!capability.mutation) continue;
    assert.doesNotThrow(() => recommendReconciliation({ capability, payload: {}, error: { code: "COMMAND_TIMEOUT" } }), `recommendReconciliation threw for ${capability.id}`);
  }
});
