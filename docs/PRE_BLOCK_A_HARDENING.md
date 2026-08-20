# Pre-Block-A Hardening

Scope: resolve the architectural/reliability/maintainability issues the read-only Unified MCP audit
found, before Block A begins capability integration. Not a new stage, not a rewrite, not Block A.

## H1 — Disable the old dual-runtime path (CRITICAL) — FIXED

`unified_status`/`unified_backends`/`unified_active_backend`/`unified_probe_backend` no longer
register as MCP tools unless `UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` is set (Option A from the
brief — a config flag gate, less architecturally disruptive than a separate process). Verified
live through the real stdio MCP protocol (not just mocked unit tests): `tools/list` returns exactly
6 tools with the flag unset, 10 with it set; calling `unified_status` directly without the flag
returns `"Unknown tool: unified_status"` from the real running server. See
`docs/LEGACY_RUNTIME_POLICY.md` for the full policy and `tests/hardening.test.js` for unit coverage.

npm's default Windows script shell does not support `VAR=value command` env-prefix syntax (verified
directly — it silently does nothing). `scripts/unified-probe.mjs` now treats naming one of the 4
legacy tools on its own command line as the explicit opt-in signal instead, passing the flag to the
server process it spawns — cross-platform-safe by construction, no shell-specific syntax anywhere in
`package.json`.

## H2 — Resolve `custom.design.apply` (CRITICAL) — SHELVED

Removed from all production code (plugin, capability registry, protocol adapter, tests, package.json
scripts). Archived (not deleted) to `archive/design-apply-poc/` for historical reference, with a
README explaining why it was shelved rather than rewritten to delegate. Full reasoning:
`docs/HARDENING_WORKTREE_AUDIT.md`.

## H3 — Read fidelity (HIGH) — MITIGATED, remainder DEFERRED TO BLOCK A

`figma-plugin/code.js`'s `serializeNode` is now structured as named field groups
(`SERIALIZER_FIELD_GROUPS`), the same `include`-category pattern Custom MCP's own mature `figma_node`
already uses — but today only `geometry` and `metadata` are populated, exactly matching Stage 4's
actual shipped scope (no new data was fabricated). The remaining groups (`appearance`, `text`,
`layout`, `component`, `variables`, `styles`) are named, commented extension points, not implemented.
Populating them with real data — ideally by having Unified's capabilities delegate to Custom MCP's own
mature, already-correct serializer rather than re-deriving the same fields a second time — is real
Block A work, explicitly not attempted here per the hardening brief's own "do not implement the full
Block-A read integration yet" instruction.

## H4 — Depth cap (HIGH) — FIXED

Centralized in `src/runtime/limits.js` (`MAX_READ_DEPTH = 20`, matching Custom MCP's own real
`figma_node` limit — Custom's P2 live testing routinely used depth 10, well past the old cap of 6).
Both protocol adapters import the shared `normalizeDepth` helper; the plugin sandbox (no module
system) keeps a numerically-pinned copy with a comment pointing back to the source of truth. Exceeding
the limit is always an explicit `INVALID_PAYLOAD` validation error (via the H9 schema layer), never a
silent truncation.

## H5 — Redundant POC tool surface (MEDIUM) — MITIGATED

`unified_runtime_plumb_read`/`unified_runtime_custom_read`/`unified_runtime_acceptance_sequence`
remain registered (removing them would break `tests/runtime.test.js`'s existing coverage of the
underlying service methods — a bigger disruption than warranted) but their descriptions now state
`DEPRECATED — POC/diagnostic only, not for production workflows` and point to `unified_execute`.
`unified_runtime_status` is explicitly NOT deprecated — see H15.

## H6 — Error classification by message substring (MEDIUM) — FIXED

`normalizeBackendError` now checks for an existing `.code` (any structured error, not only
`instanceof UnifiedError`) before ever inspecting message text. Message-substring matching is
reachable only for genuinely unstructured errors and is documented as legacy-diagnostics-only
fallback classification — the production Stage 4 path's own errors were already structured
(`UnifiedError` from CommandRouter, or `{code,message,details}` from the plugin) and never went
through substring matching in the first place. `tests/hardening.test.js` proves message-wording
changes don't alter classification when a structured code is present.

## H7 — Unbounded command queue (MEDIUM) — FIXED

`CommandQueue` now takes `maxQueueLength` (default 50, `UNIFIED_MAX_QUEUE_LENGTH`) and
`queueWaitTimeoutMs` (default 15000, `UNIFIED_QUEUE_WAIT_TIMEOUT_MS`). A full queue rejects
immediately with `QUEUE_FULL`; an item that waits past the timeout without starting execution rejects
with `QUEUE_WAIT_TIMEOUT` — kept structurally distinct from `COMMAND_TIMEOUT` (execution itself
running long), verified by a dedicated test proving a slow-but-running command is never mistaken for
a slow-to-start one. See `tests/hardening.test.js`.

## H8 — Unified must own its `ws` dependency (MEDIUM) — FIXED

`ws` (and `zod`, for H9) added to Unified's own `package.json` `dependencies`; `npm install` run in
Unified's own directory (`node_modules/ws`, `node_modules/zod` now present locally).
`src/config.js`'s `wsModulePath` default now resolves via `import.meta.url` to Unified's own
`node_modules/ws/wrapper.mjs` — no path reaches into `FIGMA-CUSTOM-MCP` anywhere in the default
config. `UNIFIED_WS_MODULE` remains available as an explicit override.

## H9 — Hand-written per-capability validation (HIGH for future scaling) — FIXED (pattern established)

Every one of Stage 4's 6 capabilities now carries its own Zod `schema` in
`src/runtime/capabilities.js`, validated once by `CommandRouter.execute()` before any protocol
adapter or bridge call — protocol adapters no longer hand-roll `assertObject`/manual type/bounds
checks; they only map already-validated, already-defaulted data onto the envelope shape. This is the
pattern Block A should extend (`{id, family, operation, description, mutation, enabled, timeoutMs,
schema}` per new capability) — not a claim that every future capability's schema is written yet.

## H10 — Read-after-write architecture (HIGH for design quality) — MITIGATED (placeholder only)

`CommandRouter.execute()`'s result now always includes a `verification` field, always `null` today.
No autonomous verification logic exists — this only guarantees the response SHAPE never has to change
later to add it, matching the brief's explicit "do not implement autonomous verification now."

## H11 — Preserve rich error semantics (HIGH) — FIXED

`errorShape()` now always includes `source` (the originating family, e.g. `"custom"`/`"plumb"`)
alongside `code`, `message`, and `details` — promoted out of `details` to a top-level field rather
than buried. The specific original message is never discarded in favor of just a code, verified by
`tests/hardening.test.js`.

## H12 — Response size / deep read preparation (MEDIUM) — See `docs/HARDENING_RESULTS.md`

Controlled measurements at depth 5/10/20 against a real Figma tree, via the real paired Unified
plugin — see the Real Figma Test section of `docs/HARDENING_RESULTS.md` for the actual numbers and
the resulting decision on whether chunking/targeted-subtree reads are warranted yet.

## H13 — Plugin-data / idempotency safety (HIGH) — FIXED (documented; nothing to migrate)

`docs/PLUGIN_DATA_NAMESPACES.md` confirms Unified's plugin uses zero `setPluginData`/`getPluginData`
calls today (verified by direct source grep) and lays out the required policy — unique keys per
purpose, no name-based destructive cleanup, delegate to Custom MCP's own real namespaces rather than
inventing a third one — for whenever Block A adds the first one.

## H14 — Capability ownership confusion (duplicate IDs) — FIXED

`CapabilityRegistry`'s constructor now throws `INVALID_COMMAND` if two capabilities in its input list
share an `id`, rather than silently letting the later one shadow the earlier one. Verified by a unit
test constructing a registry with a deliberately duplicated entry, plus a regression guard proving the
real `STAGE4_CAPABILITIES` list itself has no duplicates.

## H15 — Legacy + production health status — FIXED

`unified_runtime_status` is the confirmed production-safe status capability: reports only the single
Unified runtime (bridge/plugin/protocol/queue), never touches `BackendRegistry`/the original
Plumb/Custom adapters, and is explicitly NOT marked deprecated (unlike the 3 POC tools under H5) — its
description now states `PRODUCTION STATUS` plainly.
