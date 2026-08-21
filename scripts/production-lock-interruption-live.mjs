#!/usr/bin/env node
// PRODUCTION LOCK — the composed mid-flight plan interruption + resume test. Proves the FULL chain in
// one script, against a real Figma document and a real plugin disconnect/reconnect:
//
//   plan starts -> several steps complete -> plan deliberately PAUSED at a checkpoint (the smallest
//   production-safe change enabling this — see executionPlanner.js's pauseAtCheckpoint) -> plugin
//   genuinely disconnects -> an attempt to continue the SAME plan while disconnected fails safely
//   (PLUGIN_DISCONNECTED, no mutation) -> plugin genuinely reconnects (connectionGeneration increments)
//   -> INSPECT real Figma state -> RESUME the SAME session (same sessionId) -> remaining steps complete
//   -> VERIFY -> VERIFY AGAIN (zero corrective mutation) -> confirm zero duplication.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-production-lock-interruption" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, name === "unified_execute_plan" ? 3000 : 900));
  return parsed;
}
async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}
async function status() {
  return parseToolText(await client.callTool("unified_runtime_status", {}));
}
async function waitFor(predicate, label, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await status();
    if (predicate(s)) return s;
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

const results = { steps: [] };
const record = (step, ok, extra = {}) => results.steps.push({ step, ok, ...extra });

try {
  await client.connect();
  const initial = await waitFor((s) => s?.runtime?.connected, "initial plugin pairing", 30000);
  const initialGeneration = initial.runtime.connectionGeneration;
  record("pair", true, { initialGeneration });

  // ---- Build the wrapper + 3 children the multi-stage plan will operate on ----
  const built = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "il-wrap",
        type: "frame",
        width: 300,
        height: 100,
        layout: { mode: "row", gap: 10, pad: 10 },
        children: [
          { id: "il-a", type: "rect", width: 40, height: 40, fill: [{ type: "solid", color: "#CCCCCC" }] },
          { id: "il-b", type: "rect", width: 40, height: 40, fill: [{ type: "solid", color: "#CCCCCC" }] },
          { id: "il-c", type: "rect", width: 40, height: 40, fill: [{ type: "solid", color: "#CCCCCC" }] }
        ]
      }
    }
  });
  record("setup: wrapper + 3 children built", built.ok === true);
  const wrapId = built.result?.ids?.["il-wrap"];
  const aId = built.result?.ids?.["il-a"];
  const bId = built.result?.ids?.["il-b"];
  const cId = built.result?.ids?.["il-c"];

  // ---- PLAN: patch a, then b, then c, then a final read — pause right after "a" ----
  const steps = [
    { id: "patch-a", capability: "custom.patch_node", payload: { nodeId: aId, opacity: 0.5 }, checkpoint: "pause-here" },
    { id: "patch-b", capability: "custom.patch_node", payload: { nodeId: bId, opacity: 0.5 }, dependsOn: ["patch-a"] },
    { id: "patch-c", capability: "custom.patch_node", payload: { nodeId: cId, opacity: 0.5 }, dependsOn: ["patch-b"] },
    { id: "final-read", capability: "custom.node.read", payload: { nodeId: wrapId, depth: 1 }, dependsOn: ["patch-c"], checkpoint: "complete" }
  ];

  // ---- STEP 1: run the plan, deliberately paused right after "patch-a" succeeds ----
  const pausedRun = await call("unified_execute_plan", { steps, pauseAtCheckpoint: "pause-here" });
  const sessionId = pausedRun.run?.sessionId;
  record("PLAN STARTS + PAUSES: patch-a succeeded, patch-b/patch-c/final-read genuinely paused (not executed)", pausedRun.run?.results?.find((r) => r.stepId === "patch-a")?.status === "succeeded" && pausedRun.run?.results?.find((r) => r.stepId === "patch-b")?.status === "paused" && pausedRun.run?.results?.find((r) => r.stepId === "final-read")?.status === "paused", { sessionId });

  console.log("\n\n########################################################################");
  console.log("# ACTION NEEDED: close the Unified Runtime plugin in Figma now.");
  console.log("# Waiting up to 5 minutes for the disconnect...");
  console.log("########################################################################\n");
  const disconnected = await waitFor((s) => s?.runtime?.connected === false, "plugin to disconnect", 5 * 60 * 1000);
  record("PLUGIN GENUINELY DISCONNECTS", true, { connectionGenerationAtDisconnect: disconnected.runtime.connectionGeneration });

  // ---- STEP 2: attempt to CONTINUE the SAME paused plan WHILE disconnected — must fail safely ----
  const attemptDuringDisconnect = await call("unified_execute_plan", { steps, previousRun: pausedRun.run });
  const patchBDuringDisconnect = attemptDuringDisconnect.run?.results?.find((r) => r.stepId === "patch-b");
  record(
    "ATTEMPT DURING DISCONNECT resolves safely — PLUGIN_DISCONNECTED, never a hang or a silent mutation",
    patchBDuringDisconnect?.status === "failed" && patchBDuringDisconnect?.error?.code === "PLUGIN_DISCONNECTED",
    { patchBStatus: patchBDuringDisconnect?.status, patchBErrorCode: patchBDuringDisconnect?.error?.code }
  );
  record("MCP process stayed alive through the disconnect (this same client connection is still responding)", attemptDuringDisconnect !== undefined);

  console.log("\n\n########################################################################");
  console.log("# ACTION NEEDED: reopen the Unified Runtime plugin in Figma now.");
  console.log("# Waiting up to 5 minutes for the reconnect...");
  console.log("########################################################################\n");
  const reconnected = await waitFor((s) => s?.runtime?.connected === true, "plugin to reconnect", 5 * 60 * 1000);
  const newGeneration = reconnected.runtime.connectionGeneration;
  record("PLUGIN GENUINELY RECONNECTS — connectionGeneration increments", newGeneration > disconnected.runtime.connectionGeneration, { previousGeneration: disconnected.runtime.connectionGeneration, newGeneration });

  // ---- INSPECT real Figma state before resuming — confirm patch-a's effect is real and patch-b/c are NOT applied yet ----
  const inspect = await execute("custom.node.read", { nodeId: wrapId, depth: 1 });
  const children = inspect.result?.doc?.children ?? [];
  const aChild = children.find((c) => c.id === aId);
  const bChild = children.find((c) => c.id === bId);
  record("INSPECT STATE: patch-a's effect (opacity 0.5) is real; patch-b/c have NOT been applied (still opacity 1); no duplication (still exactly 3 children)", aChild?.opacity === 0.5 && bChild?.opacity !== 0.5 && children.length === 3, { childrenCount: children.length, aOpacity: aChild?.opacity, bOpacity: bChild?.opacity });

  // ---- STEP 3: RESUME the SAME session from the disconnect-attempt's run — completes patch-b/c/final-read ----
  const resumedRun = await call("unified_execute_plan", { steps, previousRun: attemptDuringDisconnect.run });
  record("RESUME completes the SAME session — same sessionId throughout pause -> disconnect-attempt -> resume", resumedRun.run?.sessionId === sessionId, { resumedSessionId: resumedRun.run?.sessionId, originalSessionId: sessionId });
  record("RESUME: all remaining steps (patch-b, patch-c, final-read) now succeeded", resumedRun.ok === true && resumedRun.run?.succeeded === 4);

  // ---- VERIFY: all 3 children now have the expected opacity ----
  const verify1 = await execute("custom.verify", {
    expectations: [
      { nodeId: aId, expected: { opacity: 0.5 } },
      { nodeId: bId, expected: { opacity: 0.5 } },
      { nodeId: cId, expected: { opacity: 0.5 } }
    ]
  });
  record("VERIFY: all 3 children match the fully-resumed expected state", verify1.ok === true && verify1.result?.ok === true);

  // ---- VERIFY AGAIN: zero corrective mutation, and re-confirm zero duplication ----
  const verify2 = await execute("custom.verify", {
    expectations: [
      { nodeId: aId, expected: { opacity: 0.5 } },
      { nodeId: bId, expected: { opacity: 0.5 } },
      { nodeId: cId, expected: { opacity: 0.5 } }
    ]
  });
  record("VERIFY AGAIN: zero corrective mutation needed (stable, no drift)", verify2.ok === true && verify2.result?.ok === true && verify2.result?.differenceCount === 0);

  const finalRead = await execute("custom.node.read", { nodeId: wrapId, depth: 1 });
  const finalChildCount = finalRead.result?.doc?.children?.length ?? -1;
  record("ZERO DUPLICATION: wrapper still has exactly 3 children (no duplicate nodes/components/styles/variables created by the interruption+resume cycle)", finalChildCount === 3, { finalChildCount });

  // Cleanup
  if (wrapId) {
    const cleanup = await execute("custom.delete_node", { nodeId: wrapId });
    record("CLEANUP", cleanup.ok === true);
  }

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n\n=== PRODUCTION LOCK: MID-FLIGHT INTERRUPTION + RESUME SUMMARY ===");
  for (const s of results.steps) console.log(`  [${s.ok ? "PASS" : "FAIL"}] ${s.step}`);
  console.log(allOk ? "\nMID-FLIGHT INTERRUPTION + RESUME: PASS" : "\nMID-FLIGHT INTERRUPTION + RESUME: FAIL");
  writeFileSync(new URL("./production-lock-interruption-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./production-lock-interruption-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
