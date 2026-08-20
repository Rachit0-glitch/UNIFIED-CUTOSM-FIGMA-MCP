# Block A Source Parity

Per-port record: every piece of Custom MCP logic reused in Unified, exactly how it was reused, and
whether behavior differs. Nothing in this table was reimplemented from scratch — every row is either an
`imported` real dependency or an `adapted`/`verbatim sandbox port` copy of the real source.

## Node-side logic — imported (real npm dependency on `figma-custom-mcp`, see package.json's
`file:../FIGMA-CUSTOM-MCP` dependency)

| Source file | Source export(s) | Unified usage | Port type | Behavior difference |
|---|---|---|---|---|
| `src/compiler.ts` (`dist/compiler.js`) | `compileDesignDoc`, `CompileError`, `normalizeLayoutForPlugin` | `src/runtime/protocolAdapters/custom.js` (`custom.design`), `src/runtime/capabilities.js` (patch layout normalization) | imported | None — same compiled module |
| `src/design-schema.ts` (`dist/design-schema.js`) | `DesignDocSchema`, `FillSchema`, `StrokeSchema`, `RadiusSchema`, `EffectSchema`, `BlendModeSchema`, `LayoutSchema`, `FontSchema` | `src/runtime/capabilities.js` (all `custom.design`/`custom.patch_node` schemas) | imported | None |
| `src/diff.ts` (`dist/diff.js`) | `diffTrees`, `verifyExpectations`, `flattenActualTree` | `src/runtime/compoundCapabilities.js` (`custom.diff`, `custom.verify`) | imported | None — same tolerance defaults, same severity rules, same radius/cornerRadius and text/characters field-name mapping fixes |
| `src/measure.ts` (`dist/measure.js`) | `horizontalGap`, `verticalGap`, `overlap`, `containment`, `centerDelta`, `measureAlignment` | `src/runtime/compoundCapabilities.js` (`custom.measure`) | imported | None |
| `src/assets.ts` (`dist/assets.js`) | `resolveAssetSrc`, `AssetError` | Reached transitively through `compileDesignDoc` (image nodes) | imported (transitive) | None |

## Plugin-sandbox logic — verbatim sandbox port (copied into `figma-plugin/code.js`, adapted only to
Unified's envelope/dispatch shape — see `docs/BLOCK_A_INTEGRATION_ARCHITECTURE.md` for why this is the
correct reuse mechanism for code that must run inside whichever one plugin is currently paired)

| Source function(s) (`FIGMA-CUSTOM-MCP/figma-plugin/code.js`) | Unified destination | Port type | Behavior difference |
|---|---|---|---|
| `mixedSafe`, `READBACK_CATEGORIES`, `serializeNode`, `serializeNodeProperties` (:31-33,721,728-886) | Same names, A1 | verbatim | None |
| `hexToRgba`, `BLEND_MODE_MAP`, `WEIGHT_TO_STYLE`, `FALLBACK_FACES`, `resolveFont`, `GRADIENT_TYPE_MAP`, `toFigmaPaint`, `toFigmaLayoutGrid`, `toFigmaExportSetting`, `applyRadius`, `toFigmaEffect`, `applyEffects`, `applyLayoutCore`, `createFigmaNode`, `BOOLEAN_METHOD`, `BOOLEAN_COMPATIBLE_TYPES`, `loadPaintStyles`, `findPaintStyleByName`, `applyIntrinsic`, `indexExistingByKey`, `resolveTargetContainer`, `handleApplyPlan` (:15-24,35-477,477-717) | Same names, A2 | verbatim (progress-reporting `reportProgress` calls intentionally omitted — Unified has no matching progress channel) | Only the omission noted; zero logic changes |
| `handlePatchNode`, `handleDeleteNode`, `handleReorderNode` (:901-1013) | Same names, A2 | verbatim | `NODE_NOT_FOUND` throws upgraded from plain `Error` to a structured `pluginError(...)` (H6-style improvement, not a behavior change to the mutation logic itself) |
| `resolveNodesOrThrow`, `handleBooleanOp`, `findByPluginKey`, `handleGroupNodes`, `handleUngroupNode`, `handleCreateComponentSet`, `handleCreatePaintStyle`, `handleListStyles`, `loadStylesOfKind`, `invalidateStyleCache`, `findStyleOfKindByName`, `handleStyles`, `handleTextRange`, `toMat3`, `fromMat3`, `matMul3`, `matInverse3`, `handleMoveNode`, `handleComponentProperty`, `isDescendantOf`, `handleInstanceOverride`, `handleInstanceSwap`, `handleCreateInstance`, `handleVariableBind`, `handleVariables`, `handleSetMask` (:1025-1773) | Same names, A6/A7/A9 | verbatim | `NODE_NOT_FOUND` throws upgraded to structured errors, same as above; error-message prefixes changed from `figma_*` to `custom.*` tool names for clarity (cosmetic only) |
| `PLUGIN_KEY`, `OPERATION_KEY` constants | Renamed `unifiedCustomMcpKey`/`unifiedCustomMcpOperationKey` | adapted (deliberate) | **Intentional difference**: a separate plugin-data namespace from the original Custom plugin's own `customMcpKey`/`customMcpOperationKey`, so Unified's sync-mode reconciliation can never collide with a real, independent original-Custom-plugin session on the same file (see `docs/PLUGIN_DATA_NAMESPACES.md`) |

## Intentionally omitted (not ported this pass, and why)

| Custom MCP tool | Reason omitted |
|---|---|
| `figma_batch` | Unified's own `CommandQueue` already sequences calls; whether a Unified-level batch orchestration tool is still needed is an open question flagged in `docs/BLOCK_A_CAPABILITY_MATRIX.md`, not decided in this pass |
| `figma_screenshot` | Planned A8, not executed this pass — Plumb's own screenshot/export path was judged higher priority to verify (Plumb's `plumb_outline`/`plumb_selection.read` already live since Stage 4) |
| `figma_status` beyond what's ported | Unified's own `unified_runtime_status`/`custom.status` already cover this need at the Unified-runtime level |

## Verification method

Every "None" behavior-difference claim above is backed by either: (a) the port being a mechanical
copy verified via `node --check` + the real unit test suite exercising the imported modules directly
(not mocks — see `tests/block-a.test.js`'s A10 tests, which assert on `diffTrees`'/`verifyExpectations`'
actual computed output), or (b) real-Figma live verification (see `docs/BLOCK_A_LIVE_RESULTS.md`) that
the ported plugin-sandbox function produces the exact same effect on a real Figma document as the
original would.
