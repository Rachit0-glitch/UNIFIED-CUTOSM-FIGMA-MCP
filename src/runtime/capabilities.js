import { z } from "zod";
import { ERROR_CODES, UnifiedError } from "../errors.js";
import { MAX_READ_DEPTH } from "./limits.js";

/**
 * H9 (pre-Block-A hardening) — every capability now carries its OWN Zod payload schema as the single
 * source of truth for "what does a valid call look like," validated once by CommandRouter before any
 * protocol adapter or bridge call happens. Protocol adapters used to hand-roll this per operation
 * (`assertObject`, manual depth-bound checks, manual `typeof` guards) — a pattern that does not scale
 * past a handful of capabilities. This does NOT define every future Block-A capability's schema; it
 * establishes the pattern for the 6 capabilities Stage 4 already shipped, so Block A can extend the
 * registry by adding `{id, family, operation, description, mutation, enabled, timeoutMs, schema}`
 * entries rather than also writing new adapter branches.
 */
const DepthSchema = z.number().int().min(0).max(MAX_READ_DEPTH);

const EmptyPayloadSchema = z.object({}).strict();

const PlumbOutlineSchema = z.object({ page: z.string().optional() }).strict();

const PlumbSelectionReadSchema = z
  .object({
    depth: DepthSchema.optional().default(2),
    notes: z.boolean().optional(),
    maxTokens: z.number().optional()
  })
  .strict();

const CustomNodeReadSchema = z
  .object({
    nodeId: z.string().optional(),
    depth: DepthSchema.optional().default(1)
  })
  .strict();

const CustomSelectionReadSchema = z
  .object({
    depth: DepthSchema.optional().default(1)
  })
  .strict();

export const STAGE4_CAPABILITIES = Object.freeze([
  {
    id: "plumb.status",
    family: "plumb",
    operation: "status",
    description: "Read Unified plugin Plumb-family runtime status.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000,
    schema: EmptyPayloadSchema
  },
  {
    id: "plumb.outline",
    family: "plumb",
    operation: "outline",
    description: "Read pages and top-level screens using Plumb-family outline semantics.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000,
    schema: PlumbOutlineSchema
  },
  {
    id: "plumb.selection.read",
    family: "plumb",
    operation: "selection.read",
    description: "Read the current Figma selection using Plumb-family compact node summaries.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000,
    schema: PlumbSelectionReadSchema
  },
  {
    id: "custom.status",
    family: "custom",
    operation: "status",
    description: "Read Unified plugin Custom-family runtime status.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000,
    schema: EmptyPayloadSchema
  },
  {
    id: "custom.node.read",
    family: "custom",
    operation: "node.read",
    description: "Read one Figma node, or the current page when nodeId is omitted.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000,
    schema: CustomNodeReadSchema
  },
  {
    id: "custom.selection.read",
    family: "custom",
    operation: "selection.read",
    description: "Read the current Figma selection using Custom-family node serialization.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000,
    schema: CustomSelectionReadSchema
  }
]);

export class CapabilityRegistry {
  constructor(capabilities = STAGE4_CAPABILITIES) {
    this.capabilities = new Map();
    for (const capability of capabilities) {
      // H14 — duplicate capability ids must never silently overwrite an earlier registration; a
      // typo'd/copy-pasted id during Block A capability additions would otherwise shadow an existing
      // capability without any signal at all.
      if (this.capabilities.has(capability.id)) {
        throw new UnifiedError(ERROR_CODES.INVALID_COMMAND, `Duplicate capability id registered: ${capability.id}.`, { capability: capability.id });
      }
      this.capabilities.set(capability.id, Object.freeze({ ...capability }));
    }
  }

  list() {
    return [...this.capabilities.values()].map((capability) => ({ ...capability }));
  }

  get(id) {
    const capability = this.capabilities.get(id);
    if (!capability) {
      throw new UnifiedError(ERROR_CODES.CAPABILITY_NOT_FOUND, `Capability not found: ${id || "missing"}.`, { capability: id });
    }
    if (!capability.enabled) {
      throw new UnifiedError(ERROR_CODES.CAPABILITY_DISABLED, `Capability disabled: ${id}.`, { capability: id });
    }
    return capability;
  }
}
