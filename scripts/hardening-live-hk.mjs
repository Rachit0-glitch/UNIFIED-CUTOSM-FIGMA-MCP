#!/usr/bin/env node
// Focused H-K (disconnect/reconnect) retest — H-D/H-J/H12 already passed with real evidence in
// scripts/hardening-live.mjs's prior run; no need to repeat them here.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 20000),
  clientName: "figma-unified-hardening-hk"
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args)} === connected=${parsed?.runtime?.connected}`);
  return parsed;
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await call("unified_runtime_status");
    if (predicate(status)) return status;
    await sleep(3000);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}

const results = { steps: [] };

try {
  await client.connect();
  console.log("Persistent session started. Confirming current pairing state...");
  const initial = await call("unified_runtime_status");
  results.steps.push({ step: "initial status", ok: true, connected: initial.runtime.connected });

  if (!initial.runtime.connected) {
    console.log("Plugin not currently connected — waiting up to 120s for it to pair (reopen it now if needed)...");
    await waitFor((s) => s.runtime.connected, 120000, "initial pairing");
  }

  console.log("\n>>> ACTION NEEDED: close the Unified Runtime plugin window in Figma now. Waiting up to 180s for disconnect... <<<");
  const disc = await waitFor((s) => !s.runtime.connected, 180000, "disconnect");
  results.steps.push({ step: "H-K disconnect detected", ok: true });

  console.log("\n>>> ACTION NEEDED: reopen the Unified Runtime plugin from figma-plugin/manifest.json now. Waiting up to 180s for reconnect... <<<");
  const recon = await waitFor((s) => s.runtime.connected, 180000, "reconnect");
  results.steps.push({ step: "H-K reconnect", ok: true, pluginVersion: recon.runtime.pluginVersion });

  const client2 = client;
  const read = await client2.callTool("unified_execute", { capability: "plumb.outline", payload: {} });
  const readParsed = parseToolText(read);
  console.log("\n=== post-reconnect plumb.outline ===");
  console.log(JSON.stringify(readParsed, null, 2));
  results.steps.push({ step: "H-K read after reconnect", ok: readParsed.ok === true });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== H-K SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nH-K SESSION: PASS" : "\nH-K SESSION: FAIL");
  writeFileSync(new URL("./hardening-live-hk-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./hardening-live-hk-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
