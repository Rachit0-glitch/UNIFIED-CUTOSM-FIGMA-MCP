# Capability Registry

## Source

The Stage 4 registry lives in:

```text
src/runtime/capabilities.js
```

It is the source of truth for what the production Unified runtime advertises and can execute.

## Supported Capabilities

| Capability | Family | Operation | Mutation | Notes |
| --- | --- | --- | --- | --- |
| `plumb.status` | `plumb` | `status` | false | Unified plugin Plumb-family status. |
| `plumb.outline` | `plumb` | `outline` | false | Reads pages and top-level screens. |
| `plumb.selection.read` | `plumb` | `selection.read` | false | Reads current selection summaries. |
| `custom.status` | `custom` | `status` | false | Unified plugin Custom-family status. |
| `custom.node.read` | `custom` | `node.read` | false | **Block A / A1**: full-fidelity read (geometry/layout/appearance/text/component/variables/styles/metadata), verbatim-ported from Custom MCP's real serializer. Optional `include` filters to specific categories. Reads a node by ID or current page if omitted. |
| `custom.selection.read` | `custom` | `selection.read` | false | Same A1 full-fidelity upgrade as `custom.node.read`, applied to the current selection. |

## Unsupported

Everything else is intentionally unsupported for now. Unsupported capabilities fail with `CAPABILITY_NOT_FOUND` and are not sent to the plugin. See `docs/BLOCK_A_CAPABILITY_MATRIX.md` for the full remaining Plumb/Custom capability inventory and each one's integration status/plan.

## Future Expansion Rule

New capabilities should be added one small slice at a time with:

- explicit ID,
- explicit family,
- explicit operation,
- mutation flag,
- timeout,
- payload validation,
- real Figma test evidence.
