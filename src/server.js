import { loadConfig } from "./config.js";
import { CoordinatorLogger } from "./logger.js";
import { BackendRegistry } from "./registry.js";
import { UnifiedCoordinator } from "./coordinator.js";
import { PlumbAdapter } from "./adapters/plumb.js";
import { CustomAdapter } from "./adapters/custom.js";
import { UnifiedRuntimeBridge } from "./runtime/unifiedBridge.js";
import { UnifiedRuntimeService } from "./runtime/service.js";
import { SimpleMcpServer } from "./mcp/server.js";
import { errorShape } from "./errors.js";
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
  const runtimeBridge = new UnifiedRuntimeBridge({ ...config.runtime, logger });
  const runtime = new UnifiedRuntimeService({ bridge: runtimeBridge, logger });
  const coordinator = new UnifiedCoordinator({ registry, logger });
  coordinator.runtime = runtime;
  const cleanup = () => Promise.all([registry.close(), runtimeBridge.close()]).catch(() => {});
  process.once("beforeExit", cleanup);
  process.once("SIGINT", () => { cleanup(); process.exit(130); });
  process.once("SIGTERM", () => { cleanup(); process.exit(143); });
  return coordinator;
}

function safeRuntime(handler) {
  return async () => {
    try {
      return textResult(await handler());
    } catch (error) {
      return textResult({ ok: false, error: errorShape(error) });
    }
  };
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
    },
    unified_runtime_status: {
      name: "unified_runtime_status",
      description: "Return Stage 3.5 single Unified Figma plugin runtime bridge status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.status())
    },
    unified_runtime_plumb_read: {
      name: "unified_runtime_plumb_read",
      description: "Run the Stage 3.5 Plumb-family outline read through the single Unified Figma plugin.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.plumbRead())
    },
    unified_runtime_custom_read: {
      name: "unified_runtime_custom_read",
      description: "Run the Stage 3.5 Custom-family node read through the single Unified Figma plugin.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.customRead())
    },
    unified_runtime_acceptance_sequence: {
      name: "unified_runtime_acceptance_sequence",
      description: "Run Plumb-family read, Custom-family read, then Plumb-family read again through one Unified Figma plugin runtime.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.acceptanceSequence())
    }
  };
}

export function createServer(env = process.env) {
  const coordinator = createCoordinator(env);
  return new SimpleMcpServer({ name: "figma-unified-mcp", version: "0.1.0", tools: createTools(coordinator) });
}
