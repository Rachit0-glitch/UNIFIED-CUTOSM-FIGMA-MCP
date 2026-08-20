#!/usr/bin/env node
// A11 (plumb.components) live verification + a rapid-fire burst specifically designed to try to
// reproduce the transient COMMAND_TIMEOUT under the new bridge instrumentation (orphan-response
// detection), to get real diagnostic evidence instead of another unexplained blip.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-block-a-a11" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 200)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 1500));
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

try {
  await client.connect();
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });
  const expectedVersion = "0.6.0-blockA-a11-final";
  results.steps.push({ step: "plugin version reflects A11", ok: paired.runtime.pluginVersion === expectedVersion, expected: expectedVersion, actual: paired.runtime.pluginVersion });

  // ---- A11: plumb.components ----
  const components = await execute("plumb.components", {});
  results.steps.push({ step: "plumb.components: real call succeeds and returns components/instances arrays", ok: components.ok === true && Array.isArray(components.result?.components) && Array.isArray(components.result?.instances) });

  // Build a real component + 3 instances to prove cross-referencing actually works, not just an empty-array pass.
  const built = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "a11-wrap",
        type: "frame",
        width: 300,
        height: 200,
        children: [{ id: "a11-comp", type: "component", name: "Key=A11Test", width: 40, height: 40 }]
      }
    }
  });
  const compId = built.result?.ids?.["a11-comp"];
  const wrapId = built.result?.ids?.["a11-wrap"];
  const inst1 = await execute("custom.create_instance", { componentId: compId, parentId: wrapId, x: 50, y: 0 });
  const inst2 = await execute("custom.create_instance", { componentId: compId, parentId: wrapId, x: 100, y: 0 });
  const componentsAfter = await execute("plumb.components", {});
  const foundComp = componentsAfter.result?.components?.find((c) => c.id === compId);
  results.steps.push({
    step: "plumb.components: cross-references INSTANCE count correctly (2 real instances created)",
    ok: componentsAfter.ok === true && !!foundComp && foundComp.instanceCount === 2
  });

  // ---- Timeout investigation: rapid-fire burst of 40 calls, watch for COMMAND_TIMEOUT + orphan diagnostics ----
  console.log("\n--- Rapid-fire burst (40 calls) to try to reproduce the transient timeout under instrumentation ---");
  let timeoutCount = 0;
  const burstResults = [];
  for (let i = 0; i < 40; i++) {
    const t0 = Date.now();
    const r = await execute("custom.node.read", { nodeId: wrapId, depth: 0, include: ["geometry"] });
    const elapsed = Date.now() - t0;
    burstResults.push({ i, ok: r.ok, elapsed, errorCode: r.error?.code });
    if (r.error?.code === "COMMAND_TIMEOUT") timeoutCount += 1;
  }
  console.log("burst results:", JSON.stringify(burstResults));
  results.steps.push({ step: `rapid-fire burst completed: ${timeoutCount}/40 timeouts observed`, ok: true, timeoutCount, burstResults });

  const finalStatus = await call("unified_runtime_status", {});
  results.steps.push({
    step: "post-burst diagnostics: orphan-response count and last-orphan detail",
    ok: true,
    orphanResponseCount: finalStatus.runtime?.diagnostics?.orphanResponseCount,
    lastOrphanResponse: finalStatus.runtime?.diagnostics?.lastOrphanResponse
  });

  // ---- Cleanup ----
  const deleted = await execute("custom.delete_node", { nodeId: wrapId });
  results.steps.push({ step: "cleanup", ok: deleted.ok === true });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== A11 + TIMEOUT INVESTIGATION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nA11 LIVE VERIFICATION: PASS" : "\nA11 LIVE VERIFICATION: FAIL");
  writeFileSync(new URL("./block-a-a11-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-a11-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
