import { ERROR_CODES, UnifiedError } from "../errors.js";
import { nowIso } from "../utils.js";

/**
 * H7 (pre-Block-A hardening) — a caller could previously wait indefinitely before a queued command
 * even started executing (no bound on queue length, no timeout on the wait itself). Now bounded on
 * both axes, with two DISTINCT failure modes that must never be conflated:
 *   - QUEUE_FULL:          the queue itself is at capacity; the command was never accepted at all.
 *   - QUEUE_WAIT_TIMEOUT:  the command was accepted but waited too long before starting to run.
 *   - COMMAND_TIMEOUT:     (unchanged, from UnifiedRuntimeBridge) the command STARTED running but the
 *                          capability itself took too long. Never raised by this class.
 */
export class CommandQueue {
  constructor({ logger, maxQueueLength = 50, queueWaitTimeoutMs = 15000 } = {}) {
    this.logger = logger;
    this.items = [];
    this.active = null;
    this.maxQueueLength = maxQueueLength;
    this.queueWaitTimeoutMs = queueWaitTimeoutMs;
  }

  status() {
    return {
      active: Boolean(this.active),
      activeRequestId: this.active?.requestId || null,
      length: this.items.length,
      maxQueueLength: this.maxQueueLength,
      queueWaitTimeoutMs: this.queueWaitTimeoutMs
    };
  }

  enqueue(job, trace) {
    if (this.items.length >= this.maxQueueLength) {
      return Promise.reject(
        new UnifiedError(ERROR_CODES.QUEUE_FULL, `Command queue is full (${this.items.length}/${this.maxQueueLength} pending) — try again once earlier commands finish.`, {
          maxQueueLength: this.maxQueueLength,
          queueLength: this.items.length
        })
      );
    }
    return new Promise((resolve, reject) => {
      const item = { job, trace: { queuedAt: nowIso(), ...trace }, resolve, reject, waitTimer: null };
      item.waitTimer = setTimeout(() => {
        const index = this.items.indexOf(item);
        if (index === -1) return; // already picked up by #drain — execution timeout (if any) governs from here, not this
        this.items.splice(index, 1);
        this.logger?.event?.({ ...item.trace, status: "queue-wait-timeout", queueLength: this.items.length });
        item.reject(
          new UnifiedError(
            ERROR_CODES.QUEUE_WAIT_TIMEOUT,
            `Command waited more than ${this.queueWaitTimeoutMs}ms in queue without starting execution (${item.trace.family ?? "?"}.${item.trace.operation ?? "?"}).`,
            { queueWaitTimeoutMs: this.queueWaitTimeoutMs }
          )
        );
      }, this.queueWaitTimeoutMs);
      this.items.push(item);
      this.#drain();
    });
  }

  async #drain() {
    if (this.active || this.items.length === 0) return;
    const item = this.items.shift();
    clearTimeout(item.waitTimer); // now executing — the wait-timeout window is over; COMMAND_TIMEOUT (bridge-side) governs from here
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
