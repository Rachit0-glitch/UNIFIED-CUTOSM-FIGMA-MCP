figma.showUI(__html__, { width: 300, height: 190, title: "Unified Runtime" });

const PROTOCOL_VERSION = "1.0";
const PLUGIN_VERSION = "0.6.2-blockB-hierarchy-font-errors";

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

// Block A / A11 — verbatim port of Plumb's own component/instance extraction
// (plumb-mcp/figma-plugin/code.js:1914-1963, `handleGetComponents`), adapted only to return a plain
// object instead of calling Plumb's own wire-protocol `reply()`. Genuinely new capability — no Custom
// equivalent exists (Custom's tools operate on individual nodes/instances, never enumerate every
// COMPONENT/COMPONENT_SET across the whole file with cross-referenced instance counts).
async function plumbComponents() {
  await figma.loadAllPagesAsync();
  const components = [];
  const instanceNodes = [];
  function visit(n, page) {
    if (n.visible === false) return;
    if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
      const bb = n.absoluteBoundingBox;
      const c = { id: n.id, name: n.name, page, w: bb ? Math.round(bb.width) : 0, h: bb ? Math.round(bb.height) : 0, instanceCount: 0 };
      if (n.description) c.description = n.description;
      components.push(c);
    } else if (n.type === "INSTANCE") {
      instanceNodes.push({ node: n, page });
    }
    if (Array.isArray(n.children) && n.type !== "INSTANCE") {
      for (const c of n.children) visit(c, page);
    }
  }
  for (const page of figma.root.children) {
    for (const child of page.children) visit(child, page.name);
  }
  const BATCH = 64;
  const resolved = [];
  for (let i = 0; i < instanceNodes.length; i += BATCH) {
    const slice = instanceNodes.slice(i, i + BATCH);
    const mains = await Promise.all(slice.map(({ node: n }) => n.getMainComponentAsync().catch(() => null)));
    for (let j = 0; j < slice.length; j++) resolved.push({ n: slice[j].node, page: slice[j].page, main: mains[j] });
  }
  const instances = [];
  const instanceCount = new Map();
  for (const { n, page, main } of resolved) {
    if (!main) continue;
    instances.push({ id: n.id, name: n.name, componentId: main.id, page });
    instanceCount.set(main.id, (instanceCount.get(main.id) || 0) + 1);
  }
  for (const c of components) c.instanceCount = instanceCount.get(c.id) || 0;
  return { source: "unified-plugin", components, instances };
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
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${payload.nodeId}`, { nodeId: payload.nodeId });
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

// ============================================================================================
// Block A / A2 (core mutation path) — resolves create/update/delete/reorder. Every function in this
// section down to handleReorderNode is a LITERAL PORT of Custom MCP's real plugin-side mutation code
// (FIGMA-CUSTOM-MCP/figma-plugin/code.js:15-24,35-265,267-403,405-717,901-1013), adapted only where the
// envelope/dispatch shape differs — never re-derived. Validation and DSL compilation for `custom.design`
// happen server-side in src/runtime/protocolAdapters/custom.js, which imports the actual
// figma-custom-mcp compiler/schema modules (see docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md, "reuse by
// import" vs. "reuse by porting") — this plugin only ever receives an already-validated, already-
// compiled `plan`, exactly like the original Custom plugin does from its own MCP server.
// ============================================================================================

const PLUGIN_KEY = "unifiedCustomMcpKey";
// Deliberately a SEPARATE plugin-data namespace from the original Custom plugin's own "customMcpKey"
// (see docs/PLUGIN_DATA_NAMESPACES.md) — Unified's own sync-mode reconciliation must never collide with
// or be confused by nodes tagged by a real, independent original-Custom-plugin session on the same file.
const OPERATION_KEY = "unifiedCustomMcpOperationKey";

function hexToRgba(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: r || 0, g: g || 0, b: b || 0, a: isNaN(a) ? 1 : a };
}

const BLEND_MODE_MAP = {
  normal: "NORMAL", multiply: "MULTIPLY", screen: "SCREEN", overlay: "OVERLAY",
  darken: "DARKEN", lighten: "LIGHTEN", "color-dodge": "COLOR_DODGE", "color-burn": "COLOR_BURN",
  "hard-light": "HARD_LIGHT", "soft-light": "SOFT_LIGHT", difference: "DIFFERENCE", exclusion: "EXCLUSION",
  hue: "HUE", saturation: "SATURATION", color: "COLOR", luminosity: "LUMINOSITY"
};

const WEIGHT_TO_STYLE = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black" };
const FALLBACK_FACES = [{ family: "Inter", style: "Regular" }, { family: "Roboto", style: "Regular" }];

// Block A large-tree stress test (real finding, not a guess): a scaling probe isolated that
// `figma.loadFontAsync` carries meaningful per-call latency in this environment even when called
// repeatedly for the EXACT SAME family+style Figma has already loaded — 901 plain rects (no fonts)
// built in 25.6s, while as few as 50 text nodes (all requesting the same "Inter Medium") alone
// exceeded 90s. This is an intentional, documented DEVIATION from the verbatim port (see
// docs/BLOCK_A_SOURCE_PARITY.md) — a pure performance fast-path, not a behavior change: the exact
// same resolution/fallback algorithm runs, `loadFontAsync` is just skipped once a given family+style
// has already succeeded once in this plugin session.
const loadedFontKeys = new Set();

async function resolveFont(family, weight) {
  const style = WEIGHT_TO_STYLE[Math.round((weight || 400) / 100) * 100] || "Regular";
  const wanted = { family: family || "Inter", style };
  const key = `${wanted.family} ${wanted.style}`;
  if (loadedFontKeys.has(key)) return wanted;
  try {
    await figma.loadFontAsync(wanted);
    loadedFontKeys.add(key);
    return wanted;
  } catch (e) {
    for (const fb of FALLBACK_FACES) {
      const fbKey = `${fb.family} ${fb.style}`;
      if (loadedFontKeys.has(fbKey)) return fb;
      try {
        await figma.loadFontAsync(fb);
        loadedFontKeys.add(fbKey);
        return fb;
      } catch (e2) {
        /* try next */
      }
    }
    throw pluginError("FONT_ERROR", `No usable font found (tried "${wanted.family} ${wanted.style}" and fallbacks).`, { family: wanted.family, style: wanted.style });
  }
}

const GRADIENT_TYPE_MAP = {
  "linear-gradient": "GRADIENT_LINEAR",
  "radial-gradient": "GRADIENT_RADIAL",
  "angular-gradient": "GRADIENT_ANGULAR",
  "diamond-gradient": "GRADIENT_DIAMOND"
};

function toFigmaPaint(fill) {
  if (fill.type === "solid") {
    const c = hexToRgba(fill.color);
    return { type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: fill.opacity !== undefined ? fill.opacity : c.a };
  }
  const angleRad = ((fill.angle || 0) * Math.PI) / 180;
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  const transform = [
    [cos, -sin, 0.5 - 0.5 * cos + 0.5 * sin],
    [sin, cos, 0.5 - 0.5 * sin - 0.5 * cos]
  ];
  return {
    type: GRADIENT_TYPE_MAP[fill.type] || "GRADIENT_LINEAR",
    gradientTransform: transform,
    gradientStops: fill.stops.map((s) => {
      const c = hexToRgba(s.color);
      return { position: s.at, color: { r: c.r, g: c.g, b: c.b, a: c.a } };
    })
  };
}

function toFigmaLayoutGrid(g) {
  const color = g.color ? hexToRgba(g.color) : { r: 1, g: 0, b: 0, a: 0.1 };
  if (g.pattern === "grid") {
    return { pattern: "GRID", sectionSize: g.sectionSize, color, visible: true };
  }
  const alignment = g.alignment.toUpperCase();
  const grid = {
    pattern: g.pattern.toUpperCase(),
    alignment,
    gutterSize: g.gutter,
    count: g.count,
    color,
    visible: true
  };
  if (alignment !== "STRETCH") grid.sectionSize = g.sectionSize ?? 0;
  if (alignment !== "CENTER") grid.offset = g.offset ?? 0;
  return grid;
}

function toFigmaExportSetting(e) {
  const format = e.format.toUpperCase();
  const setting = { format, contentsOnly: e.contentsOnly !== undefined ? e.contentsOnly : true };
  if (e.suffix) setting.suffix = e.suffix;
  if ((format === "PNG" || format === "JPG") && e.scale !== undefined) {
    setting.constraint = { type: "SCALE", value: e.scale };
  }
  return setting;
}

function applyRadius(node, radius) {
  if (radius === undefined) return;
  if (typeof radius === "number") {
    if ("cornerRadius" in node) node.cornerRadius = radius;
    return;
  }
  if ("topLeftRadius" in node) {
    node.topLeftRadius = radius[0];
    node.topRightRadius = radius[1];
    node.bottomRightRadius = radius[2];
    node.bottomLeftRadius = radius[3];
  }
}

function toFigmaEffect(e) {
  const c = hexToRgba(e.color || "#000000");
  if (e.type === "drop-shadow" || e.type === "inner-shadow") {
    return {
      type: e.type === "drop-shadow" ? "DROP_SHADOW" : "INNER_SHADOW",
      color: { r: c.r, g: c.g, b: c.b, a: e.opacity !== undefined ? e.opacity : c.a },
      offset: { x: e.x || 0, y: e.y || 0 },
      radius: e.blur || 0,
      spread: e.spread || 0,
      visible: true,
      blendMode: "NORMAL"
    };
  }
  return { type: e.type === "layer-blur" ? "LAYER_BLUR" : "BACKGROUND_BLUR", radius: e.blur || 0, visible: true };
}

function applyEffects(node, effects) {
  if (!effects || !("effects" in node)) return;
  node.effects = effects.map(toFigmaEffect);
}

function applyLayoutCore(node, layout) {
  node.layoutMode = layout.mode;
  node.itemSpacing = layout.gap || 0;
  const [t, r, b, l] = layout.pad;
  node.paddingTop = t;
  node.paddingRight = r;
  node.paddingBottom = b;
  node.paddingLeft = l;
  if (layout.justify) node.primaryAxisAlignItems = layout.justify;
  if (layout.align) node.counterAxisAlignItems = layout.align;
  if (layout.wrap) node.layoutWrap = "WRAP";
  if (layout.wrapAlign && "counterAxisAlignContent" in node) {
    node.counterAxisAlignContent = layout.wrapAlign === "space-between" ? "SPACE_BETWEEN" : "AUTO";
  }
  if (layout.reverseZIndex !== undefined && "itemReverseZIndex" in node) {
    node.itemReverseZIndex = layout.reverseZIndex;
  }
}

async function createFigmaNode(op, svgTextByRef) {
  if (op.type === "image" && op.svgRef) {
    const svgText = svgTextByRef.get(op.svgRef);
    return figma.createNodeFromSvg(svgText);
  }
  switch (op.type) {
    case "frame":
    case "group":
      return figma.createFrame();
    case "component":
      return figma.createComponent();
    case "rect":
    case "image":
      return figma.createRectangle();
    case "ellipse":
      return figma.createEllipse();
    case "text":
      return figma.createText();
    case "section":
      return figma.createSection();
    case "vector":
      return figma.createVector();
    default:
      throw new Error(`Unknown node type "${op.type}"`);
  }
}

const BOOLEAN_METHOD = { union: "union", subtract: "subtract", intersect: "intersect", exclude: "exclude" };
const BOOLEAN_COMPATIBLE_TYPES = new Set(["RECTANGLE", "ELLIPSE", "VECTOR", "STAR", "POLYGON", "LINE", "BOOLEAN_OPERATION"]);

let paintStyleCache = null;
async function loadPaintStyles(force) {
  if (!paintStyleCache || force) {
    paintStyleCache = await figma.getLocalPaintStylesAsync();
  }
  return paintStyleCache;
}
async function findPaintStyleByName(name) {
  const styles = await loadPaintStyles(false);
  let found = styles.find((s) => s.name === name);
  if (!found) {
    found = (await loadPaintStyles(true)).find((s) => s.name === name);
  }
  return found || null;
}

async function applyIntrinsic(node, op, imageHashByRef) {
  if (op.name) node.name = op.name;
  node.setPluginData(PLUGIN_KEY, op.key);

  const isSvgImage = op.type === "image" && op.svgRef;

  if (op.size && "resize" in node && !isSvgImage) {
    node.resize(Math.max(0.01, op.size.w), Math.max(0.01, op.size.h));
  } else if (op.size && isSvgImage && "resize" in node) {
    node.resize(Math.max(0.01, op.size.w), Math.max(0.01, op.size.h));
  }

  if (op.type === "image" && !op.svgRef) {
    const hash = imageHashByRef.get(op.assetRef);
    if (!hash) throw new Error(`Image asset "${op.assetRef}" was not hydrated.`);
    node.fills = [{ type: "IMAGE", imageHash: hash, scaleMode: "FILL" }];
  } else if (op.fills && "fills" in node && op.type !== "text") {
    node.fills = op.fills.map(toFigmaPaint);
  } else if (!isSvgImage && "fills" in node && op.type !== "text") {
    node.fills = [];
  }

  if (op.stroke && "strokes" in node) {
    const c = hexToRgba(op.stroke.color);
    node.strokes = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
    node.strokeWeight = op.stroke.width;
    if (op.stroke.align && "strokeAlign" in node) node.strokeAlign = op.stroke.align.toUpperCase();
    if (op.stroke.dash && "dashPattern" in node) node.dashPattern = op.stroke.dash;
  }

  applyRadius(node, op.radius);
  applyEffects(node, op.effects);

  if (op.layout && "layoutMode" in node) {
    applyLayoutCore(node, op.layout);
    if (op.size) {
      node.primaryAxisSizingMode = "FIXED";
      node.counterAxisSizingMode = "FIXED";
      node.resize(Math.max(0.01, op.size.w), Math.max(0.01, op.size.h));
    } else {
      node.primaryAxisSizingMode = "AUTO";
      node.counterAxisSizingMode = "AUTO";
    }
  }

  if (op.opacity !== undefined && "opacity" in node) node.opacity = op.opacity;
  if (op.blendMode && "blendMode" in node) node.blendMode = BLEND_MODE_MAP[op.blendMode] || "NORMAL";
  if (op.clip !== undefined && "clipsContent" in node) node.clipsContent = op.clip;
  if (op.isMask !== undefined && "isMask" in node) node.isMask = op.isMask;
  if (op.maskType && "maskType" in node) node.maskType = op.maskType.toUpperCase();
  if (op.rotation !== undefined && "rotation" in node) node.rotation = op.rotation;

  if (op.locked !== undefined && "locked" in node) node.locked = op.locked;
  if (op.expanded !== undefined && "expanded" in node) node.expanded = op.expanded;

  if (op.vectorPaths && "vectorPaths" in node) {
    node.vectorPaths = op.vectorPaths.map((p) => ({ windingRule: p.windingRule.toUpperCase(), data: p.data }));
  }

  if (op.layoutGrids && "layoutGrids" in node) {
    node.layoutGrids = op.layoutGrids.map(toFigmaLayoutGrid);
  }

  if (op.exportSettings && "exportSettings" in node) {
    node.exportSettings = op.exportSettings.map(toFigmaExportSetting);
  }

  if (op.constraints && "constraints" in node) {
    node.constraints = { horizontal: op.constraints.horizontal, vertical: op.constraints.vertical };
  }

  if (op.fillStyleRef) {
    if (!("fillStyleId" in node)) throw new Error(`Node type "${op.type}" does not support fillStyleId.`);
    const style = await findPaintStyleByName(op.fillStyleRef);
    if (!style) throw new Error(`Paint style "${op.fillStyleRef}" not found. Create it first with custom.create_paint_style.`);
    await node.setFillStyleIdAsync(style.id);
  }
  if (op.strokeStyleRef) {
    if (!("strokeStyleId" in node)) throw new Error(`Node type "${op.type}" does not support strokeStyleId.`);
    const style = await findPaintStyleByName(op.strokeStyleRef);
    if (!style) throw new Error(`Paint style "${op.strokeStyleRef}" not found. Create it first with custom.create_paint_style.`);
    await node.setStrokeStyleIdAsync(style.id);
  }

  if (op.type === "text" && op.text) {
    const face = await resolveFont(op.text.fontFamily, op.text.weight);
    node.fontName = face;
    node.characters = op.text.characters;
    if (op.text.fontSize) node.fontSize = op.text.fontSize;
    if (op.text.lineHeightPx) node.lineHeight = { value: op.text.lineHeightPx, unit: "PIXELS" };
    if (op.text.letterSpacing !== undefined) node.letterSpacing = { value: op.text.letterSpacing, unit: "PIXELS" };
    if (op.text.align) node.textAlignHorizontal = op.text.align.toUpperCase();
    if (op.text.color) {
      const c = hexToRgba(op.text.color);
      node.fills = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
    }
    if (op.size === undefined) node.textAutoResize = "WIDTH_AND_HEIGHT";
  }
}

function indexExistingByKey(container) {
  const map = new Map();
  function walk(n) {
    if (n.type === "INSTANCE") return;
    try {
      if (n.getPluginData) {
        const k = n.getPluginData(PLUGIN_KEY);
        if (k) map.set(k, n);
      }
    } catch (e) {
      return;
    }
    if ("children" in n) for (const c of n.children) walk(c);
  }
  for (const c of container.children) walk(c);
  return map;
}

async function resolveTargetContainer(target) {
  if (target.page) {
    let page = figma.root.children.find((p) => p.type === "PAGE" && p.name === target.page);
    if (!page) {
      page = figma.createPage();
      page.name = target.page;
    }
    await page.loadAsync();
    await figma.setCurrentPageAsync(page);
    return page;
  }
  return figma.currentPage;
}

async function handleApplyPlan(args) {
  const plan = args.plan;
  const warnings = [];

  const imageHashByRef = new Map();
  for (const a of plan.assets) {
    try {
      const bytes = figma.base64Decode(a.data);
      const img = figma.createImage(bytes);
      imageHashByRef.set(a.ref, img.hash);
    } catch (e) {
      warnings.push({ ref: a.ref, message: `Failed to create image: ${e.message || e}` });
    }
  }
  const svgTextByRef = new Map();
  for (const s of plan.svgs) svgTextByRef.set(s.ref, s.text);

  const target = await resolveTargetContainer(plan.target);
  const existing = plan.mode === "sync" ? indexExistingByKey(target) : new Map();
  const used = new Set();
  const nodesByKey = new Map();
  let created = 0;
  let updated = 0;

  const booleanOps = plan.ops.filter((o) => o.type === "boolean");
  const absorbedKeys = new Set();
  for (const bop of booleanOps) {
    for (const op of plan.ops) if (op.parent === bop.key) absorbedKeys.add(op.key);
  }

  for (const op of plan.ops) {
    if (op.type === "boolean") continue;
    const reuse = existing.get(op.key);
    let node;
    if (reuse && !reuse.removed) {
      node = reuse;
      used.add(op.key);
      updated += 1;
    } else {
      node = await createFigmaNode(op, svgTextByRef);
      created += 1;
    }
    nodesByKey.set(op.key, node);
    try {
      await applyIntrinsic(node, op, imageHashByRef);
    } catch (e) {
      warnings.push({ key: op.key, message: e.message || String(e) });
    }
  }

  for (const bop of booleanOps) {
    const childOps = plan.ops.filter((o) => o.parent === bop.key);
    const childNodes = childOps.map((o) => nodesByKey.get(o.key)).filter(Boolean);
    if (childNodes.length === 0) {
      warnings.push({ key: bop.key, message: "boolean op has no resolved child shapes — skipped." });
      continue;
    }
    const method = BOOLEAN_METHOD[bop.booleanOp];
    if (!method) {
      warnings.push({ key: bop.key, message: `unknown booleanOp "${bop.booleanOp}"` });
      continue;
    }
    for (const n of childNodes) {
      if (!BOOLEAN_COMPATIBLE_TYPES.has(n.type)) {
        warnings.push({ key: bop.key, message: `child node type "${n.type}" is not boolean-compatible — skipped.` });
      }
    }
    const bopX = bop.pos ? bop.pos.x : 0;
    const bopY = bop.pos ? bop.pos.y : 0;
    for (const childOp of childOps) {
      const childNode = nodesByKey.get(childOp.key);
      if (!childNode || !childOp.pos) continue;
      childNode.x = bopX + childOp.pos.x;
      childNode.y = bopY + childOp.pos.y;
    }
    const parentContainer = (bop.parent ? nodesByKey.get(bop.parent) : target) || target;
    const stale = existing.get(bop.key);
    let resultNode;
    try {
      resultNode = figma[method](childNodes, parentContainer);
      created += 1;
    } catch (e) {
      warnings.push({ key: bop.key, message: `boolean "${method}" failed: ${e.message || e}` });
      continue;
    }
    if (stale && stale !== resultNode && !stale.removed && "children" in stale && stale.children.length === 0) {
      try {
        stale.remove();
      } catch (e) {
        warnings.push({ key: bop.key, message: `could not remove stale boolean result: ${e.message || e}` });
      }
    }
    used.add(bop.key);
    nodesByKey.set(bop.key, resultNode);
    try {
      await applyIntrinsic(resultNode, bop, imageHashByRef);
    } catch (e) {
      warnings.push({ key: bop.key, message: e.message || String(e) });
    }
    if (!bop.fills && childNodes[0] && Array.isArray(childNodes[0].fills) && childNodes[0].fills.length && "fills" in resultNode) {
      resultNode.fills = childNodes[0].fills;
    }
  }

  for (const op of plan.ops) {
    if (absorbedKeys.has(op.key)) continue;
    const node = nodesByKey.get(op.key);
    const parent = op.parent ? nodesByKey.get(op.parent) : target;
    if (parent && "appendChild" in parent) {
      try {
        parent.appendChild(node);
      } catch (e) {
        throw new Error(`parenting "${op.key}" (type ${node.type}) into "${op.parent ?? "<target>"}" (type ${parent.type}, id ${parent.id}): ${e.message || e}`);
      }
    }
  }

  for (const op of plan.ops) {
    if (op.type === "boolean" || absorbedKeys.has(op.key) || !op.sizing) continue;
    const node = nodesByKey.get(op.key);
    if (!node) continue;
    try {
      if (op.sizing.horizontal && "layoutSizingHorizontal" in node) node.layoutSizingHorizontal = op.sizing.horizontal;
      if (op.sizing.vertical && "layoutSizingVertical" in node) node.layoutSizingVertical = op.sizing.vertical;
    } catch (e) {
      warnings.push({ key: op.key, message: `sizing: ${e.message || e}` });
    }
  }

  for (const op of plan.ops) {
    if (op.type === "boolean" || absorbedKeys.has(op.key)) continue;
    const node = nodesByKey.get(op.key);
    if (op.positioning === "absolute") {
      node.layoutPositioning = "ABSOLUTE";
    }
    if (op.positioning !== "auto" && op.pos) {
      node.x = op.pos.x;
      node.y = op.pos.y;
    }
  }

  let deleted = 0;
  if (plan.mode === "sync" && plan.prune) {
    for (const [k, node] of existing) {
      if (used.has(k)) continue;
      if (node.removed) continue;
      try {
        node.remove();
        deleted += 1;
      } catch (e) {
        warnings.push({ key: k, message: `prune: ${e.message || e}` });
      }
    }
  }

  const rootOp = plan.ops.find((o) => o.parent === null);
  const rootNode = rootOp ? nodesByKey.get(rootOp.key) : null;
  if (rootNode) {
    figma.currentPage.selection = [rootNode];
    figma.viewport.scrollAndZoomIntoView([rootNode]);
  }

  const ids = {};
  for (const [k, n] of nodesByKey) ids[k] = n.id;

  return { rootId: rootNode ? rootNode.id : null, created, updated, deleted, ids, warnings };
}

async function handlePatchNode(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  const p = args.props || {};
  if (p.x !== undefined && "x" in node) node.x = p.x;
  if (p.y !== undefined && "y" in node) node.y = p.y;
  if ((p.width !== undefined || p.height !== undefined) && "resize" in node) {
    node.resize(p.width !== undefined ? p.width : node.width, p.height !== undefined ? p.height : node.height);
  }
  if (p.rotation !== undefined && "rotation" in node) node.rotation = p.rotation;
  if (p.opacity !== undefined && "opacity" in node) node.opacity = p.opacity;
  if (p.visible !== undefined) node.visible = p.visible;
  if (p.constraints && "constraints" in node) {
    node.constraints = { horizontal: p.constraints.horizontal.toUpperCase(), vertical: p.constraints.vertical.toUpperCase() };
  }
  if (p.fillStyleRef) {
    if (!("fillStyleId" in node)) throw new Error(`Node type "${node.type}" does not support fillStyleId.`);
    const style = await findPaintStyleByName(p.fillStyleRef);
    if (!style) throw new Error(`Paint style "${p.fillStyleRef}" not found.`);
    await node.setFillStyleIdAsync(style.id);
  }

  if (p.fill !== undefined) {
    if (!("fills" in node)) throw new Error(`Node type "${node.type}" does not support fills.`);
    const fills = Array.isArray(p.fill) ? p.fill : [p.fill];
    node.fills = fills.map(toFigmaPaint);
  }
  if (p.stroke) {
    if (!("strokes" in node)) throw new Error(`Node type "${node.type}" does not support strokes.`);
    const c = hexToRgba(p.stroke.color);
    node.strokes = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
    node.strokeWeight = p.stroke.width;
    if (p.stroke.align && "strokeAlign" in node) node.strokeAlign = p.stroke.align.toUpperCase();
    if (p.stroke.dash && "dashPattern" in node) node.dashPattern = p.stroke.dash;
  }
  if (p.radius !== undefined) applyRadius(node, p.radius);
  if (p.effects !== undefined) applyEffects(node, p.effects);
  if (p.blendMode) {
    if (!("blendMode" in node)) throw new Error(`Node type "${node.type}" does not support blendMode.`);
    node.blendMode = BLEND_MODE_MAP[p.blendMode] || "NORMAL";
  }
  if (p.locked !== undefined) {
    if (!("locked" in node)) throw new Error(`Node type "${node.type}" does not support locked.`);
    node.locked = p.locked;
  }
  if (p.layout) {
    if (!("layoutMode" in node)) throw new Error(`Node type "${node.type}" does not support auto-layout.`);
    applyLayoutCore(node, p.layout);
    if (p.width !== undefined && p.height !== undefined) {
      node.primaryAxisSizingMode = "FIXED";
      node.counterAxisSizingMode = "FIXED";
    }
  }
  if (p.text) {
    if (node.type !== "TEXT") throw new Error(`Node type "${node.type}" is not TEXT — cannot patch "text".`);
    if (p.text.font) {
      const face = await resolveFont(p.text.font.family, p.text.font.weight);
      node.fontName = face;
      if (p.text.font.size) node.fontSize = p.text.font.size;
      if (p.text.font.lineHeight) node.lineHeight = { value: p.text.font.lineHeight, unit: "PIXELS" };
      if (p.text.font.letterSpacing !== undefined) node.letterSpacing = { value: p.text.font.letterSpacing, unit: "PIXELS" };
      if (p.text.font.align) node.textAlignHorizontal = p.text.font.align.toUpperCase();
      if (p.text.font.color) {
        const c = hexToRgba(p.text.font.color);
        node.fills = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a }];
      }
    }
    if (p.text.characters !== undefined) {
      if (!p.text.font) {
        if (node.fontName === figma.mixed) {
          throw pluginError("FONT_ERROR", `custom.patch_node: text node ${node.id} has mixed fonts across its characters — patching "text.characters" without also patching "text.font" is only supported on single-font text nodes.`, { nodeId: node.id });
        }
        await figma.loadFontAsync(node.fontName);
      }
      node.characters = p.text.characters;
    }
  }

  return { id: node.id, patched: true };
}

async function handleDeleteNode(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  node.remove();
  return { deleted: true };
}

async function handleReorderNode(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  const parent = node.parent;
  if (!parent || !("insertChild" in parent)) throw new Error("Node has no reorderable parent.");
  const count = parent.children.length;
  let index;
  if (args.to === "front") index = count - 1;
  else if (args.to === "back") index = 0;
  else index = Math.max(0, Math.min(count - 1, args.to));
  parent.insertChild(index, node);
  return { id: node.id, index };
}

// ============================================================================================
// Block A / A6-A9 (hierarchy, components/instances, styles, variables, masks) — every function down
// to handleSetMask is a LITERAL PORT of Custom MCP's real plugin-side code
// (FIGMA-CUSTOM-MCP/figma-plugin/code.js:1025-1773), same reuse-by-porting rule as A2. Schemas for
// these operations live server-side in src/runtime/capabilities.js, importing the same figma-custom-mcp
// field schemas already used for custom.design/custom.patch_node where applicable.
// ============================================================================================

async function resolveNodesOrThrow(nodeIds, label) {
  const nodes = [];
  for (const id of nodeIds) {
    const n = await figma.getNodeByIdAsync(id);
    if (!n) throw new Error(`${label}: node not found: ${id}`);
    if (n.removed) throw new Error(`${label}: node has been deleted: ${id}`);
    nodes.push(n);
  }
  return nodes;
}

async function handleBooleanOp(args) {
  const method = BOOLEAN_METHOD[args.op];
  if (!method) throw new Error(`Unknown boolean operation "${args.op}" (expected union/subtract/intersect/exclude).`);
  if (!Array.isArray(args.nodeIds) || args.nodeIds.length < 1) {
    throw new Error("custom.boolean requires at least 1 nodeId (2+ for a meaningful result).");
  }
  const nodes = await resolveNodesOrThrow(args.nodeIds, "custom.boolean");
  const incompatible = nodes.filter((n) => !BOOLEAN_COMPATIBLE_TYPES.has(n.type));
  if (incompatible.length) {
    throw new Error(`custom.boolean: incompatible node type(s) [${incompatible.map((n) => `${n.id}:${n.type}`).join(", ")}] — expected RECTANGLE/ELLIPSE/VECTOR/STAR/POLYGON/LINE/BOOLEAN_OPERATION.`);
  }
  const parent = nodes[0].parent;
  if (!parent || !("appendChild" in parent)) throw new Error("custom.boolean: source node has no usable parent container.");
  const resultNode = figma[method](nodes, parent);
  resultNode.setPluginData(OPERATION_KEY, args.resultKey || resultNode.id);
  return { resultNodeId: resultNode.id, operation: args.op, sourceNodeIds: args.nodeIds };
}

function findByPluginKey(container, key) {
  function walk(n) {
    if (n.type === "INSTANCE") return null;
    try {
      if (n.getPluginData && n.getPluginData(OPERATION_KEY) === key && !n.removed) return n;
    } catch (e) {
      return null;
    }
    if ("children" in n) {
      for (const c of n.children) {
        const found = walk(c);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(container);
}

async function handleGroupNodes(args) {
  if (!Array.isArray(args.nodeIds) || args.nodeIds.length < 1) {
    throw new Error("custom.group requires at least 1 nodeId.");
  }
  if (args.operationKey) {
    const existing = findByPluginKey(figma.currentPage, args.operationKey);
    if (existing && existing.type === "GROUP") {
      return { groupId: existing.id, name: existing.name, childCount: existing.children.length, reused: true };
    }
  }
  const nodes = await resolveNodesOrThrow(args.nodeIds, "custom.group");
  const parents = new Set(nodes.map((n) => n.parent && n.parent.id));
  if (parents.size > 1) {
    throw new Error(`custom.group: all source nodes must share the same parent (found ${parents.size} distinct parents).`);
  }
  const parent = nodes[0].parent;
  if (!parent) throw new Error("custom.group: source node has no parent.");
  const group = figma.group(nodes, parent);
  if (args.name) group.name = args.name;
  group.setPluginData(OPERATION_KEY, args.operationKey || group.id);
  return { groupId: group.id, name: group.name, childCount: group.children.length, reused: false };
}

async function handleUngroupNode(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  if (node.type !== "GROUP") throw new Error(`custom.ungroup: node ${args.nodeId} is type "${node.type}", not "GROUP".`);
  const parent = node.parent;
  if (!parent || !("insertChild" in parent)) throw new Error("custom.ungroup: group has no reorderable parent.");
  const groupIndex = parent.children.indexOf(node);
  const children = [...node.children];
  const childIds = [];
  children.forEach((child, i) => {
    parent.insertChild(groupIndex + i, child);
    childIds.push(child.id);
  });
  if (!node.removed) node.remove();
  return { parentId: parent.id, childIds };
}

async function handleCreateComponentSet(args) {
  if (!Array.isArray(args.componentNodeIds) || args.componentNodeIds.length < 2) {
    throw new Error("custom.create_component_set requires at least 2 componentNodeIds.");
  }
  if (args.operationKey) {
    const existing = findByPluginKey(figma.currentPage, args.operationKey);
    if (existing && existing.type === "COMPONENT_SET") {
      const variants = existing.children.map((c) => ({ id: c.id, name: c.name, variantProperties: c.variantProperties || null }));
      return { componentSetId: existing.id, name: existing.name, variants, reused: true };
    }
  }
  const nodes = await resolveNodesOrThrow(args.componentNodeIds, "custom.create_component_set");
  const nonComponents = nodes.filter((n) => n.type !== "COMPONENT");
  if (nonComponents.length) {
    throw new Error(`custom.create_component_set: node(s) [${nonComponents.map((n) => `${n.id}:${n.type}`).join(", ")}] are not COMPONENT nodes.`);
  }
  const seenNames = new Set();
  for (const n of nodes) {
    if (seenNames.has(n.name)) throw new Error(`custom.create_component_set: duplicate variant name "${n.name}" — each component's name must be a unique "Key=Value, ..." combination.`);
    seenNames.add(n.name);
  }
  const parent = nodes[0].parent;
  if (!parent || !("appendChild" in parent)) throw new Error("custom.create_component_set: source component has no usable parent container.");
  let set;
  try {
    set = figma.combineAsVariants(nodes, parent);
  } catch (e) {
    throw new Error(`custom.create_component_set: Figma rejected combineAsVariants — ${e.message || e}. Every component name must follow "Key=Value" (or "Key1=Value1, Key2=Value2") with the same set of keys across all variants.`);
  }
  if (args.name) set.name = args.name;
  set.setPluginData(OPERATION_KEY, args.operationKey || set.id);
  const variants = set.children.map((c) => ({ id: c.id, name: c.name, variantProperties: c.variantProperties || null }));
  return { componentSetId: set.id, name: set.name, variants, reused: false };
}

async function handleCreatePaintStyle(args) {
  if (!args.name) throw new Error("custom.create_paint_style requires a name.");
  if (!args.paint) throw new Error("custom.create_paint_style requires a paint.");
  let style = await findPaintStyleByName(args.name);
  const created = !style;
  if (!style) style = figma.createPaintStyle();
  style.name = args.name;
  if (args.description !== undefined && "description" in style) style.description = args.description;
  style.paints = [toFigmaPaint(args.paint)];
  paintStyleCache = null;
  return { styleId: style.id, name: style.name, created };
}

async function handleListStyles() {
  const styles = await loadPaintStyles(true);
  return { styles: styles.map((s) => ({ id: s.id, name: s.name, paints: s.paints })) };
}

let textStyleCache = null;
let effectStyleCache = null;
let gridStyleCache = null;

async function loadStylesOfKind(kind, force) {
  if (kind === "text") {
    if (!textStyleCache || force) textStyleCache = await figma.getLocalTextStylesAsync();
    return textStyleCache;
  }
  if (kind === "effect") {
    if (!effectStyleCache || force) effectStyleCache = await figma.getLocalEffectStylesAsync();
    return effectStyleCache;
  }
  if (kind === "grid") {
    if (!gridStyleCache || force) gridStyleCache = await figma.getLocalGridStylesAsync();
    return gridStyleCache;
  }
  throw new Error(`Unknown style kind "${kind}".`);
}
function invalidateStyleCache(kind) {
  if (kind === "text") textStyleCache = null;
  else if (kind === "effect") effectStyleCache = null;
  else if (kind === "grid") gridStyleCache = null;
}
async function findStyleOfKindByName(kind, name) {
  const styles = await loadStylesOfKind(kind, false);
  let found = styles.find((s) => s.name === name);
  if (!found) found = (await loadStylesOfKind(kind, true)).find((s) => s.name === name);
  return found || null;
}

async function handleStyles(args) {
  const kind = args.kind;
  if (kind !== "paint" && kind !== "text" && kind !== "effect" && kind !== "grid") {
    throw new Error(`custom.styles: unknown kind "${kind}" (expected paint/text/effect/grid).`);
  }

  if (args.action === "list") {
    if (kind === "paint") return handleListStyles();
    const styles = await loadStylesOfKind(kind, true);
    if (kind === "text") return { styles: styles.map((s) => ({ id: s.id, name: s.name, fontName: s.fontName, fontSize: s.fontSize })) };
    if (kind === "effect") return { styles: styles.map((s) => ({ id: s.id, name: s.name, effects: s.effects })) };
    return { styles: styles.map((s) => ({ id: s.id, name: s.name, layoutGrids: s.layoutGrids })) };
  }

  if (args.action === "delete") {
    if (!args.name) throw new Error('custom.styles: action "delete" requires "name".');
    if (kind === "paint") {
      const style = await findPaintStyleByName(args.name);
      if (!style) throw new Error(`Paint style "${args.name}" not found.`);
      style.remove();
      paintStyleCache = null;
      return { deleted: args.name };
    }
    const style = await findStyleOfKindByName(kind, args.name);
    if (!style) throw new Error(`${kind} style "${args.name}" not found.`);
    style.remove();
    invalidateStyleCache(kind);
    return { deleted: args.name };
  }

  if (args.action === "create") {
    if (!args.name) throw new Error('custom.styles: action "create" requires "name".');
    if (kind === "paint") {
      if (!args.paint) throw new Error('custom.styles: kind "paint" create requires "paint".');
      return handleCreatePaintStyle({ name: args.name, paint: args.paint, description: args.description });
    }
    if (kind === "text") {
      let style = await findStyleOfKindByName("text", args.name);
      const created = !style;
      if (!style) style = figma.createTextStyle();
      style.name = args.name;
      const font = args.font || {};
      const face = await resolveFont(font.family, font.weight);
      await figma.loadFontAsync(face);
      style.fontName = face;
      if (font.size) style.fontSize = font.size;
      if (font.lineHeight) style.lineHeight = { value: font.lineHeight, unit: "PIXELS" };
      if (font.letterSpacing !== undefined) style.letterSpacing = { value: font.letterSpacing, unit: "PIXELS" };
      invalidateStyleCache("text");
      return { styleId: style.id, name: style.name, created };
    }
    if (kind === "effect") {
      if (!args.effects || !args.effects.length) throw new Error('custom.styles: kind "effect" create requires a non-empty "effects" array.');
      let style = await findStyleOfKindByName("effect", args.name);
      const created = !style;
      if (!style) style = figma.createEffectStyle();
      style.name = args.name;
      style.effects = args.effects.map(toFigmaEffect);
      invalidateStyleCache("effect");
      return { styleId: style.id, name: style.name, created };
    }
    if (kind === "grid") {
      if (!args.layoutGrids || !args.layoutGrids.length) throw new Error('custom.styles: kind "grid" create requires a non-empty "layoutGrids" array.');
      let style = await findStyleOfKindByName("grid", args.name);
      const created = !style;
      if (!style) style = figma.createGridStyle();
      style.name = args.name;
      style.layoutGrids = args.layoutGrids.map(toFigmaLayoutGrid);
      invalidateStyleCache("grid");
      return { styleId: style.id, name: style.name, created };
    }
  }

  if (args.action === "apply" || args.action === "unapply") {
    if (!args.nodeId) throw new Error(`custom.styles: action "${args.action}" requires "nodeId".`);
    const node = await figma.getNodeByIdAsync(args.nodeId);
    if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });

    let styleId = "";
    if (args.action === "apply") {
      if (!args.name) throw new Error('custom.styles: action "apply" requires "name".');
      const style = kind === "paint" ? await findPaintStyleByName(args.name) : await findStyleOfKindByName(kind, args.name);
      if (!style) throw new Error(`${kind} style "${args.name}" not found. Create it first with custom.styles (action:"create").`);
      styleId = style.id;
    }

    if (kind === "paint") {
      const target = args.paintTarget === "strokes" ? "strokeStyleId" : "fillStyleId";
      if (target === "fillStyleId") {
        if (!("fillStyleId" in node)) throw new Error(`custom.styles: node type "${node.type}" does not support fill paint styles.`);
        await node.setFillStyleIdAsync(styleId);
      } else {
        if (!("strokeStyleId" in node)) throw new Error(`custom.styles: node type "${node.type}" does not support stroke paint styles.`);
        await node.setStrokeStyleIdAsync(styleId);
      }
    } else if (kind === "text") {
      if (!("setTextStyleIdAsync" in node)) throw new Error(`custom.styles: node type "${node.type}" is not TEXT — cannot apply a text style.`);
      await node.setTextStyleIdAsync(styleId);
    } else if (kind === "effect") {
      if (!("setEffectStyleIdAsync" in node)) throw new Error(`custom.styles: node type "${node.type}" does not support effect styles.`);
      await node.setEffectStyleIdAsync(styleId);
    } else if (kind === "grid") {
      if (!("setGridStyleIdAsync" in node)) throw new Error(`custom.styles: node type "${node.type}" does not support grid styles.`);
      await node.setGridStyleIdAsync(styleId);
    }
    return { nodeId: node.id, kind, applied: args.action === "apply" };
  }

  throw new Error(`custom.styles: unknown action "${args.action}" (expected create/apply/unapply/delete/list).`);
}

async function handleTextRange(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  if (node.type !== "TEXT") throw new Error(`custom.text_range: node ${args.nodeId} is type "${node.type}", not "TEXT".`);

  const len = node.characters.length;
  const start = args.start;
  const end = args.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > len || start >= end) {
    throw new Error(`custom.text_range: invalid range [${start}, ${end}) for a text node with ${len} characters (need 0 <= start < end <= length).`);
  }

  const touchedFields = [];

  if (args.fontFamily !== undefined || args.fontWeight !== undefined) {
    const face = await resolveFont(args.fontFamily, args.fontWeight);
    await figma.loadFontAsync(face);
    node.setRangeFontName(start, end, face);
    touchedFields.push("fontName");
  }
  if (args.fontSize !== undefined) {
    node.setRangeFontSize(start, end, args.fontSize);
    touchedFields.push("fontSize");
  }
  if (args.fill !== undefined) {
    node.setRangeFills(start, end, [toFigmaPaint(args.fill)]);
    touchedFields.push("fills");
  }
  if (args.letterSpacing !== undefined) {
    node.setRangeLetterSpacing(start, end, { value: args.letterSpacing, unit: "PIXELS" });
    touchedFields.push("letterSpacing");
  }
  if (args.lineHeight !== undefined) {
    node.setRangeLineHeight(start, end, { value: args.lineHeight, unit: "PIXELS" });
    touchedFields.push("lineHeight");
  }
  if (args.decoration !== undefined) {
    node.setRangeTextDecoration(start, end, args.decoration.toUpperCase());
    touchedFields.push("textDecoration");
  }
  if (args.hyperlink !== undefined) {
    node.setRangeHyperlink(start, end, args.hyperlink === null ? null : { type: "URL", value: args.hyperlink });
    touchedFields.push("hyperlink");
  }
  if (args.styleRef !== undefined) {
    const style = await findStyleOfKindByName("text", args.styleRef);
    if (!style) throw new Error(`custom.text_range: text style "${args.styleRef}" not found. Create it first with custom.styles (kind:"text", action:"create").`);
    await node.setRangeTextStyleIdAsync(start, end, style.id);
    touchedFields.push("textStyleId");
  }

  if (touchedFields.length === 0) {
    throw new Error("custom.text_range: at least one of fontFamily/fontWeight/fontSize/fill/letterSpacing/lineHeight/decoration/hyperlink/styleRef is required.");
  }

  const segments = node.getStyledTextSegments(touchedFields, 0, len);
  return { nodeId: node.id, start, end, touchedFields, segments };
}

function toMat3(t) {
  return [
    [t[0][0], t[0][1], t[0][2]],
    [t[1][0], t[1][1], t[1][2]],
    [0, 0, 1]
  ];
}
function fromMat3(m) {
  return [
    [m[0][0], m[0][1], m[0][2]],
    [m[1][0], m[1][1], m[1][2]]
  ];
}
function matMul3(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i][k] * b[k][j];
      r[i][j] = sum;
    }
  }
  return r;
}
function matInverse3(m) {
  const a = m[0][0], b = m[0][1], tx = m[0][2];
  const c = m[1][0], d = m[1][1], ty = m[1][2];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("Transform is not invertible (degenerate scale/rotation).");
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [
    [ia, ib, -(ia * tx + ib * ty)],
    [ic, id, -(ic * tx + id * ty)],
    [0, 0, 1]
  ];
}

async function handleMoveNode(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  if (!("absoluteTransform" in node) || !("relativeTransform" in node)) {
    throw new Error(`custom.move_node: node type "${node.type}" has no transform to preserve (not a scene node).`);
  }
  const newParent = await figma.getNodeByIdAsync(args.parentId);
  if (!newParent) throw pluginError("NODE_NOT_FOUND", `Parent not found: ${args.parentId}`, { nodeId: args.parentId });
  if (!("appendChild" in newParent)) throw new Error(`custom.move_node: target "${args.parentId}" (type "${newParent.type}") cannot contain children.`);
  // Block B §15/§17 — Figma's own appendChild/insertChild would eventually reject this, but only with
  // a raw platform error carrying no .code (normalized down to a generic FIGMA_API_ERROR). Detecting it
  // here up front gives the caller a precise, actionable INVALID_HIERARCHY instead.
  if (newParent.id === node.id || isDescendantOf(newParent, node)) {
    throw pluginError("INVALID_HIERARCHY", `custom.move_node: cannot move node ${args.nodeId} into ${args.parentId} — the target parent is the node itself or one of its own descendants, which would create a hierarchy cycle.`, { nodeId: args.nodeId, parentId: args.parentId });
  }

  const preserve = args.preserveVisualPosition !== false;
  const absBefore = preserve ? toMat3(node.absoluteTransform) : null;

  if (typeof args.index === "number" && "insertChild" in newParent) {
    const idx = Math.max(0, Math.min(newParent.children.length, args.index));
    newParent.insertChild(idx, node);
  } else {
    newParent.appendChild(node);
  }

  if (preserve && absBefore) {
    const parentAbs = toMat3(newParent.absoluteTransform);
    const newRelative = matMul3(matInverse3(parentAbs), absBefore);
    node.relativeTransform = fromMat3(newRelative);
  }

  return { id: node.id, parentId: newParent.id, x: "x" in node ? node.x : undefined, y: "y" in node ? node.y : undefined };
}

const COMPONENT_PROPERTY_TYPES = new Set(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT", "SLOT"]);

async function handleComponentProperty(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(`custom.component_property: node ${args.nodeId} is type "${node.type}" — property definitions can only be added/edited/deleted on a COMPONENT or COMPONENT_SET. An INSTANCE only supplies values (see custom.instance_override).`);
  }
  if (args.action === "list") {
    return { definitions: node.componentPropertyDefinitions || {} };
  }
  if (args.action === "add") {
    if (!args.name) throw new Error('custom.component_property: action "add" requires "name".');
    if (!args.propType || !COMPONENT_PROPERTY_TYPES.has(args.propType)) {
      throw new Error(`custom.component_property: action "add" requires a valid "propType" (one of BOOLEAN/TEXT/INSTANCE_SWAP/VARIANT/SLOT), got "${args.propType}".`);
    }
    if (args.propType === "VARIANT") {
      throw new Error("custom.component_property: VARIANT properties cannot be created via addComponentProperty — they are derived from a COMPONENT_SET's variant names. Use custom.create_component_set instead.");
    }
    const propertyId = node.addComponentProperty(args.name, args.propType, args.defaultValue, args.options);
    return { propertyId, definitions: node.componentPropertyDefinitions };
  }
  if (args.action === "edit") {
    if (!args.propertyId) throw new Error('custom.component_property: action "edit" requires "propertyId" (the "Name#id" key from "list" or "add").');
    node.editComponentProperty(args.propertyId, args.options || {});
    return { propertyId: args.propertyId, definitions: node.componentPropertyDefinitions };
  }
  if (args.action === "delete") {
    if (!args.propertyId) throw new Error('custom.component_property: action "delete" requires "propertyId".');
    const def = (node.componentPropertyDefinitions || {})[args.propertyId];
    if (def && def.type === "VARIANT") {
      throw new Error(`custom.component_property: "${args.propertyId}" is a VARIANT property — it cannot be deleted this way (it's derived from the component set's variant names, not an independently-added property).`);
    }
    node.deleteComponentProperty(args.propertyId);
    return { deleted: args.propertyId, definitions: node.componentPropertyDefinitions };
  }
  throw new Error(`custom.component_property: unknown action "${args.action}" (expected add/edit/delete/list).`);
}

function isDescendantOf(node, ancestor) {
  let cur = node.parent;
  while (cur) {
    if (cur.id === ancestor.id) return true;
    cur = cur.parent;
  }
  return false;
}

async function handleInstanceOverride(args) {
  const instance = await figma.getNodeByIdAsync(args.instanceId);
  if (!instance) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.instanceId}`, { nodeId: args.instanceId });
  if (instance.type !== "INSTANCE") throw new Error(`custom.instance_override: node ${args.instanceId} is type "${instance.type}", not "INSTANCE".`);

  if (args.action === "reset") {
    instance.removeOverrides();
    return { instanceId: instance.id, reset: true };
  }
  if (args.action === "set") {
    if (!args.properties || typeof args.properties !== "object") {
      throw new Error('custom.instance_override: action "set" requires a "properties" object ({propertyName: value}).');
    }
    instance.setProperties(args.properties);
    return { instanceId: instance.id, componentProperties: instance.componentProperties };
  }
  if (args.action === "set_node") {
    if (!args.targetNodeId) throw new Error('custom.instance_override: action "set_node" requires "targetNodeId".');
    const target = await figma.getNodeByIdAsync(args.targetNodeId);
    if (!target) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.targetNodeId}`, { nodeId: args.targetNodeId });
    if (target.id !== instance.id && !isDescendantOf(target, instance)) {
      throw new Error(`custom.instance_override: node ${args.targetNodeId} is not a descendant of instance ${args.instanceId} — refusing to write to it.`);
    }
    const p = args.props || {};
    if (p.characters !== undefined) {
      if (target.type !== "TEXT") throw new Error(`custom.instance_override: "characters" override target ${target.id} is type "${target.type}", not "TEXT".`);
      if (target.fontName === figma.mixed) {
        throw pluginError("FONT_ERROR", `custom.instance_override: target text node ${target.id} has mixed fonts across its characters — setting "characters" is only supported on single-font text nodes.`, { nodeId: target.id });
      }
      await figma.loadFontAsync(target.fontName);
      target.characters = p.characters;
    }
    if (p.visible !== undefined) target.visible = p.visible;
    if (p.opacity !== undefined && "opacity" in target) target.opacity = p.opacity;
    if (p.fill && "fills" in target) target.fills = [toFigmaPaint(p.fill)];
    return { targetNodeId: target.id, applied: true };
  }
  throw new Error(`custom.instance_override: unknown action "${args.action}" (expected set/reset/set_node).`);
}

async function handleInstanceSwap(args) {
  const instance = await figma.getNodeByIdAsync(args.instanceId);
  if (!instance) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.instanceId}`, { nodeId: args.instanceId });
  if (instance.type !== "INSTANCE") throw new Error(`custom.instance_swap: node ${args.instanceId} is type "${instance.type}", not "INSTANCE".`);
  const component = await figma.getNodeByIdAsync(args.componentId);
  if (!component) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.componentId}`, { nodeId: args.componentId });
  if (component.type !== "COMPONENT") throw new Error(`custom.instance_swap: node ${args.componentId} is type "${component.type}", not "COMPONENT".`);
  instance.swapComponent(component);
  instance.setPluginData(PLUGIN_KEY, "");
  return { instanceId: instance.id, mainComponentId: component.id };
}

async function handleCreateInstance(args) {
  const component = await figma.getNodeByIdAsync(args.componentId);
  if (!component) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.componentId}`, { nodeId: args.componentId });
  if (component.type !== "COMPONENT") throw new Error(`custom.create_instance: node ${args.componentId} is type "${component.type}", not "COMPONENT".`);
  const instance = component.createInstance();
  instance.setPluginData(PLUGIN_KEY, "");
  if (args.name) instance.name = args.name;
  const parent = args.parentId ? await figma.getNodeByIdAsync(args.parentId) : figma.currentPage;
  if (!parent) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.parentId}`, { nodeId: args.parentId });
  if (!("appendChild" in parent)) throw new Error(`custom.create_instance: node "${args.parentId}" (type "${parent.type}") cannot contain children.`);
  parent.appendChild(instance);
  if (args.x !== undefined) instance.x = args.x;
  if (args.y !== undefined) instance.y = args.y;
  return { instanceId: instance.id, mainComponentId: component.id, x: instance.x, y: instance.y };
}

const VARIABLE_NODE_FIELDS = new Set([
  "height", "width", "characters", "itemSpacing", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
  "visible", "cornerRadius", "topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius",
  "minWidth", "maxWidth", "minHeight", "maxHeight", "counterAxisSpacing", "strokeWeight", "strokeTopWeight",
  "strokeRightWeight", "strokeBottomWeight", "strokeLeftWeight", "opacity", "gridRowGap", "gridColumnGap",
  "fontFamily", "fontSize", "fontStyle", "fontWeight", "letterSpacing", "lineHeight", "paragraphSpacing", "paragraphIndent"
]);
const VARIABLE_EFFECT_FIELDS = new Set(["color", "radius", "spread", "offsetX", "offsetY"]);
const VARIABLE_GRID_FIELDS = new Set(["sectionSize", "count", "offset", "gutterSize"]);

async function findCollectionById(id) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const found = collections.find((c) => c.id === id);
  if (!found) throw new Error(`Variable collection not found: ${id}`);
  return found;
}
async function findVariableById(id) {
  const v = await figma.variables.getVariableByIdAsync(id);
  if (!v) throw new Error(`Variable not found: ${id}`);
  return v;
}

function toVariableValue(resolvedType, raw) {
  if (resolvedType === "COLOR" && typeof raw === "string") {
    const c = hexToRgba(raw);
    return { r: c.r, g: c.g, b: c.b, a: c.a };
  }
  return raw;
}

async function handleVariableBind(args, unbind) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  const variable = unbind ? null : await findVariableById(args.variableId);
  const kind = args.kind || "node";

  if (kind === "node") {
    if (!VARIABLE_NODE_FIELDS.has(args.field)) {
      throw new Error(`custom.variables: "${args.field}" is not a valid node/text bindable field.`);
    }
    if (!("setBoundVariable" in node)) throw new Error(`custom.variables: node type "${node.type}" does not support variable binding.`);
    node.setBoundVariable(args.field, variable);
    return { nodeId: node.id, field: args.field, bound: !unbind };
  }

  if (kind === "paint") {
    const prop = args.paintProperty === "strokes" ? "strokes" : "fills";
    if (!(prop in node)) throw new Error(`custom.variables: node type "${node.type}" has no "${prop}".`);
    const paints = [...node[prop]];
    const idx = args.paintIndex || 0;
    if (!paints[idx] || paints[idx].type !== "SOLID") {
      throw new Error(`custom.variables: ${prop}[${idx}] on node ${args.nodeId} is not a SOLID paint — only a solid paint's color can be bound to a variable.`);
    }
    paints[idx] = figma.variables.setBoundVariableForPaint(paints[idx], "color", variable);
    node[prop] = paints;
    return { nodeId: node.id, [prop]: paints, bound: !unbind };
  }

  if (kind === "effect") {
    if (!("effects" in node)) throw new Error(`custom.variables: node type "${node.type}" has no "effects".`);
    if (!VARIABLE_EFFECT_FIELDS.has(args.field)) throw new Error(`custom.variables: "${args.field}" is not a valid effect-bindable field.`);
    const effects = [...node.effects];
    const idx = args.effectIndex || 0;
    if (!effects[idx]) throw new Error(`custom.variables: effects[${idx}] does not exist on node ${args.nodeId}.`);
    effects[idx] = figma.variables.setBoundVariableForEffect(effects[idx], args.field, variable);
    node.effects = effects;
    return { nodeId: node.id, effects, bound: !unbind };
  }

  if (kind === "layoutGrid") {
    if (!("layoutGrids" in node)) throw new Error(`custom.variables: node type "${node.type}" has no "layoutGrids".`);
    if (!VARIABLE_GRID_FIELDS.has(args.field)) throw new Error(`custom.variables: "${args.field}" is not a valid layoutGrid-bindable field.`);
    const grids = [...node.layoutGrids];
    const idx = args.gridIndex || 0;
    if (!grids[idx]) throw new Error(`custom.variables: layoutGrids[${idx}] does not exist on node ${args.nodeId}.`);
    grids[idx] = figma.variables.setBoundVariableForLayoutGrid(grids[idx], args.field, variable);
    node.layoutGrids = grids;
    return { nodeId: node.id, layoutGrids: grids, bound: !unbind };
  }

  throw new Error(`custom.variables: unknown bind kind "${kind}" (expected node/paint/effect/layoutGrid).`);
}

async function handleVariables(args) {
  const action = args.action;
  if (action === "create_collection") {
    if (!args.name) throw new Error('custom.variables: action "create_collection" requires "name".');
    const collection = figma.variables.createVariableCollection(args.name);
    return { collectionId: collection.id, name: collection.name, modes: collection.modes };
  }
  if (action === "delete_collection") {
    const collection = await findCollectionById(args.collectionId);
    collection.remove();
    return { deleted: args.collectionId };
  }
  if (action === "add_mode") {
    const collection = await findCollectionById(args.collectionId);
    if (!args.name) throw new Error('custom.variables: action "add_mode" requires "name".');
    const modeId = collection.addMode(args.name);
    return { collectionId: collection.id, modeId, modes: collection.modes };
  }
  if (action === "rename_mode") {
    const collection = await findCollectionById(args.collectionId);
    if (!args.modeId || !args.name) throw new Error('custom.variables: action "rename_mode" requires "modeId" and "name".');
    collection.renameMode(args.modeId, args.name);
    return { collectionId: collection.id, modes: collection.modes };
  }
  if (action === "remove_mode") {
    const collection = await findCollectionById(args.collectionId);
    if (!args.modeId) throw new Error('custom.variables: action "remove_mode" requires "modeId".');
    if (collection.modes.length <= 1) {
      throw new Error(`custom.variables: cannot remove mode "${args.modeId}" — collection "${collection.name}" has only one mode left.`);
    }
    collection.removeMode(args.modeId);
    return { collectionId: collection.id, modes: collection.modes };
  }
  if (action === "create_variable") {
    const collection = await findCollectionById(args.collectionId);
    if (!args.name || !args.resolvedType) throw new Error('custom.variables: action "create_variable" requires "name" and "resolvedType".');
    const variable = figma.variables.createVariable(args.name, collection, args.resolvedType);
    return { variableId: variable.id, name: variable.name, resolvedType: variable.resolvedType, collectionId: collection.id };
  }
  if (action === "delete_variable") {
    const variable = await findVariableById(args.variableId);
    variable.remove();
    return { deleted: args.variableId };
  }
  if (action === "set_value") {
    const variable = await findVariableById(args.variableId);
    if (!args.modeId) throw new Error('custom.variables: action "set_value" requires "modeId".');
    let value;
    if (args.value && typeof args.value === "object" && args.value.alias) {
      const aliasTarget = await findVariableById(args.value.alias);
      value = figma.variables.createVariableAlias(aliasTarget);
    } else {
      value = toVariableValue(variable.resolvedType, args.value);
    }
    variable.setValueForMode(args.modeId, value);
    return { variableId: variable.id, modeId: args.modeId, valuesByMode: variable.valuesByMode };
  }
  if (action === "bind") return handleVariableBind(args, false);
  if (action === "unbind") return handleVariableBind(args, true);
  if (action === "list") {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    return {
      collections: collections.map((c) => ({ id: c.id, name: c.name, modes: c.modes, defaultModeId: c.defaultModeId })),
      variables: variables.map((v) => ({ id: v.id, name: v.name, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId, valuesByMode: v.valuesByMode }))
    };
  }
  throw new Error(`custom.variables: unknown action "${action}".`);
}

async function handleSetMask(args) {
  const node = await figma.getNodeByIdAsync(args.nodeId);
  if (!node) throw pluginError("NODE_NOT_FOUND", `Node not found: ${args.nodeId}`, { nodeId: args.nodeId });
  if (!("isMask" in node)) throw new Error(`custom.set_mask: node type "${node.type}" does not support isMask.`);
  const isMask = args.isMask !== undefined ? args.isMask : true;
  if (args.maskType && !isMask) {
    throw new Error(`custom.set_mask: "maskType" has no effect without isMask:true.`);
  }
  node.isMask = isMask;
  if (args.maskType) {
    if (!("maskType" in node)) throw new Error(`custom.set_mask: node type "${node.type}" does not support maskType.`);
    node.maskType = args.maskType.toUpperCase();
  }
  return { id: node.id, isMask: node.isMask, maskType: "maskType" in node ? node.maskType : undefined };
}

const handlers = {
  plumb: {
    status: async () => await runtimeStatus("plumb"),
    outline: async (payload) => await plumbOutline(payload),
    "selection.read": async (payload) => await plumbSelection(payload),
    components: async () => await plumbComponents()
  },
  custom: {
    status: async () => await runtimeStatus("custom"),
    "node.read": async (payload) => await customNode(payload),
    "selection.read": async (payload) => await customSelection(payload),
    "design.apply": async (payload) => await handleApplyPlan(payload),
    "node.patch": async (payload) => await handlePatchNode(payload),
    "node.delete": async (payload) => await handleDeleteNode(payload),
    "node.reorder": async (payload) => await handleReorderNode(payload),
    "node.move": async (payload) => await handleMoveNode(payload),
    "boolean.op": async (payload) => await handleBooleanOp(payload),
    "group.create": async (payload) => await handleGroupNodes(payload),
    "group.ungroup": async (payload) => await handleUngroupNode(payload),
    "component_set.create": async (payload) => await handleCreateComponentSet(payload),
    "paint_style.create": async (payload) => await handleCreatePaintStyle(payload),
    "styles.list": async () => await handleListStyles(),
    "styles.manage": async (payload) => await handleStyles(payload),
    "text_range.set": async (payload) => await handleTextRange(payload),
    "component_property.manage": async (payload) => await handleComponentProperty(payload),
    "instance.override": async (payload) => await handleInstanceOverride(payload),
    "instance.swap": async (payload) => await handleInstanceSwap(payload),
    "instance.create": async (payload) => await handleCreateInstance(payload),
    "variables.manage": async (payload) => await handleVariables(payload),
    "mask.set": async (payload) => await handleSetMask(payload)
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
