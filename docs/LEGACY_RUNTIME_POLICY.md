# Legacy Runtime Policy (H1, H5)

## Two execution paths exist in this codebase. Only one is production.

```
PRODUCTION (Stage 3.5/4)                    LEGACY DIAGNOSTICS ONLY (Stage 1/2)

unified_capabilities                        unified_status
unified_execute                             unified_backends
unified_runtime_status                      unified_active_backend
       |                                    unified_probe_backend
       v                                           |
CapabilityRegistry                                 v
       |                                    BackendRegistry
       v                                           |
CommandRouter -> ProtocolAdapter                   v
       |                                    PlumbAdapter / CustomAdapter
       v                                           |
CommandQueue                                       v
       |                                    StdioMcpClient
       v                                           |
UnifiedRuntimeBridge                               v
       |                                    Original, SEPARATE Plumb MCP /
       v                                    Custom MCP server processes
ONE Unified Figma plugin                           |
       |                                           v
       v                                    Original, SEPARATE Plumb plugin /
     Figma                                  Custom plugin — NOT the Unified plugin
                                                    |
                                                    v
                                                  Figma
```

## Why the legacy path is dangerous in production

The whole reason Stage 3/3.5/4 exist is that keeping two independent Figma plugin runtimes alive
simultaneously for autonomous operation doesn't work in practice (Stage 3's own investigation,
`docs/STAGE3_RESULTS.md`, found automated handoff between them structurally blocked). The legacy path
spawns the ORIGINAL Plumb and Custom MCP server processes and requires their ORIGINAL, separate Figma
plugins — calling it in the same session as the production path re-creates precisely the dual-runtime
scenario the Unified project exists to eliminate.

## Policy

- **Production tool registration** (`createTools()` in `src/server.js`) **never** includes
  `unified_status`/`unified_backends`/`unified_active_backend`/`unified_probe_backend` unless the
  environment variable `UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` is explicitly set. Default: unset,
  meaning these four tools do not exist as far as a normal LLM session calling `tools/list` can see.
- When the flag **is** set (an explicit, human-driven opt-in — e.g. someone debugging why the original
  Plumb/Custom setups do or don't pair, independent of Unified entirely), all four tools register with
  descriptions that state plainly: `LEGACY DIAGNOSTICS ONLY — NOT FOR PRODUCTION DESIGN EXECUTION`.
- The underlying classes (`BackendRegistry`, `UnifiedCoordinator`, `PlumbAdapter`, `CustomAdapter`,
  `StdioMcpClient`) are **not deleted** — they remain real, tested, useful diagnostic infrastructure
  (this is how Stage 1's original investigation proved Plumb/Custom worked independently in the first
  place). They are only kept out of the *default* MCP tool surface.
- `npm run integration:status` / `integration:plumb` / `integration:custom` (the CLI scripts that
  exercise this path directly) now set `UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` themselves, since
  invoking them is itself the explicit opt-in.

## The 3 redundant Stage 3.5 POC tools (H5) — a different, lower-severity issue

`unified_runtime_plumb_read`, `unified_runtime_custom_read`, and
`unified_runtime_acceptance_sequence` are **not** dangerous the way the Stage-2 path is — they run
through the same single Unified plugin as `unified_execute`, just with a hardcoded capability id (or a
fixed 3-call sequence). They remain registered (removing them would break `tests/runtime.test.js`'s
existing coverage of `UnifiedRuntimeService`'s wrapper methods, a bigger disruption than the hardening
pass's scope calls for) but every one of their descriptions now states `DEPRECATED — POC/diagnostic
only, not for production workflows` and recommends calling `unified_execute` directly instead. A fresh
LLM session should never be confused about which of `unified_execute` vs. one of these three to reach
for — the answer is always `unified_execute`.

`unified_runtime_status` is explicitly **not** deprecated — see H15 in `docs/PRE_BLOCK_A_HARDENING.md`.
It is the one production-safe status/health capability, reports only the single Unified runtime, and
never touches the legacy path.

## Verifying the policy

`tests/hardening.test.js` (H1/H5 tests) proves: the 4 legacy tools are absent from `createTools()`'s
output by default, present (with the correct warning text) only when the flag is set, and the 3 POC
tools carry the deprecation text while `unified_runtime_status` does not. See
`docs/HARDENING_RESULTS.md` for the live-Figma confirmation that the production tool set genuinely
never spawns the original processes.
