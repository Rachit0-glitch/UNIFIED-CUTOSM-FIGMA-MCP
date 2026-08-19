import { ERROR_CODES, UnifiedError } from "./errors.js";

export class BackendRegistry {
  constructor() {
    this.backends = new Map();
  }

  register(adapter) {
    this.backends.set(adapter.id, adapter);
  }

  get(id) {
    const backend = this.backends.get(id);
    if (!backend) throw new UnifiedError(ERROR_CODES.BACKEND_NOT_FOUND, `Backend not found: ${id}`);
    return backend;
  }

  list() {
    return [...this.backends.values()];
  }

  capabilities() {
    return this.list().map((backend) => backend.getCapabilities());
  }

  async statuses() {
    const entries = await Promise.all(this.list().map(async (backend) => [backend.id, await backend.getStatus()]));
    return Object.fromEntries(entries);
  }

  async close() {
    await Promise.all(this.list().map((backend) => backend.close?.().catch(() => {})));
  }
}

export function determineActiveBackend(statuses) {
  const usable = Object.entries(statuses)
    .filter(([, status]) => status?.pluginPaired === true && status?.usable === true)
    .map(([id]) => id);
  if (usable.length === 0) return "none";
  if (usable.length === 1) return usable[0];
  return "ambiguous";
}
