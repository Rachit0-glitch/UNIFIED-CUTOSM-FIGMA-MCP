# Block A Performance

## Observations from this execution's live tests

Real timings captured incidentally during A2/A6-A9/mini-design live testing (not a dedicated stress
test, but genuine data points, not fabricated):

| Operation | Observed durationMs (plugin-reported) |
|---|---|
| `custom.design` create, 1 node, no page target | 137ms (first call after a fresh pairing), 26-49ms on subsequent calls |
| `custom.design` create, 2-3 nodes incl. nested auto-layout | 37-56ms |
| `custom.design` create, 5-node hero composition incl. local image import | not separately isolated, but the whole live-test round trip (network + plugin) stayed under 300ms |
| `custom.patch_node` | 1-11ms |
| `custom.node.read` (depth 0-2, full fidelity) | 2-19ms |
| `custom.measure`/`custom.verify`/`custom.diff` (N internal reads + pure computation) | single-digit ms per internal read, negligible computation overhead — the imported `diff.js`/`measure.js` functions are pure and fast by construction |

No operation observed in this pass showed a genuine performance problem — every measured duration was
well under any of the configured `timeoutMs` values (8000-20000ms) by 2-3 orders of magnitude. The
`COMMAND_TIMEOUT`s observed and documented in `docs/BLOCK_A_LIMITATIONS.md` were response-DELIVERY
issues, not slow computation — the underlying operations, when they did report a duration, were fast.

## Status at this checkpoint

No new performance data collected in A1 beyond what the pre-Block-A hardening pass already measured
(`docs/HARDENING_RESULTS.md`, Test H-J) — depth 1/5/10/20 reads against a single-frame document,
~1.1KB, single-digit-to-low-teens ms. That measurement's own caveat still applies: it does not exercise
a genuinely deep/wide tree.

A1 added the `include` category filter specifically as the mechanism the hardening pass's own
recommendation named for managing response size (H12/§37: "prefer targeted subtree reads, property
filters, summary modes before implementing complex streaming") — but its actual size-reduction benefit
on a large real tree has not yet been measured, since no large tree exists in the live test document
yet.

## Required before this doc can report real numbers (brief §37)

A genuinely non-trivial Figma tree, built through Unified once A2 (basic write path) lands, then read at
depth 5/10/20 with `include` filters on and off, measuring: node count, response bytes, serialization
time, bridge round-trip, total MCP time. This is explicitly deferred to whichever batch first builds
enough real structure to make the measurement meaningful (likely after A6/A7, once layout and hierarchy
give a plausible "real design" tree to measure against) — building throwaway filler nodes purely to
inflate a performance number would not produce a meaningful result and is not attempted here.

## Decision on chunking/streaming

Not yet warranted — no evidence of a real problem exists yet (the only measurement so far is on a
near-empty tree). Revisit once the large-tree measurement above exists.
