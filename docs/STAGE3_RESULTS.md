# Stage 3 Results

## Executive Summary

AUTOMATED HANDOFF: BLOCKED

Unified MCP cannot safely cause zero-manual-switch Plumb <-> Custom execution handoff under the current two-plugin architecture without either modifying plugin architecture or using fragile Figma UI automation. No `unified_handoff` tool was added because the Stage 3 feasibility gate failed.

## Investigation Findings

Manual handoff is caused by the user running the target Figma plugin. Pairing itself is automatic once a plugin UI is running and a backend bridge is available, but plugin runtime activation is not externally controllable by Unified MCP.

Observed lifecycle:

```text
backend MCP process starts
  -> bridge listens
  -> pluginPaired remains false until Figma plugin UI is running
  -> plugin UI connects to bridge
  -> backend becomes usable
```

## Backend Lifecycle

Plumb:

- MCP child opens a bridge on `31337..31346`.
- Running Plumb plugin UI scans ports and pairs.
- Plumb auto-pair is stored in Figma `clientStorage`, but only after the plugin is already running.

Custom:

- MCP child opens `39217`.
- Running Custom plugin UI connects to `ws://localhost:39217` and sends `hello`.
- If another Custom server owns `39217`, a new Custom backend child fails with `EADDRINUSE`.

## Handoff Mechanism

No legitimate handoff mechanism exists in the current architecture.

Unified can:

- start backend processes,
- stop backend processes it owns,
- observe bridge/plugin status,
- detect manual plugin switches.

Unified cannot:

- launch the inactive Figma plugin,
- run two Figma plugins simultaneously,
- make an inactive plugin execute against Figma,
- claim handoff success before real plugin pairing and safe read verification.

## State Machine

Implemented Stage 2 observation states remain valid:

```text
NONE
PLUMB_ACTIVE
CUSTOM_ACTIVE
AMBIGUOUS
```

The requested Stage 3 transition states remain architectural only:

```text
SWITCHING_TO_PLUMB -> HANDOFF_UNSUPPORTED
SWITCHING_TO_CUSTOM -> HANDOFF_UNSUPPORTED
```

## Child Process Ownership

Unified owns backend MCP child processes that it spawns. It does not attach to arbitrary already-running backend servers.

Stage 3 read-only observation found a Custom server already owning `39217`:

```text
node C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP\dist\index.js
```

A separate Unified status run could not claim that port and returned `BACKEND_UNAVAILABLE`. This confirms process ownership is distinct from Figma execution ownership.

## Tools Added

None.

Reason: `unified_handoff` was allowed only if handoff was proven feasible. It was not.

## Unit Tests

No new handoff unit tests were added because no handoff implementation was added. Existing Stage 2 tests still pass.

Command:

```text
npm test
```

Result: PASS, 14/14 tests.

## Integration Tests

Command:

```text
npm run check
```

Result: PASS.

Read-only lifecycle observation through `npm run integration:status` returned backend process/bridge observations without source modifications.

## Real Figma Tests

| Test | Result | Reason |
| --- | --- | --- |
| S3-A Baseline | PASS | Existing manual Plumb/Custom baselines remained available; final independent regressions passed. |
| S3-B Plumb -> Custom automated handoff | BLOCKED | No supported mechanism to launch Custom Figma plugin from Unified MCP. |
| S3-C Custom -> Plumb automated handoff | BLOCKED | No supported mechanism to launch Plumb Figma plugin from Unified MCP. |
| S3-D Full round trip | BLOCKED | Depends on S3-B/S3-C; zero-manual-switch acceptance cannot be run legitimately. |
| S3-E Repeated handoff | BLOCKED | Depends on feasible handoff. |
| S3-F Already active | DEFERRED | No handoff API was added; Stage 2 probes already cover active backend reads. |
| S3-G Failure recovery | DEFERRED | No handoff API was added; blocked-path recovery is documentation-only. |
| S3-H Final regression | PASS | Custom independent status/read passed on `39217`; Plumb independent status/outline passed on `31338`, file `Untitled`, 3 pages, 4 screens. |

## Acceptance Test

```text
Plumb read -> automatic switch -> Custom read -> automatic switch -> Plumb read
```

Result: FAIL / BLOCKED.

Manual plugin switches during acceptance test: not run, because a legitimate automatic switch mechanism does not exist under the current architecture.

## Human Interaction

Manual plugin switches required for real backend changes today: yes.

Manual plugin switches during any valid automated acceptance test: cannot be zero with the current two-plugin architecture.

## Existing System Modifications

Plumb: NONE
Custom: NONE

Stage 3 changed only Unified MCP documentation.

## Regression

Plumb independent: PASS
Custom independent: PASS


## Final Regression Evidence

Custom independent read-only regression:

```json
{
  "bridgePort": 39217,
  "connected": true,
  "pluginVersion": "0.1.0",
  "read": {
    "nodeId": "8:3",
    "nodeName": "Headphone Hero",
    "nodeType": "PAGE",
    "children": ["Button instance", "P2 Composition"]
  }
}
```

Plumb independent read-only regression:

```json
{
  "bridgePort": 31338,
  "connected": true,
  "pluginVersion": "0.13.2",
  "fileName": "Untitled",
  "pageCount": 3,
  "screenCount": 4,
  "selection": "P2 Composition"
}
```
## Known Limitations

- No automatic plugin switching.
- No `unified_handoff` tool.
- No full backend tool aggregation.
- Current architecture cannot satisfy zero-manual-switch handoff while preserving separate Plumb and Custom plugins unchanged.
- UI automation remains rejected unless explicitly approved in a future stage.

## Stage 4 Recommendation

Do not start Stage 4 tool aggregation until the runtime architecture is reviewed. The recommended next step is a small proof-of-concept single Unified Figma plugin or shared executor bridge, not broad tool routing.

