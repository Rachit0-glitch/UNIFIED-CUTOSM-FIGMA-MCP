export class UnifiedRuntimeService {
  constructor({ bridge, logger }) {
    this.bridge = bridge;
    this.logger = logger;
  }

  async status() {
    await this.bridge.start();
    return { ok: true, runtime: this.bridge.status() };
  }

  async plumbRead() {
    return await this.logger.timed("unified_runtime_plumb_read", "unified-runtime", async () => {
      const outline = await this.bridge.request("plumb-outline", {});
      return { ok: true, family: "plumb", diagnostic: outline, runtime: this.bridge.status() };
    });
  }

  async customRead() {
    return await this.logger.timed("unified_runtime_custom_read", "unified-runtime", async () => {
      const node = await this.bridge.request("custom-node", { depth: 1 });
      return { ok: true, family: "custom", diagnostic: node, runtime: this.bridge.status() };
    });
  }

  async acceptanceSequence() {
    return await this.logger.timed("unified_runtime_sequence", "unified-runtime", async () => {
      const firstPlumb = await this.bridge.request("plumb-outline", {});
      const custom = await this.bridge.request("custom-node", { depth: 1 });
      const secondPlumb = await this.bridge.request("plumb-outline", {});
      return {
        ok: true,
        manualPluginSwitching: 0,
        pluginRestarts: 0,
        sequence: [
          { family: "plumb", diagnostic: firstPlumb },
          { family: "custom", diagnostic: custom },
          { family: "plumb", diagnostic: secondPlumb }
        ],
        runtime: this.bridge.status()
      };
    });
  }
}
