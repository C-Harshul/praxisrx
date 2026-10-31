import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorState } from "../platform/types";
import { currentMatchingInput, publishedItemIds } from "./handoff";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../platform/store.server", () => ({ readRecord: mocks.read }));
import { readCurrentRankedPackage } from "./handoff.server";

function fixture() {
  // Offline nonclinical contract fixture; never published to Databricks.
  const state = {
    doctor: { onboarding_complete: true, patient_data_linked: false, consent_given_at: null },
    profiles: [
      {
        id: "profile",
        version: 1,
        confirmed_at: "test",
        status: "succeeded",
        schema_version: "doctor-profile.v1",
        prompt_version: "test",
        model: "test",
        input: {},
        reviewed_focus: [],
      },
    ],
    patient_mix: null,
    newsletters: [],
    matching_runs: [],
  } as unknown as DoctorState;
  state.matching_runs.push({
    id: "run",
    created_at: "test",
    profile_id: "profile",
    patient_mix_id: null,
    release_version: "release",
    result: {},
    evidence_package: {
      schema_version: "ranked-evidence-package.v1",
      publication_state: "published",
      input_doctor_revision: "r0",
      profile_version: 1,
      patient_mix_version: null,
      kb_pointer_revision: "kb1",
      matcher_version: "matching.v1",
      input: currentMatchingInput(state)!,
      result: { matcher_version: "matching.v1", matches: [], excluded: [] },
    },
  });
  return state;
}
beforeEach(() => vi.resetAllMocks());
describe("newsletter handoff", () => {
  it("suppresses only explicitly published library items regardless of email state", () => {
    const state = fixture();
    state.newsletters = [
      { id: "draft", articles: [{ kb_item_id: "draft-item" }] },
      { id: "preview", articles: [{ kb_item_id: "preview-item" }] },
      {
        id: "published",
        publication: { status: "published", matching_run_id: "run", published_at: "test" },
        articles: [{ kb_item_id: "published-item" }],
      },
    ] as DoctorState["newsletters"];
    expect(publishedItemIds(state)).toEqual(["published-item"]);
  });
  it("returns an acknowledged canonical package with current revisions", async () => {
    mocks.read
      .mockResolvedValueOnce({ revision: "doctor-current", state: fixture() })
      .mockResolvedValueOnce({ revision: "kb1", state: { published: true, version: "release" } });
    expect(await readCurrentRankedPackage("doctor", "run")).toMatchObject({
      doctor_revision: "doctor-current",
      matching_run_id: "run",
      evidence_package: { publication_state: "published" },
    });
  });
  it("rejects unconfirmed or superseded profiles", async () => {
    const state = fixture();
    state.profiles[0]!.confirmed_at = null;
    mocks.read.mockResolvedValue({ state });
    expect(await readCurrentRankedPackage("doctor", "run")).toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("rejects invalidated/replaced evidence", async () => {
    mocks.read
      .mockResolvedValueOnce({ state: fixture() })
      .mockResolvedValueOnce({ revision: "kb2", state: { published: false, version: "release" } });
    expect(await readCurrentRankedPackage("doctor", "run")).toBeNull();
  });
  it("rejects historical packages and canonical read failures without fallback", async () => {
    const state = fixture();
    delete state.matching_runs[0]!.evidence_package;
    mocks.read.mockResolvedValueOnce({ state });
    expect(await readCurrentRankedPackage("doctor", "run")).toBeNull();
    mocks.read.mockRejectedValueOnce(new Error("canonical unavailable"));
    await expect(readCurrentRankedPackage("doctor", "run")).rejects.toThrow(
      "canonical unavailable",
    );
  });
});
