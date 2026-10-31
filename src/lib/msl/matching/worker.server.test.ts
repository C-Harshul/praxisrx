import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  commit: vi.fn(),
  audit: vi.fn(),
  match: vi.fn(),
}));
vi.mock("../platform/store.server", () => ({
  listRecords: mocks.list,
  readRecord: mocks.read,
  commitDoctor: mocks.commit,
  audit: mocks.audit,
}));
vi.mock("./contract", () => ({
  MATCHER_VERSION: "matching.v1",
  matchEvidence: mocks.match,
  evidenceReleaseSchema: { parse: (v: unknown) => v },
}));
import { runMatchingJob } from "./worker.server";
beforeEach(() => vi.resetAllMocks());
describe("canonical matching worker", () => {
  it("defers during a canonical KB write fence",async()=>{
    mocks.read.mockResolvedValue({state:{published:true,kb_write_lock:{id:"writer"}}});
    expect(await runMatchingJob()).toEqual({status:"waiting_for_reviewed_evidence"});expect(mocks.match).not.toHaveBeenCalled();
  });
  it("fails visibly when no reviewed canonical evidence exists", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await runMatchingJob()).toEqual({ status: "waiting_for_reviewed_evidence" });
    expect(mocks.match).not.toHaveBeenCalled();
  });
  it("idles when no doctor has a confirmed due profile", async () => {
    mocks.read.mockResolvedValue({ state: { published: true, payload: {} } });
    mocks.list.mockResolvedValue([]);
    expect(await runMatchingJob()).toEqual({ status: "idle" });
  });
  it("pins the canonical profile, mix, release and guards the exact doctor revision", async () => {
    const record = {
      id: "doctor",
      revision: "r1",
      state: {
        doctor: {
          onboarding_complete: true,
          frequency: "Weekly",
          patient_data_linked: false,
          consent_given_at: null,
        },
        profiles: [
          {
            id: "profile",
            confirmed_at: "now",
            status: "succeeded",
            version: 1,
            schema_version: "v1",
            prompt_version: "p1",
            model: "model",
            input: {},
            reviewed_focus: [],
          },
        ],
        newsletters: [],
        matching_runs: [],
        audit: [],
      },
    };
    mocks.read.mockResolvedValue({
      revision: "kb1",
      state: { published: true, version: "kb-v1", payload: {} },
    });
    mocks.list.mockResolvedValue([record]);
    mocks.match.mockReturnValue({ matches: [] });
    mocks.commit.mockResolvedValue("committed-revision");
    expect(await runMatchingJob()).toEqual({
      status: "succeeded",
      matching_run_id: expect.any(String),
      revision: "committed-revision",
    });
    expect(mocks.commit).toHaveBeenCalledWith(
      record,
      expect.objectContaining({
        matching_runs: [
          expect.objectContaining({
            profile_id: "profile",
            patient_mix_id: null,
            release_version: "kb-v1",
            evidence_package: expect.objectContaining({
              schema_version: "ranked-evidence-package.v1",
              publication_state: "published",
              input_doctor_revision: "r1",
              kb_pointer_revision: "kb1",
              input: expect.objectContaining({ delivered_item_ids: [] }),
            }),
          }),
        ],
      }),
    );
  });
});
