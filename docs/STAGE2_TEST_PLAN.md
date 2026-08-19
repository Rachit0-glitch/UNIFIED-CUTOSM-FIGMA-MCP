# Stage 2 Test Plan

## S2-A - Plumb Active

Purpose: Verify Unified MCP detects Plumb as the active Figma backend and routes a read-only diagnostic to Plumb.
Preconditions: Figma open, Plumb plugin active and paired.
Steps: Run `unified_status`; run `unified_probe_backend` with `{ "backend": "plumb" }`.
Expected result: `activeBackend = "plumb"`; Plumb usable true; probe returns real outline/page data.
Failure meaning: PlumbAdapter or active-backend detection is not sufficient.
Cleanup: None.
Regression check: Plumb direct status/outline should still pass.

## S2-B - Custom Active

Purpose: Verify Unified MCP detects Custom as the active Figma backend and routes a read-only diagnostic to Custom.
Preconditions: Figma open, Custom MCP plugin active and paired.
Steps: Run `unified_status`; run `unified_probe_backend` with `{ "backend": "custom" }`.
Expected result: `activeBackend = "custom"`; Custom usable true; probe returns real `figma_node` metadata.
Failure meaning: CustomAdapter or status normalization is not sufficient.
Cleanup: None.
Regression check: Custom independent probe should still pass.

## S2-C - Live Backend Change

Purpose: Verify one persistent Unified MCP process detects manual backend changes without restart.
Preconditions: Figma open and user able to switch plugins manually.
Steps: Run `scripts/unified-live-sequence.mjs`; switch Figma to Custom when prompted; switch back to Plumb when prompted.
Expected result: Same Unified MCP process reports Custom active after Custom switch and Plumb active after Plumb switch.
Failure meaning: Status is stale, backend child lifecycle is broken, or pairing cannot be observed dynamically.
Cleanup: End sequence process.
Regression check: Backend child processes exit with the Unified sequence.

## S2-D - Wrong Backend Probe

Purpose: Verify safe failure when probing an inactive backend.
Preconditions: One backend active.
Steps: With Custom active, call Plumb probe; with Plumb active, call Custom probe.
Expected result: No crash; normalized `BACKEND_NOT_PAIRED` or equivalent unavailable state.
Failure meaning: Routing or error normalization is unsafe.
Cleanup: None.
Regression check: Active backend remains usable afterward.

## S2-E - No Active Backend

Purpose: Verify status reports none when no plugin is paired.
Preconditions: Safely close/stop plugin bridges if possible.
Steps: Run `unified_status`.
Expected result: `activeBackend = "none"`; Unified MCP remains healthy.
Failure meaning: Active detection invents pairing state.
Cleanup: Reopen a plugin bridge.
Regression check: Reopened backend becomes detectable.

## S2-F - Final Regression

Purpose: Verify existing independent systems still work.
Preconditions: Figma open; switch to each backend manually.
Steps: Direct Plumb status/outline; direct Custom status/read through SDK probe.
Expected result: Both independent systems pass.
Failure meaning: Stage 2 damaged an existing backend or left a process conflict.
Cleanup: None.
