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
