#!/usr/bin/env node
// Establish a real scaling curve (does duration grow linearly with node count, or worse?) before
// deciding whether the large-tree timeout needs to be even bigger or whether there's a genuine bug.
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 150000, clientName: "scaling-probe" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitForPlugin(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = parseToolText(await client.callTool("unified_runtime_status", {}));
    if (status?.runtime?.connected) return status;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for plugin.");
}

// The Figma file in use is on the free Starter plan (3-page limit — confirmed live: a real
// FIGMA_API_ERROR "The Starter plan only comes with 3 pages" was hit creating a 2nd scaling-probe
// page). Reuse ONE page for every scale tested instead of creating a new one each time.
function buildDoc(cardCount, pageName) {
  const children = [];
  for (let i = 0; i < cardCount; i++) {
    children.push({
      id: `sp-card-${i}`,
      type: "frame",
      width: 160,
      height: 100,
      layout: { mode: "col", gap: 6, pad: 10 },
      fill: { type: "solid", color: "#1b2030" },
      radius: 6,
      children: [
        { id: `sp-card-${i}-bg`, type: "rect", width: 30, height: 30, fill: { type: "solid", color: "#5b8def" }, radius: 15 },
        { id: `sp-card-${i}-label`, type: "text", text: `Item ${i}`, font: { family: "Inter", weight: 500, size: 13, color: "#ffffff" } }
      ]
    });
  }
  return { version: "1", page: pageName, root: { id: "sp-root", type: "frame", width: 1800, height: 1400, layout: { mode: "row", gap: 12, pad: 20, wrap: true }, children } };
}

try {
  await client.connect();
  await waitForPlugin();

  // Run each scale TWICE in a row: the first call after a plugin (re)connection is suspected to carry
  // a one-time "cold start" cost (matches the pattern already documented in docs/BLOCK_A_LIMITATIONS.md
  // — first call after reload times out/is slow, retries are fast). Comparing call 1 vs call 2 at the
  // SAME node count isolates that from genuine per-node scaling cost.
  for (const cardCount of [10, 10, 50, 50, 150, 150]) {
    const pageName = "Block A Scratch";
    const doc = buildDoc(cardCount, pageName);
    const nodeCount = 1 + cardCount * 3;
    const t0 = Date.now();
    const result = parseToolText(await client.callTool("unified_execute", { capability: "custom.design", payload: { doc } }));
    const elapsed = Date.now() - t0;
    console.log(`${cardCount} cards (${nodeCount} nodes): ${elapsed}ms, ok=${result.ok}`, result.ok ? `created=${result.result?.created}` : JSON.stringify(result.error));
    if (result.ok) {
      const rootId = result.result?.ids?.["sp-root"];
      await client.callTool("unified_execute", { capability: "custom.delete_node", payload: { nodeId: rootId } });
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await client.close().catch(() => {});
}
