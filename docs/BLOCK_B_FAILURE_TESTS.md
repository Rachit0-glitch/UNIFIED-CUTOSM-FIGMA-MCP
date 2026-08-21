# Block B §15 — Failure Injection: Live Results

Live test: [`scripts/block-b-failure-injection-live.mjs`](../scripts/block-b-failure-injection-live.mjs),
run against a real, paired Unified Runtime plugin on 2026-08-20/21. Every case below produced a
**structured `{code, message}` error** — never `undefined`, a generic message, a silent swallow, or an
uncaught rejection, satisfying §15's core requirement.

| # | Injected failure | Expected code | Actual code | Result |
|---|---|---|---|---|
| 1 | Invalid node ID (`custom.node.read` on a nonexistent id) | `NODE_NOT_FOUND` | `NODE_NOT_FOUND` | PASS |
| 2 | Deleted target (create → delete → patch the same id) | `NODE_NOT_FOUND` | `NODE_NOT_FOUND` | PASS |
| 3 | Invalid (nonexistent) parent on `custom.move_node` | `NODE_NOT_FOUND` | `NODE_NOT_FOUND` | PASS |
| 4 | Hierarchy cycle — move an ancestor frame into its own descendant frame | `INVALID_HIERARCHY` (new) | `INVALID_HIERARCHY` | PASS |
| 5 | Move a node into itself | `INVALID_HIERARCHY` (new) | `INVALID_HIERARCHY` | PASS |
| 6 | Unsupported/unknown capability (`custom.does_not_exist`) | `CAPABILITY_NOT_FOUND` | `CAPABILITY_NOT_FOUND` | PASS |
| 7 | Malformed payload (`custom.patch_node` missing `nodeId`) | `INVALID_PAYLOAD` | `INVALID_PAYLOAD` | PASS |
| 8 | Patch `characters` on a genuinely mixed-font text node (built via `custom.text_range` to give run 2 a different weight, then `custom.patch_node` on `text.characters` only) | `FONT_ERROR` (new) | `FONT_ERROR` | PASS |
| 9 | `custom.verify` against a deliberately wrong expectation (`width`/`height` off by ~1,000,000) | non-crashing structured `differences[]` | 2 `MAJOR` differences returned, `result.ok:false` | PASS |

**9/9 real failure-injection assertions passed.** (A 10th check — that the live plugin's reported
version string matched the new build — failed for an explainable, orthogonal reason: see
"Real bug found" below. It has since been fixed and is not a failure-injection result.)

## Real bug found and fixed while building this test

`figma-plugin/ui.html` maintains its own **independent** `PLUGIN_VERSION` constant (sent in the raw
WebSocket `hello` handshake) — separate from `figma-plugin/code.js`'s `PLUGIN_VERSION` constant (sent
via the internal `plugin-ready` `postMessage` from the sandboxed plugin code to its UI iframe). These
two were already duplicated pre-Block-B (both read `"0.6.1-blockA-font-cache-fix"` in Block A); Block B's
version bump to `code.js` initially updated only one copy, so `unified_runtime_status`'s reported
`pluginVersion` (sourced from `ui.html`'s `hello` message, not `code.js`'s value) kept showing the old
string even though the plugin was genuinely running the new, reloaded code — proven definitively by
cases 4/5/8 above actually exercising the new `INVALID_HIERARCHY`/`FONT_ERROR` logic that only exists in
the new file. Fixed by updating `ui.html`'s copy to match (`0.6.2-blockB-hierarchy-font-errors`); not
refactored into a single source of truth (the two files have no shared module system to do that with —
Figma plugin sandbox code and its UI iframe are two separate JS execution contexts with no import
mechanism between them), consistent with §29 (no unnecessary abstraction for a two-line constant kept in
sync at each version bump).

## What this closes

- §15's list of concrete failure scenarios is substantially covered: invalid node ID, deleted target,
  invalid parent, unsupported operation, malformed payload, missing/mixed font, failed verification.
- §17's two genuinely new error codes (`INVALID_HIERARCHY`, `FONT_ERROR`) are now real, wired,
  live-verified behavior — not just entries in an enum. See `docs/BLOCK_B_OPERATION_MODEL.md` for the
  full taxonomy mapping and exactly where each is thrown in `figma-plugin/code.js`.
- Plugin disconnect/reconnect is now ALSO covered live (not just the fake-transport unit tests) — see
  `scripts/block-b-reconnect-live.mjs` and `docs/BLOCK_B_LIVE_RESULTS.md`'s §14/§11 section: a real
  disconnect and reconnect were observed, with `connectionGeneration` correctly incrementing.
- Still not yet covered live: a plugin disconnect happening WHILE a specific operation is mid-flight
  (the reconnect test above disconnected between operations, not during one), stale plan, duplicate
  operation ID, repeated request, command timeout under real Figma latency. These require either a more
  precisely-timed disconnect or the execution-planner/idempotency acceptance tests (§20/§21), tracked
  separately.
