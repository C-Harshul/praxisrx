import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), read: vi.fn(), audit: vi.fn() }));
vi.mock("./store.server", () => ({
  mutateDoctor: mocks.mutate,
  readRecord: mocks.read,
  audit: mocks.audit,
}));
import { doctorWrite, doctorRead } from "./doctor.server";
import type { DoctorState } from "./types";
import { queueProfile } from "./profile-state";
const id = "00000000-0000-4000-8000-000000000001";
let state: DoctorState;
beforeEach(() => {
  vi.resetAllMocks();
  state = {
    schema_version: "msl-app-state.v1",
    assigned_code: "DR-1001",
    hospital_ids: [],
    patient_mix: null,
    sync_history: [],
    profiles: [],
    matching_runs: [],
    newsletters: [],
    bookmarks: [],
    audit: [],
    doctor: {
      id,
      full_name: "Synthetic doctor",
      years_in_practice: null,
      practice_setting: null,
      specialty: "Medical oncology",
      cancer_types: ["Lung"],
      topics: ["Immunotherapy"],
      preferred_format: "Written",
      frequency: "Weekly",
      doctor_id_code: null,
      patient_data_linked: false,
      consent_given_at: null,
      onboarding_complete: true,
      created_at: "now",
      updated_at: "now",
    },
  };
  mocks.mutate.mockImplementation(async (_id, fn) => {
    const next = structuredClone(state);
    const result = fn(next);
    state = next;
    return result;
  });
  mocks.read.mockImplementation(async () => ({ id, revision: "r1", state }));
});
describe("doctor-owned canonical state", () => {
  it("rejects another doctor's code and requires explicit consent", async () => {
    expect(await doctorWrite(id, "link", { code: "DR-OTHER", consent: true })).toEqual({
      found: false,
    });
    await expect(doctorWrite(id, "link", { code: "DR-1001", consent: false })).rejects.toThrow();
    expect(state.doctor.patient_data_linked).toBe(false);
  });
  it("invalidates generated results on unlink and cannot reuse an old confirmation", async () => {
    queueProfile(state, () => id);
    const job = state.profiles[0]!;
    job.status = "succeeded";
    job.output = {
      stated: job.input,
      suggested_focus: [{ cancer_type: "Lung", topic: "Immunotherapy" }],
    };
    await doctorWrite(id, "confirm_profile", { id, focus: [] });
    expect(state.profiles[0]!.reviewed_focus).toEqual([]);
    await doctorWrite(id, "unlink", {});
    expect(state.profiles[0]!.status).toBe("superseded");
    await expect(doctorWrite(id, "confirm_profile", { id, focus: [] })).rejects.toThrow(
      "no longer current",
    );
    expect(await doctorRead(id, "patient_mix")).toBeNull();
  });
  it("does not accept client ownership fields, raw patient records or injected preferences", async () => {
    await expect(doctorWrite(id, "save_profile", { update: { id: "other" } })).rejects.toThrow();
    await expect(doctorWrite(id, "save_profile", { update: { patients: [] } })).rejects.toThrow();
    await expect(
      doctorWrite(id, "save_profile", { update: { topics: ["Invented topic"] } }),
    ).rejects.toThrow();
  });
});
