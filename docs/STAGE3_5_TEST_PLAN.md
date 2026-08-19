# Stage 3.5 Test Plan

## S3.5-A - Protocol Investigation

Purpose: Verify Plumb and Custom command families can be reasoned about separately.
Preconditions: Local Plumb and Custom source/install available read-only.
Steps: Inspect bridge/plugin protocol files and docs.
Expected result: Verified facts, hypotheses, and unknowns recorded.
Cleanup: none.
Regression check: no Plumb/Custom source modifications.

## S3.5-B - Unified Runtime Boot

Purpose: Verify Unified MCP can start a bridge for one Unified plugin.
Preconditions: no process on `39417` or bridge can bind it.
Steps: Run `unified_runtime_status`.
Expected result: bridge starts and reports connected false before plugin launch.
Cleanup: close probe process.
Regression check: no ports in Plumb/Custom ranges changed.

## S3.5-C - Unified Plugin Pairing

Purpose: Verify one Unified plugin can pair to the Unified bridge.
Preconditions: Unified bridge running; Figma open; Unified Runtime POC plugin imported/run once from `figma-plugin/manifest.json`.
Steps: Run `unified_runtime_status`.
Expected result: connected true, plugin version `0.1.0-stage3.5`.
Cleanup: keep plugin open for acceptance test.
Regression check: no Plumb/Custom plugin required.

## S3.5-D - Critical Acceptance Sequence

Purpose: Prove one plugin runtime supports both read families without switching.
Preconditions: Unified Runtime POC plugin paired and kept open.
Steps: Run `unified_runtime_acceptance_sequence`.
Expected result: Plumb-family read returns real Figma outline; Custom-family read returns real Figma current page/node; Plumb-family read returns real outline again.
Cleanup: none.
Regression check: manual plugin switching 0, plugin restarts 0, UI automation 0.

## S3.5-E - Original Plumb Regression

Purpose: Verify original Plumb still works.
Preconditions: User manually runs original Plumb plugin after POC test.
Steps: Call direct `plumb_status` and `plumb_outline`.
Expected result: original Plumb paired and returns real Figma outline.
Cleanup: none.
Regression check: no Plumb source/config changes.

## S3.5-F - Original Custom Regression

Purpose: Verify original Custom still works.
Preconditions: User manually runs original Custom plugin after Plumb regression; `39217` free for the probe-owned server.
Steps: Run `scripts/custom-mcp-sdk-probe.mjs --wait-paired --read`.
Expected result: original Custom paired and returns real `figma_node` data.
Cleanup: none.
Regression check: no Custom source/config changes.
