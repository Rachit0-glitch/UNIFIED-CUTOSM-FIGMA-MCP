#!/usr/bin/env node
import path from "node:path";
import { Client } from "../..//FIGMA-CUSTOM-MCP/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../..//FIGMA-CUSTOM-MCP/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const args = new Set(process.argv.slice(2));
const customRepo = process.env.CUSTOM_MCP_REPO || "C:\\Users\\rachi\\OneDrive\\Documents\\FIGMA-CUSTOM-MCP";
const serverPath = process.env.CUSTOM_MCP_SERVER || path.join(customRepo, "dist", "index.js");
const port = process.env.FIGMA_CUSTOM_MCP_PORT || "39217";
const doRead = args.has("--read") || args.has("--write");
const doWrite = args.has("--write");
const waitPaired = args.has("--wait-paired");

function parseToolText(result) {
  const text = result?.content?.find((part) => part.type === "text")?.text;
  if (!text) return { raw: result };
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function callTool(client, name, toolArgs = {}) {
  const result = await client.callTool({ name, arguments: toolArgs });
  return { raw: result, parsed: parseToolText(result), isError: Boolean(result?.isError) };
}

const stderrChunks = [];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: customRepo,
  env: { FIGMA_CUSTOM_MCP_PORT: port },
  stderr: "pipe"
});
transport.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));
const client = new Client({ name: "ufmp-stage1-sdk-probe", version: "0.0.0" }, { capabilities: {} });

const out = {
  ok: false,
  serverPath,
  port: Number(port),
  toolNames: [],
  status: null,
  statusIsError: null,
  read: null,
  write: null,
  cleanup: null,
  stderr: null
};

try {
  await client.connect(transport);
  const tools = await client.listTools();
  out.toolNames = (tools.tools || []).map((tool) => tool.name).sort();

  let status = await callTool(client, "figma_status", {});
  if (waitPaired && !status.parsed?.connected) {
    const deadline = Date.now() + Number(process.env.UFMP_WAIT_PAIRED_MS || 15000);
    while (Date.now() < deadline && !status.parsed?.connected) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = await callTool(client, "figma_status", {});
    }
  }

  out.status = status.parsed;
  out.statusIsError = status.isError;
  out.ok = true;

  if (doRead) {
    try {
      const read = await callTool(client, "figma_node", { depth: 1, include: ["metadata"] });
      out.read = { ok: !read.isError, result: read.parsed };
    } catch (err) {
      out.read = { ok: false, error: err.message };
    }
  }

  if (doWrite) {
    const doc = {
      version: "1",
      name: "UFMP Stage 1 Custom Disposable",
      x: 40,
      y: 40,
      root: {
        id: "ufmp-stage1-custom-disposable-root",
        type: "frame",
        name: "UFMP_STAGE1_CUSTOM_DISPOSABLE",
        width: 160,
        height: 96,
        fill: { type: "solid", color: "#f4f4f5" },
        children: [
          { id: "ufmp-stage1-custom-disposable-rect", type: "rect", name: "UFMP_STAGE1_CUSTOM_RECT", x: 16, y: 16, width: 48, height: 48, radius: 8, fill: { type: "solid", color: "#0f766e" } },
          { id: "ufmp-stage1-custom-disposable-label", type: "text", name: "UFMP_STAGE1_CUSTOM_LABEL", x: 72, y: 32, width: 72, height: 24, text: "UFMP", font: { family: "Inter", weight: 700, size: 18, color: "#18181b" } }
        ]
      }
    };
    try {
      const write = await callTool(client, "figma_design", { doc, dryRun: false });
      out.write = { ok: !write.isError, result: write.parsed };
      const rootId = write.parsed?.rootId;
      if (rootId) {
        try {
          const cleanup = await callTool(client, "figma_delete_node", { nodeId: rootId });
          out.cleanup = { ok: !cleanup.isError, result: cleanup.parsed };
        } catch (err) {
          out.cleanup = { ok: false, error: err.message, rootId };
        }
      }
    } catch (err) {
      out.write = { ok: false, error: err.message };
    }
  }
} catch (err) {
  out.error = err.message;
  process.exitCode = 1;
} finally {
  out.stderr = stderrChunks.join("").trim() || null;
  console.log(JSON.stringify(out, null, 2));
  await client.close().catch(() => {});
}
