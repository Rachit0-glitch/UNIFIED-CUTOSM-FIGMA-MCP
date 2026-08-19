import { pathToFileURL } from "node:url";
import { ERROR_CODES, UnifiedError } from "../errors.js";
import { PROTOCOL_VERSION, validateCommandEnvelope, validateResponseEnvelope } from "./protocol.js";

export class UnifiedRuntimeBridge {
  constructor({ port = 39417, wsModulePath, requestTimeoutMs = 8000, logger }) {
    this.port = port;
    this.wsModulePath = wsModulePath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
    this.wss = null;
    this.socket = null;
    this.pluginVersion = null;
    this.pluginProtocolVersion = null;
    this.connectedAt = null;
    this.pending = new Map();
    this.startPromise = null;
  }

  async start() {
    if (this.wss) return;
    if (this.startPromise) return await this.startPromise;
    this.startPromise = (async () => {
      const mod = await import(pathToFileURL(this.wsModulePath).href);
      const { WebSocketServer } = mod;
      this.wss = new WebSocketServer({ port: this.port, host: "127.0.0.1" });
      this.wss.on("connection", (ws) => {
        if (this.socket && this.socket.readyState === this.socket.OPEN) {
          this.socket.close(1000, "superseded by newer Unified plugin connection");
        }
        this.socket = ws;
        this.pluginVersion = null;
        this.pluginProtocolVersion = null;
        this.connectedAt = new Date().toISOString();
        ws.on("message", (raw) => this.#handleMessage(raw.toString()));
        ws.on("close", () => {
          if (this.socket === ws) {
            this.socket = null;
            this.pluginVersion = null;
            this.pluginProtocolVersion = null;
            this.connectedAt = null;
            this.#rejectPending(new UnifiedError(ERROR_CODES.PLUGIN_DISCONNECTED, "Unified Figma plugin disconnected."));
          }
        });
      });
      this.startPromise = null;
    })();
    return await this.startPromise;
  }

  status() {
    return {
      bridgePort: this.port,
      bridge: this.wss ? "ready" : "stopped",
      connected: Boolean(this.socket && this.socket.readyState === this.socket.OPEN),
      plugin: this.socket && this.socket.readyState === this.socket.OPEN ? "connected" : "disconnected",
      protocolVersion: PROTOCOL_VERSION,
      pluginVersion: this.pluginVersion,
      pluginProtocolVersion: this.pluginProtocolVersion,
      pendingRequests: this.pending.size,
      connectedAt: this.connectedAt
    };
  }

  async execute(envelope, timeoutMs = this.requestTimeoutMs) {
    await this.start();
    validateCommandEnvelope(envelope);
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new UnifiedError(ERROR_CODES.PLUGIN_DISCONNECTED, `Unified Figma plugin is not paired on ws://127.0.0.1:${this.port}.`);
    }
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        reject(new UnifiedError(ERROR_CODES.COMMAND_TIMEOUT, `Unified runtime command "${envelope.family}.${envelope.operation}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(envelope.requestId, { resolve, reject, timer, envelope });
      this.socket.send(JSON.stringify({ type: "command", envelope }));
    });
  }

  async request(cmd, args = {}, timeoutMs = this.requestTimeoutMs) {
    const legacyMap = {
      "plumb-outline": { family: "plumb", operation: "outline" },
      "custom-node": { family: "custom", operation: "node.read" },
      "runtime-status": { family: "custom", operation: "status" }
    };
    const mapped = legacyMap[cmd];
    if (!mapped) throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Unsupported legacy runtime command: ${cmd}.`);
    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: `legacy-${Date.now()}`,
      family: mapped.family,
      operation: mapped.operation,
      payload: args,
      metadata: { legacyCommand: cmd }
    };
    const response = await this.execute(envelope, timeoutMs);
    if (!response.ok) {
      throw new UnifiedError(response.error?.code || ERROR_CODES.COMMAND_EXECUTION_FAILED, response.error?.message || `${cmd} failed.`, response.error?.details);
    }
    return response.result;
  }

  async close() {
    this.#rejectPending(new UnifiedError(ERROR_CODES.RUNTIME_UNAVAILABLE, "Unified runtime bridge closed."));
    if (this.socket) this.socket.close();
    await new Promise((resolve) => this.wss?.close(resolve));
    this.wss = null;
    this.socket = null;
    this.pluginVersion = null;
    this.pluginProtocolVersion = null;
    this.connectedAt = null;
  }

  #handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg?.type === "hello") {
      this.pluginVersion = typeof msg.pluginVersion === "string" ? msg.pluginVersion : "unknown";
      this.pluginProtocolVersion = typeof msg.protocolVersion === "string" ? msg.protocolVersion : "unknown";
      return;
    }
    if (msg?.type === "response" && msg.envelope?.requestId) {
      const pending = this.pending.get(msg.envelope.requestId);
      if (!pending) return;
      this.pending.delete(msg.envelope.requestId);
      clearTimeout(pending.timer);
      try {
        pending.resolve(validateResponseEnvelope(msg.envelope, pending.envelope.requestId));
      } catch (error) {
        pending.reject(error);
      }
    }
  }

  #rejectPending(error) {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}

