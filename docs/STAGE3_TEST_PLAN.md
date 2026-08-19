# Stage 3 Test Plan

Stage 3 begins with investigation. Automated handoff tests must not be marked passing unless Unified MCP causes real Figma execution ownership to change without human plugin switching.

## S3-A - Baseline

Purpose: Prove Stage 2 behavior remains intact before handoff conclusions.
Preconditions: Figma open; user can manually run Plumb and Custom plugins.
Initial backend: manual Plumb, then manual Custom.
Requested backend: none.
Exact steps: Run direct/Unified Plumb status + safe read. Manually switch to Custom and run direct/Unified Custom status + safe read.
Expected transition: none; this is baseline only.
Expected real Figma result: Plumb outline from `Untitled`; Custom `figma_node` data from `Headphone Hero`.
Timeout: existing adapter/probe timeouts.
Failure meaning: Stage 2 regression before Stage 3.
Cleanup: none.
Regression check: both plugins still pair when manually launched.

## S3-B - Plumb To Custom Automated Handoff

Purpose: Determine whether Unified MCP can cause Plumb -> Custom ownership transition.
Preconditions: Plumb active, Unified MCP running, no human switching after test starts.
Initial backend: Plumb.
Requested backend: Custom.
Exact steps: Confirm `activeBackend = plumb`; run Plumb safe read; attempt only legitimate programmatic handoff if one is found.
Expected transition: Custom becomes paired and usable without human Figma action.
Expected real Figma result: Custom safe read succeeds.
Timeout: bounded handoff timeout if implemented.
Failure meaning: no legitimate automated activation path or handoff implementation failure.
Cleanup: restore a manually usable backend if needed.
Regression check: Plumb/Custom still pair manually.

## S3-C - Custom To Plumb Automated Handoff

Purpose: Determine whether Unified MCP can cause Custom -> Plumb ownership transition.
Preconditions: Custom active from S3-B, Unified MCP still running, no human switching.
Initial backend: Custom.
Requested backend: Plumb.
Exact steps: Invoke legitimate handoff if S3-B proved one exists; verify status; run Plumb safe read.
Expected transition: Plumb becomes paired and usable without human Figma action.
Expected real Figma result: Plumb outline succeeds.
Timeout: bounded handoff timeout if implemented.
Failure meaning: no legitimate automated activation path or handoff implementation failure.
Cleanup: restore a manually usable backend if needed.
Regression check: direct Plumb/Custom still work.

## S3-D - Full Round Trip

Purpose: Primary acceptance test.
Preconditions: S3-B and S3-C feasible.
Initial backend: Plumb.
Requested backend: Custom, then Plumb.
Exact steps: Plumb read -> automatic handoff to Custom -> Custom read -> automatic handoff to Plumb -> Plumb read.
Expected transition: zero human plugin switches, no Unified restart.
Expected real Figma result: all three reads return live Figma data.
Timeout: bounded handoff timeout per transition.
Failure meaning: Stage 3 feasible-path acceptance failed.
Cleanup: none beyond normal process exit.
Regression check: independent Plumb and Custom reads.

## S3-E - Repeated Handoff

Purpose: Detect leaks/stale sessions after repeated automatic transitions.
Preconditions: S3-D passes.
Initial backend: Plumb.
Requested backend: Custom/Plumb repeated 3-5 times.
Exact steps: alternate handoff + safe read.
Expected transition: each target becomes usable and verified.
Expected real Figma result: safe read succeeds after each transition.
Timeout: bounded per handoff.
Failure meaning: lifecycle or timing instability.
Cleanup: close Unified process.
Regression check: no duplicate uncontrolled backend processes.

## S3-F - Already Active

Purpose: Verify idempotent handoff.
Preconditions: backend active.
Initial backend: Plumb, then Custom.
Requested backend: same as current.
Exact steps: call handoff to already-active backend if implemented.
Expected transition: no restart or plugin cycling; verified true.
Expected real Figma result: safe read succeeds.
Timeout: normal probe timeout.
Failure meaning: handoff is not idempotent.
Cleanup: none.
Regression check: active backend remains paired.

## S3-G - Failure Recovery

Purpose: Verify clear failure when target cannot become active.
Preconditions: safe target-unavailable condition exists.
Initial backend: any.
Requested backend: unavailable target.
Exact steps: request handoff to unavailable target.
Expected transition: failure result; final backend truthfully reported.
Expected real Figma result: no false success.
Timeout: bounded.
Failure meaning: unsafe handoff state handling.
Cleanup: restore manual plugin if needed.
Regression check: Unified remains responsive.

## S3-H - Final Regression

Purpose: Verify Stage 3 did not damage existing systems.
Preconditions: Figma open; manually run each plugin as needed.
Initial backend: manual Plumb, then manual Custom.
Requested backend: none.
Exact steps: direct Plumb status/read; direct Custom status/read.
Expected transition: none.
Expected real Figma result: both independent reads pass.
Timeout: existing probe timeout.
Failure meaning: Stage 3 damaged or conflicted with a backend.
Cleanup: none.
Regression check: git status confirms no Plumb/Custom source modifications by Stage 3.
