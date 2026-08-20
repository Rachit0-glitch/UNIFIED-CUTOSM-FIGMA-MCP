# Block A Performance

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
