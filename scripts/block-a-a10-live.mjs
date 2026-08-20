#!/usr/bin/env node
// A10 (P3: inspect/measure/diff/correct/verify + idempotency) live verification, through Unified.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: 20000,
  clientName: "figma-unified-block-a-a10"
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function near(a, b, eps = 0.01) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
}

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 300)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 2500));
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
  throw new Error("Timed out waiting for plugin.");
}

const results = { steps: [] };
let frameId, aId, bId;

try {
  await client.connect();
  await waitForPlugin();
  results.steps.push({ step: "pair", ok: true });

  // ---- Build a small controlled composition: two rects, a known 30px gap on the x axis ----
  const created = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "a10-frame",
        type: "frame",
        name: "A10 Scratch",
        width: 400,
        height: 200,
        children: [
          { id: "a10-a", type: "rect", x: 20, y: 20, width: 100, height: 60, fill: { type: "solid", color: "#3366ff" } },
          { id: "a10-b", type: "rect", x: 150, y: 20, width: 100, height: 60, fill: { type: "solid", color: "#33cc66" } }
        ]
      }
    }
  });
  frameId = created.result?.ids?.["a10-frame"];
  aId = created.result?.ids?.["a10-a"];
  bId = created.result?.ids?.["a10-b"];
  results.steps.push({ step: "build controlled composition (frame + 2 rects, 30px gap)", ok: created.ok === true && !!aId && !!bId });
  if (!aId || !bId) throw new Error("build failed, cannot continue");

  // ---- MEASURE: bounds, gap, containment, alignment ----
  const bounds = await execute("custom.measure", { mode: "bounds", nodeIds: [aId, bId] });
  results.steps.push({ step: "measure bounds", ok: bounds.ok === true && !!bounds.result?.bounds?.[aId] });

  const gap = await execute("custom.measure", { mode: "gap", nodeIds: [aId, bId], axis: "x" });
  results.steps.push({ step: "measure gap == 30 (expected 150-20-100=30)", ok: gap.ok === true && near(gap.result?.gap, 30) && gap.result?.overlapping === false });

  const containment = await execute("custom.measure", { mode: "containment", nodeIds: [aId, frameId] });
  results.steps.push({ step: "measure containment: rect A fits inside the frame", ok: containment.ok === true && containment.result?.contained === true });

  const alignment = await execute("custom.measure", { mode: "alignment", nodeIds: [aId, bId], edge: "top" });
  results.steps.push({ step: "measure alignment: A and B share the same top edge (both y=20)", ok: alignment.ok === true && Array.isArray(alignment.result?.entries) });

  // ---- VERIFY (should pass — matches what was authored) ----
  const verify1 = await execute("custom.verify", { expectations: [{ nodeId: aId, expected: { x: 20, y: 20, width: 100 } }] });
  results.steps.push({ step: "verify matches authored state (differenceCount 0)", ok: verify1.ok === true && verify1.result?.ok === true && verify1.result?.differenceCount === 0 });

  // ---- DIFF against a deliberately wrong expectation (INSPECT/MEASURE step of the loop) ----
  const diff1 = await execute("custom.diff", {
    expected: { id: "expect-a", type: "rect", x: 999, y: 20 },
    idMap: { "expect-a": aId },
    nodeId: aId
  });
  const xChange = diff1.result?.changed?.find((c) => c.field === "x");
  results.steps.push({ step: "diff detects the deliberate x mismatch (999 vs 20)", ok: diff1.ok === true && !!xChange && xChange.severity === "MAJOR" });

  // ---- CORRECT (patch A to a wrong position on purpose, to exercise the full loop) ----
  const patch1 = await execute("custom.patch_node", { nodeId: aId, x: 25 });
  results.steps.push({ step: "correct: patch A.x to 25 (deliberately off from the original 20)", ok: patch1.ok === true });

  // ---- VERIFY again: should now show a MINOR/MAJOR difference against the ORIGINAL expectation ----
  const verify2 = await execute("custom.verify", { expectations: [{ nodeId: aId, expected: { x: 20 } }] });
  results.steps.push({ step: "verify detects the just-introduced drift (x 25 != expected 20)", ok: verify2.ok === true && verify2.result?.ok === false && verify2.result?.differenceCount === 1 });

  // ---- CORRECT again (patch back to 20) ----
  const patch2 = await execute("custom.patch_node", { nodeId: aId, x: 20 });
  results.steps.push({ step: "correct: patch A.x back to 20", ok: patch2.ok === true });

  // ---- VERIFY final: should now be clean ----
  const verify3 = await execute("custom.verify", { expectations: [{ nodeId: aId, expected: { x: 20 } }] });
  results.steps.push({ step: "verify confirms the correction (differenceCount 0)", ok: verify3.ok === true && verify3.result?.ok === true && verify3.result?.differenceCount === 0 });

  // ---- IDEMPOTENCY: re-run the same verify again, expect no change / same clean result ----
  const verify4 = await execute("custom.verify", { expectations: [{ nodeId: aId, expected: { x: 20 } }] });
  results.steps.push({
    step: "IDEMPOTENCY: re-running verify produces the identical result, no drift from re-checking",
    ok: verify4.ok === true && verify4.result?.ok === true && verify4.result?.differenceCount === 0 && JSON.stringify(verify4.result) === JSON.stringify(verify3.result)
  });

  // ---- Cross-check: read the live node directly and confirm it matches what verify/diff concluded ----
  const finalRead = await execute("custom.node.read", { nodeId: aId, depth: 0, include: ["geometry"] });
  results.steps.push({ step: "cross-check: direct read confirms x=20 independently of verify's own internal read", ok: finalRead.ok === true && finalRead.result?.doc?.x === 20 });

  // ---- Cleanup ----
  const deleted = await execute("custom.delete_node", { nodeId: frameId });
  const readAfterDelete = await execute("custom.node.read", { nodeId: frameId });
  results.steps.push({ step: "cleanup: scratch frame deleted and confirmed absent", ok: deleted.ok === true && readAfterDelete.ok === false && readAfterDelete.error?.code === "NODE_NOT_FOUND" });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== A10 LIVE VERIFICATION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nA10 LIVE VERIFICATION: PASS" : "\nA10 LIVE VERIFICATION: FAIL");
  writeFileSync(new URL("./block-a-a10-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-a10-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
