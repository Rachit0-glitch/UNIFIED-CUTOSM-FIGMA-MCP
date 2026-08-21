# Production Baseline Record

The reference state before any future Block C work begins. Update this file only as part of a
deliberate new baseline (a future production-lock pass), never as a routine edit.

| Field | Value |
|---|---|
| Commit | (filled in after the Production Lock commit — see below) |
| Branch | `main` |
| Protocol version | `1.0` |
| Plugin version | `0.6.2-blockB-hierarchy-font-errors` (unchanged by Production Lock — no plugin-side code was touched this pass) |
| Total capabilities | 29 (4 Plumb, 25 Custom) |
| MCP tools (production, always registered) | `unified_capabilities`, `unified_execute`, `unified_execute_plan`, `unified_runtime_status` (+3 labeled-DEPRECATED convenience wrappers) |
| MCP tools (gated, opt-in only) | `unified_status`, `unified_backends`, `unified_active_backend`, `unified_probe_backend` |
| Unit tests | 146/146 passing (`npm test`) |
| `npm run check` | clean |

## Major acceptance results on record

| Test | Result | Script/doc |
|---|---|---|
| Vector/SVG round-trip | 9/10 (1 environmental, not functional) | `scripts/block-b-vector-acceptance.mjs` |
| §15 failure injection | 9/9 | `scripts/block-b-failure-injection-live.mjs` |
| §14 connection recovery (real disconnect/reconnect) | 7/7 | `scripts/block-b-reconnect-live.mjs` |
| Execution planner, live | 9/9 | `scripts/block-b-planner-live.mjs` |
| §2B batch decision evidence | measured, decision closed (no primitive) | `scripts/block-b-batch-evidence-live.mjs` |
| §18-19 main design-construction acceptance (289 real nodes) | 27/27 | `scripts/block-b-acceptance-live.mjs` |
| §20 idempotency | 8/8 | `scripts/block-b-idempotency-live.mjs` |
| **Mid-flight plan interruption + resume (Production Lock)** | **14/14** | `scripts/production-lock-interruption-live.mjs` |
| **MCP process-restart boundary (Production Lock)** | **8/8** | `scripts/production-lock-process-restart-live.mjs` |
| Queue concurrency / duplicate-replay (unit) | 4/4 | `tests/production-lock.test.js` |

## Large-tree results

Block A's 901-node uniform stress test remains the large-scale baseline (unchanged since Block A,
`docs/BLOCK_A_LIVE_RESULTS.md`). Block B's 289-node acceptance test is the large-scale REALISTIC-mixture
baseline (frames/auto-layout/text/component+instances/vector/mask/styles/variables — not uniform
rectangles).

## Known limitations at this baseline

- MCP-process-restart survives ONLY if the caller retained the last `run` object — no disk persistence
  exists or is currently justified by evidence. See `docs/PRODUCTION_READINESS_FINAL.md` item 11.
- A recurring, genuine, reproducible Figma-cloud `getNodeByIdAsync` connectivity delay — environmental,
  not local code. See `docs/BLOCK_B_LIMITATIONS.md`.
- Figma Starter-plan 3-page test-environment cap — not a production assumption anywhere in the code.

## How to re-establish this baseline from scratch

```powershell
npm ci
npm run check
npm test
```

Then, with the Unified Runtime plugin open and paired in Figma, any `scripts/block-b-*.mjs` or
`scripts/production-lock-*.mjs` script can be re-run for live confirmation.
