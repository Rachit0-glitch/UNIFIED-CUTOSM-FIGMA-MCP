# Plumb Architecture

## Role

Plumb is the high-level Figma read/write backend. It is strongest for extracting normalized design specs, reading outlines/selections/screens, exporting screenshots/assets, and generating structured Figma layouts from Plumb's DSL.

## Runtime

Observed package: `plumb-mcp` version `0.13.2`.

Codex registration:

```text
node C:\Users\rachi\AppData\Roaming\npm\node_modules\plumb-mcp\dist\index.js
```

Observed live state during Stage 1:

- MCP reachable: yes.
- Bridge port: `31338`.
- Plugin paired: yes during Plumb baseline/regression.
- Plugin version: `0.13.2`.
- Figma file: `Untitled`.
- REST token: not configured.

## Data Flow

```text
MCP client
  -> Plumb MCP stdio server
  -> localhost WebSocket bridge on 31337..31346
  -> Plumb Figma plugin UI
  -> Plumb plugin main code
  -> Figma Plugin API
  -> Figma document
```

Plumb also uses an HTTP channel on the same selected port for binary asset and screenshot transfer.

## Protocol Notes

The plugin scans ports `31337..31346` and pairs with a Plumb server. The server accepts one paired plugin socket for that server instance. The plugin can support multiple Plumb server sessions by port, but the current user workflow allows only one active Figma MCP plugin bridge at a time.

Common bridge request families observed from source/tool surface:

- `get-node`
- `get-assets`
- `get-screenshot`
- `search`
- `components`
- `apply-design`
- `apply-foundations`

## Strengths

- Best default read path for page outline, node extraction, screenshot, asset discovery, and component inventory.
- High-level DSL write path for ordinary layout-heavy UI.
- Compact PDS format and token normalization are useful for downstream implementation.
- Works without Figma REST token when plugin is paired.

## Constraints For Unified MCP

- Plumb and Custom should remain independent backends.
- Unified MCP should call Plumb as an external backend, not vendor or patch it.
- Plumb write cleanup is limited through the exposed tool surface because no direct delete tool is available in the Plumb MCP API.
- Because the user's Figma environment allows only one active plugin bridge at a time, Stage 2 routing must expose clear backend health and ask/signal when a backend switch is required.
