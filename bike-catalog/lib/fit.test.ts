import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fitCheck } from "./fit";

describe("fitCheck", () => {
  it("flags an unverified fit-critical part to check before ordering", () => {
    const check = fitCheck("BOTTOM_BRACKET", false);
    assert.equal(check.fitCritical, true);
    assert.equal(check.checkBeforeOrdering, true);
    assert.match(check.fitNote ?? "", /shell/);
  });

  it("doesn't flag a verified factory part, but still calls it fit-critical", () => {
    const check = fitCheck("BOTTOM_BRACKET", true);
    assert.equal(check.fitCritical, true);
    assert.equal(check.checkBeforeOrdering, false);
  });

  it("covers the standards replacements have to match", () => {
    for (const slot of ["AXLE", "HEADSET", "DERAILLEUR_HANGER", "BRAKES", "DISC_ROTORS", "SEATPOST", "CASSETTE", "REAR_SHOCK"]) {
      assert.equal(fitCheck(slot, false).fitCritical, true, slot);
    }
  });

  it("leaves parts that fit anything alone", () => {
    for (const slot of ["SADDLE", "GRIPS", "FRAME_MATERIAL"]) {
      const check = fitCheck(slot, false);
      assert.equal(check.fitCritical, false, slot);
      assert.equal(check.checkBeforeOrdering, false, slot);
    }
  });
});
