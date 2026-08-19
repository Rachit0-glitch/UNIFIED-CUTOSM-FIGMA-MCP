import { pathToFileURL } from "node:url";
import { ERROR_CODES, UnifiedError } from "../errors.js";

export class UnifiedRuntimeBridge {
  constructor({ port = 39417, wsModulePath, requestTimeoutMs = 8000, logger }) {
    this.port = port;
    this.wsModulePath = wsModulePath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
    this.wss = null;
    this.socket = null;
    this.pluginVersion = null;
    this.connectedAt = null;
    this.reqCounter = 0;
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
        this.socket = ws;
        this.pluginVersion = null;
        this.connectedAt = new Date().toISOString();
        ws.on("message", (raw) => this.#handleMessage(raw.toString()));
        ws.on("close", () => {
          if (this.socket === ws) {
            this.socket = null;
            this.pluginVersion = null;
            this.connectedAt = null;
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
      connected: Boolean(this.socket && this.socket.readyState === this.socket.OPEN),
      pluginVersion: this.pluginVersion,
      connectedAt: this.connectedAt
    };
  }

  async request(cmd, args = {}, timeoutMs = this.requestTimeoutMs) {
    await this.start();
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new UnifiedError(ERROR_CODES.BACKEND_NOT_PAIRED, `Unified Figma plugin is not paired on ws://127.0.0.1:${this.port}.`);
    }
    this.reqCounter += 1;
    const reqId = `u35_${Date.now()}_${this.reqCounter}`;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new UnifiedError(ERROR_CODES.BACKEND_TIMEOUT, `Unified runtime command "${cmd}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer, cmd });
      this.socket.send(JSON.stringify({ type: "request", reqId, cmd, args }));
    });
  }

  async close() {
    for (const [reqId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new UnifiedError(ERROR_CODES.BACKEND_UNAVAILABLE, "Unified runtime bridge closed."));
      this.pending.delete(reqId);
    }
    if (this.socket) this.socket.close();
    await new Promise((resolve) => this.wss?.close(resolve));
    this.wss = null;
    this.socket = null;
    this.pluginVersion = null;
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
      return;
    }
    if (msg?.type === "reply" && typeof msg.reqId === "string") {
      const pending = this.pending.get(msg.reqId);
      if (!pending) return;
      this.pending.delete(msg.reqId);
      clearTimeout(pending.timer);
      if (msg.ok === false) {
        pending.reject(new UnifiedError(ERROR_CODES.BACKEND_PROTOCOL_ERROR, msg.error || `${pending.cmd} failed without an error message.`));
      } else {
        pending.resolve(msg.payload);
      }
    }
  }
}

