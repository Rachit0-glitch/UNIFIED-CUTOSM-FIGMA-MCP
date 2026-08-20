#!/usr/bin/env node
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const [toolName = "unified_status", argJson = "{}"] = process.argv.slice(2);
let toolArgs = {};
try {
  toolArgs = JSON.parse(argJson);
} catch (error) {
  console.error(`Invalid JSON arguments: ${error.message}`);
  process.exit(2);
}

// H1 (pre-Block-A hardening): `VAR=value command` shell-prefix syntax to set
// UNIFIED_ENABLE_LEGACY_DIAGNOSTICS does NOT work under npm's default Windows script shell (verified
// directly — `npm run` on this system does not pass such a prefix through to the environment). Rather
// than depend on shell syntax at all, naming one of the 4 legacy tools on this script's own command
// line IS the explicit opt-in — cross-platform-safe by construction, no shell-specific env syntax
// required anywhere in package.json.
const LEGACY_TOOL_NAMES = new Set(["unified_status", "unified_backends", "unified_active_backend", "unified_probe_backend"]);

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  env: LEGACY_TOOL_NAMES.has(toolName) ? { UNIFIED_ENABLE_LEGACY_DIAGNOSTICS: "true" } : {},
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 12000),
  clientName: "figma-unified-cli-probe"
});

try {
  await client.connect();
  const result = await client.callTool(toolName, toolArgs);
  console.log(JSON.stringify(parseToolText(result), null, 2));
  if (result?.isError) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
