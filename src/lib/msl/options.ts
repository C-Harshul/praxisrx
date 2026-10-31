export const PRACTICE_SETTINGS = [
  "Academic hospital",
  "Community cancer centre",
  "Private practice",
  "Other",
] as const;

export const SPECIALTIES = [
  "Medical oncology",
  "Radiation oncology",
  "Surgical oncology",
  "Other",
] as const;

export const CANCER_TYPES = [
  "Lung",
  "Breast",
  "Pancreas",
  "Liver",
  "Gastric",
  "Colorectal",
  "Other",
] as const;

export const TOPICS = [
  "Targeted therapy",
  "Immunotherapy",
  "Antibody-drug conjugates",
  "Chemotherapy",
  "Clinical trials",
  "Guidelines",
] as const;

export const FORMATS = ["Written", "Audio", "Both"] as const;
export const FREQUENCIES = ["Weekly", "Every two weeks"] as const;

/** Preferred display order for patient-mix aggregates; unknown labels follow. */
export const AGGREGATE_ORDER = [
  "NSCLC",
  "SCLC",
  "EGFR-mutant",
  "Post-osimertinib",
  "KRAS G12C",
  "ALK-positive",
  "PD-L1 ≥50%",
  "PD-L1 negative",
  "Stage IV",
];

export const ONBOARDING_STEPS = [
  { n: 1, label: "About you" },
  { n: 2, label: "Your specialty" },
  { n: 3, label: "Your newsletter" },
  { n: 4, label: "Link your patient data" },
  { n: 5, label: "Review and finish" },
] as const;
