# Handoff State Machine

## Feasible Model

If a legitimate activation mechanism existed, the state machine would be:

```text
NONE
PLUMB_ACTIVE
CUSTOM_ACTIVE
SWITCHING_TO_PLUMB
SWITCHING_TO_CUSTOM
FAILED
AMBIGUOUS
```

Transitions would be serialized through a handoff lock:

```text
PLUMB_ACTIVE -> SWITCHING_TO_CUSTOM -> CUSTOM_ACTIVE
CUSTOM_ACTIVE -> SWITCHING_TO_PLUMB -> PLUMB_ACTIVE
NONE -> SWITCHING_TO_PLUMB -> PLUMB_ACTIVE
NONE -> SWITCHING_TO_CUSTOM -> CUSTOM_ACTIVE
```

Each successful transition would require:

1. release/neutralize current ownership if needed,
2. activate target backend,
3. wait bounded time for pairing,
4. verify status,
5. perform a real Figma safe read,
6. return success only after verification.

## Actual Stage 3 State Machine

Current architecture supports observation states only:

```text
NONE
PLUMB_ACTIVE
CUSTOM_ACTIVE
AMBIGUOUS
FAILED_OBSERVATION
```

Unsupported requested transitions:

```text
PLUMB_ACTIVE --handoffTo(custom)--> HANDOFF_UNSUPPORTED
CUSTOM_ACTIVE --handoffTo(plumb)--> HANDOFF_UNSUPPORTED
NONE --handoffTo(any)--> HANDOFF_UNSUPPORTED
```

## Why No `unified_handoff` Tool Was Added

The Stage 3 brief allowed `unified_handoff` only if programmatic handoff was proven feasible. It was not. Adding a tool that always fails would expand the MCP surface without solving the runtime problem and could invite callers to treat backend selection as automated when it is not.
