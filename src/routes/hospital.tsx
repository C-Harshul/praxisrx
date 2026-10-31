import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileUp,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hospitalDirectoryQuery } from "@/lib/msl/queries";
import { signInHospital, signOutHospital, syncHospitalContext } from "@/lib/msl/api";
import { DEMO_PATIENT_MIX } from "@/lib/msl/hospital/contract";
import type { HospitalSyncInput } from "@/lib/msl/hospital/contract";
import { MAX_UPLOAD_BYTES, parsePatientUpload } from "@/lib/msl/patient-sync/contract";

export const Route = createFileRoute("/hospital")({
  ssr: false,
  head: () => ({ meta: [{ title: "Hospital portal — MSL" }] }),
  component: HospitalPortal,
});

function HospitalPortal() {
  const query = useQuery(hospitalDirectoryQuery);
  const qc = useQueryClient();
  const [code, setCode] = useState("DR-1001");
  const [tab, setTab] = useState("Patient sync");
  const [preview, setPreview] = useState<HospitalSyncInput | null>(null);
  const [error, setError] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [approved, setApproved] = useState(false);
  const [reading, setReading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const fileToken = useRef(0);
  const upload = useMutation({
    mutationFn: syncHospitalContext,
    onSuccess: async () => {
      setPreview(null);
      setApproved(false);
      await qc.invalidateQueries({ queryKey: ["hospitalDirectory"] });
    },
  });
  const login = useMutation({
    mutationFn: () => signInHospital(email, password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hospitalDirectory"] }),
  });
  const logout = useMutation({
    mutationFn: signOutHospital,
    onSuccess: () => {
      qc.clear();
      setPreview(null);
      setApproved(false);
    },
  });
  const doctor =
    query.data?.doctors.find((d) => d.doctor_id_code === code) ?? query.data?.doctors[0];
  const selectedCode = doctor?.doctor_id_code ?? "";
  const simulation = query.data?.mode === "simulation";
  const busy = upload.isPending || reading;
  function clearPreview() {
    fileToken.current++;
    setPreview(null);
    setApproved(false);
    setError("");
    upload.reset();
  }
  async function selectFile(file: File | undefined) {
    clearPreview();
    if (!file) return;
    const token = fileToken.current;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File must be 5 MB or smaller.");
      return;
    }
    const kind = file.name.toLowerCase().endsWith(".csv")
      ? "synthetic_csv"
      : file.name.toLowerCase().endsWith(".json")
        ? "aggregate_json"
        : null;
    if (!kind) {
      setError("Choose an aggregate JSON or synthetic CSV file.");
      return;
    }
    if (kind === "synthetic_csv" && !synthetic) {
      setError("Confirm the CSV contains only synthetic patients before selecting it.");
      return;
    }
    setReading(true);
    try {
      const payload = parsePatientUpload(await file.text(), kind);
      if (token !== fileToken.current) return;
      if (payload.doctor_id_code !== selectedCode)
        throw new Error("The file doctor ID must match the selected doctor.");
      if (Date.parse(payload.synced_at) > Date.now() + 300000)
        throw new Error("The export timestamp cannot be in the future.");
      setPreview({
        payload,
        sourceKind: kind,
        requestId: crypto.randomUUID(),
        expectedId: doctor?.context?.id ?? null,
      });
    } catch (e) {
      if (token === fileToken.current)
        setError(e instanceof Error ? e.message : "Could not read file.");
    } finally {
      if (token === fileToken.current) setReading(false);
    }
  }
  function loadDemo() {
    clearPreview();
    setPreview({
      payload: { ...structuredClone(DEMO_PATIENT_MIX), synced_at: new Date().toISOString() },
      sourceKind: "aggregate_json",
      requestId: crypto.randomUUID(),
      expectedId: doctor?.context?.id ?? null,
    });
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(DEMO_PATIENT_MIX, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "DR-1001_patient_mix.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="min-h-screen bg-muted/30 text-foreground lg:grid lg:grid-cols-[244px_1fr]">
      <aside className="border-b bg-background lg:fixed lg:inset-y-0 lg:w-[244px] lg:border-r">
        <div className="flex items-center gap-3 px-6 py-7">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 size={22} />
          </div>
          <div>
            <span className="text-lg font-semibold tracking-tight">MSL Connect</span>
            <p className="text-xs text-muted-foreground">Hospital workspace</p>
          </div>
        </div>
        <div className="mx-4 rounded-lg border bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium">{query.data?.hospital_name ?? "Hospital portal"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {simulation ? "EHR simulation environment" : "Hospital data operations"}
          </p>
        </div>
        <p className="px-6 pt-7 text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
          Workspace
        </p>
        <nav className="flex gap-1 p-3 lg:flex-col" aria-label="Hospital navigation">
          {[
            { label: "Overview", icon: LayoutDashboard },
            { label: "Patient sync", icon: RefreshCw },
            { label: "Sync activity", icon: Activity },
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setTab(label)}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm ${tab === label ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="hidden px-6 pt-4 lg:block">
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">
            Connected doctors
          </p>
          <p className="mt-4 flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-primary" />
            {query.data?.doctors.length ?? 0} in your directory
          </p>
        </div>
        <div className="hidden border-t p-5 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <div className="flex gap-2 text-xs text-muted-foreground">
            <ShieldCheck size={17} className="shrink-0" />
            <p>
              Aggregate context only.
              <br />
              Doctors stay in control.
            </p>
          </div>
        </div>
      </aside>
      <div className="min-w-0 lg:col-start-2">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b bg-background px-6 py-4 lg:px-10">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Hospital portal <ChevronRight size={14} />
            <span className="text-foreground">{tab}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium">
              {simulation ? "Synthetic data sandbox" : "Staff access"}
            </span>
            {query.data?.mode === "connected" && query.data.authorized && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                <LogOut size={16} />
                Sign out
              </Button>
            )}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              HC
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl space-y-7 px-5 py-8 lg:px-10 lg:py-10">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-primary">
              Hospital patient data
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {tab === "Patient sync"
                ? "Sync patient context"
                : tab === "Overview"
                  ? "Hospital overview"
                  : "Sync activity"}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Upload a patient panel, link it to a doctor, and keep their evidence-matching profile
              up to date in the background.
            </p>
          </div>
          {!simulation && query.data?.authorized && (
            <div className="rounded-xl border border-primary/20 bg-primary-soft px-5 py-4 text-sm text-primary-soft-foreground">
              <strong>Canonical destination: Databricks</strong>
              <p className="mt-1">
                Workspace 7474660613250664. Every accepted upload is published here before a new
                doctor profile is queued. If Databricks is unavailable, the upload remains
                unconfirmed.
              </p>
            </div>
          )}
          {simulation && (
            <div className="flex gap-3 rounded-xl border border-primary/20 bg-primary-soft px-5 py-4 text-sm text-primary-soft-foreground">
              <CircleHelp size={18} className="mt-0.5 shrink-0" />
              <p>
                <strong>Local simulation.</strong> No doctor login is required. Uploads update the
                simulated doctor context below; connected doctor accounts are unchanged. Demo data
                resets when this server restarts.
              </p>
            </div>
          )}
          {query.isPending && (
            <p role="status" className="flex items-center gap-2">
              <Loader2 className="animate-spin" size={18} />
              Loading hospital workspace…
            </p>
          )}
          {query.isError && (
            <div role="alert" className="rounded-xl border bg-background p-5">
              <p>{query.error.message}</p>
              <Button variant="outline" className="mt-3" onClick={() => void query.refetch()}>
                Retry connection
              </Button>
            </div>
          )}
          {query.data && !query.data.authorized && (
            <section className="max-w-md rounded-xl border bg-background p-6">
              <LockKeyhole className="text-primary" />
              <h2 className="mt-3 text-xl font-semibold">Hospital staff sign in</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Use a provisioned hospital staff account. Doctor credentials do not grant hospital
                access.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  login.mutate();
                }}
                className="mt-5 space-y-4"
              >
                <label className="block text-sm">
                  Staff email
                  <Input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="mt-2"
                  />
                </label>
                <label className="block text-sm">
                  Password
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="mt-2"
                  />
                </label>
                <Button disabled={login.isPending}>
                  {login.isPending ? "Signing in…" : "Sign in to hospital"}
                </Button>
                {login.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {login.error.message}
                  </p>
                )}
              </form>
            </section>
          )}
          {query.data?.authorized && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    label: "Connected doctors",
                    value: query.data.doctors.length,
                    icon: Stethoscope,
                  },
                  {
                    label: "Selected patient panel",
                    value: doctor?.context?.panel_size ?? "—",
                    icon: Users,
                  },
                  {
                    label: "Profile status",
                    value:
                      doctor?.profile?.status === "succeeded"
                        ? doctor.profile.confirmed
                          ? "Up to date"
                          : "Ready for review"
                        : (doctor?.profile?.status ?? "No profile"),
                    icon: Activity,
                  },
                ].map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-xl border bg-background px-5 py-5"
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-2 text-xl font-semibold capitalize">{value}</p>
                    </div>
                    <div className="rounded-lg bg-muted p-2.5 text-primary">
                      <Icon size={20} />
                    </div>
                  </div>
                ))}
              </div>
              {tab === "Patient sync" && (
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
                  <section className="overflow-hidden rounded-xl border bg-background">
                    <div className="border-b px-6 py-5">
                      <h2 className="text-lg font-semibold">Upload a patient panel</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        A new snapshot updates the selected doctor’s context.
                      </p>
                    </div>
                    <div className="space-y-5 p-6">
                      <div>
                        <label htmlFor="hospital-doctor" className="text-sm font-medium">
                          Doctor ID
                        </label>
                        <select
                          id="hospital-doctor"
                          value={selectedCode}
                          onChange={(e) => {
                            setCode(e.target.value);
                            clearPreview();
                          }}
                          disabled={busy}
                          className="mt-2 h-11 w-full rounded-lg border bg-background px-3 text-sm"
                        >
                          <option value="" disabled>
                            Select a doctor
                          </option>
                          {query.data.doctors.map((d) => (
                            <option key={d.doctor_id_code} value={d.doctor_id_code}>
                              {d.doctor_id_code} · {d.full_name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Only doctors assigned to this hospital can receive context.
                        </p>
                      </div>
                      {!doctor?.linked && (
                        <p role="alert" className="rounded-lg bg-muted p-3 text-sm">
                          {doctor
                            ? "This doctor must complete onboarding and consent to the hospital data link before syncing."
                            : "No assigned doctor selected. Ask an administrator to provision the hospital directory."}
                        </p>
                      )}
                      <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={synthetic}
                          onChange={(e) => {
                            setSynthetic(e.target.checked);
                            clearPreview();
                          }}
                          disabled={busy}
                          className="mt-1"
                        />
                        My CSV contains only synthetic patients in the supplied demo format.
                      </label>
                      <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-primary/30 bg-primary-soft/30 px-6 py-9 text-center focus-within:ring-2 focus-within:ring-primary">
                        <div className="mb-4 rounded-xl border bg-background p-3 text-primary">
                          <FileUp size={24} />
                        </div>
                        <span className="text-sm font-semibold">Choose a patient data file</span>
                        <span className="mt-2 text-xs text-muted-foreground">
                          Aggregate JSON or synthetic patient CSV · max 5 MB
                        </span>
                        <input
                          type="file"
                          aria-label="Hospital patient data file"
                          accept=".json,.csv"
                          disabled={busy || !doctor?.linked}
                          onChange={(e) => {
                            void selectFile(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                          className="mt-5 max-w-full text-xs"
                        />
                      </label>
                      <div className="flex flex-wrap justify-between gap-3">
                        <button
                          onClick={downloadTemplate}
                          className="flex items-center gap-1.5 text-xs font-medium text-primary"
                        >
                          <ArrowDownToLine size={14} />
                          Download JSON template
                        </button>
                        {simulation && (
                          <button
                            onClick={loadDemo}
                            disabled={busy || !doctor?.linked}
                            className="text-xs font-medium text-primary disabled:opacity-50"
                          >
                            Use demo patient panel <span aria-hidden>↗</span>
                          </button>
                        )}
                      </div>
                      {reading && (
                        <p role="status" className="text-sm">
                          Aggregating patient panel in your browser…
                        </p>
                      )}
                      {error && (
                        <p role="alert" className="text-sm text-destructive">
                          {error}
                        </p>
                      )}
                      {preview && (
                        <div className="rounded-xl border p-4">
                          <div className="flex justify-between gap-3">
                            <div>
                              <h3 className="font-semibold">Ready to sync</h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {preview.payload.panel_size} patients ·{" "}
                                {Object.keys(preview.payload.aggregates).length} cohort categories ·{" "}
                                {preview.payload.doctor_id_code}
                              </p>
                            </div>
                            <ShieldCheck className="shrink-0 text-primary" size={20} />
                          </div>
                          <dl className="mt-4 grid gap-x-5 sm:grid-cols-2">
                            {Object.entries(preview.payload.aggregates).map(([label, value]) => (
                              <div
                                key={label}
                                className="flex justify-between gap-2 border-t py-2 text-xs"
                              >
                                <dt>{label}</dt>
                                <dd className="shrink-0 font-medium">
                                  {value === null ? "Suppressed / unknown" : `${value}%`}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          <p className="mt-3 text-xs text-muted-foreground">
                            Cohorts overlap. Percentages describe the active panel, not exact
                            evidence eligibility.
                          </p>
                          <label className="mt-4 flex items-start gap-2 text-xs leading-5">
                            <input
                              type="checkbox"
                              checked={approved}
                              onChange={(e) => setApproved(e.target.checked)}
                              disabled={busy}
                              className="mt-1"
                            />
                            I have reviewed this panel and authorize syncing these aggregates to the
                            selected doctor.
                          </label>
                          <Button
                            className="mt-4 w-full"
                            onClick={() => upload.mutate(preview)}
                            disabled={!approved || busy}
                          >
                            <RefreshCw
                              size={16}
                              className={upload.isPending ? "animate-spin" : ""}
                            />
                            {upload.isPending
                              ? "Syncing patient context…"
                              : simulation
                                ? "Sync to doctor profile"
                                : "Publish to Databricks"}
                          </Button>
                        </div>
                      )}
                      {upload.isError && (
                        <p role="alert" className="text-sm text-destructive">
                          {upload.error.message}
                        </p>
                      )}
                      {upload.isSuccess && (
                        <div
                          role="status"
                          className="flex gap-2 rounded-lg bg-primary-soft p-4 text-sm text-primary"
                        >
                          <Check className="shrink-0" size={18} />
                          <p>
                            {simulation
                              ? `Snapshot ${upload.data.version} saved. The simulated profile is updating in the background.`
                              : `Snapshot ${upload.data.version} published to Databricks workspace 7474660613250664. A fresh doctor profile is queued for background processing.`}
                            {!simulation && upload.data.canonical_revision && (
                              <span className="mt-2 block break-all text-xs">
                                Publication revision: {upload.data.canonical_revision}
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                  <div className="space-y-6">
                    <section className="rounded-xl border bg-background p-6">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Receiving doctor
                      </p>
                      <div className="mt-4 flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary">
                          {doctor?.full_name
                            .split(" ")
                            .slice(-2)
                            .map((w) => w[0])
                            .join("") ?? "—"}
                        </div>
                        <div>
                          <h2 className="font-semibold">
                            {doctor?.full_name ?? "Select a doctor"}
                          </h2>
                          <p className="mt-1 text-xs text-muted-foreground">{doctor?.specialty}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex justify-between border-t pt-4 text-sm">
                        <span className="text-muted-foreground">Doctor ID</span>
                        <span className="font-medium">{doctor?.doctor_id_code ?? "—"}</span>
                      </div>
                      <div className="mt-3 flex justify-between text-sm">
                        <span className="text-muted-foreground">Patient-data consent</span>
                        <span className={doctor?.linked ? "text-primary" : "text-muted-foreground"}>
                          {doctor?.linked ? "Linked and active" : "Not linked"}
                        </span>
                      </div>
                    </section>
                    <section className="rounded-xl border bg-background p-6">
                      <h2 className="font-semibold">What happens after a sync?</h2>
                      <ol className="mt-5 space-y-5">
                        {[
                          simulation
                            ? "Validate and save aggregate context"
                            : "Publish aggregate context to Databricks",
                          "Prepare a new doctor profile version",
                          "Doctor reviews the updated profile",
                          "Matching uses the current context",
                        ].map((text, i) => (
                          <li key={text} className="flex items-center gap-3 text-sm">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-primary">
                              {i + 1}
                            </span>
                            {text}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">
                        Individual CSV rows are processed in your browser. Only de-identified
                        aggregates reach the profile system.
                      </p>
                    </section>
                  </div>
                </div>
              )}
              {tab === "Overview" && (
                <section className="rounded-xl border bg-background p-6">
                  <h2 className="text-lg font-semibold">Hospital doctor directory</h2>
                  <div className="mt-5 divide-y">
                    {query.data.doctors.map((d) => (
                      <button
                        key={d.doctor_id_code}
                        onClick={() => {
                          setCode(d.doctor_id_code);
                          setTab("Patient sync");
                          clearPreview();
                        }}
                        className="flex w-full flex-wrap items-center justify-between gap-3 py-4 text-left"
                      >
                        <div>
                          <p className="font-medium">{d.full_name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {d.doctor_id_code} · {d.specialty}
                          </p>
                        </div>
                        <span className="flex items-center gap-2 text-sm text-primary">
                          Open patient sync <ArrowRight size={16} />
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {tab === "Sync activity" && (
                <section className="rounded-xl border bg-background p-6">
                  <h2 className="text-lg font-semibold">Recent hospital uploads</h2>
                  {query.data.doctors.every((d) => d.history.length === 0) ? (
                    <p className="mt-5 text-sm text-muted-foreground">
                      No hospital uploads yet. Choose a patient panel to start.
                    </p>
                  ) : (
                    <div className="mt-5 overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="pb-3">Doctor</th>
                            <th>Snapshot</th>
                            <th>Patients</th>
                            <th>Received</th>
                          </tr>
                        </thead>
                        <tbody>
                          {query.data.doctors.flatMap((d) =>
                            d.history.map((s) => (
                              <tr key={s.id} className="border-b">
                                <td className="py-4">{d.doctor_id_code}</td>
                                <td>v{s.version}</td>
                                <td>{s.panel_size}</td>
                                <td className="text-xs">
                                  {new Date(s.created_at).toLocaleString()}
                                </td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
              {doctor && (
                <section className="rounded-xl border bg-background p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-primary">
                        {simulation ? "Simulated matching context" : "Background profile status"}
                      </p>
                      <h2 className="mt-2 text-lg font-semibold">
                        {doctor.full_name} · Profile v{doctor.profile?.version ?? "—"}
                      </h2>
                    </div>
                    <span
                      role="status"
                      className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs"
                    >
                      <Clock3 size={14} />
                      {doctor.profile?.status === "succeeded"
                        ? doctor.profile.confirmed
                          ? "Current profile"
                          : "Updated · awaiting doctor review"
                        : (doctor.profile?.status ?? "Not prepared")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {simulation
                      ? "This sandbox updates a synthetic doctor profile to demonstrate the background workflow. It does not call a model or publish live Databricks data."
                      : "The profiler runs independently. Hospital staff cannot confirm a profile on the doctor’s behalf."}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {Object.entries(doctor.context?.aggregates ?? {}).map(([label, value]) => (
                      <span
                        key={label}
                        className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                      >
                        {label}{" "}
                        <strong className="ml-1">{value === null ? "Unknown" : `${value}%`}</strong>
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
