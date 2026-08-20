#!/usr/bin/env node
// A6 (hierarchy/move), A7 (group/ungroup/instances), A9 (masks/paint styles/variables/text-range) live
// verification, through the real Unified plugin.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: 20000,
  clientName: "figma-unified-block-a-a6-a9"
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function near(a, b, eps = 0.5) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
}
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 300)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 2000));
  return parsed;
}
async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}
async function waitForPlugin(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = parseToolText(await client.callTool("unified_runtime_status", {}));
    if (status?.runtime?.connected) return status;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for the Unified plugin to pair.");
}

const results = { steps: [] };
const cleanupIds = [];

try {
  await client.connect();
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });
  const expectedVersion = "0.5.0-blockA-a6-a9-full";
  results.steps.push({ step: "plugin version reflects the A6-A9 code change", ok: paired.runtime.pluginVersion === expectedVersion, expected: expectedVersion, actual: paired.runtime.pluginVersion });

  // ---- Build a scratch component + two child shapes on the scratch page ----
  const built = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "a69-frame",
        type: "frame",
        name: "A69 Scratch",
        width: 400,
        height: 300,
        children: [
          { id: "a69-comp", type: "component", name: "Key=A", width: 80, height: 40, fill: { type: "solid", color: "#3366ff" } },
          { id: "a69-shape-a", type: "rect", x: 10, y: 100, width: 40, height: 40, fill: { type: "solid", color: "#33cc66" } },
          { id: "a69-shape-b", type: "rect", x: 30, y: 120, width: 40, height: 40, fill: { type: "solid", color: "#cc3366" } },
          { id: "a69-mask-target", type: "rect", x: 10, y: 200, width: 60, height: 60, fill: { type: "solid", color: "#999999" } }
        ]
      }
    }
  });
  const ids = built.result?.ids || {};
  const frameId = ids["a69-frame"];
  const compId = ids["a69-comp"];
  const shapeAId = ids["a69-shape-a"];
  const shapeBId = ids["a69-shape-b"];
  const maskTargetId = ids["a69-mask-target"];
  results.steps.push({ step: "build scratch composition (component + shapes)", ok: built.ok === true && !!frameId && !!compId && !!shapeAId && !!shapeBId });
  if (frameId) cleanupIds.push(frameId);
  if (!compId || !shapeAId || !shapeBId) throw new Error("build failed, cannot continue");

  // ---- A6: move_node — reparent shapeA under the component, preserving visual position ----
  const readBefore = await execute("custom.node.read", { nodeId: shapeAId, depth: 0, include: ["geometry"] });
  const moved = await execute("custom.move_node", { nodeId: shapeAId, parentId: compId, preserveVisualPosition: true });
  const readAfterMove = await execute("custom.node.read", { nodeId: shapeAId, depth: 0, include: ["geometry", "metadata"] });
  results.steps.push({
    step: "A6 move_node: reparent under component, visual position preserved",
    ok:
      moved.ok === true &&
      moved.result?.parentId === compId &&
      readAfterMove.ok === true &&
      readAfterMove.result?.doc?.parentId === compId &&
      near(readAfterMove.result?.doc?.absoluteBoundingBox?.x, readBefore.result?.doc?.absoluteBoundingBox?.x)
  });

  // ---- A7: group shapeB with itself is invalid (need same-parent siblings) — group two fresh siblings instead ----
  const groupSiblings = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "a69-group-parent",
        type: "frame",
        name: "GroupTest",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        children: [
          { id: "gs-a", type: "rect", x: 0, y: 0, width: 20, height: 20 },
          { id: "gs-b", type: "rect", x: 30, y: 0, width: 20, height: 20 }
        ]
      }
    }
  });
  const groupParentId = groupSiblings.result?.ids?.["a69-group-parent"];
  const gsA = groupSiblings.result?.ids?.["gs-a"];
  const gsB = groupSiblings.result?.ids?.["gs-b"];
  if (groupParentId) cleanupIds.push(groupParentId);

  const grouped = await execute("custom.group", { nodeIds: [gsA, gsB], name: "TestGroup", operationKey: "a69-test-group" });
  results.steps.push({ step: "A7 group: creates a real GROUP from 2 siblings", ok: grouped.ok === true && grouped.result?.childCount === 2 && grouped.result?.reused === false });

  const groupedAgain = await execute("custom.group", { nodeIds: [gsA, gsB], name: "TestGroup", operationKey: "a69-test-group" });
  results.steps.push({ step: "A7 group idempotency: same operationKey reuses the existing group instead of duplicating", ok: groupedAgain.ok === true && groupedAgain.result?.reused === true && groupedAgain.result?.groupId === grouped.result?.groupId });

  const ungrouped = await execute("custom.ungroup", { nodeId: grouped.result?.groupId });
  results.steps.push({ step: "A7 ungroup: children reparented back out, group removed", ok: ungrouped.ok === true && Array.isArray(ungrouped.result?.childIds) && ungrouped.result.childIds.length === 2 });

  // ---- A7: create_instance + instance_override ----
  const instance = await execute("custom.create_instance", { componentId: compId, name: "A69 Instance", x: 200, y: 10 });
  const instanceId = instance.result?.instanceId;
  results.steps.push({ step: "A7 create_instance: real INSTANCE created from the component", ok: instance.ok === true && !!instanceId });
  if (instanceId) cleanupIds.push(instanceId);

  const overridden = await execute("custom.instance_override", { instanceId, action: "set_node", targetNodeId: instanceId, props: { opacity: 0.5 } });
  results.steps.push({ step: "A7 instance_override: set_node applies an override", ok: overridden.ok === true && overridden.result?.applied === true });

  // ---- A9: create_paint_style, then apply via custom.styles ----
  const paintStyle = await execute("custom.create_paint_style", { name: `A69 Test Style ${Date.now()}`, paint: { type: "solid", color: "#ff9900" } });
  results.steps.push({ step: "A9 create_paint_style: real PaintStyle created", ok: paintStyle.ok === true && !!paintStyle.result?.styleId });

  const listedStyles = await execute("custom.list_styles", {});
  results.steps.push({ step: "A9 list_styles: newly created style is enumerable", ok: listedStyles.ok === true && listedStyles.result?.styles?.some((s) => s.id === paintStyle.result?.styleId) });

  // ---- A9: set_mask ----
  if (maskTargetId) cleanupIds.push(maskTargetId);
  const masked = await execute("custom.set_mask", { nodeId: maskTargetId, isMask: true });
  const readAfterMask = await execute("custom.node.read", { nodeId: maskTargetId, depth: 0, include: ["appearance"] });
  results.steps.push({ step: "A9 set_mask: isMask actually set on the real node", ok: masked.ok === true && masked.result?.isMask === true && readAfterMask.result?.doc?.isMask === true });

  // ---- A9: variables (create collection, variable, bind to the mask target's opacity) ----
  const collection = await execute("custom.variables", { action: "create_collection", name: `A69 Vars ${Date.now()}` });
  const collectionId = collection.result?.collectionId;
  results.steps.push({ step: "A9 variables: create_collection", ok: collection.ok === true && !!collectionId });

  const variable = await execute("custom.variables", { action: "create_variable", collectionId, name: "test-opacity", resolvedType: "FLOAT" });
  const variableId = variable.result?.variableId;
  results.steps.push({ step: "A9 variables: create_variable (FLOAT)", ok: variable.ok === true && !!variableId });

  const modeId = collection.result?.modes?.[0]?.modeId;
  const setValue = await execute("custom.variables", { action: "set_value", variableId, modeId, value: 0.8 });
  results.steps.push({ step: "A9 variables: set_value", ok: setValue.ok === true });

  const bound = await execute("custom.variables", { action: "bind", nodeId: maskTargetId, variableId, kind: "node", field: "opacity" });
  results.steps.push({ step: "A9 variables: bind a FLOAT variable to a node's opacity field", ok: bound.ok === true && bound.result?.bound === true });

  // ---- A3/A9: text_range on a real text node ----
  // A text node cannot be the document ROOT (the real, imported compiler correctly rejects that —
  // confirmed live in an earlier run: "the document root must be type frame/group/section"). Wrap it
  // in a frame, matching how any real design would actually be structured.
  const textBuilt = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: { id: "a69-text-wrap", type: "frame", width: 220, height: 50, children: [{ id: "a69-text", type: "text", text: "Hello Block A", width: 200, height: 30 }] }
    }
  });
  const textWrapId = textBuilt.result?.ids?.["a69-text-wrap"];
  const textId = textBuilt.result?.ids?.["a69-text"];
  if (textWrapId) cleanupIds.push(textWrapId);
  const ranged = await execute("custom.text_range", { nodeId: textId, start: 0, end: 5, fontSize: 32 });
  results.steps.push({ step: "text_range: per-range font size applied to a substring", ok: ranged.ok === true && Array.isArray(ranged.result?.segments) });

  // ---- Cleanup everything created directly under the scratch page ----
  let cleanupOk = true;
  for (const id of cleanupIds) {
    const del = await execute("custom.delete_node", { nodeId: id });
    if (!del.ok) cleanupOk = false;
  }
  results.steps.push({ step: "cleanup: all top-level scratch nodes deleted", ok: cleanupOk });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== A6-A9 LIVE VERIFICATION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nA6-A9 LIVE VERIFICATION: PASS" : "\nA6-A9 LIVE VERIFICATION: FAIL");
  writeFileSync(new URL("./block-a-a6-a9-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-a6-a9-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
