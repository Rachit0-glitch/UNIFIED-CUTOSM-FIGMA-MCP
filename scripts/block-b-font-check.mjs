#!/usr/bin/env node
// Standalone follow-up: just the font-resolution assertion from block-b-reconnect-live.mjs, corrected
// (custom.design's root must be frame/group/section, not text directly) and run once against the
// CURRENT plugin session (already post-reconnect, generation >=2 from the prior full reconnect run) —
// no need to trigger another full disconnect/reconnect cycle to close out this one assertion.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-block-b-font-check" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 1000));
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
try {
  await client.connect();
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, connectionGeneration: paired.runtime.connectionGeneration });

  const t1 = Date.now();
  const postFont = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "reconnect-wrap-2",
        type: "frame",
        width: 160,
        height: 40,
        children: [{ id: "reconnect-text-c", type: "text", text: "Restarted", width: 150, height: 30, font: { family: "Inter", weight: 400, size: 14 } }]
      }
    }
  });
  const elapsedMs = Date.now() - t1;
  results.steps.push({ step: "font resolution works cleanly on the current (post-reconnect) plugin runtime", ok: postFont.ok === true, elapsedMs });

  const wrapId = postFont.result?.ids?.["reconnect-wrap-2"];
  if (wrapId) await execute("custom.delete_node", { nodeId: wrapId });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== SUMMARY ===");
  for (const s of results.steps) console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.step}`);
  writeFileSync(new URL("./block-b-font-check-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-b-font-check-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
