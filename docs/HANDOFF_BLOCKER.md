# Handoff Blocker

## Status

PROGRAMMATIC HANDOFF BLOCKED BY FIGMA PLUGIN LIFECYCLE

## Exact Blocker

Under the current architecture, Unified MCP has no supported way to launch the inactive Figma plugin. Plumb and Custom become Figma-usable only when their plugin UI is running inside Figma and connected to their localhost bridge.

The only supported activation path observed and documented is user initiation from Figma's plugin UI/menu/quick action/relaunch surfaces.

## Reproduction Evidence

Observed states:

- Backend bridge can be listening while plugin pairing is false.
- Starting a backend process does not make the inactive Figma plugin appear.
- With Custom active, Plumb MCP can start and listen on a Plumb port, but `pluginPaired` remains false until the user runs Plumb.
- With no plugin paired to Unified-owned backend children, `unified_status` returns `activeBackend: "none"` even though backend MCP processes are available.
- When the user manually runs the other plugin, the existing Unified process detects the new active backend without restart.

## Official Platform Constraint

Figma's own help states that plugins must be manually run, only one plugin can run at a time, and plugins cannot act in the background. Figma's plugin docs describe manifest menu commands, relaunch buttons, and the plugin runtime exposed after a plugin is run; they do not expose an external API for a local MCP server to launch a different plugin in an already-open Figma file.

References:

- https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files
- https://developers.figma.com/docs/plugins/how-plugins-run/
- https://developers.figma.com/docs/plugins/manifest/

## Rejected Non-Solutions

The following were not implemented because Stage 3 explicitly rejected fragile UI automation:

- mouse automation,
- keyboard shortcut automation,
- coordinate clicking,
- screen/image recognition,
- AutoHotkey or SendKeys,
- Figma UI browser/desktop automation.

## Consequence

The Stage 3 acceptance test cannot pass under the current two-plugin architecture:

```text
Plumb read -> automatic switch -> Custom read -> automatic switch -> Plumb read
```

Human plugin switches required: greater than zero.

Therefore Stage 3 stops as a blocked architecture report rather than adding a fake handoff implementation.
