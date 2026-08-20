import { z } from "zod";
import { ERROR_CODES, UnifiedError } from "../errors.js";
import { MAX_READ_DEPTH } from "./limits.js";
// Block A — REUSE BY IMPORT (see docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md): these are the real
// figma-custom-mcp field schemas (FillSchema/StrokeSchema/RadiusSchema/EffectSchema/BlendModeSchema/
// LayoutSchema/FontSchema/DesignDocSchema), the exact same source of truth `figma_design`/
// `figma_patch_node` validate against — not re-derived Zod equivalents that could silently drift.
import {
  DesignDocSchema,
  FillSchema,
  StrokeSchema,
  RadiusSchema,
  EffectSchema,
  BlendModeSchema,
  LayoutSchema,
  FontSchema
} from "figma-custom-mcp/dist/design-schema.js";
// Block A / A10 — compound capabilities (custom.diff/custom.verify/custom.measure) live in their own
// module since they don't fit the schema+adapter+single-bridge-call shape every other capability uses
// (see compoundCapabilities.js and commandRouter.js's `capability.compound` branch).
import { COMPOUND_CAPABILITIES } from "./compoundCapabilities.js";

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

// Block A / A1 (full-fidelity reads) — the exact same 8 category names Custom MCP's own figma_node
// `include` param accepts (FIGMA-CUSTOM-MCP/src/tools.ts), reused verbatim rather than invented fresh,
// since the plugin-side serializer producing these fields is itself a literal port of Custom's real
// serializeNode/serializeNodeProperties (figma-plugin/code.js) — see docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md.
const ReadbackCategorySchema = z.enum(["geometry", "layout", "appearance", "text", "component", "variables", "styles", "metadata"]);

const CustomNodeReadSchema = z
  .object({
    nodeId: z.string().optional(),
    depth: DepthSchema.optional().default(1),
    include: z.array(ReadbackCategorySchema).optional()
  })
  .strict();

const CustomSelectionReadSchema = z
  .object({
    depth: DepthSchema.optional().default(1),
    include: z.array(ReadbackCategorySchema).optional()
  })
  .strict();

// Block A / A2 (core mutation path).

const CustomDesignSchema = z
  .object({
    doc: DesignDocSchema,
    dryRun: z.boolean().optional()
  })
  .strict();

// Verbatim copies of the two tool-layer-only schemas figma_patch_node defines inline (not exported
// from design-schema.ts, since they only exist at FIGMA-CUSTOM-MCP/src/tools.ts:114-119) — reproduced
// here rather than re-derived, so a future upstream change to either is a one-line diff to notice, not
// a silent behavioral drift.
const ConstraintAxisSchema = z.enum(["min", "center", "max", "stretch", "scale"]);

const PatchTextSchema = z
  .object({ characters: z.string().optional(), font: FontSchema.optional() })
  .strict()
  .refine((v) => v.characters !== undefined || v.font !== undefined, { message: '"text" requires at least one of "characters" or "font".' });

const CustomPatchNodeSchema = z
  .object({
    nodeId: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
    constraints: z.object({ horizontal: ConstraintAxisSchema, vertical: ConstraintAxisSchema }).strict().optional(),
    fillStyleRef: z.string().optional(),
    fill: z.union([FillSchema, z.array(FillSchema)]).optional(),
    stroke: StrokeSchema.optional(),
    radius: RadiusSchema.optional(),
    effects: z.array(EffectSchema).optional(),
    blendMode: BlendModeSchema.optional(),
    locked: z.boolean().optional(),
    layout: LayoutSchema.optional(),
    text: PatchTextSchema.optional()
  })
  .strict();

const CustomDeleteNodeSchema = z.object({ nodeId: z.string() }).strict();

const CustomReorderNodeSchema = z
  .object({
    nodeId: z.string(),
    to: z.union([z.number().int().min(0), z.enum(["front", "back"])])
  })
  .strict();

// Block A / A6-A9 — every operation below is a flat pass-through at the protocol adapter (see
// protocolAdapters/custom.js's PASS_THROUGH_OPERATIONS), matching the original figma_* tools' own
// `bridge.request(cmd, args)` calls (FIGMA-CUSTOM-MCP/src/tools.ts) — none of these wrap fields into a
// nested object the way figma_patch_node's `props` does, verified per-tool against source before
// assuming pass-through was safe (see docs/BLOCK_A_SOURCE_PARITY.md).

const CustomMoveNodeSchema = z
  .object({
    nodeId: z.string(),
    parentId: z.string(),
    index: z.number().int().min(0).optional(),
    preserveVisualPosition: z.boolean().optional()
  })
  .strict();

const CustomBooleanSchema = z
  .object({
    op: z.enum(["union", "subtract", "intersect", "exclude"]),
    nodeIds: z.array(z.string()).min(1),
    resultKey: z.string().optional()
  })
  .strict();

const CustomGroupSchema = z
  .object({
    nodeIds: z.array(z.string()).min(1),
    name: z.string().optional(),
    operationKey: z.string().optional()
  })
  .strict();

const CustomUngroupSchema = z.object({ nodeId: z.string() }).strict();

const CustomCreateComponentSetSchema = z
  .object({
    componentNodeIds: z.array(z.string()).min(2),
    name: z.string().optional(),
    operationKey: z.string().optional()
  })
  .strict();

// Verbatim copy of figma_create_paint_style's own PaintForStyle (FIGMA-CUSTOM-MCP/src/tools.ts:255-262)
// — note it deliberately only allows linear/radial gradients, unlike figma_styles' broader 4-gradient
// union below; this asymmetry is real source behavior, preserved exactly rather than "fixed."
const PaintForStyleSchema = z.union([
  z.object({ type: z.literal("solid"), color: z.string(), opacity: z.number().min(0).max(1).optional() }).strict(),
  z
    .object({
      type: z.enum(["linear-gradient", "radial-gradient"]),
      angle: z.number().optional(),
      stops: z.array(z.object({ at: z.number().min(0).max(1), color: z.string() }).strict()).min(2)
    })
    .strict()
]);

const CustomCreatePaintStyleSchema = z
  .object({
    name: z.string(),
    paint: PaintForStyleSchema,
    description: z.string().optional()
  })
  .strict();

const CustomListStylesSchema = EmptyPayloadSchema;

// Verbatim copies of figma_styles' own inline EffectForStyle/LayoutGridForStyle/paint-union
// (FIGMA-CUSTOM-MCP/src/tools.ts:445-499).
const EffectForStyleSchema = z
  .object({
    type: z.enum(["drop-shadow", "inner-shadow", "layer-blur", "background-blur"]),
    x: z.number().optional(),
    y: z.number().optional(),
    blur: z.number().optional(),
    spread: z.number().optional(),
    color: z.string().optional(),
    opacity: z.number().min(0).max(1).optional()
  })
  .strict();

const LayoutGridForStyleSchema = z.union([
  z
    .object({
      pattern: z.enum(["rows", "columns"]),
      alignment: z.enum(["min", "max", "stretch", "center"]),
      gutter: z.number().nonnegative(),
      count: z.number().int(),
      sectionSize: z.number().nonnegative().optional(),
      offset: z.number().optional(),
      color: z.string().optional()
    })
    .strict(),
  z.object({ pattern: z.literal("grid"), sectionSize: z.number().positive(), color: z.string().optional() }).strict()
]);

const CustomStylesSchema = z
  .object({
    kind: z.enum(["paint", "text", "effect", "grid"]),
    action: z.enum(["create", "apply", "unapply", "delete", "list"]),
    name: z.string().optional(),
    description: z.string().optional(),
    paint: z
      .union([
        z.object({ type: z.literal("solid"), color: z.string(), opacity: z.number().min(0).max(1).optional() }).strict(),
        z
          .object({
            type: z.enum(["linear-gradient", "radial-gradient", "angular-gradient", "diamond-gradient"]),
            angle: z.number().optional(),
            stops: z.array(z.object({ at: z.number().min(0).max(1), color: z.string() }).strict()).min(2)
          })
          .strict()
      ])
      .optional(),
    font: z
      .object({ family: z.string().optional(), weight: z.number().optional(), size: z.number().optional(), lineHeight: z.number().optional(), letterSpacing: z.number().optional() })
      .strict()
      .optional(),
    effects: z.array(EffectForStyleSchema).optional(),
    layoutGrids: z.array(LayoutGridForStyleSchema).optional(),
    nodeId: z.string().optional(),
    paintTarget: z.enum(["fills", "strokes"]).optional()
  })
  .strict();

const CustomTextRangeSchema = z
  .object({
    nodeId: z.string(),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    fontFamily: z.string().optional(),
    fontWeight: z.number().optional(),
    fontSize: z.number().positive().optional(),
    fill: z.object({ type: z.literal("solid"), color: z.string(), opacity: z.number().min(0).max(1).optional() }).strict().optional(),
    letterSpacing: z.number().optional(),
    lineHeight: z.number().positive().optional(),
    decoration: z.enum(["none", "underline", "strikethrough"]).optional(),
    hyperlink: z.union([z.string(), z.null()]).optional(),
    styleRef: z.string().optional()
  })
  .strict();

const CustomComponentPropertySchema = z
  .object({
    nodeId: z.string(),
    action: z.enum(["add", "edit", "delete", "list"]),
    name: z.string().optional(),
    propType: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "SLOT"]).optional(),
    defaultValue: z.union([z.string(), z.boolean()]).optional(),
    propertyId: z.string().optional(),
    options: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

const CustomInstanceOverrideSchema = z
  .object({
    instanceId: z.string(),
    action: z.enum(["set", "reset", "set_node"]),
    properties: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
    targetNodeId: z.string().optional(),
    props: z
      .object({
        characters: z.string().optional(),
        visible: z.boolean().optional(),
        opacity: z.number().min(0).max(1).optional(),
        fill: z.object({ type: z.literal("solid"), color: z.string(), opacity: z.number().min(0).max(1).optional() }).strict().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const CustomInstanceSwapSchema = z.object({ instanceId: z.string(), componentId: z.string() }).strict();

const CustomCreateInstanceSchema = z
  .object({
    componentId: z.string(),
    parentId: z.string().optional(),
    name: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional()
  })
  .strict();

const CustomVariablesSchema = z
  .object({
    action: z.enum(["create_collection", "delete_collection", "add_mode", "rename_mode", "remove_mode", "create_variable", "delete_variable", "set_value", "bind", "unbind", "list"]),
    name: z.string().optional(),
    collectionId: z.string().optional(),
    modeId: z.string().optional(),
    variableId: z.string().optional(),
    resolvedType: z.enum(["BOOLEAN", "COLOR", "FLOAT", "STRING"]).optional(),
    value: z.union([z.string(), z.number(), z.boolean(), z.object({ alias: z.string() }).strict()]).optional(),
    nodeId: z.string().optional(),
    kind: z.enum(["node", "paint", "effect", "layoutGrid"]).optional(),
    field: z.string().optional(),
    paintProperty: z.enum(["fills", "strokes"]).optional(),
    paintIndex: z.number().int().min(0).optional(),
    effectIndex: z.number().int().min(0).optional(),
    gridIndex: z.number().int().min(0).optional()
  })
  .strict();

const CustomSetMaskSchema = z
  .object({
    nodeId: z.string(),
    isMask: z.boolean().optional(),
    maskType: z.enum(["alpha", "vector", "luminance"]).optional()
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
    id: "plumb.components",
    family: "plumb",
    operation: "components",
    description: "Enumerate every COMPONENT/COMPONENT_SET across the whole file, cross-referenced with INSTANCE counts. Genuinely new capability — no Custom equivalent (Custom operates on individual nodes/instances, never enumerates file-wide). Verbatim port of Plumb's own component/instance extraction.",
    mutation: false,
    enabled: true,
    stage: "blockA-a11",
    timeoutMs: 15000,
    schema: EmptyPayloadSchema
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
    description: "Read one Figma node (full fidelity: geometry, layout, appearance, text, component, variables, styles, metadata), or the current page when nodeId is omitted. Optional `include` filters to specific categories.",
    mutation: false,
    enabled: true,
    stage: "4",
    // Block A large-tree stress test (real finding): a full-fidelity read of a ~900-node tree
    // (1.1MB JSON payload) took ~7-8s and one run timed out at 8016ms against the old 8000ms budget
    // — a genuine near-miss, not a guess. 25000ms gives real headroom for large real trees.
    timeoutMs: 25000,
    schema: CustomNodeReadSchema
  },
  {
    id: "custom.selection.read",
    family: "custom",
    operation: "selection.read",
    description: "Read the current Figma selection using Custom-family full-fidelity node serialization. Optional `include` filters to specific categories.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 25000,
    schema: CustomSelectionReadSchema
  },
  {
    id: "custom.design",
    family: "custom",
    operation: "design.apply",
    description: "Build or sync a design into Figma from a strict JSON DesignDoc (same schema figma_design validates against) — supports overlapping/absolute-positioned nodes and strict field validation. Pass dryRun:true to validate + compile without touching Figma.",
    mutation: true,
    enabled: true,
    stage: "blockA-a2",
    // Block A large-tree stress test (real finding, not a guess): a 901-node build (300 cards, each
    // with a font-loaded text label) genuinely takes longer than 20000ms end-to-end inside the plugin
    // sandbox — a real COMMAND_TIMEOUT was observed and reproduced live. 90000ms gives real headroom
    // for large real-world compositions without masking genuine hangs (still a hard ceiling, not
    // "unlimited") — see docs/BLOCK_A_LIVE_RESULTS.md for the measured actual duration.
    timeoutMs: 90000,
    schema: CustomDesignSchema
  },
  {
    id: "custom.patch_node",
    family: "custom",
    operation: "node.patch",
    description: "Patch a subset of properties on an EXISTING node without touching siblings or re-stating the whole subtree (geometry, visibility, fill/stroke/radius/effects/blendMode, layout, text). Fields omitted are left untouched.",
    mutation: true,
    enabled: true,
    stage: "blockA-a2",
    timeoutMs: 8000,
    schema: CustomPatchNodeSchema
  },
  {
    id: "custom.delete_node",
    family: "custom",
    operation: "node.delete",
    description: "Delete an existing node by id.",
    mutation: true,
    enabled: true,
    stage: "blockA-a2",
    timeoutMs: 8000,
    schema: CustomDeleteNodeSchema
  },
  {
    id: "custom.reorder_node",
    family: "custom",
    operation: "node.reorder",
    description: "Change an existing node's z-order among its siblings without a full re-build. `to` is a 0-based child index, or \"front\"/\"back\".",
    mutation: true,
    enabled: true,
    stage: "blockA-a2",
    timeoutMs: 8000,
    schema: CustomReorderNodeSchema
  },
  {
    id: "custom.move_node",
    family: "custom",
    operation: "node.move",
    description: "Reparent an EXISTING node to a new parent container, correcting its transform so it keeps its visual (page-space) position across the coordinate-space change.",
    mutation: true,
    enabled: true,
    stage: "blockA-a6",
    timeoutMs: 8000,
    schema: CustomMoveNodeSchema
  },
  {
    id: "custom.boolean",
    family: "custom",
    operation: "boolean.op",
    description: "Combine EXISTING nodes into a real Figma BooleanOperationNode (union/subtract/intersect/exclude).",
    mutation: true,
    enabled: true,
    stage: "blockA-a7",
    timeoutMs: 8000,
    schema: CustomBooleanSchema
  },
  {
    id: "custom.group",
    family: "custom",
    operation: "group.create",
    description: "Create a genuine Figma GROUP from existing nodes (they must currently share the same parent). Pass operationKey for idempotent re-runs.",
    mutation: true,
    enabled: true,
    stage: "blockA-a7",
    timeoutMs: 8000,
    schema: CustomGroupSchema
  },
  {
    id: "custom.ungroup",
    family: "custom",
    operation: "group.ungroup",
    description: "Ungroup an existing GROUP node: children are reparented to the group's own parent, preserving order and position, and the empty group is removed.",
    mutation: true,
    enabled: true,
    stage: "blockA-a7",
    timeoutMs: 8000,
    schema: CustomUngroupSchema
  },
  {
    id: "custom.create_component_set",
    family: "custom",
    operation: "component_set.create",
    description: "Combine 2+ existing COMPONENT nodes into a real Figma COMPONENT_SET (variant set) via figma.combineAsVariants. Each component's name must follow Figma's \"Key=Value\" variant-name convention.",
    mutation: true,
    enabled: true,
    stage: "blockA-a7",
    timeoutMs: 8000,
    schema: CustomCreateComponentSetSchema
  },
  {
    id: "custom.create_paint_style",
    family: "custom",
    operation: "paint_style.create",
    description: "Create or update a real, named Figma PaintStyle (idempotent by name).",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomCreatePaintStyleSchema
  },
  {
    id: "custom.list_styles",
    family: "custom",
    operation: "styles.list",
    description: "Enumerate local Figma paint styles (id, name, resolved paints).",
    mutation: false,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomListStylesSchema
  },
  {
    id: "custom.styles",
    family: "custom",
    operation: "styles.manage",
    description: "Unified create/apply/unapply/delete/list for TEXT, EFFECT, and GRID styles (kind:\"paint\" delegates to the same mechanism as custom.create_paint_style/custom.list_styles).",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomStylesSchema
  },
  {
    id: "custom.text_range",
    family: "custom",
    operation: "text_range.set",
    description: "Style a SUBSTRING of an existing TEXT node's characters (mixed/rich text). start/end are character indices (end-exclusive).",
    mutation: true,
    enabled: true,
    stage: "blockA-a3",
    timeoutMs: 8000,
    schema: CustomTextRangeSchema
  },
  {
    id: "custom.component_property",
    family: "custom",
    operation: "component_property.manage",
    description: "Add/edit/delete/list component property DEFINITIONS on a COMPONENT or COMPONENT_SET node.",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomComponentPropertySchema
  },
  {
    id: "custom.instance_override",
    family: "custom",
    operation: "instance.override",
    description: "Set or reset property VALUES / per-sublayer overrides on an EXISTING component INSTANCE.",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomInstanceOverrideSchema
  },
  {
    id: "custom.instance_swap",
    family: "custom",
    operation: "instance.swap",
    description: "Swap an instance's WHOLE main component, preserving overrides using Figma's own swap heuristics.",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomInstanceSwapSchema
  },
  {
    id: "custom.create_instance",
    family: "custom",
    operation: "instance.create",
    description: "Create a real INSTANCE of an existing COMPONENT.",
    mutation: true,
    enabled: true,
    stage: "blockA-a7",
    timeoutMs: 8000,
    schema: CustomCreateInstanceSchema
  },
  {
    id: "custom.variables",
    family: "custom",
    operation: "variables.manage",
    description: "Manage real Figma Variables: collections, modes, variables, values, and bindings (node/paint/effect/layoutGrid kinds).",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomVariablesSchema
  },
  {
    id: "custom.set_mask",
    family: "custom",
    operation: "mask.set",
    description: "Set isMask/maskType on an EXISTING node.",
    mutation: true,
    enabled: true,
    stage: "blockA-a9",
    timeoutMs: 8000,
    schema: CustomSetMaskSchema
  },
  ...COMPOUND_CAPABILITIES
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
