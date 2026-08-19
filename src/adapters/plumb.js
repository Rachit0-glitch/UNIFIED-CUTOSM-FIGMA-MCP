import { StdioMcpClient } from "../mcp/stdioClient.js";
import { ERROR_CODES, UnifiedError, errorShape, normalizeBackendError } from "../errors.js";
import { nowIso, parseToolText, sleep, withTimeout } from "../utils.js";
import { BackendAdapter, unavailableStatus } from "./base.js";

export class PlumbAdapter extends BackendAdapter {
  constructor(options) {
    super({ id: "plumb", displayName: "Plumb", ...options });
    this.client = null;
    this.clientPromise = null;
  }

  getCapabilities() {
    return {
      ...super.getCapabilities(),
      reads: ["status", "outline"],
      preferredFor: ["outline", "selection", "node extraction", "screenshots", "assets", "PDS"]
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
        timeoutMs: this.config.timeoutMs,
        clientName: "figma-unified-plumb-adapter"
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
        const outlineRaw = await withTimeout(client.callTool("plumb_outline", {}), this.config.timeoutMs, "plumb_outline");
        const outline = parseToolText(outlineRaw);
        if (outlineRaw?.isError) {
          throw new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, "plumb_outline returned an error", { outline });
        }
        return {
          ok: true,
          backend: this.id,
          operation: operation.type || "safe-read",
          status,
          diagnostic: {
            kind: "outline",
            fileName: outline?.file?.name ?? status.fileName ?? null,
            pageCount: outline?.meta?.pageCount ?? null,
            screenCount: outline?.meta?.screenCount ?? null,
            pages: Array.isArray(outline?.pages) ? outline.pages.map((page) => ({ name: page.name, screens: page.screens?.length ?? 0 })) : []
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
    const raw = await withTimeout(client.callTool("plumb_status", {}), this.config.timeoutMs, "plumb_status");
    const payload = parseToolText(raw);
    const plugin = payload.plugin || {};
    const connected = plugin.connected === true;
    return {
      id: this.id,
      mcpAvailable: true,
      bridgeAvailable: typeof plugin.bridgePort === "number" ? true : null,
      pluginPaired: connected,
      figmaConnected: connected,
      usable: connected,
      version: payload.server?.version,
      bridgePort: plugin.bridgePort,
      pluginVersion: plugin.pluginVersion ?? null,
      fileName: plugin.fileName ?? null,
      selection: plugin.selection ?? null,
      screenCount: typeof plugin.screens === "number" ? plugin.screens : null,
      lastCheckedAt: nowIso(),
      raw: { server: payload.server, rest: payload.rest }
    };
  }
}
