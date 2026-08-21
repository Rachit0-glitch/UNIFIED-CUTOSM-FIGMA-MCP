import { z } from "zod";
import { ERROR_CODES, UnifiedError } from "../errors.js";
import { createCommandEnvelope, createRequestId } from "./protocol.js";
import { MAX_READ_DEPTH } from "./limits.js";
// Block A / A10 — REUSE BY IMPORT (see docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md): diff.js/measure.js
// are pure Node-side comparison logic (no `figma` dependency at all — confirmed by reading the source),
// the exact same functions figma_diff/figma_verify/figma_measure call. Reusing them here means P3's
// severity classification, tolerance defaults, and known field-name-mismatch fixes (radius vs
// cornerRadius, text vs characters — see diff.ts's own comments about a real bug found via P3 live
// testing) all carry over automatically, with zero chance of Unified silently reintroducing a bug
// Custom MCP's own P3 work already found and fixed.
import { diffTrees, flattenActualTree, verifyExpectations } from "figma-custom-mcp/dist/diff.js";
import { horizontalGap, verticalGap, overlap, containment, centerDelta, measureAlignment } from "figma-custom-mcp/dist/measure.js";
import { DesignNodeSchema } from "figma-custom-mcp/dist/design-schema.js";

/** Issues one `custom.node.read`-equivalent bridge call, through the same queue every other command
 * uses (preserving the single-plugin-connection FIFO invariant), without going through CommandRouter's
 * own single-envelope path (which compound capabilities bypass entirely — see commandRouter.js). */
async function readNode({ bridge, queue, nodeId, depth, include }, timeoutMs) {
  const envelope = createCommandEnvelope({
    requestId: createRequestId(),
    family: "custom",
    operation: "node.read",
    payload: { ...(nodeId ? { nodeId } : {}), depth, ...(include ? { include } : {}) }
  });
  const response = await queue.enqueue(async () => await bridge.execute(envelope, timeoutMs), {
    requestId: envelope.requestId,
    capability: "custom.node.read (internal, compound)",
    family: "custom",
    operation: "node.read"
  });
  if (!response.ok) {
    throw new UnifiedError(response.error?.code || ERROR_CODES.COMMAND_EXECUTION_FAILED, response.error?.message || `Failed to read node ${nodeId ?? "(page)"} for a compound capability.`, {
      source: "custom",
      nodeId,
      cause: response.error
    });
  }
  return response.result.doc;
}

const TolerancesSchema = z
  .object({
    geometry: z.number().nonnegative().optional(),
    opacity: z.number().nonnegative().optional(),
    rotation: z.number().nonnegative().optional()
  })
  .strict()
  .optional();

// ---- custom.diff -----------------------------------------------------------------------------

const CustomDiffSchema = z
  .object({
    expected: DesignNodeSchema,
    idMap: z.record(z.string(), z.string()),
    actual: z.unknown().optional(),
    nodeId: z.string().optional(),
    depth: z.number().int().min(1).max(MAX_READ_DEPTH).optional(),
    tolerances: TolerancesSchema
  })
  .strict()
  .refine((v) => v.actual !== undefined || v.nodeId !== undefined, { message: 'provide either "actual" or "nodeId".' });

async function runDiff({ payload, bridge, queue }) {
  let actual = payload.actual;
  if (actual === undefined) {
    actual = await readNode({ bridge, queue, nodeId: payload.nodeId, depth: payload.depth ?? MAX_READ_DEPTH, include: null }, 15000);
  }
  return diffTrees(payload.expected, actual, payload.idMap, payload.tolerances ?? {});
}

// ---- custom.verify ----------------------------------------------------------------------------

const CustomVerifySchema = z
  .object({
    expectations: z.array(z.object({ nodeId: z.string(), expected: z.record(z.string(), z.unknown()) }).strict()).min(1),
    tolerances: TolerancesSchema
  })
  .strict();

async function runVerify({ payload, bridge, queue }) {
  const actualByFigmaId = new Map();
  for (const { nodeId } of payload.expectations) {
    if (actualByFigmaId.has(nodeId)) continue;
    try {
      const doc = await readNode({ bridge, queue, nodeId, depth: 1, include: null }, 15000);
      actualByFigmaId.set(nodeId, doc);
    } catch {
      // A node that can't be read (deleted, invalid id) is legitimately "missing" for verification
      // purposes — verifyExpectations already handles an absent map entry as CRITICAL/missing, so this
      // is not silently swallowing a real bridge failure, it's the exact input shape that function
      // expects for "this node doesn't exist."
    }
  }
  return verifyExpectations(payload.expectations, actualByFigmaId, payload.tolerances ?? {});
}

// ---- custom.measure ---------------------------------------------------------------------------

const CustomMeasureSchema = z
  .object({
    mode: z.enum(["bounds", "gap", "overlap", "containment", "center-delta", "alignment"]),
    nodeIds: z.array(z.string()).min(1),
    axis: z.enum(["x", "y"]).optional(),
    edge: z.enum(["left", "right", "top", "bottom", "centerX", "centerY"]).optional(),
    reference: z.number().optional()
  })
  .strict();

async function runMeasure({ payload, bridge, queue }) {
  const { mode, nodeIds, axis, edge, reference } = payload;
  const rectsById = new Map();
  const notFound = [];
  for (const nodeId of nodeIds) {
    let doc;
    try {
      doc = await readNode({ bridge, queue, nodeId, depth: 0, include: ["geometry"] }, 15000);
    } catch {
      notFound.push(nodeId);
      continue;
    }
    const box = doc?.absoluteBoundingBox;
    if (!box) {
      notFound.push(nodeId);
      continue;
    }
    rectsById.set(nodeId, box);
  }
  if (notFound.length) {
    throw new UnifiedError(ERROR_CODES.NODE_NOT_FOUND, `custom.measure: could not resolve absoluteBoundingBox for node(s) [${notFound.join(", ")}].`, { source: "custom", nodeIds: notFound });
  }

  if (mode === "bounds") return { bounds: Object.fromEntries(rectsById) };
  if (mode === "gap") {
    if (nodeIds.length !== 2) throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, 'custom.measure: mode "gap" requires exactly 2 nodeIds.', { source: "custom" });
    if (!axis) throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, 'custom.measure: mode "gap" requires "axis".', { source: "custom" });
    const [a, b] = nodeIds.map((id) => rectsById.get(id));
    const gap = axis === "x" ? horizontalGap(a, b) : verticalGap(a, b);
    return { axis, gap, overlapping: gap < 0 };
  }
  if (mode === "overlap") {
    if (nodeIds.length !== 2) throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, 'custom.measure: mode "overlap" requires exactly 2 nodeIds.', { source: "custom" });
    const [a, b] = nodeIds.map((id) => rectsById.get(id));
    return overlap(a, b);
  }
  if (mode === "containment") {
    if (nodeIds.length !== 2) throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, 'custom.measure: mode "containment" requires exactly 2 nodeIds: [child, parent].', { source: "custom" });
    const [child, parent] = nodeIds.map((id) => rectsById.get(id));
    return containment(child, parent);
  }
  if (mode === "center-delta") {
    if (nodeIds.length !== 2) throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, 'custom.measure: mode "center-delta" requires exactly 2 nodeIds.', { source: "custom" });
    const [a, b] = nodeIds.map((id) => rectsById.get(id));
    return centerDelta(a, b);
  }
  // mode === "alignment"
  if (!edge) throw new UnifiedError(ERROR_CODES.INVALID_PAYLOAD, 'custom.measure: mode "alignment" requires "edge".', { source: "custom" });
  return { entries: measureAlignment(rectsById, edge, reference) };
}

// Production Lock §17 — capability registry metadata audit. Every non-compound capability carries a
// `timeoutMs` enforced as one hard cap around its single bridge round trip (CommandRouter -> CommandQueue
// -> UnifiedRuntimeBridge). Compound capabilities don't have one bridge call to cap — `runDiff`/
// `runVerify`/`runMeasure` each make their OWN internal `readNode(..., 15000)` calls (one PER node
// being read, sequentially — `custom.verify`/`custom.measure` can read several), so no single number
// bounds the whole operation the way it does elsewhere. `timeoutMs: 15000` below is documented as
// PER-INTERNAL-READ, matching the literal actually enforced in compoundCapabilities.js's `readNode`
// calls — present and accurate rather than silently absent, without changing any real behavior.
export const COMPOUND_CAPABILITIES = Object.freeze([
  {
    id: "custom.diff",
    family: "custom",
    operation: "diff",
    description: "P3 — compare an authored DesignNode tree against its actual, currently-built Figma state, matched via idMap (authored id -> live Figma id, from a prior custom.design result's `ids`). Returns {missing, extra, changed, matched, severityCounts}.",
    mutation: false,
    enabled: true,
    stage: "blockA-a10",
    compound: true,
    timeoutMs: 15000, // per internal read (up to 1 for a diff against a live nodeId) — see note above
    schema: CustomDiffSchema,
    handler: runDiff
  },
  {
    id: "custom.verify",
    family: "custom",
    operation: "verify",
    description: "P3 — verify a flat list of {nodeId, expected} property expectations against live Figma state. Returns {ok, differenceCount, differences, missing, severityCounts}.",
    mutation: false,
    enabled: true,
    stage: "blockA-a10",
    compound: true,
    timeoutMs: 15000, // per internal read — verifying N distinct nodeIds makes up to N such reads
    schema: CustomVerifySchema,
    handler: runVerify
  },
  {
    id: "custom.measure",
    family: "custom",
    operation: "measure",
    description: "P3 — deterministic geometric measurement between existing nodes (bounds/gap/overlap/containment/center-delta/alignment), using real page-space absoluteBoundingBox. Numeric facts only, never a qualitative judgement.",
    mutation: false,
    enabled: true,
    stage: "blockA-a10",
    compound: true,
    timeoutMs: 15000, // per internal read — measuring N nodeIds makes up to N such reads
    schema: CustomMeasureSchema,
    handler: runMeasure
  }
]);

export { flattenActualTree };
