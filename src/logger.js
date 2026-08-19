let counter = 0;

export class CoordinatorLogger {
  constructor({ level = "info", sink = process.stderr } = {}) {
    this.level = level;
    this.sink = sink;
  }

  nextRequestId() {
    counter += 1;
    return `u2-${String(counter).padStart(4, "0")}`;
  }

  event(entry) {
    if (this.level === "silent") return;
    this.sink.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  }

  async timed(operation, backend, fn) {
    const requestId = this.nextRequestId();
    const start = Date.now();
    this.event({ requestId, operation, backend, status: "start" });
    try {
      const result = await fn(requestId);
      this.event({ requestId, operation, backend, status: "success", durationMs: Date.now() - start });
      return result;
    } catch (error) {
      this.event({
        requestId,
        operation,
        backend,
        status: "error",
        durationMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
