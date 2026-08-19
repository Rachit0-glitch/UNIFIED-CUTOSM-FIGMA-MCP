import { spawn } from "node:child_process";
import { withTimeout } from "../utils.js";

export class StdioMcpClient {
  constructor({ command, args = [], cwd, env = {}, timeoutMs = 8000, clientName = "figma-unified-mcp-client" }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.timeoutMs = timeoutMs;
    this.clientName = clientName;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.closed = false;
  }

  async connect() {
    if (this.child) return;
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child.stdout.on("data", (chunk) => this.#pump(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    this.child.on("close", () => {
      this.closed = true;
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP child closed before response to ${pending.method}. ${this.stderr}`.trim()));
        this.pending.delete(id);
      }
    });

    await withTimeout(
      this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: this.clientName, version: "0.1.0" }
      }),
      this.timeoutMs,
      `${this.clientName} initialize`
    );
    this.notify("notifications/initialized", {});
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.#send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
  }

  notify(method, params = {}) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  async listTools() {
    return await this.request("tools/list", {});
  }

  async callTool(name, args = {}) {
    return await this.request("tools/call", { name, arguments: args });
  }

  async close() {
    if (!this.child) return;
    if (!this.closed) this.child.kill();
    this.child = null;
  }

  #send(message) {
    if (!this.child?.stdin || this.closed) throw new Error("MCP child is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #pump(chunk) {
    this.buffer += chunk.toString("utf8");
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      this.#handleMessage(JSON.parse(line));
    }
  }

  #handleMessage(message) {
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
    } else {
      pending.resolve(message.result);
    }
  }
}
