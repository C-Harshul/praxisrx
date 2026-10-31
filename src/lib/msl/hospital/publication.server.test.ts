import { describe, it, expect, vi } from "vitest";
import { publishHospitalContext, HospitalPublicationUnconfirmed } from "./publication.server";
import type { HospitalCanonicalStore } from "./publication.server";
import { DEMO_PATIENT_MIX } from "./contract";
import type { DoctorState, RecordSnapshot } from "../platform/types";
const hospitalId = "20000000-0000-0000-0000-000000000001";
const doctorId = "20000000-0000-0000-0000-000000000002";
const requestId = "10000000-0000-0000-0000-000000000001";
function fixture() {
  let record: RecordSnapshot<DoctorState> = {
    id: doctorId,
    revision: "before",
    state: {
      schema_version: "msl-app-state.v1",
      assigned_code: "DR-1001",
      hospital_ids: [hospitalId],
      doctor: {
        id: doctorId,
        full_name: "Synthetic doctor",
        years_in_practice: 14,
        practice_setting: "Community cancer centre",
        specialty: "Medical oncology",
        cancer_types: ["Lung"],
        topics: ["Immunotherapy"],
        preferred_format: "Written",
        frequency: "Weekly",
        doctor_id_code: "DR-1001",
        patient_data_linked: true,
        consent_given_at: "2026-01-01T00:00:00Z",
        onboarding_complete: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      patient_mix: null,
      sync_history: [],
      profiles: [],
      matching_runs: [],
      newsletters: [],
      bookmarks: [],
      audit: [],
    },
  };
  const store: HospitalCanonicalStore = {
    list: vi.fn(async () => [structuredClone(record)]),
    read: vi.fn(async () => structuredClone(record)),
    commit: vi.fn(async (before, next) => {
      if (before.revision !== record.revision) throw new Error("conflict");
      record = { id: doctorId, revision: "published-revision", state: structuredClone(next) };
      return record.revision;
    }),
  };
  const input = {
    payload: structuredClone(DEMO_PATIENT_MIX),
    sourceKind: "aggregate_json" as const,
    requestId,
    expectedId: null,
  };
  return {
    store,
    input,
    get record() {
      return record;
    },
  };
}
describe("canonical hospital publication", () => {
  it("commits aggregate, queued profile and audit atomically before returning a Databricks receipt", async () => {
    const f = fixture();
    const result = await publishHospitalContext(hospitalId, f.input, f.store);
    expect(result.canonical_revision).toBe("published-revision");
    expect(result.publication).toMatchObject({
      status: "published",
      workspace_id: "7474660613250664",
      snapshot_id: requestId,
      hospital_id: hospitalId,
    });
    expect(f.record.state.patient_mix?.id).toBe(requestId);
    expect(f.record.state.profiles.at(-1)?.status).toBe("queued");
    expect(f.record.state.profiles.at(-1)?.input).not.toHaveProperty("patient_mix");
    expect(f.record.state.audit.at(-1)?.action).toBe("hospital_patient_mix_published");
    expect(JSON.stringify(f.record.state.patient_mix)).not.toContain("patient_id");
  });
  it("retries idempotently without another canonical mutation, profile or audit", async () => {
    const f = fixture();
    await publishHospitalContext(hospitalId, f.input, f.store);
    const result = await publishHospitalContext(hospitalId, f.input, f.store);
    expect(result.id).toBe(requestId);
    expect(f.store.commit).toHaveBeenCalledTimes(1);
    expect(f.record.state.profiles).toHaveLength(1);
    expect(f.record.state.audit).toHaveLength(1);
  });
  it("does not report success or accept a local copy when Databricks commit fails", async () => {
    const f = fixture();
    vi.mocked(f.store.commit).mockRejectedValue(new Error("network timeout"));
    await expect(publishHospitalContext(hospitalId, f.input, f.store)).rejects.toBeInstanceOf(
      HospitalPublicationUnconfirmed,
    );
    expect(f.record.state.patient_mix).toBeNull();
    expect(f.record.state.profiles).toHaveLength(0);
  });
  it("recovers an ambiguous committed response using the same request ID", async () => {
    const f = fixture();
    const commit = f.store.commit;
    f.store.commit = vi.fn(async (before, next) => {
      await commit(before, next);
      throw new Error("lost response");
    });
    await expect(publishHospitalContext(hospitalId, f.input, f.store)).rejects.toBeInstanceOf(
      HospitalPublicationUnconfirmed,
    );
    const result = await publishHospitalContext(hospitalId, f.input, f.store);
    expect(result.id).toBe(requestId);
    expect(f.store.commit).toHaveBeenCalledTimes(1);
    expect(f.record.state.profiles).toHaveLength(1);
  });
  it("checks current consent/assignment after the directory read and before committing", async () => {
    const f = fixture();
    const denied = structuredClone(f.record);
    denied.state.doctor.patient_data_linked = false;
    vi.mocked(f.store.read).mockResolvedValue(denied);
    await expect(publishHospitalContext(hospitalId, f.input, f.store)).rejects.toThrow(/consent/);
    expect(f.store.commit).not.toHaveBeenCalled();
  });
  it("rejects raw fields, stale previews, and unknown or duplicate assigned doctor codes", async () => {
    const f = fixture();
    await expect(
      publishHospitalContext(
        hospitalId,
        { ...f.input, payload: { ...f.input.payload, patients: [] } },
        f.store,
      ),
    ).rejects.toThrow();
    await expect(publishHospitalContext("different-hospital", f.input, f.store)).rejects.toThrow(
      /not uniquely assigned/,
    );
    vi.mocked(f.store.list).mockResolvedValue([f.record, f.record]);
    await expect(publishHospitalContext(hospitalId, f.input, f.store)).rejects.toThrow(
      /not uniquely assigned/,
    );
    expect(f.store.commit).not.toHaveBeenCalled();
  });
});
