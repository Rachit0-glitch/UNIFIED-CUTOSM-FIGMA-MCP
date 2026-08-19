import { ERROR_CODES, UnifiedError } from "../errors.js";

export const STAGE4_CAPABILITIES = Object.freeze([
  {
    id: "plumb.status",
    family: "plumb",
    operation: "status",
    description: "Read Unified plugin Plumb-family runtime status.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000
  },
  {
    id: "plumb.outline",
    family: "plumb",
    operation: "outline",
    description: "Read pages and top-level screens using Plumb-family outline semantics.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000
  },
  {
    id: "plumb.selection.read",
    family: "plumb",
    operation: "selection.read",
    description: "Read the current Figma selection using Plumb-family compact node summaries.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000
  },
  {
    id: "custom.status",
    family: "custom",
    operation: "status",
    description: "Read Unified plugin Custom-family runtime status.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000
  },
  {
    id: "custom.node.read",
    family: "custom",
    operation: "node.read",
    description: "Read one Figma node, or the current page when nodeId is omitted.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000
  },
  {
    id: "custom.selection.read",
    family: "custom",
    operation: "selection.read",
    description: "Read the current Figma selection using Custom-family node serialization.",
    mutation: false,
    enabled: true,
    stage: "4",
    timeoutMs: 8000
  }
]);

export class CapabilityRegistry {
  constructor(capabilities = STAGE4_CAPABILITIES) {
    this.capabilities = new Map(capabilities.map((capability) => [capability.id, Object.freeze({ ...capability })]));
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
