import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Link2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Wordmark } from "@/components/msl/Wordmark";
import { ChoiceChips } from "@/components/msl/ChoiceChips";
import { AggregateBars } from "@/components/msl/AggregateBars";
import { LoadingBlock } from "@/components/msl/States";
import { doctorQuery, patientMixQuery } from "@/lib/msl/queries";
import {
  completeOnboarding,
  linkPatientData,
  saveDoctorProfile,
  updateProfile,
  type Doctor,
  type DoctorProfileUpdate,
} from "@/lib/msl/api";
import { validateStep, type OnboardingDraft, type StepErrors } from "@/lib/msl/rules";
import {
  CANCER_TYPES,
  FORMATS,
  FREQUENCIES,
  ONBOARDING_STEPS,
  PRACTICE_SETTINGS,
  SPECIALTIES,
  TOPICS,
} from "@/lib/msl/options";
import { cn } from "@/lib/utils";

type OnboardingSearch = { step?: number; from?: "review" | "profile" };
function validateOnboardingSearch(s: Record<string, unknown>): OnboardingSearch {
  const n = Number(s["step"]);
  const out: OnboardingSearch = {};
  if (Number.isInteger(n) && n >= 1 && n <= 5) out.step = n;
  const f = s["from"];
  if (f === "review" || f === "profile") out.from = f;
  return out;
}

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: validateOnboardingSearch,
  head: () => ({
    meta: [
      { title: "Set up your briefing — MSL" },
      { name: "description", content: "Tell MSL about your practice and link your de-identified patient mix." },
      { property: "og:title", content: "Set up your briefing — MSL" },
      { property: "og:description", content: "Tell MSL about your practice and link your de-identified patient mix." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(doctorQuery),
  pendingComponent: () => <LoadingBlock />,
  component: OnboardingPage,
});

function draftFrom(d: Doctor): OnboardingDraft {
  return {
    full_name: d.full_name ?? "",
    years_in_practice: d.years_in_practice != null ? String(d.years_in_practice) : "",
    practice_setting: d.practice_setting ?? "",
    specialty: d.specialty ?? "",
    cancer_types: d.cancer_types ?? [],
    topics: d.topics ?? [],
    preferred_format: d.preferred_format ?? "",
    frequency: d.frequency ?? "",
    doctor_id_code: d.doctor_id_code ?? "",
    consent: !!d.consent_given_at,
    linked: d.patient_data_linked,
  };
}

function toUpdate(d: OnboardingDraft): DoctorProfileUpdate {
  return {
    full_name: d.full_name.trim() || null,
    years_in_practice: d.years_in_practice.trim() === "" ? null : Number(d.years_in_practice),
    practice_setting: d.practice_setting || null,
    specialty: d.specialty || null,
    cancer_types: d.cancer_types,
    topics: d.topics,
    preferred_format: d.preferred_format || null,
    frequency: d.frequency || null,
  };
}

function OnboardingPage() {
  const search = Route.useSearch();
  const step = search.step ?? 1;
  const from = search.from;
  const navigate = useNavigate({ from: "/onboarding" });
  const qc = useQueryClient();
  const { data: doctor } = useSuspenseQuery(doctorQuery);
  const [draft, setDraft] = useState<OnboardingDraft>(() => draftFrom(doctor));
  const [errors, setErrors] = useState<StepErrors>({});
  const [busy, setBusy] = useState(false);
  const [linkPreview, setLinkPreview] = useState<Record<string, number> | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { data: existingMix } = useQuery({
    ...patientMixQuery(doctor.patient_data_linked ? doctor.doctor_id_code : null),
    enabled: doctor.patient_data_linked && !linkPreview,
  });

  const editing = doctor.onboarding_complete;
  const set = <K extends keyof OnboardingDraft>(k: K, v: OnboardingDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, linked: undefined }));
  };
  const goStep = (n: number) => navigate({ search: { step: n } });

  async function next() {
    const errs = validateStep(step, draft);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      if (editing) {
        if (step <= 3) await updateProfile(toUpdate(draft), step);
        await qc.invalidateQueries({ queryKey: ["doctor"] });
        toast.success("Profile updated");
        navigate({ to: "/profile" });
        return;
      }
      if (step <= 3) {
        await saveDoctorProfile(toUpdate(draft));
        qc.invalidateQueries({ queryKey: ["doctor"] });
      }
      goStep(from === "review" ? 5 : step + 1);
    } catch {
      toast.error("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    const errs = validateStep(4, { ...draft, linked: true });
    setErrors(errs);
    setNotFound(false);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    try {
      const res = await linkPatientData(draft.doctor_id_code.trim(), draft.consent);
      if (!res.found) {
        setNotFound(true);
        return;
      }
      setDraft((d) => ({ ...d, doctor_id_code: res.doctor_id_code, linked: true }));
      setLinkPreview(res.aggregates);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["doctor"] }),
        qc.invalidateQueries({ queryKey: ["newsletters"] }),
        qc.invalidateQueries({ queryKey: ["patientMix"] }),
      ]);
    } catch {
      toast.error("We couldn't link your patient data. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    for (const s of [1, 4]) {
      const errs = validateStep(s, draft);
      if (Object.values(errs).some(Boolean)) {
        setErrors(errs);
        goStep(s);
        return;
      }
    }
    setBusy(true);
    try {
      await completeOnboarding(toUpdate(draft));
      await qc.invalidateQueries({ queryKey: ["doctor"] });
      navigate({ to: "/library" });
    } catch {
      toast.error("We couldn't finish setup. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const progress = (step / ONBOARDING_STEPS.length) * 100;
  const current = ONBOARDING_STEPS[step - 1] ?? ONBOARDING_STEPS[0];
  const preview = linkPreview ?? (draft.linked ? (existingMix?.aggregates as Record<string, number> | undefined) : undefined);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Wordmark asLink={false} />
          {editing && (
            <Link to="/profile" className="text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        {!editing && (
          <div className="mb-10">
            <div className="mb-2 flex justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span>Step {step} of {ONBOARDING_STEPS.length}</span>
              <span>{current.label}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={5}>
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">{current.label}</h1>

        <div className="mt-8 space-y-8">
          {step === 1 && (
            <>
              <Field label="Full name" htmlFor="full_name" error={errors.full_name} required>
                <Input id="full_name" value={draft.full_name} maxLength={120} onChange={(e) => set("full_name", e.target.value)} className="h-11" autoComplete="name" />
              </Field>
              <Field label="Years in practice" htmlFor="years" error={errors.years_in_practice}>
                <Input id="years" type="number" inputMode="numeric" min={0} max={80} value={draft.years_in_practice} onChange={(e) => set("years_in_practice", e.target.value)} className="h-11 max-w-40" />
              </Field>
              <ChoiceChips label="Practice setting" options={PRACTICE_SETTINGS} value={draft.practice_setting} onChange={(v) => set("practice_setting", v as string)} />
            </>
          )}

          {step === 2 && (
            <>
              <ChoiceChips label="Specialty" options={SPECIALTIES} value={draft.specialty} onChange={(v) => set("specialty", v as string)} />
              <ChoiceChips label="Cancer types you treat" hint="Choose all that apply." multiple options={CANCER_TYPES} value={draft.cancer_types} onChange={(v) => set("cancer_types", v as string[])} />
              <ChoiceChips label="Topics of interest" hint="Choose all that apply." multiple options={TOPICS} value={draft.topics} onChange={(v) => set("topics", v as string[])} />
            </>
          )}

          {step === 3 && (
            <>
              <ChoiceChips label="Preferred format" options={FORMATS} value={draft.preferred_format} onChange={(v) => set("preferred_format", v as string)} />
              <ChoiceChips label="Frequency" options={FREQUENCIES} value={draft.frequency} onChange={(v) => set("frequency", v as string)} />
            </>
          )}

          {step === 4 && (
            <>
              <div className="flex gap-3 rounded-xl bg-primary-soft p-5 text-sm leading-relaxed text-primary-soft-foreground">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
                <p>
                  Your doctor ID links your de-identified patient mix so we can tell you which new research applies to
                  your patients. We never store or show individual patient records. Only aggregate counts reach your
                  profile.
                </p>
              </div>
              <Field label="Doctor ID" htmlFor="doctor_id" error={errors.doctor_id_code} required>
                <Input
                  id="doctor_id"
                  placeholder="e.g. DR-1001"
                  value={draft.doctor_id_code}
                  maxLength={40}
                  onChange={(e) => {
                    set("doctor_id_code", e.target.value);
                    setNotFound(false);
                    if (draft.linked && e.target.value.trim().toUpperCase() !== doctor.doctor_id_code) {
                      setDraft((d) => ({ ...d, doctor_id_code: e.target.value, linked: false }));
                      setLinkPreview(null);
                    }
                  }}
                  className="h-11 max-w-xs uppercase placeholder:normal-case"
                />
                {notFound && (
                  <p className="text-sm text-destructive" role="alert">
                    We couldn't find that doctor ID. Check it and try again.
                  </p>
                )}
              </Field>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-3 text-sm">
                  <Checkbox checked={draft.consent} onCheckedChange={(c) => set("consent", c === true)} className="mt-0.5" />
                  <span>I consent to linking my de-identified patient mix.<span className="text-destructive"> *</span></span>
                </label>
                {errors.consent && <p className="text-sm text-destructive">{errors.consent}</p>}
              </div>

              {draft.linked && preview ? (
                <div className="rounded-xl border border-success/30 bg-success-soft p-5">
                  <p className="flex items-center gap-2 font-medium text-success">
                    <CheckCircle2 className="h-5 w-5" /> Patient mix linked for {draft.doctor_id_code}
                  </p>
                  <div className="mt-4">
                    <AggregateBars aggregates={preview} compact />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">De-identified aggregates only.</p>
                </div>
              ) : (
                <div>
                  <Button type="button" variant="outline" onClick={link} disabled={busy}>
                    <Link2 /> {busy ? "Looking up…" : "Link patient data"}
                  </Button>
                  {errors.linked && <p className="mt-2 text-sm text-destructive">{errors.linked}</p>}
                </div>
              )}
            </>
          )}

          {step === 5 && <Review draft={draft} />}
        </div>

        <div className="mt-12 flex items-center justify-between border-t pt-6">
          {editing ? (
            <Button variant="ghost" asChild>
              <Link to="/profile"><ArrowLeft /> Back to profile</Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => goStep(step - 1)} disabled={step === 1 || busy} className={cn(step === 1 && "invisible")}>
              <ArrowLeft /> Back
            </Button>
          )}
          {step === 5 && !editing ? (
            <Button size="lg" onClick={finish} disabled={busy}>
              {busy ? "Saving…" : "Finish"}
            </Button>
          ) : (
            <Button size="lg" onClick={next} disabled={busy}>
              {editing ? "Save changes" : from === "review" ? "Back to review" : "Next"}
              {!editing && <ArrowRight />}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ label, htmlFor, error, required, children }: { label: string; htmlFor: string; error?: string | undefined; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Review({ draft }: { draft: OnboardingDraft }) {
  const sections: { step: number; title: string; rows: [string, string][] }[] = [
    { step: 1, title: "About you", rows: [["Full name", draft.full_name], ["Years in practice", draft.years_in_practice], ["Practice setting", draft.practice_setting]] },
    { step: 2, title: "Your specialty", rows: [["Specialty", draft.specialty], ["Cancer types", draft.cancer_types.join(", ")], ["Topics", draft.topics.join(", ")]] },
    { step: 3, title: "Your newsletter", rows: [["Format", draft.preferred_format], ["Frequency", draft.frequency]] },
    { step: 4, title: "Patient data", rows: [["Doctor ID", draft.doctor_id_code], ["Status", draft.linked ? "Linked" : "Not linked"]] },
  ];
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <section key={s.step} className="rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <Link to="/onboarding" search={{ step: s.step, from: "review" }} className="text-sm font-medium text-primary hover:underline">
              Edit
            </Link>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
            {s.rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-foreground">{v || <span className="text-muted-foreground">—</span>}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
