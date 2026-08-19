#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const rl = createInterface({ input, output });
const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 20000),
  clientName: "figma-unified-stage4-live"
});

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args)} ===`);
  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}

try {
  await client.connect();

  await call("unified_runtime_status");
  await rl.question("\nRun the Unified Runtime plugin from figma-plugin/manifest.json, keep it open, then press Enter...");

  await call("unified_runtime_status");
  await call("unified_capabilities");

  await execute("plumb.status");
  await execute("plumb.outline");
  await execute("plumb.selection.read", { depth: 1 });
  await execute("custom.status");
  await execute("custom.node.read", { depth: 1 });
  await execute("custom.selection.read", { depth: 1 });

  await execute("plumb.outline");
  await execute("custom.node.read", { depth: 1 });
  await execute("plumb.outline");
  await execute("custom.node.read", { depth: 1 });

  await execute("plumb.status");
  await execute("custom.status");
  await execute("plumb.outline");

  await execute("does.not.exist");
  await execute("custom.node.read", { depth: 99 });

  await rl.question("\nClose the Unified Runtime plugin window in Figma, then press Enter...");
  await call("unified_runtime_status");

  await rl.question("\nReopen the Unified Runtime plugin from figma-plugin/manifest.json, then press Enter...");
  await call("unified_runtime_status");
  await execute("plumb.outline");
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
  await client.close().catch(() => {});
}
