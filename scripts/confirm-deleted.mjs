#!/usr/bin/env node
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";
const nodeId = process.argv[2];
const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 15000, clientName: "confirm-deleted" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
try {
  await client.connect();
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const status = parseToolText(await client.callTool("unified_runtime_status", {}));
    if (status?.runtime?.connected) break;
    await sleep(2000);
  }
  const r = parseToolText(await client.callTool("unified_execute", { capability: "custom.node.read", payload: { nodeId } }));
  console.log(JSON.stringify(r, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
} finally {
  await client.close().catch(() => {});
}
