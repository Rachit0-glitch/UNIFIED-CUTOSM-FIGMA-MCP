# Stage 1 Test Plan

All tests are non-destructive, minimal, and reversible. Existing Plumb and Custom MCP source/configuration must remain read-only.

## TEST S1-A1 - Plumb Baseline Status

Purpose: Verify Plumb MCP, bridge, and plugin pairing health.
Preconditions: Figma file open; Plumb plugin running if available.
Systems involved: Plumb MCP, Plumb bridge, Plumb plugin, Figma.
Exact steps: Call `plumb_status`.
Expected result: MCP responds; bridge port is reported; plugin is paired or explicit not-paired error is recorded.
Failure meaning: Plumb baseline cannot proceed.
Cleanup: None.
Post-test health check: Call `plumb_status` again if a later test changes state.

## TEST S1-A2 - Plumb Safe Read

Purpose: Verify real Figma read through Plumb.
Preconditions: TEST S1-A1 paired.
Systems involved: Plumb full stack.
Exact steps: Call `plumb_outline` or `plumb_selection`.
Expected result: Real file/page/frame data returns from Figma.
Failure meaning: Plumb is not healthy enough for Stage 1 comparison.
Cleanup: None.
Post-test health check: Plumb status remains paired.

## TEST S1-A3 - Plumb Safe Write + Cleanup

Purpose: Verify real Figma write through Plumb using a disposable node.
Preconditions: TEST S1-A1 paired; scratch/current Figma file is acceptable for disposable frame.
Systems involved: Plumb full stack.
Exact steps: Use `plumb_design` to create a tiny disposable frame named `UFMP_STAGE1_PLUMB_DISPOSABLE`. Then delete/cleanup if supported safely, or document if only a harmless disposable frame remains because deletion would require a different backend.
Expected result: Figma node is created; returned root id is recorded.
Failure meaning: Plumb write path is unhealthy.
Cleanup: Prefer delete via same backend if available; otherwise leave clearly named disposable and record.
Post-test health check: Plumb status/read still works.

## TEST S1-B1 - Custom MCP Direct Status

Purpose: Verify Custom MCP can start and report bridge/plugin status through its own MCP tool.
Preconditions: No source modification. Port `39217` availability observed.
Systems involved: Custom MCP server, Custom bridge, Custom plugin if running.
Exact steps: Start `node dist/index.js` as an MCP stdio child from the Custom MCP repo, send MCP initialize/list/call requests, call `figma_status`.
Expected result: Custom MCP responds; status reports bridge port and paired/not paired state.
Failure meaning: Custom baseline cannot proceed until plugin/server exposure issue is resolved.
Cleanup: Terminate child process.
Post-test health check: No Custom source/config changed.

## TEST S1-B2 - Custom Safe Read

Purpose: Verify real Figma read through Custom MCP.
Preconditions: TEST S1-B1; Custom plugin paired.
Systems involved: Custom full stack.
Exact steps: Call `figma_node` without nodeId, or with a disposable/safe node id if known.
Expected result: Figma page/node structure returns.
Failure meaning: Custom Figma path is not paired or not healthy.
Cleanup: None.
Post-test health check: `figma_status` still works.

## TEST S1-B3 - Custom Safe Write + Cleanup

Purpose: Verify real Figma write through Custom MCP using a disposable rectangle/frame.
Preconditions: TEST S1-B1/B2 pass; Custom plugin paired.
Systems involved: Custom full stack.
Exact steps: Call `figma_design` with a minimal disposable design, then delete the created node via `figma_delete_node`.
Expected result: Disposable node appears and is deleted.
Failure meaning: Custom write/cleanup path is not healthy.
Cleanup: Delete disposable node.
Post-test health check: `figma_status` and a read still work.

## TEST S1-C1 - Dual Runtime Observation

Purpose: Determine whether both runtime paths can be active together.
Preconditions: Plumb baseline established; Custom status/read path established or explicit unavailability recorded.
Systems involved: Plumb, Custom MCP, Figma.
Exact steps: With Plumb paired, run Custom status/read. Then call Plumb status/read again. If Custom is paired, attempt one read from each backend in sequence.
Expected result: Either both remain paired and reads work, or the exact failing layer is observed.
Failure meaning: Identifies runtime/session conflict or current Custom exposure failure.
Cleanup: Terminate any test child processes; no source/config changes.
Post-test health check: Plumb independent status/read; Custom independent status if callable.

## TEST S1-D1 - Non-Destructive Architecture Probe

Purpose: Probe whether a coordinator can detect both backend states without production implementation.
Preconditions: No permanent config changes.
Systems involved: Unified project only, existing backends read-only.
Exact steps: Use a disposable script or manual MCP status calls to gather Plumb status and Custom status via direct child process.
Expected result: Health states can be normalized from existing signals.
Failure meaning: Stage 2 must include backend discovery work before routing.
Cleanup: Remove or keep read-only script if useful; terminate child processes.
Post-test health check: Plumb and Custom baselines remain as before.

## TEST S1-E1 - Post-Stage Regression

Purpose: Confirm Stage 1 did not break existing systems.
Preconditions: Stage 1 tests complete.
Systems involved: Plumb and Custom.
Exact steps: Re-run Plumb status/read. Re-run Custom status/read if Custom was callable.
Expected result: Same or better health than baseline.
Failure meaning: Stop and restore before proceeding.
Cleanup: None.
