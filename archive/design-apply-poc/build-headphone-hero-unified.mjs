#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const assets = "C:\\Users\\rachi\\OneDrive\\Documents\\FIGMA\\assets_hp";
const headphoneFolder = "C:\\Users\\rachi\\OneDrive\\Documents\\FIGMA\\Headphone";

function pngDataUri(filePath) {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function text(id, name, x, y, width, height, value, font) {
  return { id, type: "text", name, x, y, width, height, text: value, font };
}

const navFont = { family: "Inter", weight: 800, size: 22, lineHeight: 26, letterSpacing: 0, color: "#171717" };
const titleBlack = { family: "Inter", weight: 900, size: 128, lineHeight: 118, letterSpacing: -2, color: "#111111" };
const titleTeal = { ...titleBlack, color: "#1E4F54" };

const doc = {
  version: "unified-design-v1",
  name: "Sonic Headphone Hero",
  page: "Headphone Hero",
  root: {
    id: "sonic-hero-unified-root",
    type: "frame",
    name: "Sonic Headphone Hero - Unified MCP",
    x: 0,
    y: 0,
    width: 1536,
    height: 1024,
    clip: true,
    fill: { color: "#EDEDEB" },
    children: [
      { id: "sonic-bg", type: "image", name: "concrete shadow background", x: 0, y: 0, width: 1536, height: 1024, src: pngDataUri(path.join(headphoneFolder, "Background.png")) },
      { id: "sonic-wave", type: "image", name: "turquoise audio waveform", x: 374, y: 286, width: 1162, height: 430, opacity: 0.74, src: pngDataUri(path.join(assets, "soundwave.png")) },
      { id: "sonic-arch", type: "image", name: "teal acoustic arch", x: 800, y: 118, width: 436, height: 696, src: pngDataUri(path.join(assets, "arch.png")) },
      { id: "sonic-headphones", type: "image", name: "mint wireless headphones", x: 736, y: 178, width: 522, height: 672, src: pngDataUri(path.join(assets, "headphone.png")) },
      { id: "nav-shop", type: "rect", name: "SHOP NOW pill", x: 1295, y: 30, width: 193, height: 50, radius: 25, fill: { color: "#1E6670" }, effects: [{ type: "drop-shadow", x: 0, y: 2, blur: 6, color: "#000000", opacity: 0.22 }] },
      { id: "nav-shop-circle", type: "ellipse", name: "SHOP NOW arrow circle", x: 1441, y: 36, width: 38, height: 38, fill: { color: "#F7FBFA" } },
      text("nav-logo", "SONIC logo text", 75, 61, 126, 39, "SONIC", { family: "Inter", weight: 900, size: 34, lineHeight: 38, letterSpacing: -1, color: "#171717" }),
      { id: "nav-logo-dot-1", type: "ellipse", name: "logo dot 1", x: 194, y: 62, width: 11, height: 11, stroke: { color: "#171717", width: 4 }, fill: { color: "#FFFFFF", opacity: 0 } },
      { id: "nav-logo-dot-2", type: "ellipse", name: "logo dot 2", x: 198, y: 44, width: 12, height: 12, stroke: { color: "#171717", width: 4 }, fill: { color: "#FFFFFF", opacity: 0 } },
      { id: "nav-logo-dot-3", type: "ellipse", name: "logo dot 3", x: 206, y: 34, width: 5, height: 5, fill: { color: "#171717" } },
      text("nav-home", "HOME nav", 433, 42, 68, 25, "HOME", navFont),
      { id: "nav-home-underline", type: "rect", name: "HOME underline", x: 433, y: 73, width: 68, height: 4, radius: 2, fill: { color: "#1E6670" } },
      text("nav-products", "PRODUCTS nav", 579, 42, 122, 25, "PRODUCTS", navFont),
      text("nav-about", "ABOUT nav", 782, 42, 76, 25, "ABOUT", navFont),
      text("nav-journal", "JOURNAL nav", 924, 42, 105, 25, "JOURNAL", navFont),
      text("nav-contact", "CONTACT nav", 1097, 42, 105, 25, "CONTACT", navFont),
      text("nav-shop-label", "SHOP NOW label", 1318, 45, 118, 24, "SHOP NOW", { family: "Inter", weight: 900, size: 17, lineHeight: 22, letterSpacing: 0, color: "#FFFFFF" }),
      text("nav-shop-arrow", "SHOP NOW arrow", 1450, 41, 26, 30, "→", { family: "Inter", weight: 900, size: 28, lineHeight: 30, color: "#1E6670" }),
      text("hero-block", "Headline BLOCK", 73, 156, 402, 124, "BLOCK", titleBlack),
      text("hero-the-noise", "Headline THE NOISE", 66, 300, 626, 124, "THE NOISE", titleBlack),
      text("hero-own-your", "Headline OWN YOUR", 72, 459, 562, 124, "OWN YOUR", titleTeal),
      text("hero-world", "Headline WORLD", 74, 595, 390, 124, "WORLD", titleTeal),
      { id: "sub-divider", type: "rect", name: "subtitle divider", x: 75, y: 751, width: 65, height: 4, radius: 2, fill: { color: "#1E6670" } },
      text("sub-premium", "Premium line", 76, 776, 260, 30, "Premium Wireless", { family: "Inter", weight: 700, size: 25, lineHeight: 30, color: "#1F1F1F" }),
      text("sub-headphones", "Headphones line", 76, 806, 230, 30, "Headphones", { family: "Inter", weight: 700, size: 25, lineHeight: 30, color: "#1F1F1F" }),
      text("discover-label", "DISCOVER MORE label", 1143, 934, 230, 30, "DISCOVER MORE", { family: "Inter", weight: 900, size: 25, lineHeight: 30, letterSpacing: 0, color: "#FFFFFF" }),
      { id: "discover-circle", type: "ellipse", name: "DISCOVER MORE circle", x: 1407, y: 911, width: 72, height: 72, stroke: { color: "#FFFFFF", width: 2, align: "center" }, fill: { color: "#FFFFFF", opacity: 0 } },
      text("discover-arrow", "DISCOVER MORE arrow", 1420, 920, 50, 54, "→", { family: "Inter", weight: 500, size: 47, lineHeight: 54, color: "#FFFFFF" })
    ]
  }
};

const rl = createInterface({ input, output });
const client = new StdioMcpClient({
  command: process.execPath,
  args: ["src/index.js"],
  cwd: process.cwd(),
  timeoutMs: Number(process.env.UNIFIED_PROBE_TIMEOUT_MS || 60000),
  clientName: "sonic-hero-unified-builder"
});

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

try {
  await client.connect();
  let status = await call("unified_runtime_status");
  if (!status.runtime?.connected) {
    await rl.question("\nRun the Unified Runtime plugin from figma-plugin/manifest.json, keep it open, then press Enter...");
    status = await call("unified_runtime_status");
  }
  if (!status.runtime?.connected) throw new Error("Unified Runtime plugin is not connected.");

  await call("unified_execute", { capability: "custom.design.apply", payload: { doc, dryRun: true, reveal: false } });
  const built = await call("unified_execute", { capability: "custom.design.apply", payload: { doc, dryRun: false, reveal: true } });
  const rootId = built.result?.rootId;
  if (rootId) await call("unified_execute", { capability: "custom.node.read", payload: { nodeId: rootId, depth: 1 } });
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
  await client.close().catch(() => {});
}
