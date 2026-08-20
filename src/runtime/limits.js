/**
 * H4 (pre-Block-A hardening) — single source of truth for the read-depth bound, previously
 * duplicated as the magic number `6` independently in both protocol adapters AND the plugin itself
 * (3 places that could silently drift). Raised from 6 to 20 to match Custom MCP's own real
 * `figma_node` limit (P0's schema bound, unchanged through P2/P3) — Custom's own P2 live testing
 * routinely used depth 10, well past Stage 4's old cap, so 6 was already an artificially low ceiling
 * relative to what the mature Custom MCP capability set actually supports.
 *
 * `figma-plugin/code.js` runs in Figma's plugin sandbox with no module system, so it cannot import
 * this file directly — its own copy of `MAX_READ_DEPTH` is kept numerically identical and pointed
 * back here with a comment, the same "can't share code across the plugin boundary, so pin the value
 * and document it" pattern Custom MCP itself already uses for `code.js`.
 */
export const MAX_READ_DEPTH = 20;

/**
 * Validates and normalizes a `depth` field. Returns the resolved integer depth, or throws
 * `onInvalid()`'s return value (an error) if the value is missing-but-required or out of bounds.
 * Never silently truncates — an out-of-bounds depth is always a thrown, explicit error.
 */
export function normalizeDepth(payload, fallback, makeError) {
  const depth = payload?.depth === undefined ? fallback : Number(payload.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_READ_DEPTH) {
    throw makeError(`depth must be an integer from 0 to ${MAX_READ_DEPTH} (got ${payload?.depth ?? "missing"}).`);
  }
  return depth;
}
