# First Report

## A. Discovered Current Architecture

Plumb is a stdio MCP server (`plumb-mcp` 0.13.2) with a localhost bridge that binds the first free port in `31337..31346`; in this run it is paired on `31338`. It uses WebSocket for control frames and HTTP for binary assets/screenshots. Its Figma plugin scans the port range, pairs by `plumb-hello` / `pair` / `paired`, relays requests through plugin UI to plugin main, and executes with the Figma Plugin API.

Custom MCP source exists at `C:\Users\rachi\OneDrive\Documents\FIGMA-CUSTOM-MCP`. It is a stdio MCP server with a WebSocket bridge on `39217`; its plugin UI auto-connects and relays `{ type: "request", reqId, cmd, args }` to plugin main as `{ kind: "server-request" }`. The plugin dispatcher supports apply/read/patch/delete/reorder/screenshot/boolean/group/component/style/variable/text-range commands.

Codex config also registers `figma-bridge` from `@gethopp/figma-mcp-bridge`, and this is the live `mcp__figma_bridge` namespace exposed in the current tool surface.

## B. Verified Problem

Plumb is reachable and paired. The exposed `mcp__figma_bridge` is reachable but reports no connected files. The registered `figma-custom` server's expected tools are not exposed in this session, so Custom MCP capability is not currently usable through Codex despite local source and config registration. A pure aggregator would therefore be misleading unless it can detect this and report `CUSTOM_UNAVAILABLE` or start/connect to Custom explicitly.

## C. Facts vs Assumptions

Verified facts:

- Plumb live status: MCP PASS, bridge PASS, plugin paired on `31338`.
- Custom MCP source and plugin exist locally and are separate from Plumb.
- Custom bridge default port is `39217`.
- Plumb and Custom use different protocols and different plugin manifests.
- `figma-custom` is registered in Codex config.
- Tool search found no callable `figma_status`, `figma_design`, `figma_patch_node`, or `figma_batch` tools in this session.

Strong hypotheses:

- The real hard problem is Figma runtime/session coordination, not MCP server multiplicity.
- Initial explicit namespacing plus health is safer than automatic semantic routing.
- Mutations should be serialized until coexistence is proven safe.

Unknown / needs testing:

- Why `figma-custom` tools are not exposed.
- Whether both Plumb and Custom plugins can remain paired simultaneously in the current Figma desktop session.
- Whether Plumb's protocol can be proxied to a shared executor without modifying Plumb.

## D. Capability Matrix

See `CAPABILITY_MATRIX.md`. Summary: Plumb is strongest for compact inspection, extraction, assets, screenshots, verification, and high-level design generation. Custom source is strongest for strict DSL, absolute positioning, local image import, patch/reorder/delete, boolean/group/component operations, variables, styles, rich text ranges, and batch orchestration. The live third-party `figma-bridge` overlaps with basic Figma operations but should not be treated as the Custom MCP.

## E. Architecture Options

See `ARCHITECTURE_OPTIONS.md`. Evaluated options: MCP proxy with explicit namespacing, Unified MCP plus runtime coordinator, single unified Figma plugin/executor, and shared bridge with plugin adapter.

## F. Recommended Architecture

Start with Unified MCP plus runtime coordinator. It preserves existing systems, adds honest health/status, can serialize operations, and lets us test whether two plugins can truly coexist before committing to a single-executor rewrite. If coexistence fails, move to the single unified executor design.

## G. Required Existing-System Changes

None approved or performed. Potential later changes may be needed to fix `figma-custom` tool exposure or to create a shared executor, but those require approval.

## H. Unified MCP Development Plan

U0 investigation, U1 skeleton/status, U2 backend discovery, U3 explicit namespaced routing for a tiny proof set, U4 mutation serialization, U5 runtime coexistence test, U6 shared executor design spike if coexistence fails.

## I. First Proof-of-Concept Test

One Codex session talks only to Unified MCP. Unified MCP reports Plumb and Custom health. Then run one Plumb read, one Custom read, one Custom harmless write, and one Plumb readback against the same Figma file without manually switching plugins.

## J. Risks

- Custom MCP registration may be broken or hidden in Codex tool discovery.
- Figma plugin lifecycle may prevent two independent runtimes from staying active.
- Plumb protocol adaptation may be more expensive than expected because of HTTP asset hydration and plugin-specific request vocabulary.
- A proxy-only solution can fake success while failing the actual design workflow.
- Figma has no document-level transaction/rollback for batch mutations.
