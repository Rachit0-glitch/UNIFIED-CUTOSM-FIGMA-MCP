import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UnifiedRuntimeBridge } from "../src/runtime/unifiedBridge.js";
import { PROTOCOL_VERSION } from "../src/runtime/protocol.js";

// Block B §14/§16 — proves connectionGeneration actually identifies which physical plugin connection
// is paired, across a real disconnect/reconnect cycle, and that it's captured at send-time (not read
// live at timeout-time) so a diagnostic event always reflects the connection the request was actually
// sent on, even if a reconnect happens while the request is still in flight.

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

async function makeBridge({ timeoutMs = 50 } = {}) {
  const wsModulePath = writeFakeWsModule();
  const events = [];
  const bridge = new UnifiedRuntimeBridge({ port: 0, wsModulePath, requestTimeoutMs: timeoutMs, logger: { event: (e) => events.push(e) } });
  await bridge.start();
  return { bridge, events };
}

function connect(bridge) {
  const socket = new FakeSocket();
  globalThis.__fakeWss.emit("connection", socket);
  return socket;
}

test("connectionGeneration: starts at 0 before any plugin has ever connected", async () => {
  const { bridge } = await makeBridge();
  assert.equal(bridge.status().connectionGeneration, 0);
});

test("connectionGeneration: becomes 1 on the first real connection, and is logged on plugin_connected", async () => {
  const { bridge, events } = await makeBridge();
  connect(bridge);
  assert.equal(bridge.status().connectionGeneration, 1);
  const connectedEvent = events.find((e) => e.status === "plugin_connected");
  assert.ok(connectedEvent, "expected a plugin_connected event");
  assert.equal(connectedEvent.connectionGeneration, 1);
});

test("connectionGeneration: increments again on a real reconnect (2nd physical connection = generation 2)", async () => {
  const { bridge, events } = await makeBridge();
  const first = connect(bridge);
  assert.equal(bridge.status().connectionGeneration, 1);
  first.close(); // plugin closes / bridge notices disconnect
  assert.equal(bridge.status().connected, false);
  connect(bridge); // plugin reopens
  assert.equal(bridge.status().connectionGeneration, 2, "a genuine reconnect must be a new generation, not reuse the old one");
  const connectedEvents = events.filter((e) => e.status === "plugin_connected");
  assert.equal(connectedEvents.length, 2);
  assert.deepEqual(connectedEvents.map((e) => e.connectionGeneration), [1, 2]);
});

test("connectionGeneration: plugin_disconnected is logged with the generation that actually disconnected, not a generation that hasn't happened yet", async () => {
  const { bridge, events } = await makeBridge();
  const first = connect(bridge);
  first.close();
  const disconnectedEvent = events.find((e) => e.status === "plugin_disconnected");
  assert.ok(disconnectedEvent);
  assert.equal(disconnectedEvent.connectionGeneration, 1);
});

test("connectionGeneration: a request in flight when its own connection drops is rejected immediately with PLUGIN_DISCONNECTED, never left to silently time out or get relabeled onto the next generation", async () => {
  const { bridge } = await makeBridge({ timeoutMs: 5000 }); // long timeout — must NOT be what resolves this
  connect(bridge); // generation 1
  const envelope = { protocolVersion: PROTOCOL_VERSION, requestId: "gen-test-1", family: "custom", operation: "node.read", payload: {} };
  const promise = bridge.execute(envelope, 5000);

  await new Promise((r) => setImmediate(r));
  const first = bridge.socket;
  const start = Date.now();
  first.close(); // generation 1 drops while the request is still in flight
  connect(bridge); // generation 2 pairs immediately after

  let caught = null;
  await promise.catch((e) => {
    caught = e;
  });
  assert.ok(caught, "expected the in-flight request to reject, not hang until the 5s timeout");
  assert.equal(caught.code, "PLUGIN_DISCONNECTED");
  assert.ok(Date.now() - start < 1000, "must reject immediately on disconnect, not wait anywhere near the 5000ms request timeout");
  assert.equal(bridge.status().connectionGeneration, 2, "generation 2 is paired even though generation 1's request just failed");
});

test("status(): connectionGeneration is present alongside the existing diagnostics block, without disturbing it", async () => {
  const { bridge } = await makeBridge();
  connect(bridge);
  const status = bridge.status();
  assert.equal(status.connectionGeneration, 1);
  assert.equal(status.diagnostics.orphanResponseCount, 0);
});
