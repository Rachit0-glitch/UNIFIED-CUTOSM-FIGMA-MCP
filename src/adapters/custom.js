import { StdioMcpClient } from "../mcp/stdioClient.js";
import { ERROR_CODES, UnifiedError, errorShape, normalizeBackendError } from "../errors.js";
import { nowIso, parseToolText, sleep, withTimeout } from "../utils.js";
import { BackendAdapter, unavailableStatus } from "./base.js";

export class CustomAdapter extends BackendAdapter {
  constructor(options) {
    super({ id: "custom", displayName: "Custom MCP", ...options });
    this.client = null;
    this.clientPromise = null;
  }

  getCapabilities() {
    return {
      ...super.getCapabilities(),
      reads: ["status", "figma_node"],
      preferredFor: ["strict DSL", "absolute layout", "local images", "node CRUD", "read-back", "cleanup"]
    };
  }

  async getClient() {
    if (this.client && !this.client.closed) return this.client;
    if (this.clientPromise) return await this.clientPromise;
    this.clientPromise = (async () => {
      const client = new StdioMcpClient({
        command: this.config.command,
        args: this.config.args,
        cwd: this.config.cwd,
        env: { FIGMA_CUSTOM_MCP_PORT: String(this.config.port) },
        timeoutMs: this.config.timeoutMs,
        clientName: "figma-unified-custom-adapter"
      });
      await client.connect();
      this.client = client;
      this.clientPromise = null;
      return client;
    })();
    return await this.clientPromise;
  }

  async close() {
    await this.client?.close().catch(() => {});
    this.client = null;
    this.clientPromise = null;
  }

  async getStatus() {
    return await this.logger.timed("status", this.id, async () => {
      try {
        const client = await this.getClient();
        return await this.#statusWithPairWait(client);
      } catch (error) {
        await this.close();
        return unavailableStatus(this.id, error);
      }
    });
  }

  async executeDiagnostic(operation = { type: "safe-read" }) {
    return await this.logger.timed("probe", this.id, async () => {
      try {
        const client = await this.getClient();
        const status = await this.#statusWithPairWait(client);
        this.requirePaired(status);
        const readRaw = await withTimeout(client.callTool("figma_node", { depth: 1, include: ["metadata"] }), this.config.timeoutMs, "figma_node");
        const read = parseToolText(readRaw);
        if (readRaw?.isError) {
          throw new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, "figma_node returned an error", { read });
        }
        return {
          ok: true,
          backend: this.id,
          operation: operation.type || "safe-read",
          status,
          diagnostic: {
            kind: "figma_node",
            nodeId: read?.doc?.id ?? null,
            nodeName: read?.doc?.name ?? null,
            nodeType: read?.doc?.type ?? null,
            childCount: Array.isArray(read?.doc?.children) ? read.doc.children.length : read?.doc?.childCount ?? null
          }
        };
      } catch (error) {
        const normalized = normalizeBackendError(error);
        return { ok: false, backend: this.id, operation: operation.type || "safe-read", error: errorShape(normalized) };
      }
    });
  }

  async #statusWithPairWait(client) {
    let status = await this.#statusFromClient(client);
    const deadline = Date.now() + this.config.pairWaitMs;
    while (!status.pluginPaired && Date.now() < deadline) {
      await sleep(300);
      status = await this.#statusFromClient(client);
    }
    return status;
  }

  async #statusFromClient(client) {
    const raw = await withTimeout(client.callTool("figma_status", {}), this.config.timeoutMs, "figma_status");
    const payload = parseToolText(raw);
    const connected = payload.connected === true;
    return {
      id: this.id,
      mcpAvailable: true,
      bridgeAvailable: typeof payload.bridgePort === "number" ? true : null,
      pluginPaired: connected,
      figmaConnected: connected,
      usable: connected,
      version: undefined,
      bridgePort: payload.bridgePort,
      pluginVersion: payload.pluginVersion ?? null,
      fileName: null,
      lastCheckedAt: nowIso(),
      raw: { note: payload.note ?? null }
    };
  }
}
