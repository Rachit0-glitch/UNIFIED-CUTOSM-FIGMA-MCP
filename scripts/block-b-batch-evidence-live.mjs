#!/usr/bin/env node
// Block B §2B — real evidence for the figma_batch decision. Fires a realistic multi-op mutation
// workload (20 sequential custom.patch_node calls against 20 real nodes) through the EXISTING
// unified_execute path (no batch primitive), and measures where the time actually goes: local
// MCP-stdio round trip vs. CommandQueue-enforced serialization vs. the real bridge/Figma round trip.
// If CommandQueue's single-active-lane design already dominates the latency (i.e. per-call overhead is
// small relative to bridge/Figma time), a batch primitive would only shave off the small local part,
// not the dominant cost — which is the evidence this decision needs.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-block-b-batch-evidence" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  return parseToolText(result);
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

const results = { steps: [], perOpMs: [] };
const N = 20;

try {
  await client.connect();
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });

  // Build N real nodes in one bulk custom.design call (the existing, already-efficient bulk-creation
  // primitive) so the batch question is isolated to the MUTATION workload, not creation.
  const children = Array.from({ length: N }, (_, i) => ({ id: `batch-n${i}`, type: "rect", width: 20, height: 20, x: i * 25, y: 0 }));
  const t0 = Date.now();
  const built = await execute("custom.design", { doc: { version: "1", page: "Block A Scratch", root: { id: "batch-wrap", type: "frame", width: N * 25 + 20, height: 60, children } } });
  const createMs = Date.now() - t0;
  results.steps.push({ step: `bulk-create ${N} nodes via custom.design (1 call)`, ok: built.ok === true, elapsedMs: createMs, msPerNode: +(createMs / N).toFixed(2) });
  const wrapId = built.result?.ids?.["batch-wrap"];
  const nodeIds = Array.from({ length: N }, (_, i) => built.result?.ids?.[`batch-n${i}`]);

  // Now the actual §2B question: N SEPARATE mutations (patch_node), each a distinct unified_execute
  // call — exactly what a caller does today without a batch primitive. Measure wall time per call.
  console.log(`\n--- ${N} sequential custom.patch_node calls (no batch primitive) ---`);
  const seqStart = Date.now();
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const r = await execute("custom.patch_node", { nodeId: nodeIds[i], x: i * 25, y: 40, opacity: 0.8 });
    const elapsed = Date.now() - t;
    results.perOpMs.push({ i, elapsed, ok: r.ok });
  }
  const seqTotal = Date.now() - seqStart;
  const avg = results.perOpMs.reduce((s, r) => s + r.elapsed, 0) / N;
  const allOk = results.perOpMs.every((r) => r.ok);
  results.steps.push({
    step: `${N} sequential patch_node mutations`,
    ok: allOk,
    totalMs: seqTotal,
    avgMsPerOp: +avg.toFixed(2),
    minMs: Math.min(...results.perOpMs.map((r) => r.elapsed)),
    maxMs: Math.max(...results.perOpMs.map((r) => r.elapsed))
  });

  // Fire the SAME N mutations concurrently (Promise.all) to see how much CommandQueue's single-active
  // lane already flattens concurrent submission into the same effective serialized time.
  console.log(`\n--- ${N} CONCURRENT custom.patch_node calls (Promise.all, no batch primitive) ---`);
  const concStart = Date.now();
  const concResults = await Promise.all(nodeIds.map((id, i) => execute("custom.patch_node", { nodeId: id, x: i * 25, y: 45, opacity: 1 })));
  const concTotal = Date.now() - concStart;
  const concOk = concResults.every((r) => r.ok);
  results.steps.push({
    step: `${N} CONCURRENT patch_node mutations via Promise.all`,
    ok: concOk,
    totalMs: concTotal,
    note: "if concTotal is close to seqTotal, CommandQueue's single-active-lane already serializes everything server-side — a batch primitive could not meaningfully speed this up, only reduce the small local MCP round-trip count."
  });

  results.comparison = {
    sequentialTotalMs: seqTotal,
    concurrentTotalMs: concTotal,
    ratio: +(concTotal / seqTotal).toFixed(3),
    interpretation: concTotal / seqTotal > 0.85 ? "concurrent submission gained little over sequential — CommandQueue is the real bottleneck, not per-call MCP overhead" : "concurrent submission was meaningfully faster — some real per-call overhead exists outside the queue"
  };

  // Cleanup
  await execute("custom.delete_node", { nodeId: wrapId });

  const allStepsOk = results.steps.every((s) => s.ok);
  results.ok = allStepsOk;
  console.log("\n=== BLOCK B §2B BATCH EVIDENCE SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`, JSON.stringify(step));
  console.log("comparison:", JSON.stringify(results.comparison, null, 2));
  writeFileSync(new URL("./block-b-batch-evidence-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allStepsOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-b-batch-evidence-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
