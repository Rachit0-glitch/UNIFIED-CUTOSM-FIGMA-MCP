#!/usr/bin/env node
// Block B §15 — controlled failure injection against a real, paired Unified Runtime plugin. Every
// case here must produce a structured {code, message} error, never `undefined`/a generic message/a
// silent swallow/an uncaught rejection. Also exercises the two NEW plugin-side error codes wired up in
// this pass (INVALID_HIERARCHY, FONT_ERROR — see figma-plugin/code.js's handleMoveNode and the
// mixed-font guards, and docs/BLOCK_B_OPERATION_MODEL.md's §17 taxonomy mapping).
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-block-b-failure-injection" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 200)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 1200));
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

function expectCode(step, response, expectedCode) {
  const ok = response.ok === false && response.error?.code === expectedCode && typeof response.error?.message === "string" && response.error.message.length > 0;
  return { step, ok, expectedCode, actualCode: response.error?.code, message: response.error?.message };
}

const results = { steps: [] };

try {
  await client.connect();
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });
  const expectedVersion = "0.6.2-blockB-hierarchy-font-errors";
  results.steps.push({ step: "plugin version reflects Block B error-taxonomy wiring", ok: paired.runtime.pluginVersion === expectedVersion, expected: expectedVersion, actual: paired.runtime.pluginVersion });

  // 1. invalid node ID
  const r1 = await execute("custom.node.read", { nodeId: "9999:9999", depth: 0 });
  results.steps.push(expectCode("invalid node ID -> NODE_NOT_FOUND", r1, "NODE_NOT_FOUND"));

  // 2. deleted target (create, delete, then try to patch the now-deleted node). custom.patch_node's
  // fields are FLAT (nodeId + top-level fields), not wrapped in a "patch" object.
  const built = await execute("custom.design", {
    doc: { version: "1", page: "Block A Scratch", root: { id: "fi-wrap", type: "frame", width: 200, height: 200, children: [{ id: "fi-target", type: "rect", width: 40, height: 40 }] } }
  });
  const targetId = built.result?.ids?.["fi-target"];
  const wrapId = built.result?.ids?.["fi-wrap"];
  await execute("custom.delete_node", { nodeId: targetId });
  const r2 = await execute("custom.patch_node", { nodeId: targetId, x: 10 });
  results.steps.push(expectCode("deleted target -> NODE_NOT_FOUND", r2, "NODE_NOT_FOUND"));

  // 3/4/5: build a genuine 2-level hierarchy (wrap2 [frame] -> innerFrame [frame, a real container so
  // the cycle check is actually reached instead of being pre-empted by the "cannot contain children"
  // guard]) to exercise both nonexistent-parent and real hierarchy-cycle cases.
  const built2 = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: { id: "fi-wrap2", type: "frame", width: 200, height: 200, children: [{ id: "fi-inner2", type: "frame", width: 100, height: 100 }] }
    }
  });
  const wrap2Id = built2.result?.ids?.["fi-wrap2"];
  const inner2Id = built2.result?.ids?.["fi-inner2"];

  const r3 = await execute("custom.move_node", { nodeId: inner2Id, parentId: "9999:8888" });
  results.steps.push(expectCode("invalid (nonexistent) parent -> NODE_NOT_FOUND", r3, "NODE_NOT_FOUND"));

  // 4. hierarchy cycle: try to move wrap2 (the ancestor) INTO inner2 (its own descendant, a real
  // container) -> INVALID_HIERARCHY
  const r4 = await execute("custom.move_node", { nodeId: wrap2Id, parentId: inner2Id });
  results.steps.push(expectCode("hierarchy cycle (move ancestor into its own descendant) -> INVALID_HIERARCHY (Block B new)", r4, "INVALID_HIERARCHY"));

  // 5. move a node into itself -> INVALID_HIERARCHY
  const r5 = await execute("custom.move_node", { nodeId: inner2Id, parentId: inner2Id });
  results.steps.push(expectCode("move node into itself -> INVALID_HIERARCHY (Block B new)", r5, "INVALID_HIERARCHY"));

  // 6. unsupported operation
  const r6 = await execute("custom.does_not_exist", {});
  results.steps.push(expectCode("unsupported capability -> CAPABILITY_NOT_FOUND", r6, "CAPABILITY_NOT_FOUND"));

  // 7. malformed payload (missing required field)
  const r7 = await execute("custom.patch_node", {});
  results.steps.push(expectCode("malformed payload (missing nodeId) -> INVALID_PAYLOAD", r7, "INVALID_PAYLOAD"));

  // 8. missing/mixed font: build a text node with two runs of different font styles, then try to
  // patch its characters without also patching font -> FONT_ERROR (Block B new)
  const builtText = await execute("custom.design", {
    doc: {
      version: "1",
      page: "Block A Scratch",
      root: {
        id: "fi-wrap3",
        type: "frame",
        width: 200,
        height: 60,
        children: [{ id: "fi-text", type: "text", text: "AB", width: 100, height: 30, font: { family: "Inter", weight: 400, size: 16 } }]
      }
    }
  });
  const textId = builtText.result?.ids?.["fi-text"];
  const wrap3Id = builtText.result?.ids?.["fi-wrap3"];
  // Make the second character bold via text_range, producing a genuinely mixed-font node.
  await execute("custom.text_range", { nodeId: textId, start: 1, end: 2, fontWeight: 700 });
  const r8 = await execute("custom.patch_node", { nodeId: textId, text: { characters: "XY" } });
  results.steps.push(expectCode("patch characters on a mixed-font text node -> FONT_ERROR (Block B new)", r8, "FONT_ERROR"));

  // 9. failed verification (verify against a deliberately wrong expectation) — custom.verify takes an
  // "expectations" array, and its result carries "differences"/"missing", not "mismatches".
  const r9 = await execute("custom.verify", { expectations: [{ nodeId: wrap2Id, expected: { width: 999999, height: 999999 } }] });
  results.steps.push({
    step: "custom.verify against a deliberately wrong expectation returns a structured mismatch (not a crash)",
    ok: r9.ok === true && r9.result?.ok === false && Array.isArray(r9.result?.differences) && r9.result.differences.length > 0,
    differences: r9.result?.differences
  });

  // ---- Cleanup ----
  for (const id of [wrapId, wrap2Id, wrap3Id].filter(Boolean)) {
    try {
      await execute("custom.delete_node", { nodeId: id });
    } catch { /* best-effort cleanup */ }
  }

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== BLOCK B §15 FAILURE INJECTION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nBLOCK B FAILURE INJECTION: PASS" : "\nBLOCK B FAILURE INJECTION: FAIL");
  writeFileSync(new URL("./block-b-failure-injection-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-b-failure-injection-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
