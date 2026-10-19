import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planJobBikeReplacement } from "./job-bike-replacement";

const existing = [
  { id: "jb1", bikeId: "b1", make: "Trek", sortOrder: 0 },
  { id: "jb2", bikeId: "b2", make: "Specialized", sortOrder: 1 },
];

describe("planJobBikeReplacement", () => {
  it("keeps every bike's identity when the client sends ids", () => {
    const plan = planJobBikeReplacement(existing, [
      { id: "jb1", make: "Trek" },
      { id: "jb2", make: "Specialized" },
    ]);
    assert.deepEqual(plan, { matches: ["jb1", "jb2"], removedIds: [] });
  });

  it("matches by customer bike when ids are missing, even if reordered", () => {
    const plan = planJobBikeReplacement(existing, [
      { bikeId: "b2", make: "Specialized" },
      { bikeId: "b1", make: "Trek" },
    ]);
    assert.deepEqual(plan.matches, ["jb2", "jb1"]);
  });

  it("falls back to position and make for older clients that send neither", () => {
    const plan = planJobBikeReplacement(existing, [
      { bikeId: null, make: "trek" },
      { bikeId: null, make: "Specialized" },
    ]);
    assert.deepEqual(plan.matches, ["jb1", "jb2"]);
  });

  it("doesn't match by position when the make changed", () => {
    const plan = planJobBikeReplacement(existing, [{ make: "Giant" }]);
    assert.deepEqual(plan, { matches: [null], removedIds: ["jb1", "jb2"] });
  });

  it("only removes bikes nobody sent, and never matches one bike twice", () => {
    const plan = planJobBikeReplacement(existing, [
      { id: "jb1", make: "Trek" },
      { id: "jb1", make: "Trek" },
    ]);
    assert.deepEqual(plan.matches, ["jb1", null]);
    assert.deepEqual(plan.removedIds, ["jb2"]);
  });

  it("ignores an id from another job", () => {
    const plan = planJobBikeReplacement(existing, [{ id: "other-job-bike", make: "Giant" }]);
    assert.deepEqual(plan.matches, [null]);
  });
});
