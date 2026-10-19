import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Stage } from "@prisma/client";
import { desiredInstallRecord, type InstallRecordInput } from "./bike-installed-components";

const DONE = new Date("2026-10-01T12:00:00Z");

function note(overrides: Partial<InstallRecordInput> = {}): InstallRecordInput {
  return {
    jobStage: "WORKING_ON",
    profileBikeId: "bike-1",
    jobBikeCompletedAt: DONE,
    confirmation: "UNREVIEWED",
    customValue: null,
    replacementState: "INSTALLED",
    replacementValue: "SRAM GX cassette",
    ...overrides,
  };
}

describe("desiredInstallRecord", () => {
  it("records a part the mechanic marked installed once the bike is done", () => {
    assert.deepEqual(desiredInstallRecord(note()), { kind: "INSTALLED", value: "SRAM GX cassette" });
  });

  it("records nothing while the work isn't done", () => {
    assert.equal(desiredInstallRecord(note({ jobBikeCompletedAt: null })), null);
  });

  it("counts Bike ready and Completed as done for the whole job", () => {
    for (const stage of ["BIKE_READY", "COMPLETED"] as Stage[]) {
      assert.ok(desiredInstallRecord(note({ jobStage: stage, jobBikeCompletedAt: null })));
    }
  });

  it("never records a part that's only planned, quoted or ordered", () => {
    assert.equal(desiredInstallRecord(note({ replacementState: "PLANNED" })), null);
    assert.equal(desiredInstallRecord(note({ replacementState: "PLANNED", jobStage: "COMPLETED" })), null);
  });

  it("never records from a cancelled job, even if the bike was marked done", () => {
    assert.equal(desiredInstallRecord(note({ jobStage: "CANCELLED" })), null);
  });

  it("never records from a job still awaiting approval", () => {
    assert.equal(desiredInstallRecord(note({ jobStage: "PENDING_APPROVAL" })), null);
  });

  it("records nothing for a walk-in bike with no customer bike to record on", () => {
    assert.equal(desiredInstallRecord(note({ profileBikeId: null })), null);
  });

  it("records a non-factory part the mechanic saw on the bike", () => {
    assert.deepEqual(
      desiredInstallRecord(
        note({ replacementState: "NONE", replacementValue: null, confirmation: "CUSTOMIZED", customValue: "Shimano XT brakes" })
      ),
      { kind: "OBSERVED", value: "Shimano XT brakes" }
    );
  });

  it("prefers what was installed over what was seen before the work", () => {
    const record = desiredInstallRecord(note({ confirmation: "CUSTOMIZED", customValue: "worn old part" }));
    assert.equal(record?.kind, "INSTALLED");
  });

  it("ignores 'factory part is on it' — that's the factory spec, not a change", () => {
    assert.equal(
      desiredInstallRecord(note({ replacementState: "NONE", replacementValue: null, confirmation: "MATCHES_CATALOG" })),
      null
    );
  });

  it("ignores blank values", () => {
    assert.equal(desiredInstallRecord(note({ replacementValue: "  " })), null);
  });
});
