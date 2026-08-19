# Failure Analysis

## F1: Custom MCP registered but not directly exposed as tools

Observation: `figma-custom` exists in `C:\Users\rachi\.codex\config.toml`, but this Codex task did not expose `figma_status`, `figma_design`, `figma_node`, or other Custom `figma_*` tools through `tool_search`.

Impact: Unified Stage 1 could not call Custom tools directly through the host tool surface.

Mitigation used in Stage 1: a local SDK-based MCP client script starts `FIGMA-CUSTOM-MCP/dist/index.js` and calls tools over stdio without modifying the Custom repo.

Stage 2 implication: Unified MCP should manage Custom as a backend process itself or expose a stable adapter. Do not rely on the Codex app surfacing both backend MCP servers simultaneously.

## F2: Port conflict on Custom bridge

Observation: Starting a second Custom MCP server on `39217` failed with `EADDRINUSE` when an existing listener was already running.

Impact: A coordinator cannot blindly start Custom on the default port if another Custom server owns it.

Mitigation used in Stage 1: stop the temporary background listener, run the probe on `39217`, then restore the listener.

Stage 2 implication: implement backend lifecycle checks before spawn. A coordinator should detect the owner state and either use a managed child or ask the user to switch/restart.

## F3: Raw Custom WebSocket probes are unsafe

Observation from source: the Custom bridge treats a new WebSocket connection as the plugin socket and replaces the previous one.

Impact: Testing bridge reachability by opening a raw WebSocket would disturb plugin pairing.

Mitigation used in Stage 1: all live Custom checks used MCP tools, not raw WebSocket probes.

Stage 2 implication: health checks must use `figma_status` through MCP.

## F4: Only one active Figma MCP plugin bridge in current workflow

Observation from user: only one MCP can be connected in Figma at one time.

Impact: Dual live testing cannot assume Plumb and Custom are simultaneously paired. Sequential backend tests are valid; concurrent plugin-paired routing is not currently validated.

Stage 2 implication: Unified MCP should expose backend requirements and provide a clear switch prompt/status message when the requested operation needs the inactive backend.

## F5: Plumb write cleanup limitation

Observation: Plumb exposes high-level write tools but no direct delete tool in the observed MCP surface.

Impact: A Plumb-only disposable write cannot be guaranteed cleanly removable through Plumb itself.

Mitigation: Stage 1 avoided a new Plumb disposable after identifying the limitation and used previously observed Plumb status/read as baseline. Custom write cleanup was fully verified.

Stage 2 implication: route destructive cleanup through Custom only when the Custom backend is active and the target node id is known.
