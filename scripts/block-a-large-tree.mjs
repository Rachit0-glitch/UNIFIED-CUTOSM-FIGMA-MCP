#!/usr/bin/env node
// Block A large-tree stress test (500-1000 nodes, brief §3). Real measurements only — nothing here is
// fabricated. Builds a genuine card-grid composition, then exercises reads/measure/diff/verify/correct/
// idempotency/cross-family against it, recording actual durationMs and payload sizes throughout.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 100000, clientName: "figma-unified-large-tree" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitForPlugin(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = parseToolText(await client.callTool("unified_runtime_status", {}));
    if (status?.runtime?.connected) return status;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for the Unified plugin to pair.");
}
async function timed(name, args) {
  const t0 = Date.now();
  const result = parseToolText(await client.callTool(name, args));
  const elapsed = Date.now() - t0;
  const bytes = JSON.stringify(result).length;
  console.log(`[${elapsed}ms, ${bytes}B] ${name} ${JSON.stringify(args).slice(0, 150)}`);
  if (result?.ok === false || result?.result?.ok === false) {
    console.log("  -> ERROR:", JSON.stringify(result?.error || result?.result?.error));
  }
  return { result, elapsed, bytes };
}
async function execute(capability, payload = {}) {
  return await timed("unified_execute", { capability, payload });
}

const CARD_COUNT = 300; // 3 nodes/card (frame+rect+text) + 1 outer wrapper = 901 total nodes
const measurements = [];
const results = { steps: [] };
let rootId;

function buildCardGridDoc() {
  const children = [];
  for (let i = 0; i < CARD_COUNT; i++) {
    children.push({
      id: `card-${i}`,
      type: "frame",
      name: `Card ${i}`,
      width: 160,
      height: 100,
      layout: { mode: "col", gap: 6, pad: 10 },
      fill: { type: "solid", color: i % 2 === 0 ? "#1b2030" : "#232a3d" },
      radius: 6,
      children: [
        { id: `card-${i}-bg`, type: "rect", width: 30, height: 30, fill: { type: "solid", color: "#5b8def" }, radius: 15 },
        { id: `card-${i}-label`, type: "text", text: `Item ${i}`, font: { family: "Inter", weight: 500, size: 13, color: "#ffffff" } }
      ]
    });
  }
  return {
    version: "1",
    page: "Block A Scratch",
    root: {
      id: "large-tree-root",
      type: "frame",
      name: "Large Tree Stress Test",
      width: 1800,
      height: 1400,
      layout: { mode: "row", gap: 12, pad: 20, wrap: true },
      fill: { type: "solid", color: "#0b0f19" },
      children
    }
  };
}

try {
  await client.connect();
  await waitForPlugin();
  results.steps.push({ step: "pair", ok: true });

  const doc = buildCardGridDoc();
  const totalNodesAuthored = 1 + CARD_COUNT * 3;
  console.log(`\nBuilding a ${totalNodesAuthored}-node tree (${CARD_COUNT} cards x 3 nodes + 1 wrapper)...`);

  const build = await execute("custom.design", { doc });
  measurements.push({ op: "build (create mode)", nodeCount: totalNodesAuthored, ...build });
  rootId = build.result?.result?.ids?.["large-tree-root"];
  const actualCreated = build.result?.result?.created;
  results.steps.push({ step: `build ${totalNodesAuthored}-node tree`, ok: build.result?.ok === true && actualCreated === totalNodesAuthored && !!rootId, actualCreated, expectedNodes: totalNodesAuthored, durationMs: build.elapsed });
  if (!rootId) throw new Error("build failed, cannot continue the stress test");

  // ---- Reads at increasing depth ----
  for (const depth of [1, 5, 10, 20]) {
    const read = await execute("custom.node.read", { nodeId: rootId, depth });
    measurements.push({ op: `read depth=${depth}`, ...read });
    results.steps.push({ step: `read at depth ${depth} succeeds`, ok: read.result?.ok === true, durationMs: read.elapsed, bytes: read.bytes });
  }

  // ---- Read with include filter (should be smaller/faster than unfiltered) ----
  const filteredRead = await execute("custom.node.read", { nodeId: rootId, depth: 20, include: ["metadata"] });
  const unfilteredRead = measurements.find((m) => m.op === "read depth=20");
  measurements.push({ op: "read depth=20, include=[metadata]", ...filteredRead });
  results.steps.push({
    step: "include filter measurably reduces payload size on the large tree",
    ok: filteredRead.result?.ok === true && filteredRead.bytes < unfilteredRead.bytes,
    filteredBytes: filteredRead.bytes,
    unfilteredBytes: unfilteredRead.bytes
  });

  // ---- Plumb outline (structural listing, not deep read) ----
  const outline = await execute("plumb.outline", { page: "Block A Scratch" });
  measurements.push({ op: "plumb.outline", ...outline });
  results.steps.push({ step: "plumb.outline lists the large tree's top-level screen", ok: outline.result?.ok === true && outline.result?.result?.pages?.[0]?.screens?.some((s) => s.id === rootId), durationMs: outline.elapsed });

  // ---- Hierarchy traversal: read a deeply-nested specific node directly ----
  const midCardLabelId = build.result?.result?.ids?.["card-150-label"];
  const deepRead = await execute("custom.node.read", { nodeId: midCardLabelId, depth: 0 });
  measurements.push({ op: "deep single-node read (card 150 label)", ...deepRead });
  results.steps.push({ step: "direct read of a specific deeply-nested node (not a full-tree walk)", ok: deepRead.result?.ok === true && deepRead.result?.result?.doc?.characters === "Item 150", durationMs: deepRead.elapsed });

  // ---- Measure on 2 real nodes at scale ----
  const cardAId = build.result?.result?.ids?.["card-0"];
  const cardBId = build.result?.result?.ids?.["card-1"];
  const measure = await execute("custom.measure", { mode: "gap", nodeIds: [cardAId, cardBId], axis: "x" });
  measurements.push({ op: "measure gap (2 nodes in an 899-descendant tree)", ...measure });
  results.steps.push({ step: "measure works correctly against nodes inside a large tree", ok: measure.result?.ok === true, durationMs: measure.elapsed });

  // ---- Diff against an authored expectation ----
  const diff = await execute("custom.diff", {
    expected: { id: "expect-card0", type: "frame", radius: 6 },
    idMap: { "expect-card0": cardAId },
    nodeId: cardAId
  });
  measurements.push({ op: "diff (1 node in a large tree)", ...diff });
  results.steps.push({ step: "diff works correctly at scale", ok: diff.result?.ok === true && diff.result?.result?.matched?.length === 1, durationMs: diff.elapsed });

  // ---- CORRECT: patch one card buried in the tree ----
  const patch = await execute("custom.patch_node", { nodeId: cardAId, radius: 20 });
  measurements.push({ op: "patch 1 node in a large tree", ...patch });
  results.steps.push({ step: "patch a single deeply-nested node without touching the rest", ok: patch.result?.ok === true, durationMs: patch.elapsed });

  // ---- VERIFY the correction, then verify sibling untouched (no collateral change) ----
  const verify1 = await execute("custom.verify", { expectations: [{ nodeId: cardAId, expected: { cornerRadius: 20 } }, { nodeId: cardBId, expected: { cornerRadius: 6 } }] });
  measurements.push({ op: "verify correction + sibling untouched", ...verify1 });
  results.steps.push({
    step: "verify: corrected node shows the new value, untouched sibling still shows the original (no collateral mutation)",
    ok: verify1.result?.ok === true && verify1.result?.result?.ok === true && verify1.result?.result?.differenceCount === 0,
    durationMs: verify1.elapsed
  });

  // ---- IDEMPOTENCY at scale: re-run the same verify ----
  const verify2 = await execute("custom.verify", { expectations: [{ nodeId: cardAId, expected: { cornerRadius: 20 } }, { nodeId: cardBId, expected: { cornerRadius: 6 } }] });
  results.steps.push({
    step: "IDEMPOTENCY at scale: repeated verify on the large tree produces an identical result",
    ok: JSON.stringify(verify1.result?.result) === JSON.stringify(verify2.result?.result),
    durationMs: verify2.elapsed
  });

  // ---- Idempotent RECONCILE: re-run the same design in sync mode, expect 0 new creates ----
  const syncDoc = { ...doc, mode: "sync", prune: false };
  const resync = await execute("custom.design", { doc: syncDoc });
  measurements.push({ op: "sync-mode reconcile of the full 901-node tree", ...resync });
  results.steps.push({
    step: `sync-mode reconcile: re-running the SAME ${totalNodesAuthored}-node doc updates existing nodes instead of duplicating (created:0)`,
    ok: resync.result?.ok === true && resync.result?.result?.created === 0 && resync.result?.result?.updated === totalNodesAuthored,
    durationMs: resync.elapsed,
    created: resync.result?.result?.created,
    updated: resync.result?.result?.updated
  });

  // ---- Cleanup ----
  const deleted = await execute("custom.delete_node", { nodeId: rootId });
  const readAfterDelete = await execute("custom.node.read", { nodeId: rootId });
  results.steps.push({ step: "cleanup: 901-node tree deleted and confirmed absent", ok: deleted.result?.ok === true && readAfterDelete.result?.ok === false && readAfterDelete.result?.error?.code === "NODE_NOT_FOUND" });

  const finalStatus = parseToolText(await client.callTool("unified_runtime_status", {}));
  results.diagnostics = finalStatus?.runtime?.diagnostics;

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  results.measurements = measurements.map((m) => ({ op: m.op, durationMs: m.elapsed, bytes: m.bytes }));
  console.log("\n=== LARGE-TREE STRESS TEST SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}${step.durationMs !== undefined ? ` (${step.durationMs}ms)` : ""}`);
  console.log("\n=== MEASUREMENTS ===");
  console.table(results.measurements);
  console.log("\n=== DIAGNOSTICS ===", JSON.stringify(results.diagnostics));
  console.log(allOk ? "\nLARGE-TREE STRESS TEST: PASS" : "\nLARGE-TREE STRESS TEST: FAIL");
  writeFileSync(new URL("./block-a-large-tree-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-large-tree-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
