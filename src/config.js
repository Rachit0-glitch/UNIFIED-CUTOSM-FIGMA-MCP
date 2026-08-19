import path from "node:path";

const documentsRoot = "C:\\Users\\rachi\\OneDrive\\Documents";

function splitArgs(value) {
  if (!value) return null;
  return value.split("|").map((part) => part.trim()).filter(Boolean);
}

export function loadConfig(env = process.env) {
  const customRepo = env.UNIFIED_CUSTOM_REPO || path.join(documentsRoot, "FIGMA-CUSTOM-MCP");
  return {
    probeTimeoutMs: Number(env.UNIFIED_PROBE_TIMEOUT_MS || 8000),
    pairWaitMs: Number(env.UNIFIED_PAIR_WAIT_MS || 2500),
    logLevel: env.UNIFIED_LOG_LEVEL || "info",
    plumb: {
      command: env.UNIFIED_PLUMB_COMMAND || "node",
      args: splitArgs(env.UNIFIED_PLUMB_ARGS) || ["C:\\Users\\rachi\\AppData\\Roaming\\npm\\node_modules\\plumb-mcp\\dist\\index.js"],
      cwd: env.UNIFIED_PLUMB_CWD || undefined
    },
    custom: {
      command: env.UNIFIED_CUSTOM_COMMAND || "node",
      args: splitArgs(env.UNIFIED_CUSTOM_ARGS) || [path.join(customRepo, "dist", "index.js")],
      cwd: env.UNIFIED_CUSTOM_CWD || customRepo,
      port: Number(env.FIGMA_CUSTOM_MCP_PORT || 39217)
    },
    runtime: {
      port: Number(env.UNIFIED_RUNTIME_PORT || 39417),
      wsModulePath: env.UNIFIED_WS_MODULE || path.join(customRepo, "node_modules", "ws", "wrapper.mjs"),
      requestTimeoutMs: Number(env.UNIFIED_RUNTIME_TIMEOUT_MS || 8000)
    }
  };
}

