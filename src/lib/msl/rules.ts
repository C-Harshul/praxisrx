import { AGGREGATE_ORDER } from "./options";

export type OnboardingDraft = {
  full_name: string;
  years_in_practice: string;
  practice_setting: string;
  specialty: string;
  cancer_types: string[];
  topics: string[];
  preferred_format: string;
  frequency: string;
  doctor_id_code: string;
  consent: boolean;
  linked: boolean;
};

export type StepErrors = { [K in keyof OnboardingDraft]?: string | undefined };

/** Validation for each onboarding step. Returns an empty object when valid. */
export function validateStep(step: number, d: OnboardingDraft): StepErrors {
  const e: StepErrors = {};
  if (step === 1) {
    const name = d.full_name.trim();
    if (!name) e.full_name = "Please enter your full name.";
    else if (name.length > 120) e.full_name = "Name must be 120 characters or fewer.";
    const y = d.years_in_practice.trim();
    if (y !== "") {
      const n = Number(y);
      if (!Number.isInteger(n) || n < 0 || n > 80) {
        e.years_in_practice = "Enter a whole number between 0 and 80.";
      }
    }
  }
  if (step === 4) {
    const code = d.doctor_id_code.trim();
    if (!code) e.doctor_id_code = "Please enter your doctor ID.";
    else if (code.length > 40) e.doctor_id_code = "Doctor ID is too long.";
    if (!d.consent) e.consent = "Consent is required to link your patient mix.";
    if (code && d.consent && !d.linked && !e.doctor_id_code) {
      e.linked = "Link your patient data before continuing.";
    }
  }
  return e;
}

/** Text for the applicability badge on an article card. */
export function applicabilityLabel(percent: number | null | undefined): {
  text: string;
  inMix: boolean;
} {
  if (percent == null || Number.isNaN(Number(percent)) || Number(percent) <= 0) {
    return { text: "Outside your patient mix", inMix: false };
  }
  return { text: `Applies to ~${Math.round(Number(percent))}% of your patients`, inMix: true };
}

/** Sort patient-mix aggregates into a stable, clinically sensible order. */
export function orderedAggregates(aggregates: Record<string, unknown> | null | undefined) {
  if (!aggregates) return [] as { label: string; value: number }[];
  const entries = Object.entries(aggregates)
    .filter(([, v]) => typeof v === "number")
    .map(([label, v]) => ({ label, value: Number(v) }))
    .filter((x) => Number.isFinite(x.value));
  const rank = (l: string) => {
    const i = AGGREGATE_ORDER.indexOf(l);
    return i === -1 ? AGGREGATE_ORDER.length : i;
  };
  return entries.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

/** Split text into plain segments and [n] citation markers. */
export function splitCitations(text: string): ({ type: "text"; value: string } | { type: "cite"; n: number })[] {
  const out: ({ type: "text"; value: string } | { type: "cite"; n: number })[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({ type: "cite", n: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}
