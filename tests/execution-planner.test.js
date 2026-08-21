import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, preflightPlan, executePlan, resumePlan } from "../src/planning/executionPlanner.js";
import { STAGE4_CAPABILITIES, CapabilityRegistry } from "../src/runtime/capabilities.js";

function registry() {
  return new CapabilityRegistry(STAGE4_CAPABILITIES);
}

function fakeRouter(outcomes) {
  // outcomes: array of {ok, result?, error?} consumed in call order, OR a function(capability, payload).
  let i = 0;
  const calls = [];
  return {
    calls,
    async execute({ capability, payload }) {
      calls.push({ capability, payload });
      const outcome = typeof outcomes === "function" ? outcomes(capability, payload, i) : outcomes[i];
      i += 1;
      return {
        ok: outcome.ok,
        result: outcome.result ?? null,
        error: outcome.error ?? null,
        operationRecord: { operationId: `op-${i}`, target: payload?.nodeId ?? null, status: outcome.ok ? "succeeded" : outcome.timedOut ? "timed_out" : "failed" }
      };
    }
  };
}

// buildPlan

test("buildPlan: assigns step ids, resolves capability metadata from the real registry", () => {
  const plan = buildPlan([{ capability: "custom.design", payload: { doc: {} } }, { capability: "custom.patch_node", payload: { nodeId: "1:1" } }], { registry: registry() });
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].id, "step-1");
  assert.equal(plan.steps[0].family, "custom");
  assert.equal(plan.steps[0].mutation, true);
  assert.equal(plan.steps[0].retrySafety, "reconciliation");
  assert.equal(plan.steps[1].retrySafety, "natural");
});

test("buildPlan: rejects an empty step list", () => {
  assert.throws(() => buildPlan([]));
});

test("buildPlan: rejects duplicate step ids", () => {
  assert.throws(() => buildPlan([{ id: "a", capability: "custom.patch_node" }, { id: "a", capability: "custom.delete_node" }]));
});

test("buildPlan: an unresolvable capability is recorded as unresolved, not thrown, so preflight can report it cleanly", () => {
  const plan = buildPlan([{ capability: "does.not.exist" }], { registry: registry() });
  assert.equal(plan.steps[0].resolved, false);
});

// preflightPlan

test("preflightPlan: a clean plan with valid dependencies passes", () => {
  const plan = buildPlan(
    [
      { id: "create", capability: "custom.design", payload: {} },
      { id: "patch", capability: "custom.patch_node", payload: {}, dependsOn: ["create"] }
    ],
    { registry: registry() }
  );
  const result = preflightPlan(plan);
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

test("preflightPlan: catches an unknown capability", () => {
  const plan = buildPlan([{ capability: "does.not.exist" }], { registry: registry() });
  const result = preflightPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, "CAPABILITY_NOT_FOUND");
});

test("preflightPlan: catches a dependency on a nonexistent step id", () => {
  const plan = buildPlan([{ id: "a", capability: "custom.patch_node", dependsOn: ["ghost"] }], { registry: registry() });
  const result = preflightPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, "INVALID_DEPENDENCY");
});

test("preflightPlan: catches a real dependency cycle (a->b->a)", () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.patch_node", dependsOn: ["b"] },
      { id: "b", capability: "custom.patch_node", dependsOn: ["a"] }
    ],
    { registry: registry() }
  );
  const result = preflightPlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === "DEPENDENCY_CYCLE"));
});

// executePlan

test("executePlan: runs steps in dependency order, not declaration order, when they're reversed", async () => {
  const plan = buildPlan(
    [
      { id: "b", capability: "custom.patch_node", payload: { nodeId: "b" }, dependsOn: ["a"] },
      { id: "a", capability: "custom.design", payload: { doc: {} } }
    ],
    { registry: registry() }
  );
  const router = fakeRouter([{ ok: true }, { ok: true }]);
  await executePlan(plan, router);
  assert.deepEqual(router.calls.map((c) => c.capability), ["custom.design", "custom.patch_node"]);
});

test("executePlan: a failed dependency blocks the dependent step (never silently skipped, reported as 'blocked')", async () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.design", payload: {} },
      { id: "b", capability: "custom.patch_node", payload: {}, dependsOn: ["a"] }
    ],
    { registry: registry() }
  );
  const router = fakeRouter([{ ok: false, error: { code: "FIGMA_API_ERROR", message: "boom" } }]);
  const run = await executePlan(plan, router);
  assert.equal(run.ok, false);
  assert.equal(run.results.find((r) => r.stepId === "a").status, "failed");
  assert.equal(run.results.find((r) => r.stepId === "b").status, "blocked");
  assert.equal(router.calls.length, 1, "step b must never have been sent to the router at all");
});

test("executePlan: reachedCheckpoints only includes checkpoints whose step actually succeeded", async () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.design", payload: {}, checkpoint: "structure" },
      { id: "b", capability: "custom.patch_node", payload: {}, checkpoint: "styling" }
    ],
    { registry: registry() }
  );
  const router = fakeRouter([{ ok: true }, { ok: false, error: { code: "FIGMA_API_ERROR" } }]);
  const run = await executePlan(plan, router, { stopOnFailure: false });
  assert.deepEqual(run.reachedCheckpoints, ["structure"]);
});

test("executePlan: every successful step's operationId and target are preserved from the real router result", async () => {
  const plan = buildPlan([{ id: "a", capability: "custom.patch_node", payload: { nodeId: "42:1" } }], { registry: registry() });
  const router = fakeRouter([{ ok: true }]);
  const run = await executePlan(plan, router);
  assert.equal(run.results[0].target, "42:1");
  assert.ok(run.results[0].operationId);
});

test("executePlan: a creation step's result-derived ids (e.g. custom.design's result.ids) are captured as createdIds, since the payload itself has no nodeId to extract a target from", async () => {
  const plan = buildPlan([{ id: "a", capability: "custom.design", payload: { doc: {} } }], { registry: registry() });
  const router = fakeRouter([{ ok: true, result: { ids: { "logical-root": "10:1", "logical-child": "10:2" } } }]);
  const run = await executePlan(plan, router);
  assert.equal(run.results[0].target, null, "custom.design's payload has no nodeId/instanceId/componentId — target correctly stays null");
  assert.deepEqual(run.results[0].createdIds, ["10:1", "10:2"]);
});

test("executePlan: createdTargets merges both payload-derived targets AND result-derived createdIds across a whole plan", async () => {
  const plan = buildPlan(
    [
      { id: "create", capability: "custom.design", payload: { doc: {} } },
      { id: "patch", capability: "custom.patch_node", payload: { nodeId: "42:1" }, dependsOn: ["create"] }
    ],
    { registry: registry() }
  );
  const router = fakeRouter([{ ok: true, result: { ids: { root: "10:1" } } }, { ok: true }]);
  const run = await executePlan(plan, router);
  assert.deepEqual(run.createdTargets, ["10:1", "42:1"]);
});

// resumePlan (§9 checkpoints / §21 interruption-resume)

test("resumePlan: does NOT re-execute a step that already succeeded in the previous run", async () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.design", payload: {} },
      { id: "b", capability: "custom.patch_node", payload: {} }
    ],
    { registry: registry() }
  );
  const router1 = fakeRouter([{ ok: true }, { ok: false, error: { code: "COMMAND_TIMEOUT" }, timedOut: true }]);
  const run1 = await executePlan(plan, router1);
  assert.equal(run1.results.find((r) => r.stepId === "a").status, "succeeded");
  assert.equal(run1.results.find((r) => r.stepId === "b").status, "timed_out");

  const router2 = fakeRouter([{ ok: true }]); // only step "b" should actually be called this time
  const run2 = await resumePlan(plan, router2, run1);
  assert.equal(router2.calls.length, 1, "step a must not be re-sent to the router on resume");
  assert.equal(router2.calls[0].capability, "custom.patch_node");
  assert.equal(run2.results.find((r) => r.stepId === "a").status, "succeeded");
  assert.equal(run2.results.find((r) => r.stepId === "b").status, "succeeded");
  assert.equal(run2.ok, true);
});

test("resumePlan: preserves the same sessionId across resumes", async () => {
  const plan = buildPlan([{ id: "a", capability: "custom.patch_node", payload: {} }], { registry: registry() });
  const router1 = fakeRouter([{ ok: false, error: { code: "COMMAND_TIMEOUT" }, timedOut: true }]);
  const run1 = await executePlan(plan, router1);
  const router2 = fakeRouter([{ ok: true }]);
  const run2 = await resumePlan(plan, router2, run1);
  assert.equal(run1.sessionId, run2.sessionId);
});

test("resumePlan: carries forward reachedCheckpoints from the previous run", async () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.design", payload: {}, checkpoint: "structure" },
      { id: "b", capability: "custom.patch_node", payload: {}, checkpoint: "styling" }
    ],
    { registry: registry() }
  );
  const router1 = fakeRouter([{ ok: true }, { ok: false, error: { code: "COMMAND_TIMEOUT" }, timedOut: true }]);
  const run1 = await executePlan(plan, router1);
  const router2 = fakeRouter([{ ok: true }]);
  const run2 = await resumePlan(plan, router2, run1);
  assert.deepEqual(run2.reachedCheckpoints.sort(), ["structure", "styling"]);
});

// Production-lock hardening — pauseAtCheckpoint: a deliberate, externally-observable mid-plan pause
// boundary, distinct from a failure, that a caller can resume from without re-executing anything.

test("executePlan: pauseAtCheckpoint stops right after that checkpoint's step succeeds, marking remaining steps 'paused' (not 'blocked' or 'failed')", async () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.design", payload: {}, checkpoint: "structure" },
      { id: "b", capability: "custom.patch_node", payload: {}, dependsOn: ["a"] },
      { id: "c", capability: "custom.patch_node", payload: {}, dependsOn: ["b"] }
    ],
    { registry: registry() }
  );
  const router = fakeRouter([{ ok: true }]); // only "a" should ever be sent
  const run = await executePlan(plan, router, { pauseAtCheckpoint: "structure" });
  assert.equal(router.calls.length, 1, "execution must stop immediately after the paused checkpoint — b/c never sent to the router");
  assert.equal(run.results.find((r) => r.stepId === "a").status, "succeeded");
  assert.equal(run.results.find((r) => r.stepId === "b").status, "paused");
  assert.equal(run.results.find((r) => r.stepId === "c").status, "paused");
  assert.equal(run.paused, true);
  assert.equal(run.ok, false, "a paused run is not yet complete");
});

test("executePlan+resumePlan: a paused plan resumes and completes normally, continuing the SAME sessionId, with paused steps re-attempted (not skipped, unlike 'succeeded' steps)", async () => {
  const plan = buildPlan(
    [
      { id: "a", capability: "custom.design", payload: {}, checkpoint: "structure" },
      { id: "b", capability: "custom.patch_node", payload: {} }
    ],
    { registry: registry() }
  );
  const router1 = fakeRouter([{ ok: true }]);
  const paused = await executePlan(plan, router1, { pauseAtCheckpoint: "structure" });
  assert.equal(paused.paused, true);

  const router2 = fakeRouter([{ ok: true }]); // step "b" (previously "paused", never attempted) must be sent now
  const resumed = await resumePlan(plan, router2, paused);
  assert.equal(router2.calls.length, 1);
  assert.equal(router2.calls[0].capability, "custom.patch_node");
  assert.equal(resumed.results.find((r) => r.stepId === "a").status, "succeeded", "step a is carried forward, not re-executed");
  assert.equal(resumed.results.find((r) => r.stepId === "b").status, "succeeded");
  assert.equal(resumed.paused, false);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.sessionId, paused.sessionId, "resuming a paused plan continues the SAME logical session");
});
