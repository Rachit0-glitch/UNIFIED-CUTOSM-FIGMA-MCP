figma.showUI(__html__, { width: 300, height: 190, title: "Unified Runtime" });

const PROTOCOL_VERSION = "1.0";
const PLUGIN_VERSION = "0.3.0-blockA-a1-reads";

function pluginError(code, message, details) {
  return { code, message, ...(details ? { details } : {}) };
}

// Block A / A1 (full-fidelity reads) — resolves H3 from the pre-Block-A hardening pass. This is a
// LITERAL PORT of Custom MCP's own real serializeNode/serializeNodeProperties/mixedSafe
// (FIGMA-CUSTOM-MCP/figma-plugin/code.js:31-33,721,728-886), not a reimplementation — see
// docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md for why this is the correct reuse pattern (Figma plugin
// sandbox code has no module system, so "delegate" for plugin-sandbox logic means "port the exact same
// function bodies," the same way the shelved custom.design.apply mistake was to write a WEAKER
// approximation instead — this is deliberately not that). Kept in verbatim sync with the source; any
// future upstream change to Custom's serializer should be re-ported here, not re-derived.

/** A TEXT node's whole-node font/text fields can be figma.mixed (a Symbol) when they vary across
 * characters; JSON.stringify silently drops a Symbol, so it must be substituted with a plain string
 * sentinel before it ever reaches a bridge reply. */
function mixedSafe(value) {
  return value === figma.mixed ? "mixed" : value;
}

const READBACK_CATEGORIES = new Set(["geometry", "layout", "appearance", "text", "component", "variables", "styles", "metadata"]);

async function serializeNode(node, depth, include) {
  const want = (category) => !include || include.includes(category);
  const out = { id: node.id, name: node.name, type: node.type };

  try {
    await serializeNodeProperties(node, out, want);
  } catch (e) {
    // A single node in a broken/errored state must not crash read-back for its entire ancestor chain
    // — report it and keep going, still recursing into children below.
    out.readError = e.message || String(e);
  }

  if ("children" in node) {
    if (depth <= 0) {
      out.childCount = node.children.length;
    } else {
      out.children = await Promise.all(node.children.map((c) => serializeNode(c, depth - 1, include)));
    }
  }
  return out;
}

async function serializeNodeProperties(node, out, want) {
  if (want("geometry")) {
    if ("x" in node) {
      out.x = node.x;
      out.y = node.y;
    }
    if ("width" in node) {
      out.width = node.width;
      out.height = node.height;
    }
    if ("rotation" in node) out.rotation = node.rotation;
    if (node.type === "VECTOR" && Array.isArray(node.vectorPaths) && node.vectorPaths.length) out.vectorPaths = node.vectorPaths;
    if ("absoluteBoundingBox" in node) out.absoluteBoundingBox = node.absoluteBoundingBox;
    if (node.parent) {
      out.parentId = node.parent.id;
      if ("children" in node.parent) out.index = node.parent.children.indexOf(node);
    }
  }

  if (want("layout")) {
    if ("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE") out.absolute = true;
    if ("layoutMode" in node && node.layoutMode && node.layoutMode !== "NONE") {
      out.layout = {
        mode: node.layoutMode,
        gap: node.itemSpacing,
        pad: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft],
        justify: node.primaryAxisAlignItems,
        align: node.counterAxisAlignItems
      };
      if (node.layoutWrap === "WRAP") {
        out.layout.wrap = true;
        out.layout.wrapAlign = node.counterAxisAlignContent;
      }
      if (node.itemReverseZIndex === true) out.layout.reverseZIndex = true;
    }
    if (node.constraints && (node.constraints.horizontal || node.constraints.vertical)) {
      out.constraints = { horizontal: node.constraints.horizontal, vertical: node.constraints.vertical };
    }
    if (typeof node.layoutSizingHorizontal === "string" || typeof node.layoutSizingVertical === "string") {
      out.sizing = { horizontal: node.layoutSizingHorizontal, vertical: node.layoutSizingVertical };
    }
    if (Array.isArray(node.layoutGrids) && node.layoutGrids.length) out.layoutGrids = node.layoutGrids;
  }

  if (want("appearance")) {
    if ("opacity" in node) out.opacity = node.opacity;
    if ("blendMode" in node && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") out.blendMode = node.blendMode;
    if (Array.isArray(node.fills) && node.fills.length) out.fills = node.fills;
    if (Array.isArray(node.strokes) && node.strokes.length) out.strokes = node.strokes;
    if (typeof node.cornerRadius === "number") out.cornerRadius = node.cornerRadius;
    if (node.clipsContent === true) out.clip = true;
    if (node.isMask === true) out.isMask = true;
    if (typeof node.maskType === "string" && node.maskType && node.maskType !== "ALPHA") out.maskType = node.maskType;
    if (Array.isArray(node.effects) && node.effects.length) out.effects = node.effects;
  }

  if (want("text") && node.type === "TEXT") {
    out.characters = node.characters;
    const fontName = mixedSafe(node.fontName);
    out.fontFamily = fontName === "mixed" ? "mixed" : fontName.family;
    out.fontStyle = fontName === "mixed" ? "mixed" : fontName.style;
    out.fontSize = mixedSafe(node.fontSize);
    out.textAlignHorizontal = node.textAlignHorizontal;
    out.textAlignVertical = node.textAlignVertical;
    out.textCase = mixedSafe(node.textCase);
    out.textDecoration = mixedSafe(node.textDecoration);
    const lineHeight = mixedSafe(node.lineHeight);
    out.lineHeight = lineHeight === "mixed" ? "mixed" : lineHeight;
    const letterSpacing = mixedSafe(node.letterSpacing);
    out.letterSpacing = letterSpacing === "mixed" ? "mixed" : letterSpacing;
  }

  if (want("styles")) {
    if (typeof node.fillStyleId === "string" && node.fillStyleId) out.fillStyleId = node.fillStyleId;
    if (typeof node.strokeStyleId === "string" && node.strokeStyleId) out.strokeStyleId = node.strokeStyleId;
    if (typeof node.textStyleId === "string" && node.textStyleId) out.textStyleId = node.textStyleId;
    if (typeof node.effectStyleId === "string" && node.effectStyleId) out.effectStyleId = node.effectStyleId;
    if (typeof node.gridStyleId === "string" && node.gridStyleId) out.gridStyleId = node.gridStyleId;
  }

  if (want("variables")) {
    if (node.boundVariables && Object.keys(node.boundVariables).length) out.boundVariables = node.boundVariables;
  }

  if (want("component")) {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      if (node.variantProperties) out.variantProperties = node.variantProperties;
      if (node.componentPropertyDefinitions && Object.keys(node.componentPropertyDefinitions).length) {
        out.componentPropertyDefinitions = node.componentPropertyDefinitions;
      }
    }
    if (node.type === "INSTANCE") {
      if (node.componentProperties && Object.keys(node.componentProperties).length) out.componentProperties = node.componentProperties;
      if (Array.isArray(node.overrides) && node.overrides.length) out.overrides = node.overrides;
      // `mainComponent` is write-only under documentAccess:"dynamic-page" — getMainComponentAsync() is
      // the required read path (same reason every setter in this codebase is already async).
      const mainComponent = await node.getMainComponentAsync();
      if (mainComponent) out.mainComponentId = mainComponent.id;
    }
    if (node.type === "BOOLEAN_OPERATION") out.booleanOperation = node.booleanOperation;
  }

  if (want("metadata")) {
    if (node.locked === true) out.locked = true;
    if (node.expanded === false) out.expanded = false;
    if ("visible" in node) out.visible = node.visible;
    if (Array.isArray(node.exportSettings) && node.exportSettings.length) out.exportSettings = node.exportSettings;
  }
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

// Plumb-family reads intentionally keep their own compact geometry+visibility summary shape — the
// same "do not force identical semantics" principle as the rest of Block A (see
// docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md, ownership principle). The full-fidelity serializeNode
// above is Custom-family-only; blurring it into plumb.selection.read would make Plumb reads suddenly
// balloon in size and shape for no plumb-side benefit.
function plumbSerializeNode(node, depth) {
  const out = { id: node.id, name: node.name, type: node.type };
  if ("x" in node) {
    out.x = node.x;
    out.y = node.y;
  }
  if ("width" in node) {
    out.width = node.width;
    out.height = node.height;
  }
  if ("visible" in node) out.visible = node.visible;
  if ("children" in node) {
    out.childCount = node.children.length;
    if (depth > 0) out.children = node.children.map((child) => plumbSerializeNode(child, depth - 1));
  }
  return out;
}

async function plumbSelection(payload) {
  const depth = normalizeDepth(payload, 2);
  const selection = figma.currentPage.selection.map((node) => plumbSerializeNode(node, depth));
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
  const include = (payload && payload.include) || null;
  return { doc: await serializeNode(node, depth, include) };
}

async function customSelection(payload) {
  const depth = normalizeDepth(payload, 1);
  const include = (payload && payload.include) || null;
  return {
    doc: {
      id: figma.currentPage.id,
      name: figma.currentPage.name,
      type: "SELECTION",
      childCount: figma.currentPage.selection.length,
      children: await Promise.all(figma.currentPage.selection.map((node) => serializeNode(node, depth, include)))
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
