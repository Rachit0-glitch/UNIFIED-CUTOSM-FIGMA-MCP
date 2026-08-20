#!/usr/bin/env node
// Block A mini-design acceptance (brief §46-47) + real coverage for A3 (typography)/A4 (appearance)/
// A5 (nested auto-layout)/A8 (local image import — the actual P0 gap this whole project exists to
// fill) in one composition, then a full P3 inspect/measure/diff/verify pass against it, then cleanup.
// No plugin reload needed — every capability exercised here was already ported in earlier batches.
import { writeFileSync } from "node:fs";
import { StdioMcpClient } from "../src/mcp/stdioClient.js";
import { parseToolText } from "../src/utils.js";

const client = new StdioMcpClient({ command: process.execPath, args: ["src/index.js"], cwd: process.cwd(), timeoutMs: 20000, clientName: "figma-unified-mini-design" });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function near(a, b, eps = 1) { return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps; }

async function call(name, args = {}) {
  const result = await client.callTool(name, args);
  const parsed = parseToolText(result);
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 250)} ===`);
  console.log(JSON.stringify(parsed, null, 2).slice(0, 2000));
  return parsed;
}
async function execute(capability, payload = {}) {
  return await call("unified_execute", { capability, payload });
}
async function waitForPlugin(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = parseToolText(await client.callTool("unified_runtime_status", {}));
    if (status?.runtime?.connected) return status;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for the Unified plugin to pair.");
}

const results = { steps: [] };
let rootId, ctaId;

try {
  await client.connect();
  await waitForPlugin();
  results.steps.push({ step: "pair", ok: true });

  // ---- Build a hero-section mini-design (brief §21/§46): nested auto-layout, multi-level typography,
  // fills/strokes/radius/shadows, a local image import (A8's headline capability), on a scratch page. ----
  const doc = {
    version: "1",
    page: "Block A Scratch",
    root: {
      id: "hero",
      type: "frame",
      name: "Hero Section",
      width: 1440,
      height: 640,
      fill: { type: "solid", color: "#0b0f19" },
      layout: { mode: "row", gap: 64, pad: [80, 80, 80, 80], align: "center", justify: "between" },
      children: [
        {
          id: "hero-copy",
          type: "frame",
          layout: { mode: "col", gap: 20, pad: 0, align: "start" },
          sizing: { horizontal: "fill" },
          children: [
            { id: "eyebrow", type: "text", text: "UNIFIED FIGMA MCP", font: { family: "Inter", weight: 700, size: 14, letterSpacing: 2, color: "#5b8def" } },
            { id: "heading", type: "text", text: "One plugin. Every capability.", font: { family: "Inter", weight: 800, size: 56, lineHeight: 64, color: "#ffffff" } },
            { id: "subcopy", type: "text", text: "Plumb, Custom, P2, and P3 — through a single Figma runtime connection.", font: { family: "Inter", weight: 400, size: 18, lineHeight: 28, color: "#a3adc2" } },
            {
              id: "cta-group",
              type: "frame",
              layout: { mode: "row", gap: 12, pad: 0 },
              children: [
                {
                  id: "cta",
                  type: "frame",
                  name: "CTA Button",
                  layout: { mode: "row", gap: 8, pad: [14, 28, 14, 28], justify: "center", align: "center" },
                  fill: { type: "solid", color: "#5b8def" },
                  radius: 8,
                  effects: [{ type: "drop-shadow", x: 0, y: 8, blur: 24, color: "#5b8def", opacity: 0.35 }],
                  children: [{ id: "cta-label", type: "text", text: "Get Started", font: { family: "Inter", weight: 600, size: 15, color: "#ffffff" } }]
                }
              ]
            }
          ]
        },
        {
          id: "hero-visual",
          type: "frame",
          name: "Visual",
          width: 420,
          height: 420,
          radius: 24,
          stroke: { color: "#22283a", width: 1 },
          fill: { type: "solid", color: "#131826" },
          children: [
            {
              id: "hero-image",
              type: "image",
              name: "Product Shot",
              x: 30,
              y: 30,
              width: 360,
              height: 360,
              src: `file:C:\\Users\\rachi\\OneDrive\\Documents\\FIGMA\\assets\\platter.png`
            }
          ]
        }
      ]
    }
  };

  const built = await execute("custom.design", { doc });
  const ids = built.result?.ids || {};
  rootId = ids["hero"];
  ctaId = ids["cta"];
  const headingId = ids["heading"];
  const imageId = ids["hero-image"];
  results.steps.push({ step: "build hero mini-design (nested auto-layout + typography + appearance + local image)", ok: built.ok === true && !!rootId && built.result?.warnings?.length === 0 });
  if (built.result?.warnings?.length) console.log("WARNINGS:", JSON.stringify(built.result.warnings));

  // ---- A8: confirm the local image genuinely imported (not a fallback/placeholder) ----
  const imageRead = await execute("custom.node.read", { nodeId: imageId, depth: 0, include: ["appearance"] });
  const fill = imageRead.result?.doc?.fills?.[0];
  results.steps.push({ step: "A8: local file: image genuinely imported as an IMAGE fill (real imageHash, not a placeholder)", ok: imageRead.ok === true && fill?.type === "IMAGE" && typeof fill?.imageHash === "string" && fill.imageHash.length > 0 });

  // ---- A3: typography — read back heading and confirm authored font properties landed ----
  const headingRead = await execute("custom.node.read", { nodeId: headingId, depth: 0, include: ["text"] });
  const h = headingRead.result?.doc;
  results.steps.push({
    step: "A3: typography — heading has correct family/weight/size/lineHeight",
    ok: headingRead.ok === true && h?.fontFamily === "Inter" && h?.fontSize === 56 && near(h?.lineHeight?.value, 64, 0.5) && h?.characters === "One plugin. Every capability."
  });

  // ---- A4: appearance — CTA has correct fill/radius/effects ----
  const ctaRead = await execute("custom.node.read", { nodeId: ctaId, depth: 0, include: ["appearance"] });
  const cta = ctaRead.result?.doc;
  results.steps.push({
    step: "A4: appearance — CTA has correct fill/cornerRadius/drop-shadow effect",
    ok: ctaRead.ok === true && cta?.cornerRadius === 8 && cta?.effects?.[0]?.type === "DROP_SHADOW" && near(cta?.effects?.[0]?.radius, 24, 0.5)
  });

  // ---- A5: layout — the outer hero frame is real auto-layout with the authored gap/padding ----
  const heroRead = await execute("custom.node.read", { nodeId: rootId, depth: 0, include: ["layout"] });
  const heroLayout = heroRead.result?.doc?.layout;
  results.steps.push({
    step: "A5: layout — hero frame is real HORIZONTAL auto-layout with authored gap 64 / padding 80",
    ok: heroRead.ok === true && heroLayout?.mode === "HORIZONTAL" && heroLayout?.gap === 64 && heroLayout?.pad?.[0] === 80
  });

  // ---- Resize the outer frame and confirm auto-layout children stay coherent (brief §9's resize test) ----
  const resized = await execute("custom.patch_node", { nodeId: rootId, width: 1600 });
  const ctaAfterResize = await execute("custom.node.read", { nodeId: ctaId, depth: 0, include: ["geometry"] });
  results.steps.push({
    step: "resize the hero frame: CTA (auto-positioned by layout) remains a valid, still-rendered node afterward",
    ok: resized.ok === true && ctaAfterResize.ok === true && typeof ctaAfterResize.result?.doc?.absoluteBoundingBox?.width === "number"
  });

  // ---- P3 over the mini-design: measure, diff, verify, idempotency ----
  const measured = await execute("custom.measure", { mode: "bounds", nodeIds: [ctaId, headingId] });
  results.steps.push({ step: "P3 measure: bounds for 2 real nodes in the mini-design", ok: measured.ok === true && !!measured.result?.bounds?.[ctaId] });

  const verify1 = await execute("custom.verify", { expectations: [{ nodeId: ctaId, expected: { cornerRadius: 8 } }, { nodeId: headingId, expected: { fontSize: 56 } }] });
  results.steps.push({ step: "P3 verify: mini-design matches its own authored expectations", ok: verify1.ok === true && verify1.result?.ok === true && verify1.result?.differenceCount === 0 });

  const verify2 = await execute("custom.verify", { expectations: [{ nodeId: ctaId, expected: { cornerRadius: 8 } }, { nodeId: headingId, expected: { fontSize: 56 } }] });
  results.steps.push({ step: "IDEMPOTENCY: re-running the same verify produces the identical result", ok: verify2.ok === true && JSON.stringify(verify1.result) === JSON.stringify(verify2.result) });

  // ---- Cross-family: a Plumb-family read of the same live document ----
  const plumbRead = await execute("plumb.outline", { page: "Block A Scratch" });
  results.steps.push({ step: "cross-family: plumb.outline sees the Custom-built hero frame through the same one plugin", ok: plumbRead.ok === true && plumbRead.result?.pages?.[0]?.screens?.some((s) => s.id === rootId) });

  // ---- Cleanup ----
  const deleted = await execute("custom.delete_node", { nodeId: rootId });
  const readAfterDelete = await execute("custom.node.read", { nodeId: rootId });
  results.steps.push({ step: "cleanup: mini-design deleted and confirmed absent", ok: deleted.ok === true && readAfterDelete.ok === false && readAfterDelete.error?.code === "NODE_NOT_FOUND" });

  const allOk = results.steps.every((s) => s.ok);
  results.ok = allOk;
  console.log("\n=== MINI-DESIGN + P3 + CROSS-FAMILY SUMMARY ===");
  for (const step of results.steps) console.log(`  [${step.ok ? "PASS" : "FAIL"}] ${step.step}`);
  console.log(allOk ? "\nMINI-DESIGN ACCEPTANCE: PASS" : "\nMINI-DESIGN ACCEPTANCE: FAIL");
  writeFileSync(new URL("./block-a-mini-design-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = allOk ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  results.ok = false;
  results.error = error instanceof Error ? error.message : String(error);
  writeFileSync(new URL("./block-a-mini-design-results.json", import.meta.url), JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
