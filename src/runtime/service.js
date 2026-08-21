import { buildPlan, preflightPlan, executePlan as runExecutionPlan } from "../planning/executionPlanner.js";
import { errorShape } from "../errors.js";

export class UnifiedRuntimeService {
  constructor({ bridge, router, registry, queue, logger }) {
    this.bridge = bridge;
    this.router = router;
    this.registry = registry;
    this.queue = queue;
    this.logger = logger;
  }

  async status() {
    await this.bridge.start();
    return {
      ok: true,
      runtime: this.bridge.status(),
      queue: this.queue.status(),
      capabilities: this.registry.list().filter((capability) => capability.enabled).length
    };
  }

  capabilities() {
    return this.router.capabilities();
  }

  async execute(args) {
    return await this.logger.timed("unified_execute", "unified-runtime", async () => await this.router.execute(args));
  }

  async plumbRead() {
    return await this.logger.timed("unified_runtime_plumb_read", "unified-runtime", async () => {
      const response = await this.router.execute({ capability: "plumb.outline", payload: {} });
      return { ok: response.ok, family: "plumb", diagnostic: response.result, response, runtime: this.bridge.status() };
    });
  }

  async customRead() {
    return await this.logger.timed("unified_runtime_custom_read", "unified-runtime", async () => {
      const response = await this.router.execute({ capability: "custom.node.read", payload: { depth: 1 } });
      return { ok: response.ok, family: "custom", diagnostic: response.result, response, runtime: this.bridge.status() };
    });
  }

  // Block B §6/§8/§9/§21 — the LLM caller submits an already-decided ordered list of steps; this is
  // the ONLY way that plan actually reaches the real CommandRouter/bridge/plugin (executionPlanner.js
  // itself has no MCP surface of its own — see docs/BLOCK_B_ARCHITECTURE.md). Preflight runs BEFORE
  // any step executes: an invalid plan (unknown capability, bad dependency, a cycle) is reported as
  // `executed:false` with the exact problems, never partially run. `previousRun` (the exact object a
  // prior call's `run` field returned) resumes without re-executing already-succeeded steps.
  async executePlan({ steps, planId, previousRun, stopOnFailure } = {}) {
    return await this.logger.timed("unified_execute_plan", "unified-runtime", async () => {
      let plan;
      try {
        plan = buildPlan(steps, { registry: this.registry, planId });
      } catch (error) {
        return { ok: false, executed: false, error: errorShape(error) };
      }
      const preflight = preflightPlan(plan);
      if (!preflight.ok) {
        return { ok: false, executed: false, plan, preflight };
      }
      const run = await runExecutionPlan(plan, this.router, { previousRun, stopOnFailure });
      return { ok: run.ok, executed: true, plan, preflight, run };
    });
  }

  async acceptanceSequence() {
    return await this.logger.timed("unified_runtime_sequence", "unified-runtime", async () => {
      const firstPlumb = await this.router.execute({ capability: "plumb.outline", payload: {} });
      const custom = await this.router.execute({ capability: "custom.node.read", payload: { depth: 1 } });
      const secondPlumb = await this.router.execute({ capability: "plumb.outline", payload: {} });
      return {
        ok: firstPlumb.ok && custom.ok && secondPlumb.ok,
        manualPluginSwitching: 0,
        pluginRestarts: 0,
        sequence: [
          { family: "plumb", capability: "plumb.outline", requestId: firstPlumb.requestId, diagnostic: firstPlumb.result },
          { family: "custom", capability: "custom.node.read", requestId: custom.requestId, diagnostic: custom.result },
          { family: "plumb", capability: "plumb.outline", requestId: secondPlumb.requestId, diagnostic: secondPlumb.result }
        ],
        runtime: this.bridge.status()
      };
    });
  }
}
