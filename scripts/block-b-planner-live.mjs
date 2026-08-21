#!/usr/bin/env node
// Block B §6/§8/§9/§21/§22 — live verification of unified_execute_plan (the planner's only MCP entry
// point) against a real, paired Unified Runtime plugin: dependency ordering, checkpoint tracking,
// result-derived createdIds (a creation step's id only exists in its RESULT, not its payload — see
// executionPlanner.js's createdIds), a deliberately failed step blocking its dependent, and resuming
// after fixing the underlying problem.
//
// By design (§6: no generic workflow DSL, no cross-step templating), a step's payload cannot reference
// another not-yet-run step's Figma-assigned id — that id only exists after execution. So a plan that
// needs a just-created id for a later step is legitimately built across TWO unified_execute_plan calls:
// create, inspect the real result, then plan the next step with the now-known id. That is intentional,
// not a workaround.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-block-b-planner" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 1800));
  return parsed;
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
  await waitForPlugin();
  results.steps.push({ step: "pair", ok: true });

  // ---- Plan A: a single creation step. Its id only exists in the RESULT, not the payload. ----
  const planA = await call("unified_execute_plan", {
    steps: [
      {
        id: "wrap",
        capability: "custom.design",
        payload: { doc: { version: "1", page: "Block A Scratch", root: { id: "planner-wrap", type: "frame", width: 200, height: 200 } } },
        checkpoint: "structure"
      }
    ]
  });
  results.steps.push({ step: "planA: preflight ok", ok: planA.preflight?.ok === true });
  results.steps.push({ step: "planA: step succeeded, checkpoint reached", ok: planA.run?.succeeded === 1 && JSON.stringify(planA.run?.reachedCheckpoints) === JSON.stringify(["structure"]) });
  const wrapResult = planA.run?.results?.find((r) => r.stepId === "wrap");
  results.steps.push({ step: "planA: target stayed null (payload had no nodeId) but createdIds captured the real created id", ok: wrapResult?.target === null && Array.isArray(wrapResult?.createdIds) && wrapResult.createdIds.length === 1 });
  const wrapId = wrapResult?.createdIds?.[0];
  results.steps.push({ step: "planA: createdTargets surfaces the same id at the run level", ok: Array.isArray(planA.run?.createdTargets) && planA.run.createdTargets.includes(wrapId) });

  // ---- Plan B: 2 real dependent steps against the now-known real id — mutation, then verification-read ----
  const planB = await call("unified_execute_plan", {
    steps: [
      { id: "patch", capability: "custom.patch_node", payload: { nodeId: wrapId, opacity: 0.5 }, checkpoint: "styling" },
      { id: "verify", capability: "custom.node.read", payload: { nodeId: wrapId, depth: 0 }, dependsOn: ["patch"], checkpoint: "verified" }
    ]
  });
  results.steps.push({
    step: "planB: dependency ordering — verify ran AFTER patch, both succeeded",
    ok: planB.run?.succeeded === 2 && planB.run?.results?.[0]?.stepId === "patch" && planB.run?.results?.[1]?.stepId === "verify"
  });
  results.steps.push({ step: "planB: both checkpoints reached in order", ok: JSON.stringify(planB.run?.reachedCheckpoints) === JSON.stringify(["styling", "verified"]) });

  // ---- Plan C: step 1 deliberately fails (bad nodeId) -> step 2 must be BLOCKED, never attempted ----
  const planC = await call("unified_execute_plan", {
    steps: [
      { id: "bad", capability: "custom.node.read", payload: { nodeId: "9999:9999", depth: 0 } },
      { id: "after", capability: "custom.node.read", payload: { nodeId: wrapId, depth: 0 }, dependsOn: ["bad"] }
    ]
  });
  const badResult = planC.run?.results?.find((r) => r.stepId === "bad");
  const afterResult = planC.run?.results?.find((r) => r.stepId === "after");
  results.steps.push({
    step: "planC: failed dependency blocks the dependent step (never silently skipped, never executed)",
    ok: (badResult?.status === "failed" || badResult?.status === "timed_out") && afterResult?.status === "blocked"
  });

  // ---- Resume plan C after fixing the underlying problem (point "bad" at a real node instead) ----
  const planCFixed = await call("unified_execute_plan", {
    steps: [
      { id: "bad", capability: "custom.node.read", payload: { nodeId: wrapId, depth: 0 } }, // now points at a REAL node
      { id: "after", capability: "custom.node.read", payload: { nodeId: wrapId, depth: 0 }, dependsOn: ["bad"] }
    ],
    previousRun: planC.run
  });
  results.steps.push({
    step: "resume: with the underlying issue fixed, both steps now succeed (recovery works through the real MCP tool, not just the fake-router unit test)",
    ok: planCFixed.ok === true && planCFixed.run?.succeeded === 2 && planCFixed.run?.sessionId === planC.run?.sessionId
  });

  // Cleanup
  if (wrapId) await call("unified_execute", { capability: "custom.delete_node", payload: { nodeId: wrapId } });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== BLOCK B PLANNER LIVE SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nBLOCK B PLANNER LIVE: PASS" : "\nBLOCK B PLANNER LIVE: FAIL");
  writeFileSync(new URL("./block-b-planner-live-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-b-planner-live-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
