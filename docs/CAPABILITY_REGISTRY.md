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
| `custom.node.read` | `custom` | `node.read` | false | Reads a node by ID or current page if omitted. |
| `custom.selection.read` | `custom` | `selection.read` | false | Reads current selection with Custom-style node serialization. |

## Unsupported

Everything else is intentionally unsupported in Stage 4. Unsupported capabilities fail with `CAPABILITY_NOT_FOUND` and are not sent to the plugin.

## Future Expansion Rule

New capabilities should be added one small slice at a time with:

- explicit ID,
- explicit family,
- explicit operation,
- mutation flag,
- timeout,
- payload validation,
- real Figma test evidence.
