# Capability Registry

## Source

The Stage 4 registry lives in:

```text
src/runtime/capabilities.js
```

It is the source of truth for what the production Unified runtime advertises and can execute.

**Block B**: every capability below is also reachable through `unified_execute_plan` — an ordered,
already-decided list of these same capability steps, executed through the same `CommandRouter`, with
dependency ordering, checkpoints, and resumability. It is not a new capability, just a second way to
invoke the ones listed here. See `docs/BLOCK_B_ARCHITECTURE.md`.

**Production Lock**: `unified_execute_plan` also accepts an optional `pauseAtCheckpoint` — execution
stops deliberately right after that checkpoint's step succeeds (status `"paused"` on the remaining
steps, not a failure), giving a real, externally-observable boundary to resume from later via
`previousRun`. Live-proven against a genuine plugin disconnect/reconnect cycle:
`scripts/production-lock-interruption-live.mjs`. See `docs/PRODUCTION_READINESS_FINAL.md` item 9.

## Supported Capabilities

| Capability | Family | Operation | Mutation | Notes |
| --- | --- | --- | --- | --- |
| `plumb.status` | `plumb` | `status` | false | Unified plugin Plumb-family status. |
| `plumb.outline` | `plumb` | `outline` | false | Reads pages and top-level screens. |
| `plumb.selection.read` | `plumb` | `selection.read` | false | Reads current selection summaries. |
| `plumb.components` | `plumb` | `components` | false | **A11**: file-wide COMPONENT/COMPONENT_SET enumeration cross-referenced with INSTANCE counts. Verbatim port of Plumb's own `handleGetComponents`. |
| `custom.status` | `custom` | `status` | false | Unified plugin Custom-family status. |
| `custom.node.read` | `custom` | `node.read` | false | **Block A / A1**: full-fidelity read (geometry/layout/appearance/text/component/variables/styles/metadata), verbatim-ported from Custom MCP's real serializer. Optional `include` filters to specific categories. Reads a node by ID or current page if omitted. |
| `custom.selection.read` | `custom` | `selection.read` | false | Same A1 full-fidelity upgrade as `custom.node.read`, applied to the current selection. |
| `custom.design` | `custom` | `design.apply` | true | **Block A / A2**: build/sync a design from a strict DesignDoc, via the real imported `figma-custom-mcp` compiler. Supports `dryRun`. |
| `custom.patch_node` | `custom` | `node.patch` | true | **A2**: patch a subset of properties on an existing node. |
| `custom.delete_node` | `custom` | `node.delete` | true | **A2** |
| `custom.reorder_node` | `custom` | `node.reorder` | true | **A2** |
| `custom.move_node` | `custom` | `node.move` | true | **A6**: reparent with visual-position preservation. |
| `custom.boolean` | `custom` | `boolean.op` | true | **A7**: union/subtract/intersect/exclude on existing nodes. |
| `custom.group` / `custom.ungroup` | `custom` | `group.create` / `group.ungroup` | true | **A7**: real GROUP nodes, idempotent via `operationKey`. |
| `custom.create_component_set` | `custom` | `component_set.create` | true | **A7** |
| `custom.create_instance` / `custom.instance_override` / `custom.instance_swap` | `custom` | `instance.create` / `instance.override` / `instance.swap` | true | **A7** |
| `custom.create_paint_style` / `custom.list_styles` / `custom.styles` | `custom` | `paint_style.create` / `styles.list` / `styles.manage` | true / false / true | **A9** |
| `custom.component_property` | `custom` | `component_property.manage` | true | **A9** |
| `custom.instance_override`'s sibling `custom.text_range` | `custom` | `text_range.set` | true | **A3/A9**: per-substring rich text styling. |
| `custom.variables` | `custom` | `variables.manage` | true | **A9**: collections/modes/variables/values/bindings. |
| `custom.set_mask` | `custom` | `mask.set` | true | **A9** |
| `custom.diff` / `custom.verify` / `custom.measure` | `custom` | `diff` / `verify` / `measure` | false | **A10 (compound capabilities)**: P3 structural diff / expectation verification / deterministic geometric measurement, via the real imported `figma-custom-mcp` diff.js/measure.js. These bypass the normal protocol-adapter path — see `src/runtime/compoundCapabilities.js` and `commandRouter.js`'s `capability.compound` branch. |

All 25 Custom-family + 4 Plumb-family capabilities above are real-Figma-verified, including at a 901-node
stress-test scale and in one continuous Plumb→Custom→P2→P3→Plumb acceptance run — see
`docs/BLOCK_A_LIVE_RESULTS.md`. `plumb.node.read`/`plumb.tokens` are explicitly deferred with technical
justification, not silently missing — see `docs/BLOCK_A_SOURCE_PARITY.md`.

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
