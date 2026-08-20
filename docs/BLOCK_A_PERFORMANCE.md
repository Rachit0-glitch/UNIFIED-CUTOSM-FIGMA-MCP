# Block A Performance

## Headline finding: font-loading was the real bottleneck, now fixed

A large-tree stress test (`scripts/block-a-large-tree.mjs`, 901 nodes) initially timed out completely
even at a 90-second budget. A dedicated scaling investigation (`scripts/scaling-probe.mjs`) isolated the
real cause: `figma.loadFontAsync`, called once per text node with no caching, carries meaningful per-call
latency in this environment even when the exact same family+style was already loaded. 901 plain rects
(zero fonts) built in 25.6s; as few as 50 text nodes alone exceeded 90s. A same-scale test with the tree
reshaped into multiple small auto-layout sections (instead of one wide wrapping row) ruled out
"many-auto-layout-siblings" as the cause — the slowdown tracked text-node count specifically.

**Fix**: a session-level font-resolution cache in `resolveFont()` (`figma-plugin/code.js`) — skips the
redundant `loadFontAsync` call once a given family+style has already succeeded in this plugin session. A
documented, intentional deviation from the verbatim Custom MCP port (see `docs/BLOCK_A_SOURCE_PARITY.md`)
— same algorithm and return value, only the redundant repeat call is skipped.

**Before / after** (same doc shape, same node counts):

| Scale | Before | After |
|---|---|---|
| 10 cards / 31 nodes | 62s (cold), still ~4-27s even warm across runs | 0.8s (cold), 0.4s (warm) |
| 50 cards / 151 nodes | Never completed (>90s, repeatedly) | 3.5s |
| 150 cards / 451 nodes | Never completed (>90s, repeatedly) | ~10s |
| 300 cards / 901 nodes | Never completed (>90s) | ~22-24s |

## Large-tree stress test — real measurements (901 nodes, post-fix)

From `scripts/block-a-large-tree.mjs`'s live run (full account: `docs/BLOCK_A_LIVE_RESULTS.md`):

| Operation | Duration | Payload |
|---|---|---|
| Build (901 nodes, create mode) | ~22-24s | 43.6KB response |
| Read depth=1 | ~4.6s | 385KB |
| Read depth=5 | ~10.5s | 1.12MB |
| Read depth=10 | ~10s | 1.12MB (tree's real depth is 3 — depth 5/10/20 are identical) |
| Read depth=20 | ~9s | 1.12MB |
| Read depth=20, `include:["metadata"]` | 0.86s | 128KB (~9x smaller) |
| `plumb.outline` | 0.3s | 45.5KB |
| Single deeply-nested node read | 24ms | 2.2KB |
| `custom.measure` | 35ms | 875B |
| `custom.diff` | 48ms | 1.1KB |
| `custom.patch_node` | 15ms | 863B |
| `custom.verify` | 89ms | 1KB |
| `custom.design` sync-mode reconcile (full 901-node re-apply) | ~28s | `created:0, updated:901` |

**Payload-size observation**: a full-fidelity, unfiltered read of a 900-node tree is ~1.1MB. The
`include` category filter is a real, working mitigation (demonstrated ~9x reduction above) — the
mechanism the pre-Block-A hardening pass recommended (H12/§37: "prefer targeted subtree reads, property
filters, summary modes before implementing complex streaming") is genuinely sufficient at this scale.
Chunking/streaming is still not warranted — no evidence of a problem at 900 nodes that filtering doesn't
already solve.

**No O(n²) behavior found** in this codebase's own logic once the font-loading issue was fixed — build
time scales roughly linearly with node count (roughly 22-24ms/node at the 901-node scale, consistent
with the smaller-scale measurements in the before/after table above). The apparent super-linear blowup
before the fix was entirely attributable to the uncached per-text-node font load, confirmed by the
zero-font plain-rects control test (901 rects, no text at all, in 25.6s — genuinely linear).

## Full system acceptance — real measurements

From `scripts/block-a-full-acceptance.mjs` (21-step Plumb→Custom→P2→P3→Plumb run,
`docs/BLOCK_A_LIVE_RESULTS.md`): every individual operation completed well within its configured
timeout, zero orphan responses, zero retries needed.

## Timeout budgets — evidence-based, not arbitrary

- `custom.design`: raised from 20000ms → 90000ms after the large-tree investigation found a real
  20000ms timeout on a 901-node build (before the font-cache fix). Kept at 90000ms even after the fix
  landed (build now takes ~22-24s) to give genuine headroom for larger real-world compositions without
  becoming effectively unlimited.
- `custom.node.read`/`custom.selection.read`: raised from 8000ms → 25000ms after a real 8016ms timeout
  was observed reading the full 901-node tree (1.1MB payload) at depth 20 — a genuine near-miss against
  the old budget, not a guess.

## Decision on chunking/streaming

Not warranted. The `include` category filter already provides a real, demonstrated ~9x payload
reduction at the 900-node scale tested. Revisit only if a future real-world tree is measured in the
multi-thousand-node range and filtering alone proves insufficient — no such evidence exists today.
