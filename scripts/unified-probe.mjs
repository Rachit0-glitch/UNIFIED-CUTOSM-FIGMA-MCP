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

const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
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
