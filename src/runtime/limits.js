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

/**
 * Block B §25/§26 — a cheap, deterministic pre-check run BEFORE any capability's Zod schema sees an
 * INCOMING payload (i.e. a payload from the MCP caller, e.g. custom.design's DesignDoc — never applied
 * to data read back FROM Figma, which is Custom MCP's own already-verified serializer output).
 * Several capability schemas (notably custom.design's DesignNodeSchema, via z.lazy()) are genuinely
 * recursive with no built-in depth limit — a pathologically deep payload (e.g. 50,000 nested frames)
 * makes Zod's own recursive parser exhaust the call stack, throwing a raw, uncaught RangeError INSTEAD
 * OF the clean {success:false} safeParse() is supposed to always return. That would surface as a
 * generic INTERNAL_ERROR ("Maximum call stack size exceeded") rather than the clean, structured
 * INVALID_PAYLOAD §17/§25 require. This check MUST be iterative (an explicit stack, not recursion) — a
 * recursive depth-checker would have exactly the same stack-exhaustion problem it exists to prevent.
 *
 * Defaults are generous relative to any real design: a legitimate DesignDoc nests one level per
 * ancestor frame (Block A's 901-node tree was ~2 levels deep, mostly siblings, not a deep chain), so
 * 200 levels and 200,000 total nested values give enormous headroom for real production designs while
 * still rejecting a pathological/malformed payload before it ever reaches a recursive parser.
 */
export const MAX_PAYLOAD_DEPTH = 200;
export const MAX_PAYLOAD_NODES = 200000;

export function checkPayloadShape(payload, { maxDepth = MAX_PAYLOAD_DEPTH, maxNodes = MAX_PAYLOAD_NODES } = {}) {
  if (payload === null || typeof payload !== "object") return { ok: true };
  const stack = [[payload, 0]];
  let nodeCount = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    nodeCount += 1;
    if (nodeCount > maxNodes) {
      return { ok: false, reason: `payload contains more than ${maxNodes} nested values (exceeded while still within depth limits — likely a very wide, not just deep, structure)` };
    }
    if (depth > maxDepth) {
      return { ok: false, reason: `payload nesting exceeds the maximum allowed depth (${maxDepth})` };
    }
    if (node && typeof node === "object") {
      const values = Array.isArray(node) ? node : Object.values(node);
      for (const v of values) {
        if (v && typeof v === "object") stack.push([v, depth + 1]);
      }
    }
  }
  return { ok: true };
}
