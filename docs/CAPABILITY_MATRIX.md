# Capability Matrix

This matrix uses observed callable tools plus locally inspected Custom MCP source. Unknown means not verified live in this session.

| Capability | Plumb | Custom MCP source | `figma-bridge` live | Preferred backend, first pass | Notes |
| --- | --- | --- | --- | --- | --- |
| Health/status | `plumb_status` live | `figma_status` in source | `list_files` only | Unified health should query all | Custom status not callable live. |
| File/screen outline | `plumb_outline` | `figma_node` page read | `get_metadata`, `get_document`, `list_files` | Plumb for screen inventory | Plumb currently paired and has inventory. |
| Node extraction | `plumb_node`, `plumb_selection`, `plumb_query` | `figma_node` | `get_node`, `get_selection`, `get_document` | Plumb for compact PDS; Custom for exact custom readback | Need compare shapes. |
| Tokens/styles read | `plumb_tokens`, `plumb_components` | `figma_list_styles`, `figma_styles list`, `figma_variables list` | `get_styles`, `get_variable_defs` | Hybrid | Custom has variable/style management. |
| Design build | `plumb_design`, `plumb_studio*`, `plumb_brand` | `figma_design` strict DSL | basic create tools in `figma-bridge` | TBD by operation | Plumb high-level; Custom for strict absolute/local image gaps. |
| Absolute positioning | Limited by Plumb DSL/schema | Explicit project goal/source support | create/set position tools | Custom | Confirmed design goal in package/docs/source. |
| Local image import | Plumb supports assets but observed warning/placeholder with local path | Explicit project goal/source support | `create_image` supports local path | Custom or figma-bridge | Need use actual Custom live path, not third bridge. |
| Text creation/styling | Plumb build path | `figma_design`, `figma_text_range`, styles | `create_text`, `set_text_properties` | Custom for rich substring ranges | Plumb good for extraction/build, Custom for precision/ranges. |
| Geometry patch | Limited through Plumb build/sync | `figma_patch_node`, `figma_move_node`, reorder | `set_node_properties`, reparent, duplicate | Custom | Mutation serialization needed. |
| Boolean/group/component set | Not observed as explicit Plumb tool | `figma_boolean`, `figma_group`, `figma_ungroup`, `figma_create_component_set` | group/ungroup in bridge | Custom | Custom has idempotency keys for some ops. |
| Variables | Not primary surface | `figma_variables` | `get_variable_defs` read-only | Custom | Custom supports create/bind/list. |
| Styles create/apply | Plumb foundations/build path | `figma_create_paint_style`, `figma_styles` | limited fill/effects setters | Custom | Need verify live. |
| Screenshot/export | `plumb_screenshot`, `plumb_assets` | `figma_screenshot` | `get_screenshot`, `save_screenshots` | Plumb for current paired path | Custom supports scale control by source. |
| Verification | `plumb_verify`, `plumb_fit`, `plumb_review` | `figma_diff` | none equivalent | Plumb + Custom diff | Plumb has strongest loop tooling. |
| Batch operations | Not exposed as generic batch | `figma_batch` | none equivalent | Custom | Important for future safe orchestration, but no rollback. |

## Immediate matrix conclusion

The first Unified prototype should not attempt semantic auto-routing across all tools. It should expose explicit namespaced backend operations plus a unified health report first, then add safe routing once equivalence is proven.
