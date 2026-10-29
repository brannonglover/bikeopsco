import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyOptimisticCompleteBike, completingBikeMakesJobReady } from "./optimistic-job-patch";
import type { Job, JobBike, Stage } from "./types";

function bike(id: string, completed = false): JobBike {
  return { id, completedAt: completed ? "2026-10-01T00:00:00.000Z" : null } as JobBike;
}

function job(stage: Stage, jobBikes: JobBike[], workingOnJobBikeId: string | null = null): Job {
  return { id: "j1", stage, jobBikes, workingOnJobBikeId, completedAt: null } as Job;
}

describe("completingBikeMakesJobReady", () => {
  it("is true when the bike is the only one left open", () => {
    assert.equal(completingBikeMakesJobReady(job("WORKING_ON", [bike("a")]), "a"), true);
    assert.equal(
      completingBikeMakesJobReady(job("WAITING_ON_PARTS", [bike("a", true), bike("b")]), "b"),
      true
    );
  });

  it("is false while another bike is still open", () => {
    assert.equal(completingBikeMakesJobReady(job("WORKING_ON", [bike("a"), bike("b")]), "a"), false);
  });

  it("leaves Bike Ready, Completed, Cancelled and pending jobs where they are", () => {
    for (const stage of ["BIKE_READY", "COMPLETED", "CANCELLED", "PENDING_APPROVAL"] as Stage[]) {
      assert.equal(completingBikeMakesJobReady(job(stage, [bike("a")]), "a"), false);
    }
  });
});

describe("applyOptimisticCompleteBike", () => {
  it("moves the card to Bike Ready when the last bike is done", () => {
    const next = applyOptimisticCompleteBike(job("WORKING_ON", [bike("a")], "a"), "a", false);
    assert.equal(next.stage, "BIKE_READY");
    assert.equal(next.workingOnJobBikeId, null);
    assert.ok(next.jobBikes?.[0].completedAt);
  });

  it("keeps the stage while other bikes are open, and on undo", () => {
    const multi = applyOptimisticCompleteBike(job("WORKING_ON", [bike("a"), bike("b")]), "a", false);
    assert.equal(multi.stage, "WORKING_ON");
    const undo = applyOptimisticCompleteBike(job("BIKE_READY", [bike("a", true)]), "a", true);
    assert.equal(undo.stage, "BIKE_READY");
    assert.equal(undo.jobBikes?.[0].completedAt, null);
  });
});
