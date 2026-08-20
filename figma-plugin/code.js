figma.showUI(__html__, { width: 300, height: 190, title: "Unified Runtime" });

const PROTOCOL_VERSION = "1.0";
const PLUGIN_VERSION = "0.2.0-stage4";

function pluginError(code, message, details) {
  return { code, message, ...(details ? { details } : {}) };
}

// H3 (pre-Block-A hardening) — an extension point, not a full-fidelity read yet. Structured as named
// field groups (deliberately mirroring Custom MCP's own proven `include`-category read pattern) so a
// future higher-fidelity read can be built by adding new group functions below and populating them
// with real Figma data, rather than by writing a second parallel serializer from scratch — the exact
// mistake the read-only Unified MCP audit flagged in the (since-shelved) `custom.design.apply` WIP.
// Only "geometry" and "metadata" are populated today, matching Stage 4's actual shipped read-only
// scope. The remaining groups are real, planned Block-A work — listed explicitly here rather than
// silently implied complete. See docs/PRE_BLOCK_A_HARDENING.md (issue H3) for the full rationale.
const SERIALIZER_FIELD_GROUPS = {
  geometry(node, out) {
    if ("x" in node) out.x = node.x;
    if ("y" in node) out.y = node.y;
    if ("width" in node) out.width = node.width;
    if ("height" in node) out.height = node.height;
  },
  metadata(node, out) {
    if ("visible" in node) out.visible = node.visible;
  }
  // Block A extension points (not yet populated — see docs/PRE_BLOCK_A_HARDENING.md, issue H3):
  //   appearance(node, out) { ...fills/strokes/effects/opacity/blendMode/cornerRadius... }
  //   text(node, out)       { ...characters/font... }
  //   layout(node, out)     { ...layoutMode/padding/gap/constraints... }
  //   component(node, out)  { ...component/instance/variant state... }
  //   variables(node, out)  { ...boundVariables... }
  //   styles(node, out)     { ...fill/stroke/text/effect/grid style ids... }
};

/**
 * @param {*} node
 * @param {number} depth
 * @param {string[]} [include] Optional category filter (same shape as Custom MCP's figma_node
 *   `include` param) — omit for every currently-populated group, matching prior unfiltered behavior.
 */
function serializeNode(node, depth, include) {
  const want = (category) => !include || include.includes(category);
  const out = { id: node.id, name: node.name, type: node.type };
  for (const [category, apply] of Object.entries(SERIALIZER_FIELD_GROUPS)) {
    if (want(category)) apply(node, out);
  }
  if ("children" in node) {
    out.childCount = node.children.length;
    if (depth > 0) out.children = node.children.map((child) => serializeNode(child, depth - 1, include));
  }
  return out;
}

// H4 (pre-Block-A hardening) — raised from 6 to 20 to match Custom MCP's real figma_node limit (see
// src/runtime/limits.js, the server-side source of truth this value is pinned to; the plugin sandbox
// has no module system to import it directly from).
const MAX_READ_DEPTH = 20;

function normalizeDepth(payload, fallback = 1) {
  const depth = Number(payload && payload.depth !== undefined ? payload.depth : fallback);
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_READ_DEPTH) {
    throw new Error(`Depth must be an integer from 0 to ${MAX_READ_DEPTH}.`);
  }
  return depth;
}

function topLevelScreen(node) {
  return ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type);
}

async function runtimeStatus(family) {
  await figma.loadAllPagesAsync();
  return {
    source: "unified-plugin",
    family,
    pluginVersion: PLUGIN_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    file: { name: figma.root.name || null },
    currentPage: figma.currentPage.name,
    pageCount: figma.root.children.length,
    selectionCount: figma.currentPage.selection.length
  };
}

async function plumbOutline(payload) {
  await figma.loadAllPagesAsync();
  const pageFilter = payload && typeof payload.page === "string" ? payload.page.toLowerCase() : null;
  const pages = figma.root.children
    .filter((page) => !pageFilter || page.name.toLowerCase().includes(pageFilter))
    .map((page) => ({
      name: page.name,
      screens: page.children.filter(topLevelScreen).map((node) => ({
        id: node.id,
        el: node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || node.id,
        name: node.name,
        type: node.type,
        box: "width" in node && "height" in node ? { w: node.width, h: node.height } : null
      }))
    }));
  return {
    source: "unified-plugin",
    file: { name: figma.root.name || null },
    currentPage: figma.currentPage.name,
    pages,
    meta: {
      pageCount: pages.length,
      screenCount: pages.reduce((sum, page) => sum + page.screens.length, 0)
    }
  };
}

async function plumbSelection(payload) {
  const depth = normalizeDepth(payload, 2);
  const selection = figma.currentPage.selection.map((node) => serializeNode(node, depth));
  return {
    source: "unified-plugin",
    currentPage: figma.currentPage.name,
    selectionCount: selection.length,
    selection
  };
}

async function customNode(payload) {
  const depth = normalizeDepth(payload, 1);
  const node = payload && payload.nodeId ? await figma.getNodeByIdAsync(payload.nodeId) : figma.currentPage;
  if (!node) throw new Error(`Node not found: ${payload.nodeId}`);
  return { doc: serializeNode(node, depth) };
}

async function customSelection(payload) {
  const depth = normalizeDepth(payload, 1);
  return {
    doc: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      type: "SELECTION",
      childCount: figma.currentPage.selection.length,
      children: figma.currentPage.selection.map((node) => serializeNode(node, depth))
    }
  };
}

const handlers = {
  plumb: {
    status: async () => await runtimeStatus("plumb"),
    outline: async (payload) => await plumbOutline(payload),
    "selection.read": async (payload) => await plumbSelection(payload)
  },
  custom: {
    status: async () => await runtimeStatus("custom"),
    "node.read": async (payload) => await customNode(payload),
    "selection.read": async (payload) => await customSelection(payload)
  }
};

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw pluginError("INVALID_COMMAND", "Command envelope must be an object.");
  }
  if (envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw pluginError("UNSUPPORTED_PROTOCOL_VERSION", `Unsupported protocol version: ${envelope.protocolVersion || "missing"}.`, {
      expected: PROTOCOL_VERSION,
      received: envelope.protocolVersion
    });
  }
  if (!envelope.requestId || typeof envelope.requestId !== "string") {
    throw pluginError("INVALID_COMMAND", "Command envelope requires requestId.");
  }
  if (!handlers[envelope.family]) {
    throw pluginError("INVALID_COMMAND", `Unsupported command family: ${envelope.family || "missing"}.`);
  }
  if (!handlers[envelope.family][envelope.operation]) {
    throw pluginError("INVALID_COMMAND", `Unsupported operation: ${envelope.family}.${envelope.operation}.`);
  }
}

async function dispatch(envelope) {
  validateEnvelope(envelope);
  return await handlers[envelope.family][envelope.operation](envelope.payload || {});
}

async function handleCommand(envelope) {
  const start = Date.now();
  const request = envelope && typeof envelope === "object" ? envelope : {};
  try {
    const result = await dispatch(envelope);
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: envelope.requestId,
      ok: true,
      family: envelope.family,
      operation: envelope.operation,
      result,
      error: null,
      durationMs: Date.now() - start
    };
  } catch (error) {
    const normalized = error && error.code
      ? error
      : pluginError("FIGMA_API_ERROR", error instanceof Error ? error.message : String(error));
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: typeof request.requestId === "string" ? request.requestId : "missing",
      ok: false,
      family: typeof request.family === "string" ? request.family : "unknown",
      operation: typeof request.operation === "string" ? request.operation : "unknown",
      result: null,
      error: normalized,
      durationMs: Date.now() - start
    };
  }
}

figma.ui.onmessage = async (message) => {
  if (!message || message.kind !== "runtime-command") return;
  const response = await handleCommand(message.envelope);
  figma.ui.postMessage({ kind: "runtime-response", envelope: response });
};

figma.ui.postMessage({
  kind: "plugin-ready",
  pluginVersion: PLUGIN_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  currentPage: figma.currentPage.name
});
