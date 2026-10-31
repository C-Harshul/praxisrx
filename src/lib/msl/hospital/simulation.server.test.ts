import { describe, expect, it } from "vitest";
import { createHospitalSimulation } from "./simulation.server";
import { DEMO_PATIENT_MIX } from "./contract";
const requestId = "10000000-0000-0000-0000-000000000001";
const nextId = "10000000-0000-0000-0000-000000000002";
describe("isolated hospital EHR simulation", () => {
  it("updates doctor context, queues a new profile and advances background status", () => {
    let now = Date.parse("2026-10-31T09:00:00Z");
    const simulation = createHospitalSimulation(() => now);
    const payload = {
      ...structuredClone(DEMO_PATIENT_MIX),
      aggregates: { NSCLC: 80, "KRAS G12C": null },
    };
    const snapshot = simulation.sync({
      payload,
      sourceKind: "aggregate_json",
      requestId,
      expectedId: null,
    });
    expect(snapshot.version).toBe(1);
    const doctor = simulation.directory().doctors[0]!;
    expect(doctor.context?.aggregates).toEqual(payload.aggregates);
    expect(doctor.profile).toEqual({ version: 2, status: "queued", confirmed: false });
    now += 1000;
    simulation.advance();
    expect(simulation.directory().doctors[0]?.profile?.status).toBe("processing");
    now += 2000;
    simulation.advance();
    expect(simulation.directory().doctors[0]?.profile).toEqual({
      version: 2,
      status: "succeeded",
      confirmed: false,
    });
  });
  it("keeps retries idempotent, rejects unknown doctors and stale previews", () => {
    const simulation = createHospitalSimulation();
    const input = {
      payload: DEMO_PATIENT_MIX,
      sourceKind: "aggregate_json" as const,
      requestId,
      expectedId: null,
    };
    simulation.sync(input);
    simulation.sync(input);
    expect(simulation.directory().doctors[0]?.history).toHaveLength(1);
    expect(() => simulation.sync({ ...input, requestId: nextId })).toThrow(/changed/);
    expect(() =>
      simulation.sync({
        ...input,
        payload: { ...DEMO_PATIENT_MIX, doctor_id_code: "DR-OTHER" },
        requestId: nextId,
      }),
    ).toThrow(/not assigned/);
  });
  it("returns isolated copies and rejects raw patient fields", () => {
    const simulation = createHospitalSimulation();
    const data = simulation.directory();
    data.doctors.length = 0;
    expect(simulation.directory().doctors).toHaveLength(1);
    expect(() =>
      simulation.sync({
        payload: { ...DEMO_PATIENT_MIX, patients: [] },
        sourceKind: "aggregate_json",
        requestId,
        expectedId: null,
      } as never),
    ).toThrow();
  });
});
