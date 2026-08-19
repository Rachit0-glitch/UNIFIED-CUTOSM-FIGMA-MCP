import { ERROR_CODES, UnifiedError } from "../errors.js";
import { nowIso } from "../utils.js";

export class CommandQueue {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.items = [];
    this.active = null;
  }

  status() {
    return {
      active: Boolean(this.active),
      activeRequestId: this.active?.requestId || null,
      length: this.items.length
    };
  }

  enqueue(job, trace) {
    return new Promise((resolve, reject) => {
      this.items.push({ job, trace: { queuedAt: nowIso(), ...trace }, resolve, reject });
      this.#drain();
    });
  }

  async #drain() {
    if (this.active || this.items.length === 0) return;
    const item = this.items.shift();
    this.active = item.trace;
    this.logger?.event?.({ ...item.trace, status: "queued-start", queueLength: this.items.length });
    try {
      const result = await item.job({ ...item.trace, startedAt: nowIso() });
      item.resolve(result);
    } catch (error) {
      item.reject(error instanceof UnifiedError ? error : new UnifiedError(ERROR_CODES.COMMAND_EXECUTION_FAILED, error instanceof Error ? error.message : String(error)));
    } finally {
      this.logger?.event?.({ ...item.trace, status: "queued-finish", queueLength: this.items.length });
      this.active = null;
      this.#drain();
    }
  }
}
