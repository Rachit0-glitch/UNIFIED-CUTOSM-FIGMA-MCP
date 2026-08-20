#!/usr/bin/env node
// A2 (core mutation path) live verification — foundational write test per Block A brief §27/§6:
// create -> read -> update -> read -> delete -> verify absent, through the real Unified plugin.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 25000),
  clientName: "figma-unified-block-a-a2"
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Figma stores several numeric properties (opacity notably) as 32-bit floats internally, so a value
// authored as exactly 0.7 can read back as 0.699999988079071 — real float32 precision loss, not a bug.
// Same lesson Custom MCP's own P3 tolerances already encode; use an epsilon here too.
function near(a, b, eps = 0.001) {
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

async function waitForPlugin(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await client.callTool("unified_runtime_status", {});
    const parsed = parseToolText(status);
    if (parsed?.runtime?.connected) return parsed;
    await sleep(2000);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the Unified plugin to pair.`);
}

const results = { steps: [] };

try {
  await client.connect();
  console.log("Persistent session started. Waiting for the reloaded Unified Runtime plugin to pair...");
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });
  const expectedVersion = "0.4.0-blockA-a2-mutations";
  results.steps.push({
    step: "plugin version reflects the A2 code change",
    ok: paired.runtime.pluginVersion === expectedVersion,
    expected: expectedVersion,
    actual: paired.runtime.pluginVersion
  });

  // ---- dryRun: validate + compile without touching Figma ----
  const dryRun = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "scratch-frame",
        type: "frame",
        name: "A2 Scratch Frame",
        width: 300,
        height: 200,
        fill: { type: "solid", color: "#f2f2f2" },
        radius: 8
      }
    },
    dryRun: true
  });
  results.steps.push({ step: "dryRun compiles without touching Figma", ok: dryRun.ok === true && dryRun.result?.dryRun === true && dryRun.result?.nodeCount === 1 });

  // ---- CREATE: a scratch frame with a child rectangle, on a dedicated scratch page ----
  const created = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "scratch-frame",
        type: "frame",
        name: "A2 Scratch Frame",
        width: 300,
        height: 200,
        fill: { type: "solid", color: "#f2f2f2" },
        radius: 8,
        children: [
          { id: "scratch-rect", type: "rect", name: "A2 Scratch Rect", x: 20, y: 20, width: 100, height: 60, fill: { type: "solid", color: "#3366ff" }, radius: 4 }
        ]
      }
    }
  });
  const rectId = created.result?.ids?.["scratch-rect"];
  const frameId = created.result?.ids?.["scratch-frame"];
  results.steps.push({ step: "CREATE frame+child via custom.design", ok: created.ok === true && created.result?.created === 2 && !!rectId && !!frameId, rectId, frameId });

  if (!rectId) throw new Error("CREATE did not return a rectId — cannot continue the create/read/update/read/delete sequence.");

  // ---- READ (post-create) ----
  const readAfterCreate = await execute("custom.node.read", { nodeId: rectId, depth: 0 });
  const createdRight = readAfterCreate.result?.doc;
  results.steps.push({
    step: "READ after CREATE reflects authored properties",
    ok: readAfterCreate.ok === true && createdRight?.width === 100 && createdRight?.height === 60 && createdRight?.cornerRadius === 4
  });

  // ---- UPDATE via custom.patch_node ----
  const patched = await execute("custom.patch_node", {
    nodeId: rectId,
    x: 50,
    y: 50,
    width: 150,
    opacity: 0.7,
    radius: 12,
    fill: { type: "solid", color: "#ff3366" }
  });
  results.steps.push({ step: "UPDATE via custom.patch_node succeeds", ok: patched.ok === true && patched.result?.patched === true });

  // ---- READ (post-update) ----
  const readAfterUpdate = await execute("custom.node.read", { nodeId: rectId, depth: 0 });
  const updatedRight = readAfterUpdate.result?.doc;
  results.steps.push({
    step: "READ after UPDATE reflects the patched properties (not the original)",
    ok:
      readAfterUpdate.ok === true &&
      updatedRight?.x === 50 &&
      updatedRight?.y === 50 &&
      updatedRight?.width === 150 &&
      near(updatedRight?.opacity, 0.7) &&
      updatedRight?.cornerRadius === 12 &&
      updatedRight?.fills?.[0]?.color?.r > 0.9
  });

  // ---- Invalid patch (unknown node) ----
  const badPatch = await execute("custom.patch_node", { nodeId: "9999:9999", x: 1 });
  results.steps.push({ step: "patch on a nonexistent node returns NODE_NOT_FOUND, not a generic failure", ok: badPatch.ok === false && badPatch.error?.code === "NODE_NOT_FOUND" });

  // ---- REORDER ----
  const reordered = await execute("custom.reorder_node", { nodeId: rectId, to: "back" });
  results.steps.push({ step: "REORDER via custom.reorder_node succeeds", ok: reordered.ok === true && typeof reordered.result?.index === "number" });

  // ---- DELETE ----
  const deleted = await execute("custom.delete_node", { nodeId: rectId });
  results.steps.push({ step: "DELETE via custom.delete_node succeeds", ok: deleted.ok === true && deleted.result?.deleted === true });

  // ---- VERIFY ABSENT ----
  const readAfterDelete = await execute("custom.node.read", { nodeId: rectId });
  results.steps.push({ step: "READ after DELETE confirms the node is gone (NODE_NOT_FOUND)", ok: readAfterDelete.ok === false && readAfterDelete.error?.code === "NODE_NOT_FOUND" });

  // ---- Cleanup: delete the scratch frame too, verify absent ----
  const deletedFrame = await execute("custom.delete_node", { nodeId: frameId });
  const readFrameAfterDelete = await execute("custom.node.read", { nodeId: frameId });
  results.steps.push({
    step: "Cleanup: scratch frame deleted and confirmed absent",
    ok: deletedFrame.ok === true && readFrameAfterDelete.ok === false && readFrameAfterDelete.error?.code === "NODE_NOT_FOUND"
  });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== A2 LIVE VERIFICATION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nA2 LIVE VERIFICATION: PASS" : "\nA2 LIVE VERIFICATION: FAIL");
  writeFileSync(new URL("./block-a-a2-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-a2-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
