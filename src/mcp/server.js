export class SimpleMcpServer {
  constructor({ name, version, tools }) {
    this.name = name;
    this.version = version;
    this.tools = tools;
    this.buffer = "";
  }

  start() {
    process.stdin.on("data", (chunk) => this.#pump(chunk));
  }

  async #dispatch(message) {
    if (!message.method || message.id === undefined) return null;
    if (message.method === "initialize") {
      return {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: this.name, version: this.version }
      };
    }
    if (message.method === "tools/list") {
      return { tools: Object.values(this.tools).map(({ handler, ...tool }) => tool) };
    }
    if (message.method === "tools/call") {
      const tool = this.tools[message.params?.name];
      if (!tool) throw { code: -32602, message: `Unknown tool: ${message.params?.name}` };
      return await tool.handler(message.params?.arguments || {});
    }
    throw { code: -32601, message: `Unsupported method: ${message.method}` };
  }

  async #handle(message) {
    if (message.id === undefined) return;
    try {
      const result = await this.#dispatch(message);
      this.#send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      const err = typeof error === "object" && error?.code ? error : { code: -32603, message: error instanceof Error ? error.message : String(error) };
      this.#send({ jsonrpc: "2.0", id: message.id, error: err });
    }
  }

  #send(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  #pump(chunk) {
    this.buffer += chunk.toString("utf8");
    while (true) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      this.#handle(JSON.parse(line));
    }
  }
}
