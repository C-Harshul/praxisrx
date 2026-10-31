import { describe, expect, it } from "vitest";
import { applicabilityLabel, orderedAggregates, splitCitations, validateStep, type OnboardingDraft } from "./rules";

const base: OnboardingDraft = {
  full_name: "Jane Doe",
  years_in_practice: "",
  practice_setting: "",
  specialty: "",
  cancer_types: [],
  topics: [],
  preferred_format: "",
  frequency: "",
  doctor_id_code: "DR-1001",
  consent: true,
  linked: true,
};

describe("onboarding validation", () => {
  it("requires a full name on step 1", () => {
    expect(validateStep(1, { ...base, full_name: "  " }).full_name).toBeDefined();
    expect(validateStep(1, base)).toEqual({});
  });

  it("requires a doctor ID on step 4", () => {
    expect(validateStep(4, { ...base, doctor_id_code: "" }).doctor_id_code).toBeDefined();
  });

  it("requires consent on step 4", () => {
    expect(validateStep(4, { ...base, consent: false }).consent).toBeDefined();
  });

  it("requires the doctor ID to be linked before leaving step 4", () => {
    expect(validateStep(4, { ...base, linked: false }).linked).toBeDefined();
    expect(validateStep(4, base)).toEqual({});
  });
});

describe("applicability badge", () => {
  it("shows the approximate share of patients", () => {
    expect(applicabilityLabel(15)).toEqual({ text: "Applies to ~15% of your patients", inMix: true });
  });

  it("says outside your patient mix when there is no percentage", () => {
    expect(applicabilityLabel(null).text).toBe("Outside your patient mix");
    expect(applicabilityLabel(0).text).toBe("Outside your patient mix");
  });
});

describe("patient mix ordering", () => {
  it("lists NSCLC before Stage IV", () => {
    const out = orderedAggregates({ "Stage IV": 60, NSCLC: 85 });
    expect(out.map((x) => x.label)).toEqual(["NSCLC", "Stage IV"]);
  });
});

describe("citation markers", () => {
  it("splits [n] markers out of paragraph text", () => {
    expect(splitCitations("Text. [2]")).toEqual([
      { type: "text", value: "Text. " },
      { type: "cite", n: 2 },
    ]);
  });
});
