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
  clientName: "figma-unified-runtime-live"
});

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args)} ===`);
  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

try {
  await client.connect();
  await call("unified_runtime_status");
  await rl.question("\nImport/run the Unified Runtime POC plugin from figma-plugin/manifest.json, keep it open, then press Enter...");
  await call("unified_runtime_status");
  await call("unified_runtime_acceptance_sequence");
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
  await client.close().catch(() => {});
}
