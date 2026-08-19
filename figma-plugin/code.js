figma.showUI(__html__, { width: 280, height: 180, title: "Unified Runtime POC" });

const PLUGIN_VERSION = "0.1.0-stage3.5";

function serializeNode(node, depth) {
  const out = {
    id: node.id,
    name: node.name,
    type: node.type
  };
  if ("x" in node) out.x = node.x;
  if ("y" in node) out.y = node.y;
  if ("width" in node) out.width = node.width;
  if ("height" in node) out.height = node.height;
  if ("visible" in node) out.visible = node.visible;
  if ("children" in node) {
    out.childCount = node.children.length;
    if (depth > 0) out.children = node.children.map((child) => serializeNode(child, depth - 1));
  }
  return out;
}

function topLevelScreen(node) {
  return ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type);
}

async function plumbOutline() {
  await figma.loadAllPagesAsync();
  const pages = figma.root.children.map((page) => ({
    name: page.name,
    screens: page.children.filter(topLevelScreen).map((node) => ({
      id: node.id,
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

async function customNode(args) {
  const depth = Math.max(0, Math.min(6, Number(args && args.depth !== undefined ? args.depth : 1)));
  const node = args && args.nodeId ? await figma.getNodeByIdAsync(args.nodeId) : figma.currentPage;
  if (!node) throw new Error(`Node not found: ${args.nodeId}`);
  return { doc: serializeNode(node, depth) };
}

async function dispatch(cmd, args) {
  switch (cmd) {
    case "runtime-status":
      return { pluginVersion: PLUGIN_VERSION, currentPage: figma.currentPage.name };
    case "plumb-outline":
      return await plumbOutline();
    case "custom-node":
      return await customNode(args || {});
    default:
      throw new Error(`Unknown unified runtime command: ${cmd}`);
  }
}

figma.ui.onmessage = async (message) => {
  if (!message || message.kind !== "runtime-request") return;
  try {
    const payload = await dispatch(message.cmd, message.args || {});
    figma.ui.postMessage({ kind: "runtime-reply", reqId: message.reqId, ok: true, payload });
  } catch (error) {
    figma.ui.postMessage({ kind: "runtime-reply", reqId: message.reqId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

figma.ui.postMessage({ kind: "plugin-ready", pluginVersion: PLUGIN_VERSION, currentPage: figma.currentPage.name });
