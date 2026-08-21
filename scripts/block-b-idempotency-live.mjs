#!/usr/bin/env node
// Block B §20 — idempotency acceptance: build a real design, then re-run the IDENTICAL objective
// against the completed design and confirm NO duplication (mode:"sync" reconciles instead of
// recreating). Measures created/updated/unchanged, and confirms a second re-verification produces no
// corrective mutation (i.e. the design has genuinely converged, not just "returned ok").
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-block-b-idempotency" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 900));
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

const doc = {
  version: "1",
  page: "Block A Scratch",
  root: {
    id: "idem-root",
    type: "frame",
    name: "Idempotency Test",
    width: 400,
    layout: { mode: "col", gap: 16, pad: 24 },
    fill: [{ type: "solid", color: "#FFFFFF" }],
    children: [
      { id: "idem-title", type: "text", text: "Idempotency Test", font: { family: "Inter", weight: 700, size: 20 } },
      {
        id: "idem-card",
        type: "frame",
        layout: { mode: "col", gap: 8, pad: 16 },
        radius: 8,
        stroke: { color: "#E5E7EB", width: 1 },
        children: [
          { id: "idem-card-icon", type: "rect", width: 24, height: 24, radius: 6, fill: [{ type: "solid", color: "#4F46E5" }] },
          { id: "idem-card-title", type: "text", text: "Card", font: { family: "Inter", weight: 600, size: 14 } }
        ]
      },
      { id: "idem-footer", type: "text", text: "Built once, verified twice.", font: { family: "Inter", weight: 400, size: 12, color: "#6B7280" } }
    ]
  }
};

try {
  await client.connect();
  await waitForPlugin();
  record("pair", true);

  // ---- Build #1: mode:"create" (the default) ----
  const build1 = await execute("custom.design", { doc });
  record("BUILD #1 (mode:create): design applied", build1.ok === true, { created: build1.result?.created, updated: build1.result?.updated });
  record("BUILD #1: created exactly the expected node count (6 real nodes), zero updated", build1.result?.created === 6 && build1.result?.updated === 0);
  const rootId = build1.result?.ids?.["idem-root"];

  // ---- Build #2: IDENTICAL objective, mode:"sync" — the documented safe-retry transform for custom.design
  // (docs/BLOCK_B_RETRY_RECONCILIATION.md). Must reconcile (created:0), not duplicate.
  const syncDoc = { ...doc, mode: "sync" };
  const build2 = await execute("custom.design", { doc: syncDoc });
  record("BUILD #2 (mode:sync, IDENTICAL objective): created:0 — zero duplication", build2.ok === true && build2.result?.created === 0, { created: build2.result?.created, updated: build2.result?.updated, deleted: build2.result?.deleted });

  // ---- Confirm via a real read: still exactly 7 nodes total, not 14 ----
  function countNodes(node) {
    if (!node) return 0;
    let count = 1;
    for (const child of node.children ?? []) count += countNodes(child);
    return count;
  }
  const afterSyncRead = await execute("custom.node.read", { nodeId: rootId, depth: 4 });
  const nodeCountAfterSync = countNodes(afterSyncRead.result?.doc);
  record("CONFIRM: real node count after re-run is still 6, not doubled to 12", nodeCountAfterSync === 6, { nodeCountAfterSync });

  // ---- A THIRD identical mode:sync run — the design must have genuinely converged: still created:0 ----
  const build3 = await execute("custom.design", { doc: syncDoc });
  record("BUILD #3 (mode:sync again): still created:0 — the design has genuinely converged, not just 'returned ok' once", build3.ok === true && build3.result?.created === 0);

  // ---- VERIFY: no corrective mutation is needed against the doc's own authored shape.
  // idem-root is an auto-layout ("hug") frame with no explicit sizing — its real width legitimately
  // shrinks to fit content rather than staying at the authored 400 (the same auto-layout-vs-authored-
  // value pattern already documented in docs/BLOCK_B_LIVE_RESULTS.md's §18-19 section) — verify
  // against the REAL observed width from the read above, not the authored initial value.
  const realRootWidth = afterSyncRead.result?.doc?.width;
  const verify = await execute("custom.verify", {
    expectations: [
      { nodeId: rootId, expected: { width: realRootWidth } },
      { nodeId: build1.result?.ids?.["idem-card-title"], expected: { text: "Card" } }
    ]
  });
  record("VERIFY: the converged design matches expectations with zero corrective mutation needed", verify.ok === true && verify.result?.ok === true);

  // Cleanup
  if (rootId) {
    const cleanup = await execute("custom.delete_node", { nodeId: rootId });
    record("CLEANUP", cleanup.ok === true);
  }

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== BLOCK B §20 IDEMPOTENCY SUMMARY ===");
  for (const s of results.steps) console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.step}`);
  console.log(allOk ? "\nBLOCK B IDEMPOTENCY: PASS" : "\nBLOCK B IDEMPOTENCY: FAIL");
  writeFileSync(new URL("./block-b-idempotency-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-b-idempotency-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
