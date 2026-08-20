#!/usr/bin/env node
// Non-interactive hardening live-test session (H-D, H-J/H12, H-K). Keeps ONE persistent MCP child
// process (and therefore one persistent bridge/WebSocketServer on 39417) alive for the whole run,
// unlike scripts/unified-probe.mjs (one call, then exits — the bridge dies with it, so a Figma
// plugin retrying its connection never has a stable target). Polls for plugin pairing instead of
// scripts/stage4-live.mjs's interactive `rl.question` prompts, since this runs headless.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 20000),
  clientName: "figma-unified-hardening-live"
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 2000));
  return parsed;
}

async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}

async function waitForPlugin(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await call("unified_runtime_status");
    if (status?.runtime?.connected) return status;
    await sleep(2000);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the Unified plugin to pair.`);
}

const results = { steps: [] };

try {
  await client.connect();
  console.log("Persistent Unified MCP session started (bridge listening on 39417). Waiting for the Unified Runtime plugin to pair...");

  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });

  // ---- Test H-D: single-plugin, cross-family sequence ----
  const capabilities = await call("unified_capabilities");
  results.steps.push({ step: "capabilities", ok: capabilities.ok, count: capabilities.capabilities.length });

  const plumb1 = await execute("plumb.outline");
  const custom1 = await execute("custom.node.read", { depth: 1 });
  const plumb2 = await execute("plumb.outline");
  const custom2 = await execute("custom.node.read", { depth: 1 });
  results.steps.push({
    step: "H-D cross-family sequence",
    ok: plumb1.ok && custom1.ok && plumb2.ok && custom2.ok,
    sequence: [plumb1, custom1, plumb2, custom2].map((r) => ({ family: r.family, ok: r.ok, requestId: r.requestId }))
  });

  // ---- Test H-H (live confirmation): invalid capability + malformed payload never touch the bridge ----
  const invalidCap = await execute("does.not.exist");
  const badPayload = await execute("custom.node.read", { depth: 999 });
  results.steps.push({
    step: "H-H invalid capability / malformed payload",
    ok: invalidCap.ok === false && invalidCap.error?.code === "CAPABILITY_NOT_FOUND" && badPayload.ok === false && badPayload.error?.code === "INVALID_PAYLOAD"
  });

  // ---- Test H-J / H12: deep read performance at depth 5/10/20 ----
  const perf = [];
  for (const depth of [1, 5, 10, 20]) {
    const start = Date.now();
    const read = await execute("custom.node.read", { depth });
    const elapsed = Date.now() - start;
    const bytes = JSON.stringify(read).length;
    perf.push({ depth, ok: read.ok, elapsedMs: elapsed, bytes });
  }
  results.steps.push({ step: "H-J/H12 depth performance", ok: perf.every((p) => p.ok), perf });

  console.log("\n=== Depth performance summary ===");
  console.table(perf);

  // ---- Test H-K: disconnect / reconnect ----
  console.log("\n[H-K] Please CLOSE the Unified Runtime plugin window in Figma now. Waiting up to 60s for disconnect...");
  const disconnectStart = Date.now();
  let disconnected = false;
  while (Date.now() - disconnectStart < 60000) {
    const status = await call("unified_runtime_status");
    if (!status?.runtime?.connected) { disconnected = true; break; }
    await sleep(2000);
  }
  results.steps.push({ step: "H-K disconnect detected", ok: disconnected });

  if (disconnected) {
    console.log("\n[H-K] Disconnect confirmed. Please REOPEN the Unified Runtime plugin now. Waiting up to 120s for reconnect...");
    const reconnected = await waitForPlugin(120000);
    results.steps.push({ step: "H-K reconnect", ok: reconnected.runtime.connected });
    const postReconnectRead = await execute("plumb.outline");
    results.steps.push({ step: "H-K read after reconnect", ok: postReconnectRead.ok });
  }

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== HARDENING LIVE SESSION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nHARDENING LIVE SESSION: PASS" : "\nHARDENING LIVE SESSION: FAIL");

  writeFileSync(new URL("./hardening-live-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./hardening-live-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
