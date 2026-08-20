import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UnifiedRuntimeBridge } from "../src/runtime/unifiedBridge.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";

// Block A / A11 — proves the timeout-investigation instrumentation added to UnifiedRuntimeBridge
// actually works: a response that arrives AFTER its request already timed out must be recognized as
// an "orphan response" (the exact mechanism that would explain "operation succeeded, caller saw
// COMMAND_TIMEOUT" — see docs/BLOCK_A_LIMITATIONS.md) instead of being silently discarded.

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.OPEN = 1;
    this.sent = [];
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

class FakeWebSocketServer extends EventEmitter {
  constructor() {
    super();
  }
  close(cb) {
    cb?.();
  }
}

function writeFakeWsModule() {
  const dir = mkdtempSync(path.join(tmpdir(), "unified-fake-ws-"));
  const file = path.join(dir, "fake-ws.mjs");
  writeFileSync(
    file,
    `
    import { EventEmitter } from "node:events";
    export class WebSocketServer extends EventEmitter {
      constructor() { super(); globalThis.__fakeWss = this; }
      close(cb) { cb?.(); }
    }
    `
  );
  return file;
}

async function makeConnectedBridge({ timeoutMs = 50 } = {}) {
  const wsModulePath = writeFakeWsModule();
  const events = [];
  const bridge = new UnifiedRuntimeBridge({ port: 0, wsModulePath, requestTimeoutMs: timeoutMs, logger: { event: (e) => events.push(e) } });
  await bridge.start();
  const socket = new FakeSocket();
  globalThis.__fakeWss.emit("connection", socket);
  return { bridge, socket, events };
}

test("A11: a response arriving after its own timeout is recorded as an orphan response, not silently dropped", async () => {
  const { bridge, socket, events } = await makeConnectedBridge({ timeoutMs: 30 });
  const envelope = { protocolVersion: PROTOCOL_VERSION, requestId: "test-orphan-1", family: "custom", operation: "node.read", payload: {} };

  let caught = null;
  const promise = bridge.execute(envelope, 30).catch((e) => {
    caught = e;
  });

  await new Promise((r) => setTimeout(r, 60)); // let the 30ms timeout fire
  await promise;
  assert.ok(caught, "expected the call to have rejected with a timeout");
  assert.equal(caught.code, "COMMAND_TIMEOUT");
  assert.equal(bridge.status().diagnostics.orphanResponseCount, 0, "no orphan yet — the late response hasn't arrived");

  // Now simulate the plugin's real (late) response arriving.
  socket.emit(
    "message",
    JSON.stringify({
      type: "response",
      envelope: { protocolVersion: PROTOCOL_VERSION, requestId: "test-orphan-1", ok: true, family: "custom", operation: "node.read", result: { doc: {} }, error: null, durationMs: 45 }
    })
  );

  const status = bridge.status();
  assert.equal(status.diagnostics.orphanResponseCount, 1);
  assert.equal(status.diagnostics.lastOrphanResponse.requestId, "test-orphan-1");
  assert.equal(status.diagnostics.lastOrphanResponse.responseOk, true, "the late response shows the operation actually succeeded");
  assert.ok(events.some((e) => e.status === "bridge_orphan_response"), "expected the orphan to be logged via the injected logger");
});

test("A11: a normal on-time response is never counted as an orphan", async () => {
  const { bridge, socket } = await makeConnectedBridge({ timeoutMs: 5000 });
  const envelope = { protocolVersion: PROTOCOL_VERSION, requestId: "test-normal-1", family: "custom", operation: "node.read", payload: {} };
  const promise = bridge.execute(envelope, 5000);
  // execute() itself awaits this.start() before registering the pending request, so it needs at least
  // one microtask tick before `pending.set()` has actually run — emit the fake response after that,
  // not synchronously right after calling execute(), or it arrives before anyone is listening for it.
  await new Promise((r) => setImmediate(r));
  socket.emit(
    "message",
    JSON.stringify({
      type: "response",
      envelope: { protocolVersion: PROTOCOL_VERSION, requestId: "test-normal-1", ok: true, family: "custom", operation: "node.read", result: {}, error: null, durationMs: 3 }
    })
  );
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(bridge.status().diagnostics.orphanResponseCount, 0);
});

test("A11: the recentTimeouts ring buffer is bounded (does not leak memory across many timeouts)", async () => {
  const { bridge } = await makeConnectedBridge({ timeoutMs: 5 });
  for (let i = 0; i < 60; i++) {
    const envelope = { protocolVersion: PROTOCOL_VERSION, requestId: `flood-${i}`, family: "custom", operation: "node.read", payload: {} };
    await bridge.execute(envelope, 5).catch(() => {});
  }
  assert.ok(bridge.recentTimeouts.size <= 50, "expected the ring buffer to stay bounded at 50 entries");
});
