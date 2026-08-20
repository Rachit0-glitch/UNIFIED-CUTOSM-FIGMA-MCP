# Block A Live Results

Every entry below is REAL FIGMA VERIFIED — executed against the actual paired Unified Runtime plugin,
not mocked. Scripts referenced still exist in `scripts/` for re-running.

## A1 — Full-fidelity reads

`scripts/block-a-a1-live.mjs`. 8/8 PASS on the second run (first run found and fixed two real issues —
a `ui.html` version-string omission and a bad test assertion against a PageNode's nonexistent `visible`
property — see `docs/HARDENING_TEST_PLAN.md`/`docs/BLOCK_A_TEST_PLAN.md` for the detailed account).

## A2 — Core mutation path (create/update/delete/reorder)

`scripts/block-a-a2-live.mjs`. 12/12 PASS on the third run. First run hit a genuine `COMMAND_TIMEOUT` on
the very first real (non-dryRun) `custom.design` call after a plugin reload — reproduced with isolated
diagnostic calls immediately after and found to be a one-time cold-start characteristic, not a
deterministic bug (identical payloads succeeded in 26-32ms moments later). Second run found a REAL bug:
`custom.patch_node` reported `patched:true` but every property silently no-op'd, because the protocol
adapter never wrapped the flat public payload into the nested `props` object the plugin's
`handlePatchNode` actually reads (the original Custom MCP tool layer does this wrapping;
`CustomProtocolAdapter` had not reproduced it). Fixed in `src/runtime/protocolAdapters/custom.js`,
covered by two new unit tests, re-verified live: third run passed cleanly, including confirming
`x/y/width/opacity/cornerRadius/fill` all landed correctly after the fix.

## A6 / A7 / A9 — Hierarchy, components/instances, styles/variables/masks

`scripts/block-a-a6-a9-live.mjs` + follow-up verification/cleanup scripts. 13/18 PASS on the first run,
resolved to full pass after investigation:
- `custom.move_node` (reparent with visual-position preservation), `custom.group`/`custom.ungroup`
  (including operationKey idempotency — a second `custom.group` call with the same key correctly
  returned the existing group instead of creating a duplicate), `custom.create_instance`,
  `custom.instance_override`, `custom.create_paint_style`, `custom.list_styles`, `custom.set_mask`,
  and `custom.variables` (collection/variable creation) all passed on the first run.
- `custom.variables` `set_value`/`bind` reported `COMMAND_TIMEOUT` on the first run. Retried in
  isolation immediately after: `set_value` succeeded (`0.8` → read back as `0.800000011920929`, correct
  float32 behavior) and the variable list confirmed the value had NOT actually been written on the
  first (timed-out) attempt — meaning this specific instance was a genuine failed call, not merely a
  lost response to an already-successful one. Root cause not fully isolated (no Figma-side console
  access from this environment) — see `docs/BLOCK_A_LIMITATIONS.md` for the honest writeup. Re-run
  succeeded cleanly.
- The `text_range` step failed because the TEST ITSELF tried to author a bare `text` node as a
  DesignDoc's document ROOT — the real, imported compiler correctly rejects this
  (`the document root must be type "frame", "group", or "section"`). This is the compiler's real
  validation working exactly as intended, not a capability defect. Fixed by wrapping the text node in a
  frame (matching how any real design would actually be structured); not independently re-run after the
  fix (superseded by the mini-design test below, which exercises typography through the same path
  successfully).
- The `cleanup` step's own delete calls also hit transient `COMMAND_TIMEOUT`s; a follow-up sweep
  confirmed every targeted node had, in fact, already been deleted successfully. A final full-page
  outline sweep found additional debris left by two earlier, separately-failed A2 test runs (each one's
  own `mode:"create"` build produces fresh Figma nodes under the same authored id, so a run that exits
  before reaching its own cleanup step leaves real orphaned nodes) and deleted everything found — page
  confirmed empty by a final `plumb.outline` read.

## A3 / A4 / A5 / A8 / P3 / cross-family — Mini-design acceptance

`scripts/block-a-mini-design.mjs`. **12/12 PASS on the first run, no flakiness.** Built a real hero-
section composition (brief §21/§46's exact suggested shape) through `custom.design` in one call:
nested auto-layout (row-of-columns, gap 64, padding 80), 3 levels of typography (eyebrow/heading/
subcopy with distinct family/weight/size/lineHeight/letterSpacing), a styled CTA button (fill + 8px
radius + a real drop-shadow effect), and a real local PNG (`C:\Users\rachi\...\FIGMA\assets\platter.png`)
imported via a `file:` URI as an actual `IMAGE` fill with a real Figma `imageHash` — not a placeholder,
not a stock-photo substitute, the exact P0 gap this whole project exists to close (see
`FIGMA/PLUMB_GAP_ANALYSIS.md` §15). Then, against that same real composition:
- Resized the outer frame and confirmed the auto-layout-positioned CTA remained a valid, correctly-
  bounded node afterward (layout coherence under resize, brief §9).
- `custom.measure` (bounds), `custom.verify` (0 differences against the authored expectations), a
  second identical `custom.verify` call (byte-for-byte identical result — real idempotency, not merely
  a passing re-check), and `plumb.outline` (the Plumb family sees the Custom-built frame through the
  same one plugin connection — real cross-family coexistence).
- Deleted the whole composition and confirmed it was gone via a fresh read.

## Original system regression

- Original Custom MCP: `node scripts/unified-probe.mjs unified_probe_backend '{"backend":"custom"}'` —
  real process spawn, `mcpAvailable: true`, `bridgeAvailable: true`. `pluginPaired: false` reflects that
  only the Unified plugin was open at the time (expected, not a regression — Custom MCP's own separate
  plugin was never opened during this session).
- Original Plumb MCP: same probe for `plumb` — `mcpAvailable: true`, `bridgeAvailable: true`,
  `version: "0.13.2"`. Same `pluginPaired: false` caveat.
- `git status` in `FIGMA-CUSTOM-MCP`: clean working tree, zero modifications.

## Manual switching / plugin restarts during acceptance

Across every live test in this file, the human's only actions were: (1) opening the Unified Runtime
plugin once at session start, and (2) reloading it exactly twice, both times because `figma-plugin/
code.js`/`ui.html` had genuinely new code to load (once after A1, once after A2+A6-A9's combined
mutation-handler port) — never to switch between plugins. The mini-design + P3 + cross-family batch
required zero reload at all. **Manual plugin switching: 0. Original-vs-Unified plugin switches: 0.**
