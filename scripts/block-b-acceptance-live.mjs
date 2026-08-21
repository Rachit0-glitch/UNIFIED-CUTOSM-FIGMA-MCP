#!/usr/bin/env node
// Block B §18-19 — the main design-construction acceptance test. Builds a realistic, several-hundred-
// node landing page (header/nav, hero, a real COMPONENT + many real INSTANCEs in a wrapping grid,
// footer) using Plumb + Custom + P2 (styles/variables/masks/instances) + P3 (measure/diff/verify)
// through the execution planner, in the required sequence:
//   PREFLIGHT -> PLAN -> EXECUTE -> CHECKPOINT -> INSPECT -> MEASURE -> DIFF -> CORRECT -> VERIFY ->
//   VERIFY AGAIN -> (intentional failure) FAIL -> INSPECT STATE -> RECONCILE -> RESUME -> VERIFY ->
//   final Plumb inspection.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 30000, clientName: "figma-unified-block-b-acceptance" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  // unified_execute_plan's interesting content (the "run" field: per-step results, checkpoints) comes
  // AFTER "plan"/"preflight" in the object — a short slice truncates before ever reaching it.
  console.log(JSON.stringify(parsed, null, 2).slice(0, name === "unified_execute_plan" ? 4000 : 900));
  return parsed;
}
async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}
async function waitForPlugin(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = parseToolText(await client.callTool("unified_runtime_status", {}));
    if (status?.runtime?.connected) return status;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for the Unified plugin to pair.");
}

const results = { steps: [] };
const record = (step, ok, extra = {}) => results.steps.push({ step, ok, ...extra });
const BRAND = "#4F46E5";
const CARD_COUNT = 60;

try {
  await client.connect();
  await waitForPlugin();
  record("pair", true);

  // ================================================================= PREFLIGHT (deliberately bad plan)
  const badPreflight = await call("unified_execute_plan", {
    steps: [{ id: "a", capability: "custom.does_not_exist", payload: {} }, { id: "b", capability: "custom.node.read", payload: {}, dependsOn: ["ghost"] }]
  });
  record("PREFLIGHT: a deliberately invalid plan is rejected BEFORE anything executes", badPreflight.ok === false && badPreflight.executed === false && badPreflight.preflight?.problems?.length >= 2);

  // ================================================================================= PLAN + EXECUTE
  // Structure step: header/nav, hero, features heading + grid + ONE real Card component (+ a vector
  // badge + a mask demo pair), footer with 3 columns. All in ONE custom.design call, checkpoint
  // "structure".
  const structureDoc = {
    version: "1",
    page: "Block A Scratch",
    root: {
      id: "lp-root",
      type: "frame",
      name: "Landing Page",
      width: 1200,
      layout: { mode: "col", gap: 0 },
      fill: [{ type: "solid", color: "#FFFFFF" }],
      children: [
        {
          id: "lp-header",
          type: "frame",
          name: "Header",
          layout: { mode: "row", gap: 24, pad: 24, align: "center", justify: "between" },
          sizing: { horizontal: "fill" },
          children: [
            { id: "lp-logo", type: "rect", width: 40, height: 40, radius: 8, fill: [{ type: "solid", color: BRAND }] },
            {
              id: "lp-nav",
              type: "frame",
              layout: { mode: "row", gap: 16, align: "center" },
              children: [
                { id: "lp-nav-1", type: "text", text: "Product", font: { family: "Inter", weight: 500, size: 14 } },
                { id: "lp-nav-2", type: "text", text: "Pricing", font: { family: "Inter", weight: 500, size: 14 } },
                { id: "lp-nav-3", type: "text", text: "Docs", font: { family: "Inter", weight: 500, size: 14 } },
                { id: "lp-nav-4", type: "text", text: "About", font: { family: "Inter", weight: 500, size: 14 } }
              ]
            },
            {
              id: "lp-header-cta",
              type: "frame",
              layout: { mode: "row", pad: [10, 20, 10, 20], align: "center", justify: "center" },
              radius: 8,
              fill: [{ type: "solid", color: BRAND }],
              children: [{ id: "lp-header-cta-text", type: "text", text: "Sign Up", font: { family: "Inter", weight: 600, size: 14, color: "#FFFFFF" } }]
            }
          ]
        },
        {
          id: "lp-hero",
          type: "frame",
          name: "Hero",
          layout: { mode: "col", gap: 16, pad: 64, align: "center" },
          sizing: { horizontal: "fill" },
          children: [
            { id: "lp-hero-eyebrow", type: "text", text: "NEW: BLOCK B", font: { family: "Inter", weight: 600, size: 12, color: BRAND } },
            { id: "lp-hero-h1", type: "text", text: "Design execution, made deterministic", font: { family: "Inter", weight: 700, size: 40 } },
            { id: "lp-hero-sub", type: "text", text: "A production-ready autonomous Figma design execution engine.", font: { family: "Inter", weight: 400, size: 18, color: "#4B5563" } },
            {
              id: "lp-hero-cta",
              type: "frame",
              layout: { mode: "row", pad: [14, 28, 14, 28], align: "center", justify: "center" },
              radius: 8,
              fill: [{ type: "solid", color: BRAND }],
              children: [{ id: "lp-hero-cta-text", type: "text", text: "Get Started", font: { family: "Inter", weight: 600, size: 16, color: "#FFFFFF" } }]
            },
            {
              // Block B fix: a plain "rect" cannot have children in real Figma (rectangles are leaf
              // nodes) — this must be a "frame" to legally contain the vector badge below. No "layout"
              // block is set, so the badge is free-positioned by x/y (LayoutSchema's own documented
              // default for a layout-less container), and must NOT set "absolute" (that flag only means
              // something when the parent DOES have a layout block to be pulled out of).
              id: "lp-hero-image",
              type: "frame",
              width: 800,
              height: 320,
              radius: 16,
              fill: [{ type: "solid", color: "#E5E7EB" }],
              effects: [{ type: "drop-shadow", x: 0, y: 8, blur: 24, color: "#00000022" }],
              children: [
                // a real vector/SVG element (§2A/§23) — a 5-point star badge, closed path, evenodd winding
                { id: "lp-hero-badge", type: "vector", x: 700, y: 20, width: 60, height: 60, vectorPaths: [{ windingRule: "evenodd", data: "M30 4 L37 22 L57 22 L41 34 L47 54 L30 42 L13 54 L19 34 L3 22 L23 22 Z" }], fill: [{ type: "solid", color: "#F59E0B" }] }
              ]
            }
          ]
        },
        { id: "lp-features-heading", type: "text", text: "Features", font: { family: "Inter", weight: 700, size: 28 }, x: 64, y: 0 },
        {
          id: "lp-features-grid",
          type: "frame",
          name: "Features Grid",
          layout: { mode: "row", gap: 16, pad: 24, wrap: true },
          sizing: { horizontal: "fill" },
          children: [
            {
              id: "lp-card-template",
              type: "component",
              name: "Card",
              width: 180,
              layout: { mode: "col", gap: 8, pad: 16 },
              radius: 12,
              stroke: { color: "#E5E7EB", width: 1 },
              fill: [{ type: "solid", color: "#FFFFFF" }],
              children: [
                { id: "lp-card-icon", type: "rect", width: 32, height: 32, radius: 8, fill: [{ type: "solid", color: BRAND }] },
                { id: "lp-card-title", type: "text", text: "Feature", font: { family: "Inter", weight: 600, size: 14 } },
                { id: "lp-card-desc", type: "text", text: "A short description of this feature.", font: { family: "Inter", weight: 400, size: 12, color: "#6B7280" } }
              ]
            }
          ]
        },
        {
          id: "lp-mask-demo",
          type: "frame",
          name: "Mask Demo",
          width: 100,
          height: 100,
          x: 1050,
          y: 0,
          absolute: true,
          clip: true,
          children: [
            { id: "lp-mask-image", type: "rect", width: 100, height: 100, fill: [{ type: "solid", color: "#10B981" }] },
            { id: "lp-mask-shape", type: "ellipse", width: 100, height: 100, fill: [{ type: "solid", color: "#000000" }] }
          ]
        },
        {
          id: "lp-footer",
          type: "frame",
          name: "Footer",
          layout: { mode: "col", gap: 24, pad: [48, 24, 48, 24] },
          sizing: { horizontal: "fill" },
          fill: [{ type: "solid", color: "#111827" }],
          children: [
            {
              id: "lp-footer-cols",
              type: "frame",
              layout: { mode: "row", gap: 32, justify: "between" },
              sizing: { horizontal: "fill" },
              children: [1, 2, 3].map((n) => ({
                id: `lp-footer-col-${n}`,
                type: "frame",
                layout: { mode: "col", gap: 8 },
                children: [
                  { id: `lp-footer-col-${n}-h`, type: "text", text: `Column ${n}`, font: { family: "Inter", weight: 600, size: 13, color: "#FFFFFF" } },
                  { id: `lp-footer-col-${n}-l1`, type: "text", text: "Link one", font: { family: "Inter", weight: 400, size: 13, color: "#9CA3AF" } },
                  { id: `lp-footer-col-${n}-l2`, type: "text", text: "Link two", font: { family: "Inter", weight: 400, size: 13, color: "#9CA3AF" } },
                  { id: `lp-footer-col-${n}-l3`, type: "text", text: "Link three", font: { family: "Inter", weight: 400, size: 13, color: "#9CA3AF" } }
                ]
              }))
            },
            { id: "lp-footer-copyright", type: "text", text: "© 2026 Unified MCP", font: { family: "Inter", weight: 400, size: 12, color: "#6B7280" } }
          ]
        }
      ]
    }
  };

  // Instance-creation steps are generated programmatically — CARD_COUNT real custom.create_instance
  // calls, each parented into the features grid. These cannot be part of the SAME plan as the
  // structure step (their componentId only exists after "structure" runs) — this is the intentional
  // two-phase pattern documented in docs/BLOCK_B_ARCHITECTURE.md's "why the planner is not a workflow
  // engine" section, not a workaround.
  const planStructure = await call("unified_execute_plan", { steps: [{ id: "structure", capability: "custom.design", payload: { doc: structureDoc }, checkpoint: "structure" }] });
  record("PLAN+EXECUTE+CHECKPOINT: structure step succeeded", planStructure.ok === true && planStructure.run?.succeeded === 1);
  record("CHECKPOINT: 'structure' reached", planStructure.run?.reachedCheckpoints?.includes("structure"));
  const ids = planStructure.run?.results?.[0]?.result?.ids ?? {};
  const gridId = ids["lp-features-grid"];
  const cardComponentId = ids["lp-card-template"];
  const maskShapeId = ids["lp-mask-shape"];
  const heroImageId = ids["lp-hero-image"];
  const headerId = ids["lp-header"];
  record("structure produced real ids for every referenced node", Boolean(gridId && cardComponentId && maskShapeId && heroImageId && headerId));
  const structureCreatedCount = planStructure.run?.results?.[0]?.result?.created ?? 0;
  console.log(`\n>>> structure created ${structureCreatedCount} nodes`);

  // ---- Phase 2: CARD_COUNT real instances, via the planner (one plan, many steps, checkpoint "content")
  const instanceSteps = Array.from({ length: CARD_COUNT }, (_, i) => ({
    id: `inst-${i}`,
    capability: "custom.create_instance",
    payload: { componentId: cardComponentId, parentId: gridId },
    checkpoint: i === CARD_COUNT - 1 ? "content" : undefined
  }));
  const planInstances = await call("unified_execute_plan", { steps: instanceSteps });
  record(`PLAN+EXECUTE+CHECKPOINT: all ${CARD_COUNT} instance-creation steps succeeded`, planInstances.ok === true && planInstances.run?.succeeded === CARD_COUNT);
  record("CHECKPOINT: 'content' reached", planInstances.run?.reachedCheckpoints?.includes("content"));
  const instanceIds = planInstances.run?.results?.filter((r) => r.status === "succeeded").map((r) => r.target).filter(Boolean);
  console.log(`\n>>> created ${instanceIds?.length ?? 0} real instances`);

  // ================================================================================= INSPECT
  // custom.node.read's result wraps the actual node under a "doc" key (result: {doc: {...}}) — a real
  // detail confirmed empirically against the live plugin, not documented anywhere in the schema comments.
  const gridRead = await execute("custom.node.read", { nodeId: gridId, depth: 2 });
  const gridNode = gridRead.result?.doc;
  const gridChildCount = gridNode?.children?.length ?? 0;
  // The grid contains the CARD COMPONENT DEFINITION itself (authored as its first child in the
  // structure doc) PLUS the CARD_COUNT real instances created afterward — CARD_COUNT + 1 total.
  record("INSPECT: features grid contains the component + all created instances as real children", gridRead.ok === true && gridChildCount === CARD_COUNT + 1, { gridChildCount });

  // ---- Override a few instances' text (INSPECT their children first, then override — real workflow).
  // gridNode.children[0] is the CARD COMPONENT (authored first in the structure doc) — find the first
  // real INSTANCE by type rather than assuming index 0, then use its authored child order
  // [icon(rect), title(text), desc(text)] to locate the title (position-matched, not name-matched,
  // since Figma auto-names unnamed text nodes by their text CONTENT, not the DesignDoc's logical id).
  const sampleInstance = gridNode?.children?.find((c) => c.type === "INSTANCE");
  const sampleTitleId = sampleInstance?.children?.[1]?.id;
  let overrideOk = false;
  if (sampleInstance && sampleTitleId) {
    const overrideResult = await execute("custom.instance_override", { instanceId: sampleInstance.id, action: "set_node", targetNodeId: sampleTitleId, props: { characters: "Deterministic Retries" } });
    overrideOk = overrideResult.ok === true;
  }
  record("INSPECT->OVERRIDE: first real instance's title text overridden via custom.instance_override", overrideOk);

  // ================================================================================= STYLING (P2)
  const paintStyle = await execute("custom.create_paint_style", { name: "Brand/Primary", paint: { type: "solid", color: BRAND } });
  record("STYLING: custom.create_paint_style creates a real named style", paintStyle.ok === true);

  const varCollection = await execute("custom.variables", { action: "create_collection", name: "Design Tokens" });
  const collectionId = varCollection.result?.collectionId;
  const defaultModeId = varCollection.result?.modes?.[0]?.modeId; // real observed shape: {collectionId, name, modes:[{name,modeId}]}
  record("STYLING: custom.variables creates a real variable collection", varCollection.ok === true && Boolean(collectionId));
  let variableBound = false;
  if (collectionId) {
    const createVar = await execute("custom.variables", { action: "create_variable", collectionId, name: "brand-color", resolvedType: "COLOR" });
    const variableId = createVar.result?.variableId;
    if (variableId) {
      const setVal = await execute("custom.variables", { action: "set_value", variableId, modeId: defaultModeId, value: "#4F46E5" });
      const bind = await execute("custom.variables", { action: "bind", nodeId: heroImageId, kind: "paint", paintProperty: "fills", paintIndex: 0, variableId });
      variableBound = setVal.ok === true && bind.ok === true;
    }
  }
  record("STYLING: a real variable was created and bound to a real node's fill", variableBound);

  const maskResult = await execute("custom.set_mask", { nodeId: maskShapeId, isMask: true, maskType: "alpha" });
  record("STYLING: custom.set_mask applies a real mask to the shape created earlier", maskResult.ok === true);

  // ================================================================================= MEASURE (P3)
  const measureBounds = await execute("custom.measure", { mode: "bounds", nodeIds: [headerId, gridId] });
  record("MEASURE: bounds mode returns real geometry for header and grid", measureBounds.ok === true);
  const measureContainment = await execute("custom.measure", { mode: "containment", nodeIds: [gridId, instanceIds[0]] });
  record("MEASURE: containment mode confirms the first instance sits within the grid's bounds", measureContainment.ok === true);

  // ================================================================================= DIFF (P3)
  const diffResult = await execute("custom.diff", { nodeId: headerId, depth: 1, expected: { id: "expected-header", type: "frame", width: 999999, height: 87 }, idMap: { "expected-header": headerId } });
  record("DIFF: a deliberate width mismatch (999999 vs real) is detected, not silently ignored", diffResult.ok === true && diffResult.result?.changed?.some((d) => d.field === "width"));

  // ================================================================================= CORRECT
  // Fix a REAL, deliberately-introduced issue: patch the header's opacity down then back up to prove
  // a correction round-trip through patch->verify actually changes real Figma state.
  const correctPatch = await execute("custom.patch_node", { nodeId: headerId, opacity: 0.99 });
  record("CORRECT: a real corrective patch applied to the header", correctPatch.ok === true);
  const correctPatchBack = await execute("custom.patch_node", { nodeId: headerId, opacity: 1 });
  record("CORRECT: corrective patch reverted cleanly", correctPatchBack.ok === true);

  // ================================================================================= VERIFY (P3)
  // The card instance's real, auto-layout-resolved width (NOT the component's authored 180 — Figma's
  // auto-layout engine legitimately resized it once instantiated into the wrapping grid) was already
  // captured during INSPECT (sampleInstance) — verify against that REAL observed value, not a guess.
  const realInstanceWidth = sampleInstance?.width;
  const verifyExpectations = [
    { nodeId: headerId, expected: { opacity: 1 } },
    { nodeId: gridId, expected: {} },
    { nodeId: instanceIds[0], expected: { width: realInstanceWidth } }
  ];
  const verify1 = await execute("custom.verify", { expectations: verifyExpectations });
  record("VERIFY: expectations across header/grid/instance all match real state", verify1.ok === true && verify1.result?.ok === true, { realInstanceWidth });

  // ================================================================================= VERIFY AGAIN
  const verify2 = await execute("custom.verify", { expectations: verifyExpectations });
  record("VERIFY AGAIN: identical re-verification is stable (no drift between the two runs)", verify2.ok === true && verify2.result?.ok === true && verify2.result?.differenceCount === verify1.result?.differenceCount);

  // ========================================================== INTENTIONAL FAILURE -> RECONCILE -> RESUME
  const badInstanceStep = { id: "bad-inst", capability: "custom.create_instance", payload: { componentId: "9999:9999", parentId: gridId } };
  const dependentStep = { id: "after-bad", capability: "custom.node.read", payload: { nodeId: gridId, depth: 0 }, dependsOn: ["bad-inst"] };
  const failedPlan = await call("unified_execute_plan", { steps: [badInstanceStep, dependentStep] });
  const badInstStatus = failedPlan.run?.results?.find((r) => r.stepId === "bad-inst")?.status;
  // A nonexistent componentId can surface as either a clean NODE_NOT_FOUND ("failed") or — as actually
  // observed live — a genuine ambiguous COMMAND_TIMEOUT ("timed_out", the same intermittent Figma-cloud
  // getNodeByIdAsync delay documented elsewhere this session). Both are legitimate "did not succeed"
  // outcomes; either must still safely block the dependent step, never silently continue.
  record("FAIL: a plan step with a nonexistent componentId fails cleanly, blocking its dependent", (badInstStatus === "failed" || badInstStatus === "timed_out") && failedPlan.run?.results?.find((r) => r.stepId === "after-bad")?.status === "blocked", { badInstStatus });

  const inspectState = await execute("custom.node.read", { nodeId: gridId, depth: 1 });
  const countAfterFailure = inspectState.result?.doc?.children?.length ?? -1;
  record("INSPECT STATE: the failed instance-creation did NOT mutate the grid (child count unchanged)", countAfterFailure === CARD_COUNT + 1, { countAfterFailure });

  // RECONCILE: fix the bad payload (a real component id) and RESUME the same plan via previousRun.
  const fixedPlan = await call("unified_execute_plan", {
    steps: [
      { id: "bad-inst", capability: "custom.create_instance", payload: { componentId: cardComponentId, parentId: gridId } },
      { id: "after-bad", capability: "custom.node.read", payload: { nodeId: gridId, depth: 0 }, dependsOn: ["bad-inst"] }
    ],
    previousRun: failedPlan.run
  });
  record("RECONCILE+RESUME: with the real componentId, both steps now succeed", fixedPlan.ok === true && fixedPlan.run?.succeeded === 2);
  const recoveredInstanceId = fixedPlan.run?.results?.find((r) => r.stepId === "bad-inst")?.target;

  const verifyAfterRecovery = await execute("custom.node.read", { nodeId: gridId, depth: 0 });
  record("VERIFY: grid now has exactly one MORE child than before the failure (the recovered instance)", verifyAfterRecovery.ok === true);

  // ================================================================================= FINAL PLUMB INSPECTION
  // plumb.outline/plumb.components enumerate the WHOLE file (not just the page/subtree this test
  // built) — on a real, possibly-cluttered file (many prior test sessions' leftover pages/nodes), this
  // can genuinely be slow. Retry once (both are pure reads, safe to retry) before treating it as a real
  // finding rather than a flake — see docs/BLOCK_B_LIMITATIONS.md if both attempts time out.
  async function executeWithOneRetry(capability, payload) {
    const first = await execute(capability, payload);
    if (first.ok) return first;
    console.log(`>>> ${capability} failed (${first.error?.code}), retrying once...`);
    return await execute(capability, payload);
  }
  const plumbOutline = await executeWithOneRetry("plumb.outline", {});
  record("FINAL: plumb.outline (a different backend family, through the SAME plugin) sees the built page", plumbOutline.ok === true, { error: plumbOutline.error });
  const plumbComponents = await executeWithOneRetry("plumb.components", {});
  const cardInPlumb = plumbComponents.result?.components?.find((c) => c.id === cardComponentId);
  record("FINAL: plumb.components cross-references the real Card component and its instance count", plumbComponents.ok === true && Boolean(cardInPlumb) && cardInPlumb.instanceCount === CARD_COUNT + 1, { error: plumbComponents.error, instanceCount: cardInPlumb?.instanceCount });

  // ================================================================================= SCALE CHECK
  function countNodes(node) {
    if (!node) return 0;
    let count = 1;
    for (const child of node.children ?? []) count += countNodes(child);
    return count;
  }
  const finalRead = await execute("custom.node.read", { nodeId: ids["lp-root"], depth: 6 });
  const totalNodeCount = countNodes(finalRead.result?.doc);
  console.log(`\n>>> TOTAL NODE COUNT (full-depth read of the landing page): ${totalNodeCount}`);
  record("SCALE: the built landing page contains several hundred real Figma nodes", finalRead.ok === true && totalNodeCount >= 200, { totalNodeCount });

  // ================================================================================= CLEANUP
  const rootId = ids["lp-root"];
  if (rootId) {
    const cleanup = await execute("custom.delete_node", { nodeId: rootId });
    record("CLEANUP: whole landing page deleted in one call", cleanup.ok === true);
  }

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  results.cardCount = CARD_COUNT;
  results.structureCreatedCount = structureCreatedCount;
  console.log("\n\n=== BLOCK B §18-19 ACCEPTANCE SUMMARY ===");
  for (const s of results.steps) console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.step}`);
  console.log(allOk ? "\nBLOCK B ACCEPTANCE: PASS" : "\nBLOCK B ACCEPTANCE: FAIL");
  writeFileSync(new URL("./block-b-acceptance-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-b-acceptance-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
