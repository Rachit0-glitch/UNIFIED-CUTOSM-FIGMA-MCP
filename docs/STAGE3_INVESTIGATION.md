# Stage 3 Investigation

## Objective

Determine whether Unified MCP can automatically transfer live Figma execution ownership between Plumb and Custom without human plugin switching, without modifying either backend, and without fragile UI automation.

## Sources Inspected

Unified MCP:

- `docs/STAGE1_RESULTS.md`
- `docs/STAGE2_RESULTS.md`
- `docs/STAGE2_ARCHITECTURE.md`
- `src/adapters/plumb.js`
- `src/adapters/custom.js`
- `src/coordinator.js`
- `src/registry.js`

Plumb:

- `figma-plugin/manifest.json`
- `figma-plugin/ui.html`
- `figma-plugin/code.js`
- `README.md`
- `dist/index.js` pairing strings and bridge behavior

Custom MCP:

- `figma-plugin/manifest.json`
- `figma-plugin/ui.html`
- `figma-plugin/code.js`
- `src/bridge/server.ts`
- `docs/ARCHITECTURE.md`
- `docs/QUICKSTART.md`

External Figma references:

- Figma plugin manifest docs: https://developers.figma.com/docs/plugins/manifest/
- Figma plugin runtime docs: https://developers.figma.com/docs/plugins/how-plugins-run/
- Figma help on running plugins: https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files

## Findings

1. Plumb and Custom both depend on a Figma plugin UI running inside Figma.
2. Pairing begins from inside that plugin UI by opening a localhost WebSocket to the backend bridge.
3. Starting a backend MCP process can only provide a bridge endpoint; it cannot launch a Figma plugin UI.
4. If a plugin UI is already open and retrying, starting its backend can make it pair. This is reconnection, not plugin activation.
5. Stage 2 proved Unified can observe manual switches, but it did not prove Unified can cause those switches.
6. The user-confirmed runtime allows only one active Figma MCP plugin bridge at a time.
7. The official Figma help center says plugins must be manually run, only one plugin can run at a time, and plugins cannot perform actions in the background.
8. Neither Plumb nor Custom exposes a supported external command that tells Figma to launch the other plugin.

## Exact Manual Handoff Event

Manual Plumb -> Custom handoff is caused by the user running the Custom MCP plugin in Figma. That creates the Custom plugin runtime, calls `figma.showUI`, loads `ui.html`, and starts the WebSocket client to `ws://localhost:39217`.

Manual Custom -> Plumb handoff is caused by the user running the Plumb plugin in Figma. That creates the Plumb plugin runtime, calls `figma.showUI`, loads Plumb `ui.html`, scans ports `31337..31346`, and pairs when a server responds and the plugin is configured/commanded to pair.

The backend MCP process itself is not the handoff event. The Figma plugin launch is.

## Feasibility Decision

Automated handoff is blocked under the current architecture.

Reason: Unified MCP can start and stop backend MCP child processes, but it has no legitimate supported mechanism to start the inactive Figma plugin runtime. The only observed and documented activation mechanism is user action inside Figma.

Fragile UI automation was explicitly rejected by the Stage 3 brief and was not implemented.
