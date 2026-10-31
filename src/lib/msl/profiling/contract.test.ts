import { describe, expect, it } from "vitest";
import { pickStatedProfile, validateGeneratedProfile, type StatedProfile } from "./contract";

export const stated: StatedProfile = {
  years_in_practice: 14,
  practice_setting: "Community cancer centre",
  specialty: "Medical oncology",
  cancer_types: ["Lung"],
  topics: ["Targeted therapy", "Immunotherapy"],
  preferred_format: "Both",
  frequency: "Weekly",
};

describe("doctor profiling gate", () => {
  it("accepts supported suggestions while preserving stated answers", () => {
    expect(
      validateGeneratedProfile(
        { stated, suggested_focus: [{ cancer_type: "Lung", topic: "Immunotherapy" }] },
        stated,
      ).stated,
    ).toEqual(stated);
  });
  it("omits identity and patient data from prompts", () => {
    expect(
      pickStatedProfile({
        ...stated,
        full_name: "Private name",
        doctor_id_code: "SECRET",
        aggregates: { Lung: 80 },
        patient_records: ["secret"],
      }),
    ).toEqual(stated);
  });
  it("keeps missing answers unknown", () => {
    const input = {
      ...stated,
      years_in_practice: null,
      specialty: null,
      cancer_types: [],
      topics: [],
    };
    expect(
      validateGeneratedProfile({ stated: input, suggested_focus: [] }, input).stated.specialty,
    ).toBeNull();
    expect(() =>
      validateGeneratedProfile(
        { stated: { ...input, specialty: "Medical oncology" }, suggested_focus: [] },
        input,
      ),
    ).toThrow();
  });
  it("rejects added interests and unsupported cross-specialty suggestions", () => {
    expect(() =>
      validateGeneratedProfile(
        { stated: { ...stated, topics: ["Chemotherapy"] }, suggested_focus: [] },
        stated,
      ),
    ).toThrow();
    expect(() =>
      validateGeneratedProfile(
        { stated, suggested_focus: [{ cancer_type: "Breast", topic: "Immunotherapy" }] },
        stated,
      ),
    ).toThrow();
  });
  it("rejects duplicates, extra clinical prose and invalid vocabulary", () => {
    const focus = { cancer_type: "Lung", topic: "Immunotherapy" };
    expect(() =>
      validateGeneratedProfile({ stated, suggested_focus: [focus, focus] }, stated),
    ).toThrow();
    expect(() =>
      validateGeneratedProfile({ stated, suggested_focus: [], advice: "Prescribe a drug" }, stated),
    ).toThrow();
    expect(() => pickStatedProfile({ ...stated, specialty: "Thoracic magic" })).toThrow();
  });
});
