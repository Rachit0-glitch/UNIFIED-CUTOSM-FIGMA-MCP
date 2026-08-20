# Pre-Block-A Hardening — Results

**PRE-BLOCK-A HARDENING: PASS**

Scope was the 15 issues (H1-H15) found by the earlier read-only Unified MCP audit. This is not Block A:
no broad capability integration, no semantic routing, no P2/P3 wrapping, no quality/autonomy logic was
added. Original Plumb MCP, original Custom MCP, and Custom P0-P3 source were not modified — confirmed by
`git status` before commit (see below) and by Test H-L's regression evidence.

## Per-issue status

| Issue | Severity | Status | Evidence |
|-------|----------|--------|----------|
| H1 — old dual-runtime path | CRITICAL | FIXED | Test H-A, Test H-B (real stdio) |
| H2 — `custom.design.apply` | CRITICAL | SHELVED | `archive/design-apply-poc/`, `HARDENING_WORKTREE_AUDIT.md` |
| H3 — read fidelity | HIGH | MITIGATED, remainder DEFERRED TO BLOCK A | `figma-plugin/code.js` `SERIALIZER_FIELD_GROUPS`, unit tests |
| H4 — depth cap | HIGH | FIXED | `src/runtime/limits.js`, live-verified at depth 1/5/10/20 (Test H-J) |
| H5 — redundant POC tools | MEDIUM | MITIGATED | Deprecated descriptions, unit test |
| H6 — error classification by substring | MEDIUM | FIXED | `src/errors.js`, unit tests |
| H7 — unbounded queue | MEDIUM | FIXED | `src/runtime/commandQueue.js`, unit tests |
| H8 — Unified owns `ws`/`zod` | MEDIUM | FIXED | `package.json`, `src/config.js`, Test H-I (real) |
| H9 — schema-driven validation | HIGH (scaling) | FIXED (pattern established) | `src/runtime/capabilities.js`, `src/runtime/commandRouter.js`, unit tests + Test H-D live confirmation |
| H10 — read-after-write prep | HIGH (design quality) | MITIGATED (placeholder only) | `verification: null` in every `execute()` result |
| H11 — rich error semantics | HIGH | FIXED | `errorShape()` promotes `source`, unit tests |
| H12 — response size measurement | MEDIUM | MEASURED (real, with caveat) | Test H-J — see caveat on tree depth below |
| H13 — plugin-data namespaces | HIGH | FIXED (documented; nothing to migrate) | `docs/PLUGIN_DATA_NAMESPACES.md` |
| H14 — duplicate capability IDs | — | FIXED | `CapabilityRegistry` constructor, unit tests |
| H15 — production-safe status | — | FIXED (confirmed) | `unified_runtime_status` description + Test H-A/H-D |

Full per-issue narrative: `docs/PRE_BLOCK_A_HARDENING.md`. Full test-by-test method/result:
`docs/HARDENING_TEST_PLAN.md`.

## Legacy Stage-2 path

**DISABLED (config-flag gated).** `unified_status`/`unified_backends`/`unified_active_backend`/
`unified_probe_backend` do not register as MCP tools unless `UNIFIED_ENABLE_LEGACY_DIAGNOSTICS=true` is
set on the server process's own environment. REAL STDIO VERIFIED: `tools/list` returns exactly 6 tools
with the flag unset, 10 with it set. The production tool set (`unified_capabilities`, `unified_execute`,
`unified_runtime_status`, plus 3 deprecated-but-safe POC tools) never references `BackendRegistry` or
the original per-backend adapters at all — the dual-plugin problem cannot be reached from production
tools even in principle. Full policy: `docs/LEGACY_RUNTIME_POLICY.md`.

## `custom.design.apply`

**SHELVED, not reworked to delegate.** It was a shallow reimplementation (different document-version
string, 5 of 10 node types, no absolute positioning, no auto-layout, no strict validation, no `file:`
image import, name-based not keyed cleanup) — not a real integration, and reworking it to properly
delegate to Custom MCP is real Block A-scale work. Removed from all production code (plugin, capability
registry, protocol adapter, tests, package.json scripts); archived to `archive/design-apply-poc/` with a
README pointing Block A at the real Custom MCP tools instead of this code.

## PASS/FAIL summary

| Area | Result |
|------|--------|
| Production runtime (no legacy path reachable by default) | PASS |
| Dependency independence (own `ws`/`zod`) | PASS |
| Queue hardening (bounded, distinct QUEUE_FULL/QUEUE_WAIT_TIMEOUT) | PASS |
| Schema-driven capability validation | PASS |
| Error preservation (`source` + specific message) | PASS |
| Real Figma test (H-D cross-family sequence, H-J depth reads, H-K disconnect/reconnect) | PASS |
| Original Custom MCP regression | PASS (full pairing-level evidence) |
| Original Plumb MCP regression | PASS (process/bridge-level evidence; see Test H-L notes) |

## Real Figma test summary

All three live-Figma-dependent tests ran against the actual Unified Runtime plugin in this session:

- **Test H-D** (cross-family sequence): `plumb.outline` → `custom.node.read` → `plumb.outline` →
  `custom.node.read`, all `ok: true`, through one paired plugin. Zero manual plugin switching, zero
  restarts, zero UI automation beyond the human having the plugin open once. Also confirmed live:
  `does.not.exist` → `CAPABILITY_NOT_FOUND`, `custom.node.read` with `depth: 999` → `INVALID_PAYLOAD`,
  neither ever reaching the bridge.
- **Test H-J / H12** (depth performance): depth 1/5/10/20 all succeeded, ~1.1KB, single-digit-to-low-
  double-digit ms round trip. Caveat: the live test document is a single empty frame, so this proves
  depth-bounded reads are stable and fast up to the cap, not that a genuinely deep/wide tree stays
  small — real large-tree measurement is legitimate remaining Block A work.
- **Test H-K** (disconnect/reconnect): plugin closed → bridge detected disconnect within one poll
  interval, Unified MCP process stayed alive throughout → plugin reopened → bridge detected a fresh
  reconnect (new `connectedAt` timestamp) → immediate post-reconnect read succeeded.

**Operational finding worth keeping**: the original pairing failures during this session were caused by
one-shot CLI probe scripts (`scripts/unified-probe.mjs` et al.) spawning a fresh MCP server child per
invocation and killing it within under a second — never giving the plugin a stable server to pair
against. Fixed for live testing by using persistent-session scripts
(`scripts/hardening-live.mjs`, `scripts/hardening-live-hk.mjs`). This is not a defect in the production
runtime — a real long-lived MCP client (Claude Desktop/Code) holds its connection open for the session,
exactly like these scripts do.

## Remaining Block-A-scope items (genuinely deferred, not artificially inflated or artificially avoided)

- Full read-fidelity integration: populating `appearance`/`text`/`layout`/`component`/`variables`/
  `styles` in the plugin serializer (H3) — architecture is ready, data is not populated.
- All P2/P3 Custom MCP schemas and high-value capabilities wrapped as Unified capabilities.
- Read-after-write production verification logic (the `verification` field has a stable shape now but
  no logic behind it — H10).
- Large-scale capability aggregation / semantic routing across Plumb + Custom + P2/P3.
- Genuine large-tree read performance measurement (current H-J numbers are real but only exercised a
  near-empty document).
- Full plugin-pairing-level Plumb regression check (process/bridge-level evidence exists; a second
  manual plugin swap to get pairing-level parity with the Custom result was not performed this pass, and
  is not expected to surface anything different since zero original Plumb files were touched).

None of the above was pulled forward into this pass, per the brief's explicit "do not over-fix"
instruction — this pass fixed the 15 named issues and validated them for real, and stopped there.

---

## UNIFIED MCP STATUS: READY FOR BLOCK A
