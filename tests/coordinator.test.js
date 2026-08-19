import test from "node:test";
import assert from "node:assert/strict";
import { BackendRegistry, determineActiveBackend } from "../src/registry.js";
import { UnifiedCoordinator } from "../src/coordinator.js";
import { ERROR_CODES, UnifiedError, errorShape, normalizeBackendError } from "../src/errors.js";
import { withTimeout } from "../src/utils.js";

const silentLogger = {
  timed: async (_operation, _backend, fn) => await fn(),
  event: () => {}
};

function status(id, paired, extra = {}) {
  return {
    id,
    mcpAvailable: true,
    bridgeAvailable: true,
    pluginPaired: paired,
    figmaConnected: paired,
    usable: paired,
    lastCheckedAt: "2026-08-19T00:00:00.000Z",
    ...extra
  };
}

function adapter(id, backendStatus, diagnostic = { ok: true }) {
  return {
    id,
    getStatus: async () => backendStatus,
    getCapabilities: () => ({ id, diagnostics: ["status", "safe-read"], writes: false }),
    executeDiagnostic: async () => diagnostic
  };
}

test("determineActiveBackend returns none when no backend is paired", () => {
  assert.equal(determineActiveBackend({ plumb: status("plumb", false), custom: status("custom", false) }), "none");
});

test("determineActiveBackend returns plumb when only Plumb is usable", () => {
  assert.equal(determineActiveBackend({ plumb: status("plumb", true), custom: status("custom", false) }), "plumb");
});

test("determineActiveBackend returns custom when only Custom is usable", () => {
  assert.equal(determineActiveBackend({ plumb: status("plumb", false), custom: status("custom", true) }), "custom");
});

test("determineActiveBackend returns ambiguous when both are usable", () => {
  assert.equal(determineActiveBackend({ plumb: status("plumb", true), custom: status("custom", true) }), "ambiguous");
});

test("registry enumerates and retrieves adapters", () => {
  const registry = new BackendRegistry();
  registry.register(adapter("plumb", status("plumb", true)));
  assert.equal(registry.get("plumb").id, "plumb");
  assert.deepEqual(registry.capabilities().map((item) => item.id), ["plumb"]);
});

test("registry throws normalized backend-not-found error", () => {
  const registry = new BackendRegistry();
  assert.throws(() => registry.get("missing"), /Backend not found/);
});

test("coordinator status includes statuses and active backend", async () => {
  const registry = new BackendRegistry();
  registry.register(adapter("plumb", status("plumb", true)));
  registry.register(adapter("custom", status("custom", false)));
  const coordinator = new UnifiedCoordinator({ registry, logger: silentLogger });
  const result = await coordinator.status();
  assert.equal(result.activeBackend, "plumb");
  assert.equal(result.backends.plumb.usable, true);
});

test("coordinator probe routes to selected backend", async () => {
  const registry = new BackendRegistry();
  registry.register(adapter("custom", status("custom", true), { ok: true, backend: "custom", diagnostic: { kind: "figma_node" } }));
  const coordinator = new UnifiedCoordinator({ registry, logger: silentLogger });
  const result = await coordinator.probeBackend({ backend: "custom" });
  assert.equal(result.ok, true);
  assert.equal(result.backend, "custom");
});

test("coordinator probe reports backend not found", async () => {
  const coordinator = new UnifiedCoordinator({ registry: new BackendRegistry(), logger: silentLogger });
  const result = await coordinator.probeBackend({ backend: "custom" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, ERROR_CODES.BACKEND_NOT_FOUND);
});

test("error normalization maps timeout", () => {
  const error = normalizeBackendError(new Error("operation timed out after 10ms"));
  assert.equal(error.code, ERROR_CODES.BACKEND_TIMEOUT);
});

test("error normalization maps unpaired plugin", () => {
  const error = normalizeBackendError(new Error("No Figma plugin is paired"));
  assert.equal(error.code, ERROR_CODES.BACKEND_NOT_PAIRED);
});

test("error normalization maps unavailable backend", () => {
  const error = normalizeBackendError(new Error("listen EADDRINUSE: address already in use"));
  assert.equal(error.code, ERROR_CODES.BACKEND_UNAVAILABLE);
});

test("withTimeout rejects slow operations", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5, "slow"), /timed out/);
});

test("errorShape preserves UnifiedError code", () => {
  assert.equal(errorShape(new UnifiedError(ERROR_CODES.AMBIGUOUS_ACTIVE_BACKEND, "ambiguous")).code, ERROR_CODES.AMBIGUOUS_ACTIVE_BACKEND);
});
