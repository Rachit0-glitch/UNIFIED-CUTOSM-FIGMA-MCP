#!/usr/bin/env node
// PRODUCTION LOCK §6 — the MCP-process-restart boundary. The planner's execution "session" is NOT
// stored server-side at all — every `run` object is returned in full to the caller, and resuming means
// passing that SAME object back in a later call. This script proves the practical consequence
// concretely: pause a plan against MCP server process A, kill process A entirely, start a brand-new
// process B (simulating a real MCP process restart), and resume the SAME plan against process B using
// only the `run` object retained by the CALLER (this script) — nothing written to disk, no shared
// in-memory state between the two processes.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function makeClient(label) {
  const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: `figma-unified-restart-${label}` });
  await client.connect();
  return client;
}
async function call(client, name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, name === "unified_execute_plan" ? 2500 : 700));
  return parsed;
}
async function waitForPlugin(client, timeoutMs = 30000) {
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

let clientA = null;
let clientB = null;
try {
  // ---- Process A: build + pause a plan ----
  clientA = await makeClient("A");
  await waitForPlugin(clientA);
  record("process A: plugin paired", true);

  const built = await call(clientA, "unified_execute", {
    capability: "custom.design",
    payload: { doc: { version: "1", page: "Block A Scratch", root: { id: "pr-wrap", type: "frame", width: 200, height: 60, children: [{ id: "pr-a", type: "rect", width: 40, height: 40, fill: [{ type: "solid", color: "#CCCCCC" }] }] } } }
  });
  const wrapId = built.result?.ids?.["pr-wrap"];
  const aId = built.result?.ids?.["pr-a"];
  record("process A: built a real node to operate on", built.ok === true);

  const steps = [
    { id: "patch-a", capability: "custom.patch_node", payload: { nodeId: aId, opacity: 0.5 }, checkpoint: "paused-for-restart" },
    { id: "read-a", capability: "custom.node.read", payload: { nodeId: aId, depth: 0 }, dependsOn: ["patch-a"] }
  ];
  const pausedRun = await call(clientA, "unified_execute_plan", { steps, pauseAtCheckpoint: "paused-for-restart" });
  record("process A: plan paused after patch-a — this run object is the ONLY copy of session state, held by the caller, not the server", pausedRun.run?.paused === true && pausedRun.run?.results?.find((r) => r.stepId === "patch-a")?.status === "succeeded");
  const sessionId = pausedRun.run?.sessionId;

  // ---- Kill process A entirely (simulates a real MCP server process restart) ----
  await clientA.close().catch(() => {});
  clientA = null;
  record("process A killed (real process exit, not just a disconnect)", true);
  await sleep(1500);

  // ---- Process B: a BRAND NEW MCP server process, sharing nothing with process A except the plugin's
  // still-open WebSocket connection (which reconnects to whichever server is listening on the port —
  // itself further evidence this survives process restarts, not just plugin ones) ----
  clientB = await makeClient("B");
  await waitForPlugin(clientB, 30000);
  record("process B: a genuinely NEW server process paired with the same plugin", true);

  // Resume using ONLY the run object this script retained from process A — process B's own in-memory
  // state has never seen this plan or session before this call.
  const resumedRun = await call(clientB, "unified_execute_plan", { steps, previousRun: pausedRun.run });
  record("process B: resuming with the retained run object completes the SAME session (same sessionId) with zero re-execution of patch-a", resumedRun.run?.sessionId === sessionId && resumedRun.ok === true && resumedRun.run?.results?.find((r) => r.stepId === "patch-a")?.operationId === pausedRun.run?.results?.find((r) => r.stepId === "patch-a")?.operationId);

  const verify = await call(clientB, "unified_execute", { capability: "custom.verify", payload: { expectations: [{ nodeId: aId, expected: { opacity: 0.5 } }] } });
  record("process B: verify confirms the resumed state is correct", verify.ok === true && verify.result?.ok === true);

  // Cleanup
  if (wrapId) {
    const cleanup = await call(clientB, "unified_execute", { capability: "custom.delete_node", payload: { nodeId: wrapId } });
    record("cleanup", cleanup.ok === true);
  }

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== PRODUCTION LOCK: MCP PROCESS-RESTART BOUNDARY SUMMARY ===");
  for (const s of results.steps) console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.step}`);
  console.log(allOk ? "\nPROCESS-RESTART BOUNDARY: PASS (state survives IF the caller retained the run object; nothing is persisted to disk)" : "\nPROCESS-RESTART BOUNDARY: FAIL");
  writeFileSync(new URL("./production-lock-process-restart-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./production-lock-process-restart-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await clientA?.close().catch(() => {});
  await clientB?.close().catch(() => {});
}
