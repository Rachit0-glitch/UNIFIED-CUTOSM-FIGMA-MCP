#!/usr/bin/env node
// Block A — closes every remaining "wired but not independently live-tested" gap named in
// docs/BLOCK_A_LIMITATIONS.md / docs/BLOCK_A_CAPABILITY_MATRIX.md: custom.boolean,
// custom.create_component_set, custom.instance_swap, custom.styles (text/effect/grid kinds),
// custom.component_property. Each gets its own real-Figma assertion, not just "the call didn't throw."
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-close-gaps" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 250)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 1800));
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
  await waitForPlugin();
  results.steps.push({ step: "pair", ok: true });

  // ---- Scratch composition: 2 overlapping shapes (for boolean) + 2 named components (for component_set) ----
  const built = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "gap-wrap",
        type: "frame",
        name: "Gap Closure Scratch",
        width: 500,
        height: 400,
        children: [
          { id: "gap-circle-a", type: "ellipse", x: 20, y: 20, width: 60, height: 60, fill: { type: "solid", color: "#5b8def" } },
          { id: "gap-circle-b", type: "ellipse", x: 50, y: 20, width: 60, height: 60, fill: { type: "solid", color: "#5b8def" } },
          { id: "gap-comp-a", type: "component", name: "State=Default", x: 20, y: 120, width: 80, height: 40, fill: { type: "solid", color: "#232a3d" } },
          { id: "gap-comp-b", type: "component", name: "State=Hover", x: 120, y: 120, width: 80, height: 40, fill: { type: "solid", color: "#2f3a55" } },
          { id: "gap-text", type: "text", text: "Boolean+Variants scratch", x: 20, y: 200, width: 300, height: 30, font: { family: "Inter", size: 14 } }
        ]
      }
    }
  });
  const ids = built.result?.ids || {};
  const wrapId = ids["gap-wrap"];
  results.steps.push({ step: "build scratch composition", ok: built.ok === true && !!wrapId });
  if (wrapId) cleanupIds.push(wrapId);
  if (!ids["gap-circle-a"]) throw new Error("build failed, cannot continue");

  // ---- custom.boolean: combine 2 overlapping circles into a real BooleanOperationNode ----
  const boolResult = await execute("custom.boolean", { op: "union", nodeIds: [ids["gap-circle-a"], ids["gap-circle-b"]], resultKey: "gap-boolean-test" });
  const boolNodeId = boolResult.result?.resultNodeId;
  const boolRead = await execute("custom.node.read", { nodeId: boolNodeId, depth: 0, include: ["metadata"] });
  results.steps.push({
    step: "custom.boolean: union of 2 real ellipses creates a genuine BOOLEAN_OPERATION node",
    ok: boolResult.ok === true && !!boolNodeId && boolRead.ok === true && boolRead.result?.doc?.type === "BOOLEAN_OPERATION"
  });

  // ---- custom.create_component_set: combine the 2 named components into a real COMPONENT_SET ----
  const setResult = await execute("custom.create_component_set", { componentNodeIds: [ids["gap-comp-a"], ids["gap-comp-b"]], name: "Button", operationKey: "gap-component-set-test" });
  const setId = setResult.result?.componentSetId;
  const setRead = await execute("custom.node.read", { nodeId: setId, depth: 1, include: ["metadata", "component"] });
  results.steps.push({
    step: "custom.create_component_set: 2 real components combined into a genuine COMPONENT_SET with 2 variants",
    ok: setResult.ok === true && !!setId && setRead.ok === true && setRead.result?.doc?.type === "COMPONENT_SET" && setResult.result?.variants?.length === 2
  });

  // ---- Idempotency check on create_component_set (same operationKey should reuse) ----
  const setResultAgain = await execute("custom.create_component_set", { componentNodeIds: [ids["gap-comp-a"], ids["gap-comp-b"]], name: "Button", operationKey: "gap-component-set-test" });
  results.steps.push({
    step: "custom.create_component_set idempotency: same operationKey reuses the existing set instead of duplicating",
    ok: setResultAgain.ok === true && setResultAgain.result?.reused === true && setResultAgain.result?.componentSetId === setId
  });

  // ---- custom.instance_swap: create an instance of comp-a, then swap it to point at comp-b ----
  const instance = await execute("custom.create_instance", { componentId: ids["gap-comp-a"], parentId: wrapId, x: 250, y: 20 });
  const instanceId = instance.result?.instanceId;
  const beforeSwap = await execute("custom.node.read", { nodeId: instanceId, depth: 0, include: ["component"] });
  const swapped = await execute("custom.instance_swap", { instanceId, componentId: ids["gap-comp-b"] });
  const afterSwap = await execute("custom.node.read", { nodeId: instanceId, depth: 0, include: ["component"] });
  results.steps.push({
    step: "custom.instance_swap: instance's mainComponentId genuinely changes from comp-a to comp-b",
    ok:
      swapped.ok === true &&
      swapped.result?.mainComponentId === ids["gap-comp-b"] &&
      beforeSwap.result?.doc?.mainComponentId === ids["gap-comp-a"] &&
      afterSwap.result?.doc?.mainComponentId === ids["gap-comp-b"]
  });

  // ---- custom.styles: text style create+apply ----
  const textStyleName = `Gap Test Text Style ${Date.now()}`;
  const textStyleCreate = await execute("custom.styles", { kind: "text", action: "create", name: textStyleName, font: { family: "Inter", weight: 700, size: 24 } });
  const textStyleApply = await execute("custom.styles", { kind: "text", action: "apply", name: textStyleName, nodeId: ids["gap-text"] });
  const readAfterTextStyle = await execute("custom.node.read", { nodeId: ids["gap-text"], depth: 0, include: ["styles"] });
  results.steps.push({
    step: "custom.styles (text): real TextStyle created and applied — node's textStyleId is genuinely set",
    ok: textStyleCreate.ok === true && textStyleApply.ok === true && readAfterTextStyle.ok === true && !!readAfterTextStyle.result?.doc?.textStyleId
  });

  // ---- custom.styles: effect style create+apply ----
  const effectStyleName = `Gap Test Effect Style ${Date.now()}`;
  const effectStyleCreate = await execute("custom.styles", { kind: "effect", action: "create", name: effectStyleName, effects: [{ type: "drop-shadow", x: 0, y: 4, blur: 12, color: "#000000", opacity: 0.4 }] });
  const effectStyleApply = await execute("custom.styles", { kind: "effect", action: "apply", name: effectStyleName, nodeId: ids["gap-comp-a"] });
  const readAfterEffectStyle = await execute("custom.node.read", { nodeId: ids["gap-comp-a"], depth: 0, include: ["styles"] });
  results.steps.push({
    step: "custom.styles (effect): real EffectStyle created and applied — node's effectStyleId is genuinely set",
    ok: effectStyleCreate.ok === true && effectStyleApply.ok === true && readAfterEffectStyle.ok === true && !!readAfterEffectStyle.result?.doc?.effectStyleId
  });

  // ---- custom.styles: grid style create ----
  const gridStyleName = `Gap Test Grid Style ${Date.now()}`;
  const gridStyleCreate = await execute("custom.styles", { kind: "grid", action: "create", name: gridStyleName, layoutGrids: [{ pattern: "columns", alignment: "stretch", gutter: 20, count: 12 }] });
  const listGridStyles = await execute("custom.styles", { kind: "grid", action: "list" });
  results.steps.push({
    step: "custom.styles (grid): real GridStyle created and enumerable via list",
    ok: gridStyleCreate.ok === true && !!gridStyleCreate.result?.styleId && listGridStyles.ok === true && listGridStyles.result?.styles?.some((s) => s.id === gridStyleCreate.result.styleId)
  });

  // ---- custom.component_property: add a real property definition to the component set ----
  const propAdd = await execute("custom.component_property", { nodeId: setId, action: "add", name: "Disabled", propType: "BOOLEAN", defaultValue: false });
  const propertyId = propAdd.result?.propertyId;
  const propList = await execute("custom.component_property", { nodeId: setId, action: "list" });
  results.steps.push({
    step: "custom.component_property: real BOOLEAN property definition added and enumerable",
    ok: propAdd.ok === true && !!propertyId && propList.ok === true && Object.keys(propList.result?.definitions || {}).includes(propertyId)
  });

  const propEdit = await execute("custom.component_property", { nodeId: setId, action: "edit", propertyId, options: { name: "IsDisabled" } });
  results.steps.push({ step: "custom.component_property: edit genuinely renames the property", ok: propEdit.ok === true && Object.keys(propEdit.result?.definitions || {}).some((k) => k.startsWith("IsDisabled")) });

  // ---- Cleanup ----
  let cleanupOk = true;
  for (const id of cleanupIds) {
    const del = await execute("custom.delete_node", { nodeId: id });
    if (!del.ok) cleanupOk = false;
  }
  // Styles are file-level assets, not nodes under the scratch frame — clean those up too.
  await execute("custom.styles", { kind: "text", action: "delete", name: textStyleName });
  await execute("custom.styles", { kind: "effect", action: "delete", name: effectStyleName });
  await execute("custom.styles", { kind: "grid", action: "delete", name: gridStyleName });
  results.steps.push({ step: "cleanup: scratch nodes and scratch styles removed", ok: cleanupOk });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== GAP-CLOSURE SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nGAP CLOSURE: PASS" : "\nGAP CLOSURE: FAIL");
  writeFileSync(new URL("./block-a-close-gaps-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-close-gaps-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
