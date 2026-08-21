import { loadConfig } from "./config.js";
import { CoordinatorLogger } from "./logger.js";
import { BackendRegistry } from "./registry.js";
import { UnifiedCoordinator } from "./coordinator.js";
import { PlumbAdapter } from "./adapters/plumb.js";
import { CustomAdapter } from "./adapters/custom.js";
import { UnifiedRuntimeBridge } from "./runtime/unifiedBridge.js";
import { UnifiedRuntimeService } from "./runtime/service.js";
import { CapabilityRegistry } from "./runtime/capabilities.js";
import { CommandQueue } from "./runtime/commandQueue.js";
import { CommandRouter } from "./runtime/commandRouter.js";
import { PlumbProtocolAdapter } from "./runtime/protocolAdapters/plumb.js";
import { CustomProtocolAdapter } from "./runtime/protocolAdapters/custom.js";
import { SimpleMcpServer } from "./mcp/server.js";
import { errorShape } from "./errors.js";
import { textResult } from "./utils.js";

/**
 * H1 (pre-Block-A hardening) — the legacy Stage-2 diagnostic path (`unified_status`/
 * `unified_backends`/`unified_active_backend`/`unified_probe_backend`) spawns the ORIGINAL, separate
 * Plumb and Custom MCP server processes and requires their ORIGINAL, separate Figma plugins to be
 * paired — structurally the exact two-plugin-runtime problem Stage 3/3.5/4 replaced with the single
 * Unified plugin runtime. Gated behind an explicit opt-in flag so a normal production LLM session has
 * no path back into it by accident. See docs/LEGACY_RUNTIME_POLICY.md.
 */
export function legacyDiagnosticsEnabled(env = process.env) {
  return env.UNIFIED_ENABLE_LEGACY_DIAGNOSTICS === "true";
}

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
  const capabilityRegistry = new CapabilityRegistry();
  const commandQueue = new CommandQueue({ logger, maxQueueLength: config.runtime.maxQueueLength, queueWaitTimeoutMs: config.runtime.queueWaitTimeoutMs });
  const commandRouter = new CommandRouter({
    registry: capabilityRegistry,
    queue: commandQueue,
    bridge: runtimeBridge,
    logger,
    adapters: new Map([
      ["plumb", new PlumbProtocolAdapter()],
      ["custom", new CustomProtocolAdapter()]
    ])
  });
  const runtime = new UnifiedRuntimeService({
    bridge: runtimeBridge,
    router: commandRouter,
    registry: capabilityRegistry,
    queue: commandQueue,
    logger
  });
  // Registering BackendRegistry/adapters here is harmless by itself — construction never spawns a
  // process (PlumbAdapter/CustomAdapter spawn lazily, only inside getStatus()/getClient()). What
  // matters for H1 is that createTools() below never registers an MCP tool that can reach them
  // unless the caller explicitly opted in.
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

export function createTools(coordinator, env = process.env) {
  const tools = {
    // -------------------------------------------------- production Stage 4 surface --
    unified_capabilities: {
      name: "unified_capabilities",
      description: "Return the production runtime capabilities currently supported by Unified MCP (the single-Figma-plugin execution path — see unified_execute).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.capabilities())
    },
    unified_execute: {
      name: "unified_execute",
      description: "Execute one explicit production capability (see unified_capabilities for the list) through the single Unified Figma plugin runtime. This is the primary, and normally only, way to act on Figma through Unified MCP.",
      inputSchema: {
        type: "object",
        properties: {
          capability: { type: "string" },
          payload: { type: "object" },
          metadata: { type: "object" }
        },
        required: ["capability"],
        additionalProperties: false
      },
      handler: async (args) => {
        try {
          return textResult(await coordinator.runtime.execute(args));
        } catch (error) {
          return textResult({ ok: false, error: errorShape(error), runtime: coordinator.runtime.bridge.status(), queue: coordinator.runtime.queue.status() });
        }
      }
    },
    // Block B §6/§8/§9/§21 — the execution planner's only MCP entry point. The caller (the LLM) has
    // already decided the ordered steps; this validates them (preflight, before anything runs), then
    // executes them through the same real CommandRouter unified_execute uses, tracking checkpoints and
    // per-step operationRecords. Pass back the exact `run` object a prior call returned as
    // `previousRun` to resume a plan without re-executing steps that already succeeded.
    unified_execute_plan: {
      name: "unified_execute_plan",
      description: "Execute an ordered, already-decided list of capability steps (each { capability, payload, dependsOn?, checkpoint?, id? }) through the same production Unified Figma plugin runtime as unified_execute, with dependency ordering, checkpoint tracking, and resumability. Preflights the plan (unknown capability, bad dependency, dependency cycle) before executing anything. Pass a prior call's `run` field back as `previousRun` to resume without re-running already-succeeded steps.",
      inputSchema: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                capability: { type: "string" },
                payload: { type: "object" },
                dependsOn: { type: "array", items: { type: "string" } },
                checkpoint: { type: "string" },
                expectedPostcondition: { type: "string" }
              },
              required: ["capability"],
              additionalProperties: false
            },
            minItems: 1
          },
          planId: { type: "string" },
          previousRun: { type: "object" },
          stopOnFailure: { type: "boolean" }
        },
        required: ["steps"],
        additionalProperties: false
      },
      handler: async (args) => {
        try {
          return textResult(await coordinator.runtime.executePlan(args));
        } catch (error) {
          return textResult({ ok: false, executed: false, error: errorShape(error) });
        }
      }
    },
    // H15 — the production-safe status/health capability. Reports only the single Unified runtime
    // (bridge/plugin/protocol/queue) — never spawns or requires the original Plumb/Custom processes.
    unified_runtime_status: {
      name: "unified_runtime_status",
      description: "PRODUCTION STATUS. Report the single Unified Figma plugin runtime's health: bridge state, plugin connection/version, protocol version, and command queue status. Never spawns or requires the original Plumb/Custom MCP processes or their separate plugins.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.status())
    },
    // -------------------------------------------------- deprecated Stage 3.5 POC surface --
    // H5 — these three duplicate unified_execute called with a hardcoded capability id
    // ("plumb.outline" / "custom.node.read" / that pair run twice). Kept only because
    // tests/runtime.test.js already exercises the underlying service methods; not the recommended
    // path for new callers.
    unified_runtime_plumb_read: {
      name: "unified_runtime_plumb_read",
      description: "DEPRECATED — POC/diagnostic only, not for production workflows. Equivalent to unified_execute({capability:\"plumb.outline\"}); prefer calling unified_execute directly.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.plumbRead())
    },
    unified_runtime_custom_read: {
      name: "unified_runtime_custom_read",
      description: "DEPRECATED — POC/diagnostic only, not for production workflows. Equivalent to unified_execute({capability:\"custom.node.read\"}); prefer calling unified_execute directly.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.customRead())
    },
    unified_runtime_acceptance_sequence: {
      name: "unified_runtime_acceptance_sequence",
      description: "DEPRECATED — POC/diagnostic only, not for production workflows. Runs a fixed plumb→custom→plumb unified_execute sequence to demonstrate single-plugin cross-family execution; prefer sequencing unified_execute calls directly.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: safeRuntime(() => coordinator.runtime.acceptanceSequence())
    }
  };

  // H1 — legacy Stage-2 dual-runtime diagnostics: NOT registered at all unless explicitly opted in.
  // A normal production LLM session sees none of these four tools and therefore has no path back
  // into the original two-plugin runtime problem.
  if (legacyDiagnosticsEnabled(env)) {
    Object.assign(tools, {
      unified_status: {
        name: "unified_status",
        description: "LEGACY DIAGNOSTICS ONLY — NOT FOR PRODUCTION DESIGN EXECUTION. Spawns the ORIGINAL, separate Plumb and Custom MCP processes and requires their ORIGINAL, separate Figma plugins (not the Unified plugin). Only available because UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true was set. See docs/LEGACY_RUNTIME_POLICY.md.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: async () => textResult(await coordinator.status())
      },
      unified_backends: {
        name: "unified_backends",
        description: "LEGACY DIAGNOSTICS ONLY — NOT FOR PRODUCTION DESIGN EXECUTION. Same original-process/original-plugin caveat as unified_status. See docs/LEGACY_RUNTIME_POLICY.md.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: async () => textResult(await coordinator.backends())
      },
      unified_active_backend: {
        name: "unified_active_backend",
        description: "LEGACY DIAGNOSTICS ONLY — NOT FOR PRODUCTION DESIGN EXECUTION. Same original-process/original-plugin caveat as unified_status. See docs/LEGACY_RUNTIME_POLICY.md.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        handler: async () => textResult(await coordinator.activeBackend())
      },
      unified_probe_backend: {
        name: "unified_probe_backend",
        description: "LEGACY DIAGNOSTICS ONLY — NOT FOR PRODUCTION DESIGN EXECUTION. Spawns the ORIGINAL, separate Plumb/Custom MCP process for the requested backend and requires its ORIGINAL, separate Figma plugin. See docs/LEGACY_RUNTIME_POLICY.md.",
        inputSchema: {
          type: "object",
          properties: { backend: { type: "string", enum: ["plumb", "custom"] } },
          required: ["backend"],
          additionalProperties: false
        },
        handler: async (args) => textResult(await coordinator.probeBackend(args))
      }
    });
  }

  return tools;
}

export function createServer(env = process.env) {
  const coordinator = createCoordinator(env);
  return new SimpleMcpServer({ name: "figma-unified-mcp", version: "0.1.0", tools: createTools(coordinator, env) });
}
