#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

// H1 (pre-Block-A hardening): this script exercises the LEGACY Stage-2 dual-runtime diagnostic path
// on purpose (manual plugin switching is exactly what Stage 3+ moved away from — this script predates
// that and is kept only as a historical diagnostic, see docs/LEGACY_RUNTIME_POLICY.md). Running it at
// all is the explicit opt-in, so it sets the gate flag on the spawned server itself.
const rl = createInterface({ input, output });
const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  env: { UNIFIED_ENABLE_LEGACY_DIAGNOSTICS: "true" },
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 12000),
  clientName: "figma-unified-live-sequence"
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
  await call("unified_status");
  await call("unified_probe_backend", { backend: "plumb" });
  await call("unified_probe_backend", { backend: "custom" });
  await rl.question("\nSwitch Figma to Custom MCP, then press Enter...");
  await call("unified_status");
  await call("unified_probe_backend", { backend: "custom" });
  await call("unified_probe_backend", { backend: "plumb" });
  await rl.question("\nSwitch Figma back to Plumb, then press Enter...");
  await call("unified_status");
  await call("unified_probe_backend", { backend: "plumb" });
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
  await client.close().catch(() => {});
}
