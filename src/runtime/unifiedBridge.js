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
    // Block A / A11 timeout investigation — bounded ring of recently-timed-out requestIds, so a
    // late-arriving response can be identified and reported instead of silently discarded. See
    // #handleMessage and docs/BLOCK_A_LIMITATIONS.md.
    this.recentTimeouts = new Map();
    this.orphanResponseCount = 0;
    this.lastOrphanResponse = null;
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
      connectedAt: this.connectedAt,
      // Block A / A11 timeout investigation diagnostics — see docs/BLOCK_A_LIMITATIONS.md.
      diagnostics: {
        orphanResponseCount: this.orphanResponseCount,
        lastOrphanResponse: this.lastOrphanResponse
      }
    };
  }

  async execute(envelope, timeoutMs = this.requestTimeoutMs) {
    await this.start();
    validateCommandEnvelope(envelope);
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      throw new UnifiedError(ERROR_CODES.PLUGIN_DISCONNECTED, `Unified Figma plugin is not paired on ws://127.0.0.1:${this.port}.`);
    }
    const sentAt = Date.now();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        // Block A / A11 timeout investigation — record the timed-out request (not just delete it) so a
        // response that arrives AFTER this point can be recognized as a genuine late arrival (see
        // #handleMessage's orphan-response branch below) instead of vanishing with zero trace. This is
        // the specific mechanism that would explain "operation actually succeeded, caller saw
        // COMMAND_TIMEOUT" — see docs/BLOCK_A_LIMITATIONS.md.
        this.recentTimeouts.set(envelope.requestId, { envelope, sentAt, timedOutAt: Date.now() });
        if (this.recentTimeouts.size > 50) {
          const oldest = this.recentTimeouts.keys().next().value;
          this.recentTimeouts.delete(oldest);
        }
        this.logger?.event?.({
          status: "bridge_timeout",
          requestId: envelope.requestId,
          family: envelope.family,
          operation: envelope.operation,
          waitedMs: Date.now() - sentAt,
          timeoutMs
        });
        reject(new UnifiedError(ERROR_CODES.COMMAND_TIMEOUT, `Unified runtime command "${envelope.family}.${envelope.operation}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(envelope.requestId, { resolve, reject, timer, envelope, sentAt });
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
      if (!pending) {
        // Block A / A11 timeout investigation — a response for a requestId that already timed out
        // is exactly the "operation actually succeeded but the caller saw COMMAND_TIMEOUT" mechanism
        // (see docs/BLOCK_A_LIMITATIONS.md). Recording it (instead of silently dropping it, which is
        // what this branch used to do) turns a previously invisible failure mode into observable data.
        const timedOut = this.recentTimeouts.get(msg.envelope.requestId);
        if (timedOut) {
          this.orphanResponseCount += 1;
          this.lastOrphanResponse = {
            requestId: msg.envelope.requestId,
            family: timedOut.envelope.family,
            operation: timedOut.envelope.operation,
            waitedBeforeTimeoutMs: timedOut.timedOutAt - timedOut.sentAt,
            arrivedAfterTimeoutMs: Date.now() - timedOut.timedOutAt,
            responseOk: Boolean(msg.envelope.ok)
          };
          this.logger?.event?.({ status: "bridge_orphan_response", ...this.lastOrphanResponse });
        }
        return;
      }
      this.pending.delete(msg.envelope.requestId);
      this.recentTimeouts.delete(msg.envelope.requestId);
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

