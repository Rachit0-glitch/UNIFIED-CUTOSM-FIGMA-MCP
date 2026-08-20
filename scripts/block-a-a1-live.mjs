#!/usr/bin/env node
// A1 (full-fidelity reads) live verification — persistent session (see
// docs/HARDENING_TEST_PLAN.md Test H-D's root-cause note for why one-shot probes can't pair).
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 20000),
  clientName: "figma-unified-block-a-a1"
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 3000));
  return parsed;
}

async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}

async function waitForPlugin(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await client.callTool("unified_runtime_status", {});
    const parsed = parseToolText(status);
    if (parsed?.runtime?.connected) return parsed;
    await sleep(2000);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the Unified plugin to pair.`);
}

const results = { steps: [] };

try {
  await client.connect();
  console.log("Persistent session started. Waiting for the Unified Runtime plugin to (re)pair with the new code.js...");
  const paired = await waitForPlugin();
  results.steps.push({ step: "pair", ok: true, pluginVersion: paired.runtime.pluginVersion });
  const expectedVersion = "0.3.0-blockA-a1-reads";
  results.steps.push({
    step: "plugin version reflects the A1 code change",
    ok: paired.runtime.pluginVersion === expectedVersion,
    expected: expectedVersion,
    actual: paired.runtime.pluginVersion
  });

  const full = await execute("custom.node.read", { depth: 2 });
  const fullFields = Object.keys(full.result?.doc ?? {});
  results.steps.push({ step: "unfiltered read succeeds", ok: full.ok === true, fields: fullFields });

  const geometryOnly = await execute("custom.node.read", { depth: 1, include: ["geometry"] });
  const geoFields = Object.keys(geometryOnly.result?.doc ?? {});
  const hasOnlyGeometryPlusCore = geoFields.every((f) =>
    ["id", "name", "type", "x", "y", "width", "height", "rotation", "absoluteBoundingBox", "parentId", "index", "childCount", "children", "readError"].includes(f)
  );
  results.steps.push({
    step: "include:[geometry] actually filters fields (no appearance/metadata leaking through)",
    ok: geometryOnly.ok === true && hasOnlyGeometryPlusCore && !("visible" in (geometryOnly.result?.doc ?? {})),
    fields: geoFields
  });

  // PageNode has no `visible` property (only SceneNode subtypes do) — target the actual FRAME (5:2)
  // from the earlier full read, not the page root, for a meaningful metadata-only assertion.
  const metadataOnly = await execute("custom.node.read", { nodeId: "5:2", depth: 0, include: ["metadata"] });
  results.steps.push({
    step: "include:[metadata] on a FRAME returns visible but not geometry",
    ok: metadataOnly.ok === true && "visible" in (metadataOnly.result?.doc ?? {}) && !("x" in (metadataOnly.result?.doc ?? {})),
    fields: Object.keys(metadataOnly.result?.doc ?? {})
  });

  const badInclude = await execute("custom.node.read", { include: ["not-a-real-category"] });
  results.steps.push({
    step: "unknown include category rejected before bridge (INVALID_PAYLOAD)",
    ok: badInclude.ok === false && badInclude.error?.code === "INVALID_PAYLOAD"
  });

  const selectionRead = await execute("custom.selection.read", { depth: 1 });
  results.steps.push({ step: "custom.selection.read still works with new serializer", ok: selectionRead.ok === true });

  const plumbStillCompact = await execute("plumb.selection.read", { depth: 1 });
  results.steps.push({ step: "plumb.selection.read unaffected (still compact format)", ok: plumbStillCompact.ok === true });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== A1 LIVE VERIFICATION SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nA1 LIVE VERIFICATION: PASS" : "\nA1 LIVE VERIFICATION: FAIL");
  writeFileSync(new URL("./block-a-a1-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-a1-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
