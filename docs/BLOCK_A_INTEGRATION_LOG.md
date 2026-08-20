# Block A Integration Log

Chronological record of this execution. Detailed evidence lives in the referenced docs; this file is
the narrative thread connecting them.

1. **Revalidated baseline** — confirmed `efc2cce` (A1) as HEAD, working tree clean, 49/49 tests passing,
   `npm run check` clean, before any new code changes.
2. **A2 (core mutation path)**: added `figma-custom-mcp` as a `file:../FIGMA-CUSTOM-MCP` dependency in
   `package.json`, confirmed all 4 pure-Node modules (`compiler.js`, `design-schema.js`, `diff.js`,
   `measure.js`) import cleanly. Ported `createFigmaNode`/`applyIntrinsic`/`handleApplyPlan` (create) and
   `handlePatchNode`/`handleDeleteNode`/`handleReorderNode` (update/delete/reorder) verbatim into
   `figma-plugin/code.js`. Wired `custom.design`/`custom.patch_node`/`custom.delete_node`/
   `custom.reorder_node` capabilities, importing the real `DesignDocSchema`/`FillSchema`/etc. Added
   `dryRun` short-circuit support to `CommandRouter` (a `custom.design` dry run never touches the
   bridge). Live-tested: found and fixed a real bug (patch fields not wrapped into the `props` object
   the plugin expects — full account in `docs/BLOCK_A_LIVE_RESULTS.md`). Final result: 12/12 live PASS.
3. **A10 (P3 compound capabilities)**: recognized that `custom.diff`/`custom.verify`/`custom.measure`
   don't fit the one-envelope-per-call shape every other capability uses (they need N internal reads +
   pure computation). Extended `CommandRouter` with a `capability.compound` branch that bypasses the
   family adapter entirely. Imported the real `diffTrees`/`verifyExpectations`/measure functions. Live-
   tested the full inspect→measure→diff→correct→verify→idempotency loop on a real controlled
   composition: 14/15 PASS (1 transient timeout, confirmed non-blocking on retry).
4. **A6/A7/A9 (hierarchy, components/instances, styles/variables/masks)**: ported the remaining ~20
   plugin-sandbox handler functions verbatim (move-node's matrix-transform math, group/ungroup,
   component-set creation, paint/text/effect/grid styles, text ranges, component properties, instance
   override/swap/create, variables, masks). Wired 15 new capabilities server-side, all flat pass-through
   at the adapter (verified against source before assuming — see `docs/BLOCK_A_SOURCE_PARITY.md`). Live-
   tested: 13/18 PASS on first run; investigated every failure — one real transient issue (a
   `set_value` call that had genuinely not landed, confirmed via direct read), one test bug (text node
   as document root, correctly rejected by the real compiler), rest resolved as transient-timeout/
   already-succeeded. Found and cleaned up debris left by two earlier partially-failed A2 test runs.
5. **Mini-design acceptance (A3/A4/A5/A8 + P3 + cross-family, in one pass)**: built a real hero-section
   composition — nested auto-layout, 3-level typography, styled appearance, and a genuine local PNG
   import via `file:` URI (the P0 gap the whole project exists to close) — then ran the full P3 loop
   against it and confirmed Plumb-family reads see the same Custom-built content through the same one
   plugin. 12/12 PASS, first try, zero reload needed.
6. **Regression**: 82/82 unit tests, `npm run check` clean, original Custom MCP and Plumb MCP both
   confirmed still spawning/responding correctly (process/bridge level — see
   `docs/BLOCK_A_LIVE_RESULTS.md`), `git status` in `FIGMA-CUSTOM-MCP` clean (zero modifications).
7. **Documentation**: this file plus `docs/BLOCK_A_SOURCE_PARITY.md`, `docs/BLOCK_A_LIVE_RESULTS.md`,
   `docs/BLOCK_A_LIMITATIONS.md`, updated `docs/BLOCK_A_CAPABILITY_MATRIX.md`/`BLOCK_A_DESIGN_READINESS.
   md`/`BLOCK_A_TEST_PLAN.md`/`BLOCK_A_RESULTS.md`, `README.md`, `docs/CAPABILITY_REGISTRY.md`.
8. **Commit and push** — see `docs/BLOCK_A_RESULTS.md` for the final commit hash and verdict.
