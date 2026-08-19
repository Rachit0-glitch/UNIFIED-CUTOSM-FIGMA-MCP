import { loadConfig } from "./config.js";
import { CoordinatorLogger } from "./logger.js";
import { BackendRegistry } from "./registry.js";
import { UnifiedCoordinator } from "./coordinator.js";
import { PlumbAdapter } from "./adapters/plumb.js";
import { CustomAdapter } from "./adapters/custom.js";
import { SimpleMcpServer } from "./mcp/server.js";
import { textResult } from "./utils.js";

export function createCoordinator(env = process.env) {
  const config = loadConfig(env);
  const logger = new CoordinatorLogger({ level: config.logLevel });
  const registry = new BackendRegistry();
  registry.register(
    new PlumbAdapter({
      config: { ...config.plumb, timeoutMs: config.probeTimeoutMs, pairWaitMs: config.pairWaitMs },
      logger
    })
  );
  registry.register(
    new CustomAdapter({
      config: { ...config.custom, timeoutMs: config.probeTimeoutMs, pairWaitMs: config.pairWaitMs },
      logger
    })
  );
  const coordinator = new UnifiedCoordinator({ registry, logger });
  const cleanup = () => registry.close().catch(() => {});
  process.once("beforeExit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(130); });
  process.once("SIGTERM", () => { cleanup(); process.exit(143); });
  return coordinator;
}

export function createTools(coordinator) {
  return {
    unified_status: {
      name: "unified_status",
      description: "Return current normalized health for Plumb and Custom backends plus active backend detection.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => textResult(await coordinator.status())
    },
    unified_backends: {
      name: "unified_backends",
      description: "Return known Unified MCP backends and their capability summaries.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => textResult(await coordinator.backends())
    },
    unified_active_backend: {
      name: "unified_active_backend",
      description: "Return only the currently detected active Figma backend.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => textResult(await coordinator.activeBackend())
    },
    unified_probe_backend: {
      name: "unified_probe_backend",
      description: "Run a safe read-only diagnostic through one backend: plumb or custom.",
      inputSchema: {
        type: "object",
        properties: { backend: { type: "string", enum: ["plumb", "custom"] } },
        required: ["backend"],
        additionalProperties: false
      },
      handler: async (args) => textResult(await coordinator.probeBackend(args))
    }
  };
}

export function createServer(env = process.env) {
  const coordinator = createCoordinator(env);
  return new SimpleMcpServer({ name: "figma-unified-mcp", version: "0.1.0", tools: createTools(coordinator) });
}

