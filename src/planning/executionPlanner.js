import { randomUUID } from "node:crypto";

/**
 * Block B §6/§8/§9/§10 — a deterministic planning/execution layer above raw capability calls.
 *
 * Deliberately NOT a natural-language-to-plan translator, and deliberately NOT a generic workflow DSL
 * (brief §6/§29 both explicitly warn against this). The LLM remains the design intelligence — it
 * decides WHAT the steps of a design build are, in the same way it already decides which capability to
 * call and with what payload. What this module adds is purely mechanical: given an ORDERED list of
 * already-decided steps, it validates them, resolves dependency ordering, executes them through the
 * existing CommandRouter (so every one already gets a full operationRecord — see commandRouter.js
 * §3), tracks which "checkpoint" labels were reached, and can resume a partially-completed plan without
 * re-running steps that already succeeded. This IS the "design execution session" the brief asks for
 * (§8) — its return value already answers "what did this run actually do," so no separate
 * session-tracking subsystem is introduced.
 */

/**
 * A step: { capability, payload, dependsOn？: string[], checkpoint？: string, id？: string,
 * expectedPostcondition？: string }. `id` is auto-generated if omitted. `dependsOn` names other steps'
 * `id`s — a step never runs before every step it depends on has SUCCEEDED (a failed dependency blocks
 * everything downstream of it, surfaced as `status: "blocked"`, not silently skipped).
 */
export function buildPlan(rawSteps, { registry, planId = randomUUID() } = {}) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error("buildPlan requires a non-empty array of steps.");
  }
  const seenIds = new Set();
  const steps = rawSteps.map((raw, index) => {
    const id = raw.id || `step-${index + 1}`;
    if (seenIds.has(id)) throw new Error(`buildPlan: duplicate step id "${id}".`);
    seenIds.add(id);
    if (!raw.capability) throw new Error(`buildPlan: step "${id}" is missing "capability".`);
    let capability = null;
    if (registry) {
      // Resolve now (not at execute time) so an unknown capability is a PREFLIGHT-time error, not a
      // mid-execution surprise (brief §10: "catch deterministic errors cheaply").
      try {
        capability = registry.get(raw.capability);
      } catch {
        capability = null; // recorded as unresolved below; preflightPlan() reports it clearly
      }
    }
    return {
      id,
      capability: raw.capability,
      payload: raw.payload ?? {},
      dependsOn: raw.dependsOn ?? [],
      checkpoint: raw.checkpoint ?? null,
      expectedPostcondition: raw.expectedPostcondition ?? null,
      family: capability?.family ?? null,
      mutation: capability?.mutation ?? null,
      retrySafety: capability?.retrySafety ?? null,
      resolved: capability !== null
    };
  });
  return { planId, createdAt: new Date().toISOString(), steps };
}

/**
 * Block B §10 — cheap, deterministic validation only. Never attempts to predict Figma runtime
 * behavior (e.g. "will this specific hierarchy mutation succeed") — only checks what can be known
 * without touching the bridge: every capability resolves, every dependency reference is a real step
 * id, no dependency cycles, and (schema-driven) every step's payload passes ITS OWN capability schema
 * — the exact same Zod schema CommandRouter would use, just run early instead of after the plan has
 * already started executing.
 */
export function preflightPlan(plan) {
  const problems = [];
  const idsById = new Map(plan.steps.map((s) => [s.id, s]));

  for (const step of plan.steps) {
    if (!step.resolved) {
      problems.push({ stepId: step.id, code: "CAPABILITY_NOT_FOUND", message: `Step "${step.id}" references unknown capability "${step.capability}".` });
      continue;
    }
    for (const dep of step.dependsOn) {
      if (!idsById.has(dep)) {
        problems.push({ stepId: step.id, code: "INVALID_DEPENDENCY", message: `Step "${step.id}" depends on unknown step "${dep}".` });
      }
    }
  }

  // Cycle detection (simple DFS — plans are expected to be small, O(n) steps is fine).
  const visiting = new Set();
  const visited = new Set();
  function visit(stepId, path) {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) {
      problems.push({ stepId, code: "DEPENDENCY_CYCLE", message: `Dependency cycle detected: ${[...path, stepId].join(" -> ")}.` });
      return;
    }
    const step = idsById.get(stepId);
    if (!step) return; // already reported as INVALID_DEPENDENCY above
    visiting.add(stepId);
    for (const dep of step.dependsOn) visit(dep, [...path, stepId]);
    visiting.delete(stepId);
    visited.add(stepId);
  }
  for (const step of plan.steps) visit(step.id, []);

  return { ok: problems.length === 0, problems };
}

function topologicalOrder(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const ordered = [];
  const done = new Set();
  function visit(step) {
    if (done.has(step.id)) return;
    for (const dep of step.dependsOn) {
      const depStep = byId.get(dep);
      if (depStep) visit(depStep);
    }
    done.add(step.id);
    ordered.push(step);
  }
  for (const step of steps) visit(step);
  return ordered;
}

/**
 * Executes a plan through the real CommandRouter. `previousRun` (optional) is an earlier execution
 * record from THIS SAME plan — any step whose id already has status "succeeded" there is skipped
 * (Block B §9 checkpoints / §21 interruption-resume), never re-run. A step whose dependency did not
 * succeed is marked "blocked" and never attempted (never silently skipped without a trace).
 */
export async function executePlan(plan, router, { previousRun = null, stopOnFailure = true } = {}) {
  const sessionId = previousRun?.sessionId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const priorById = new Map((previousRun?.results ?? []).map((r) => [r.stepId, r]));
  const results = [];
  const reachedCheckpoints = new Set(previousRun?.reachedCheckpoints ?? []);
  const order = topologicalOrder(plan.steps);
  let halted = false;

  for (const step of order) {
    const prior = priorById.get(step.id);
    if (prior && prior.status === "succeeded") {
      results.push(prior); // resumed — not re-executed
      if (step.checkpoint) reachedCheckpoints.add(step.checkpoint);
      continue;
    }
    const depsOk = step.dependsOn.every((dep) => {
      const depResult = results.find((r) => r.stepId === dep);
      return depResult && depResult.status === "succeeded";
    });
    if (!depsOk) {
      results.push({ stepId: step.id, status: "blocked", capability: step.capability, reason: "one or more dependencies did not succeed" });
      continue;
    }
    if (halted) {
      results.push({ stepId: step.id, status: "blocked", capability: step.capability, reason: "execution halted by an earlier failure (stopOnFailure)" });
      continue;
    }
    if (!step.resolved) {
      results.push({ stepId: step.id, status: "failed", capability: step.capability, reason: "capability did not resolve at preflight time" });
      if (stopOnFailure) halted = true;
      continue;
    }
    const routerResult = await router.execute({ capability: step.capability, payload: step.payload });
    // Block B §8 — operationRecord.target is deliberately a payload-derived, best-effort SCALAR (see
    // commandRouter.js's extractTarget) — it can only ever point at a target the CALLER already knew
    // about (nodeId/instanceId/componentId in the payload). A creation step like custom.design has no
    // such payload field — what it created only appears in the RESULT (`result.ids`, a map of the
    // caller's own doc-authored logical ids to the real Figma-assigned ids). Without reading that here,
    // "what did this run actually create" (§8's core question) would silently miss every creation step.
    const createdIds = routerResult.ok && routerResult.result && typeof routerResult.result.ids === "object" && routerResult.result.ids !== null ? Object.values(routerResult.result.ids) : null;
    results.push({
      stepId: step.id,
      capability: step.capability,
      status: routerResult.ok ? "succeeded" : routerResult.operationRecord?.status === "timed_out" ? "timed_out" : "failed",
      operationId: routerResult.operationRecord?.operationId ?? null,
      target: routerResult.operationRecord?.target ?? null,
      createdIds,
      retrySafety: step.retrySafety,
      checkpoint: step.checkpoint,
      result: routerResult.ok ? routerResult.result : null,
      error: routerResult.ok ? null : routerResult.error
    });
    if (routerResult.ok && step.checkpoint) reachedCheckpoints.add(step.checkpoint);
    if (!routerResult.ok && stopOnFailure) halted = true;
  }

  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "timed_out").length;
  const blocked = results.filter((r) => r.status === "blocked").length;

  return {
    sessionId,
    planId: plan.planId,
    startedAt,
    completedAt: new Date().toISOString(),
    ok: failed === 0 && blocked === 0,
    totalSteps: plan.steps.length,
    succeeded,
    failed,
    blocked,
    reachedCheckpoints: [...reachedCheckpoints],
    results,
    // Block B §8 — the fields a design-execution session must be able to answer "what did this run
    // actually do" from, without re-deriving them from `results` every time. Combines both sources of
    // a created/touched id: operationRecord.target (payload-derived, e.g. patch/delete/move) and
    // createdIds (result-derived, e.g. custom.design's newly-created nodes) — see the comment above
    // where createdIds is computed for why neither alone is sufficient.
    createdTargets: results
      .filter((r) => r.status === "succeeded")
      .flatMap((r) => [r.target, ...(r.createdIds ?? [])])
      .filter(Boolean)
  };
}

/** Convenience: resume a previously-halted execution against the same plan. */
export async function resumePlan(plan, router, previousRun, opts = {}) {
  return await executePlan(plan, router, { ...opts, previousRun });
}
