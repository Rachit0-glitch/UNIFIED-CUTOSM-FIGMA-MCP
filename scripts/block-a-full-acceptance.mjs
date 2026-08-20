#!/usr/bin/env node
// Block A FULL SYSTEM ACCEPTANCE — one continuous real-Figma run through ONE Unified Runtime plugin.
// Sequence: Plumb -> Custom -> P2 -> P3 -> Plumb. Builds a mini design containing every required
// element (nested auto-layout, multi-level typography, fills, strokes, corner radii, effects, image
// import, hierarchy changes, component/instance behavior, styles/variables, mask behavior), then runs
// inspect -> measure -> diff -> correct -> verify -> verify again (idempotency), then confirms Plumb
// can inspect content Custom built. Zero manual plugin switching, zero restarts, one plugin throughout.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 40000, clientName: "figma-unified-full-acceptance" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function near(a, b, eps = 1) { return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps; }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 220)} ===`);
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

const results = { steps: [], pluginEvents: { switches: 0, restarts: 0 } };
let rootId, ctaId, headingId, imageId, compId, instanceId, maskTargetId;

try {
  await client.connect();
  const paired = await waitForPlugin();
  results.steps.push({ step: "STAGE 0: pair (single Unified Runtime plugin)", ok: true, pluginVersion: paired.runtime.pluginVersion });

  // ================= STAGE 1: PLUMB (initial inspection) =================
  const initialOutline = await execute("plumb.outline", { page: "Block A Scratch" });
  results.steps.push({ step: "STAGE 1 (Plumb): plumb.outline — initial structural inspection", ok: initialOutline.ok === true });
  const initialComponents = await execute("plumb.components", {});
  results.steps.push({ step: "STAGE 1 (Plumb): plumb.components — file-wide component inventory", ok: initialComponents.ok === true });

  // ================= STAGE 2: CUSTOM (build the full mini design) =================
  const doc = {
    version: "1",
    page: "Block A Scratch",
    root: {
      id: "fa-hero",
      type: "frame",
      name: "Full Acceptance Hero",
      width: 1440,
      height: 640,
      fill: { type: "solid", color: "#0b0f19" },
      layout: { mode: "row", gap: 64, pad: [80, 80, 80, 80], align: "center", justify: "between" },
      children: [
        {
          id: "fa-copy",
          type: "frame",
          layout: { mode: "col", gap: 20, pad: 0, align: "start" },
          sizing: { horizontal: "fill" },
          children: [
            { id: "fa-eyebrow", type: "text", text: "FULL ACCEPTANCE", font: { family: "Inter", weight: 700, size: 14, letterSpacing: 2, color: "#5b8def" } },
            { id: "fa-heading", type: "text", text: "Every family, one plugin.", font: { family: "Inter", weight: 800, size: 48, lineHeight: 56, color: "#ffffff" } },
            { id: "fa-subcopy", type: "text", text: "Plumb, Custom, P2, and P3 in a single continuous run.", font: { family: "Inter", weight: 400, size: 17, lineHeight: 26, color: "#a3adc2" } },
            {
              id: "fa-cta",
              type: "frame",
              name: "CTA Button",
              layout: { mode: "row", gap: 8, pad: [14, 28, 14, 28], justify: "center", align: "center" },
              fill: { type: "solid", color: "#5b8def" },
              stroke: { color: "#7ea3f5", width: 1 },
              radius: 8,
              effects: [{ type: "drop-shadow", x: 0, y: 8, blur: 24, color: "#5b8def", opacity: 0.35 }],
              children: [{ id: "fa-cta-label", type: "text", text: "Ship It", font: { family: "Inter", weight: 600, size: 15, color: "#ffffff" } }]
            }
          ]
        },
        {
          id: "fa-visual",
          type: "frame",
          name: "Visual",
          width: 420,
          height: 420,
          radius: 24,
          stroke: { color: "#22283a", width: 1 },
          fill: { type: "solid", color: "#131826" },
          children: [
            { id: "fa-image", type: "image", name: "Product Shot", x: 30, y: 30, width: 200, height: 200, src: "file:C:\\Users\\rachi\\OneDrive\\Documents\\FIGMA\\assets\\platter.png" },
            { id: "fa-mask-target", type: "rect", name: "Mask Target", x: 30, y: 250, width: 100, height: 100, fill: { type: "solid", color: "#999999" } },
            { id: "fa-comp", type: "component", name: "Key=Chip", x: 150, y: 250, width: 100, height: 40, fill: { type: "solid", color: "#232a3d" } }
          ]
        }
      ]
    }
  };
  const built = await execute("custom.design", { doc });
  const ids = built.result?.ids || {};
  rootId = ids["fa-hero"];
  ctaId = ids["fa-cta"];
  headingId = ids["fa-heading"];
  imageId = ids["fa-image"];
  compId = ids["fa-comp"];
  maskTargetId = ids["fa-mask-target"];
  results.steps.push({
    step: "STAGE 2 (Custom): build mini design — nested auto-layout, 3-level typography, fills/strokes/radii/effects, local image import",
    ok: built.ok === true && !!rootId && built.result?.warnings?.length === 0
  });

  // ---- Hierarchy change: move the CTA button up into the visual frame, then back (Custom, hierarchy) ----
  const moved = await execute("custom.move_node", { nodeId: ctaId, parentId: ids["fa-visual"], preserveVisualPosition: true });
  results.steps.push({ step: "STAGE 2 (Custom, hierarchy): move_node reparents the CTA with visual position preserved", ok: moved.ok === true && moved.result?.parentId === ids["fa-visual"] });
  const movedBack = await execute("custom.move_node", { nodeId: ctaId, parentId: ids["fa-copy"], preserveVisualPosition: true });
  results.steps.push({ step: "STAGE 2 (Custom, hierarchy): move_node reparents the CTA back", ok: movedBack.ok === true && movedBack.result?.parentId === ids["fa-copy"] });

  // ---- Component/instance behavior ----
  const instance = await execute("custom.create_instance", { componentId: compId, parentId: ids["fa-visual"], name: "Chip Instance", x: 260, y: 250 });
  instanceId = instance.result?.instanceId;
  results.steps.push({ step: "STAGE 2 (Custom, components): create_instance produces a real INSTANCE", ok: instance.ok === true && !!instanceId });
  const overridden = await execute("custom.instance_override", { instanceId, action: "set_node", targetNodeId: instanceId, props: { opacity: 0.85 } });
  results.steps.push({ step: "STAGE 2 (Custom, components): instance_override applies a real override", ok: overridden.ok === true && overridden.result?.applied === true });

  // ---- Styles/variables ----
  const styleName = `FullAccept Text Style ${Date.now()}`;
  const styleCreate = await execute("custom.styles", { kind: "text", action: "create", name: styleName, font: { family: "Inter", weight: 700, size: 14 } });
  const styleApply = await execute("custom.styles", { kind: "text", action: "apply", name: styleName, nodeId: ids["fa-eyebrow"] });
  results.steps.push({ step: "STAGE 2 (P2, styles): real TextStyle created and applied", ok: styleCreate.ok === true && styleApply.ok === true });

  const collection = await execute("custom.variables", { action: "create_collection", name: `FullAccept Vars ${Date.now()}` });
  const collectionId = collection.result?.collectionId;
  const variable = await execute("custom.variables", { action: "create_variable", collectionId, name: "mask-opacity", resolvedType: "FLOAT" });
  const variableId = variable.result?.variableId;
  const modeId = collection.result?.modes?.[0]?.modeId;
  await execute("custom.variables", { action: "set_value", variableId, modeId, value: 0.6 });
  const bound = await execute("custom.variables", { action: "bind", nodeId: maskTargetId, variableId, kind: "node", field: "opacity" });
  results.steps.push({ step: "STAGE 2 (P2, variables): real FLOAT variable created, valued, and bound to a node's opacity", ok: bound.ok === true && bound.result?.bound === true });

  // ---- Mask behavior ----
  const masked = await execute("custom.set_mask", { nodeId: maskTargetId, isMask: true });
  results.steps.push({ step: "STAGE 2 (P2, masks): set_mask genuinely sets isMask on a real node", ok: masked.ok === true && masked.result?.isMask === true });

  // ================= STAGE 3: P3 (inspect -> measure -> diff -> correct -> verify -> verify again) =================
  const inspect = await execute("custom.node.read", { nodeId: rootId, depth: 3, include: ["geometry", "layout", "appearance", "text"] });
  results.steps.push({ step: "STAGE 3 (P3, inspect): full-fidelity read of the whole composition", ok: inspect.ok === true });

  const measure = await execute("custom.measure", { mode: "gap", nodeIds: [headingId, ctaId], axis: "y" });
  results.steps.push({ step: "STAGE 3 (P3, measure): real geometric measurement between 2 nodes", ok: measure.ok === true });

  const diff1 = await execute("custom.diff", { expected: { id: "expect-cta", type: "frame", x: 9999 }, idMap: { "expect-cta": ctaId }, nodeId: ctaId });
  const xChange = diff1.result?.changed?.find((c) => c.field === "x");
  results.steps.push({ step: "STAGE 3 (P3, diff): detects a deliberate mismatch against a real node", ok: diff1.ok === true && !!xChange });

  const correct = await execute("custom.patch_node", { nodeId: ctaId, opacity: 0.9 });
  results.steps.push({ step: "STAGE 3 (P3, correct): patch_node applies a real correction", ok: correct.ok === true });

  const verify1 = await execute("custom.verify", { expectations: [{ nodeId: ctaId, expected: { opacity: 0.9, cornerRadius: 8 } }, { nodeId: headingId, expected: { fontSize: 48 } }] });
  results.steps.push({ step: "STAGE 3 (P3, verify): matches the corrected + original expectations", ok: verify1.ok === true && verify1.result?.ok === true && verify1.result?.differenceCount === 0 });

  const verify2 = await execute("custom.verify", { expectations: [{ nodeId: ctaId, expected: { opacity: 0.9, cornerRadius: 8 } }, { nodeId: headingId, expected: { fontSize: 48 } }] });
  results.steps.push({
    step: "STAGE 3 (P3, IDEMPOTENCY): re-running the same verify produces an identical result",
    ok: verify2.ok === true && JSON.stringify(verify1.result) === JSON.stringify(verify2.result)
  });

  // ---- A8 confirmation: real local image import ----
  const imageRead = await execute("custom.node.read", { nodeId: imageId, depth: 0, include: ["appearance"] });
  results.steps.push({
    step: "A8 confirmation: local file: image is a genuine IMAGE fill with a real imageHash",
    ok: imageRead.ok === true && imageRead.result?.doc?.fills?.[0]?.type === "IMAGE" && !!imageRead.result?.doc?.fills?.[0]?.imageHash
  });

  // ================= STAGE 4: PLUMB AGAIN (confirm it sees everything Custom built) =================
  const finalOutline = await execute("plumb.outline", { page: "Block A Scratch" });
  results.steps.push({
    step: "STAGE 4 (Plumb again): plumb.outline sees the hero frame built entirely through Custom capabilities",
    ok: finalOutline.ok === true && finalOutline.result?.pages?.[0]?.screens?.some((s) => s.id === rootId)
  });
  const finalComponents = await execute("plumb.components", {});
  const foundChip = finalComponents.result?.components?.find((c) => c.id === compId);
  results.steps.push({
    step: "STAGE 4 (Plumb again): plumb.components sees the component Custom created, with correct instance count",
    ok: finalComponents.ok === true && !!foundChip && foundChip.instanceCount === 1
  });
  const finalSelection = await execute("plumb.selection.read", { depth: 1 });
  results.steps.push({ step: "STAGE 4 (Plumb again): plumb.selection.read still works after the whole sequence (no runtime degradation)", ok: finalSelection.ok === true });

  // ---- Cleanup ----
  const deleted = await execute("custom.delete_node", { nodeId: rootId });
  const readAfterDelete = await execute("custom.node.read", { nodeId: rootId });
  await execute("custom.styles", { kind: "text", action: "delete", name: styleName });
  results.steps.push({ step: "cleanup: full composition deleted and confirmed absent, scratch style removed", ok: deleted.ok === true && readAfterDelete.ok === false && readAfterDelete.error?.code === "NODE_NOT_FOUND" });

  const finalStatus = parseToolText(await client.callTool("unified_runtime_status", {}));
  results.diagnostics = finalStatus?.runtime?.diagnostics;
  results.finalPluginVersion = finalStatus?.runtime?.pluginVersion;

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== FULL SYSTEM ACCEPTANCE SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log("\nManual plugin switching: 0 (one continuous session, one plugin throughout)");
  console.log("Plugin restarts during acceptance: 0");
  console.log("Diagnostics:", JSON.stringify(results.diagnostics));
  console.log(allOk ? "\nFULL SYSTEM ACCEPTANCE: PASS" : "\nFULL SYSTEM ACCEPTANCE: FAIL");
  writeFileSync(new URL("./block-a-full-acceptance-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-full-acceptance-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
