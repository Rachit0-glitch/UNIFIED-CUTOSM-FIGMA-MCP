import { ERROR_CODES, UnifiedError } from "../../errors.js";
import { createCommandEnvelope } from "../protocol.js";
// Block A / A2 — REUSE BY IMPORT (see docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md): this is the real
// figma-custom-mcp compiler, not a re-derived equivalent. `custom.design`'s payload schema (see
// runtime/capabilities.js) already validates the raw DesignDoc against the actual DesignDocSchema —
// compileDesignDoc here does the remaining cross-field compilation (and can still throw a CompileError
// for things a per-field Zod schema structurally cannot catch, e.g. duplicate node ids).
import { compileDesignDoc, CompileError, normalizeLayoutForPlugin } from "figma-custom-mcp/dist/compiler.js";

// Block A / A6-A9 — every operation in this list maps to a plugin handler that reads its own args
// flat (no `props`-style wrapping), verified per-tool against FIGMA-CUSTOM-MCP/src/tools.ts's own
// `bridge.request(cmd, args)` calls before being added here (see docs/BLOCK_A_SOURCE_PARITY.md). The
// capability's own Zod schema (runtime/capabilities.js) has already validated/defaulted `payload` by
// the time this runs, so a straight pass-through is correct and complete — not a shortcut.
const PASS_THROUGH_OPERATIONS = new Set([
  "node.move",
  "boolean.op",
  "group.create",
  "group.ungroup",
  "component_set.create",
  "paint_style.create",
  "styles.list",
  "styles.manage",
  "text_range.set",
  "component_property.manage",
  "instance.override",
  "instance.swap",
  "instance.create",
  "variables.manage",
  "mask.set"
]);

/**
 * H9 (pre-Block-A hardening) — payload shape/bounds are now validated once by CommandRouter against
 * the capability's own Zod schema (see runtime/capabilities.js) before this adapter ever runs. This
 * adapter's only remaining job is mapping already-clean, already-defaulted data onto the envelope's
 * operation-specific shape — no more manual type/bounds checks duplicated here.
 */
export class CustomProtocolAdapter {
  family = "custom";

  async toEnvelope({ capability, payload = {}, requestId, metadata = {} }) {
    let normalized = {};
    if (capability.operation === "node.read") {
      normalized = {
        depth: payload.depth,
        ...(payload.nodeId ? { nodeId: payload.nodeId } : {}),
        ...(payload.include ? { include: payload.include } : {})
      };
    } else if (capability.operation === "selection.read") {
      normalized = { depth: payload.depth, ...(payload.include ? { include: payload.include } : {}) };
    } else if (capability.operation === "design.apply") {
      let compiled;
      try {
        // payload.doc has already passed the real DesignDocSchema (capability schema) — only cross-
        // field compilation (and, for a real "file:"/"data:" src, asset resolution) happens here.
        compiled = await compileDesignDoc(payload.doc);
      } catch (e) {
        if (e instanceof CompileError) {
          throw new UnifiedError(ERROR_CODES.DESIGN_COMPILE_ERROR, `custom.design: ${e.message}`, { source: this.family, nodeId: e.nodeId });
        }
        throw e;
      }
      if (payload.dryRun) {
        // Mirrors figma_design's own dryRun contract exactly (see FIGMA-CUSTOM-MCP/src/tools.ts) —
        // validate + compile without ever touching the bridge/plugin at all. `dryRunResult` is a
        // CommandRouter-internal short-circuit signal (see commandRouter.js), never sent over the wire.
        return {
          dryRunResult: {
            dryRun: true,
            nodeCount: compiled.plan.ops.length,
            assetCount: compiled.plan.assets.length,
            svgCount: compiled.plan.svgs.length,
            plan: compiled.plan
          }
        };
      }
      normalized = { plan: compiled.plan };
    } else if (capability.operation === "node.patch") {
      // The public payload shape is flat (nodeId + every patchable property at the top level, matching
      // figma_patch_node's own public schema) — but the plugin's handlePatchNode (a verbatim port, see
      // figma-plugin/code.js) reads properties from a nested `props` object, exactly like the original
      // Custom MCP tool layer does (FIGMA-CUSTOM-MCP/src/tools.ts:156-160: `const { nodeId, layout,
      // ...rest } = args; const props = { ...rest, layout: layout ? normalizeLayoutForPlugin(layout) :
      // undefined }`). This wrapping is real behavior, not incidental — reproduce it exactly here.
      const { nodeId, layout, ...rest } = payload;
      normalized = { nodeId, props: { ...rest, layout: layout ? normalizeLayoutForPlugin(layout) : undefined } };
    } else if (capability.operation === "node.delete") {
      normalized = { nodeId: payload.nodeId };
    } else if (capability.operation === "node.reorder") {
      normalized = { nodeId: payload.nodeId, to: payload.to };
    } else if (PASS_THROUGH_OPERATIONS.has(capability.operation)) {
      normalized = payload;
    } else if (capability.operation !== "status") {
      throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Unsupported Custom operation: ${capability.operation}.`, { source: this.family });
    }
    return createCommandEnvelope({
      requestId,
      family: this.family,
      operation: capability.operation,
      payload: normalized,
      metadata: { capability: capability.id, ...metadata }
    });
  }
}
