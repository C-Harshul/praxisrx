import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reviewRequest } from "@/lib/msl/api";
import { CANCER_TYPES, SPECIALTIES, TOPICS } from "@/lib/msl/options";
import type {
  ReviewDirectory,
  ReviewEntry,
  ReleasePreview,
  ReviewReceipt,
  PublishReceipt,
} from "@/lib/msl/kb/review-contract";
export const Route = createFileRoute("/review")({
  ssr: false,
  head: () => ({ meta: [{ title: "Evidence review — MSL" }] }),
  component: ReviewPage,
});
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Request unconfirmed. Refresh and retry.";
const selectClass = "h-10 rounded-md border bg-background px-3 text-sm";
function ReviewPage() {
  const qc = useQueryClient(),
    directory = useQuery({
      queryKey: ["kbReview"],
      queryFn: () => reviewRequest<ReviewDirectory>("list"),
      retry: false,
    });
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [family, setFamily] = useState("all"),
    [specialty, setSpecialty] = useState("all"),
    [topic, setTopic] = useState("all");
  const [selected, setSelected] = useState<{ id: string; version: string } | null>(null),
    [note, setNote] = useState(""),
    [attested, setAttested] = useState(false),
    [setId, setSetId] = useState(""),
    [cutoff, setCutoff] = useState("2026-10-30"),
    [preview, setPreview] = useState<ReleasePreview | null>(null),
    [replace, setReplace] = useState(false);
  const decisionRetry = useRef<{ key: string; input: unknown } | null>(null),
    publishRetry = useRef<{ key: string; input: unknown } | null>(null);
  const detail = useQuery({
    queryKey: ["kbReviewDetail", selected?.id, selected?.version],
    queryFn: () => reviewRequest<ReviewEntry>("detail", selected!),
    enabled: !!selected && !!directory.data,
    retry: false,
  });
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["kbReview"] });
    await qc.invalidateQueries({ queryKey: ["kbReviewDetail"] });
    setPreview(null);
    setReplace(false);
  }
  const entry = detail.data;
  const unauthorized =
    (directory.error as (Error & { status?: number }) | null)?.status === 401 ||
    (directory.error as (Error & { status?: number }) | null)?.status === 403;
  const data = unauthorized ? undefined : directory.data;
  const filtered =
    data?.entries.filter((e) => {
      const c = e.candidate;
      return (
        (status === "all" || e.status === status) &&
        (family === "all" || c.cancer_families.includes(family as (typeof CANCER_TYPES)[number])) &&
        (specialty === "all" ||
          c.specialties.includes(specialty as (typeof SPECIALTIES)[number])) &&
        (topic === "all" || c.topics.includes(topic as (typeof TOPICS)[number])) &&
        JSON.stringify([c.title, c.id, c.study_ids, c.details, c.sources.map((s) => s.identifiers)])
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    }) ?? [];
  const activeSet = setId || data?.sets[0]?.id || "";
  async function decide(decision: "approved" | "rejected") {
    if (!entry) return;
    const key = JSON.stringify([
      entry.state_token,
      entry.candidate.id,
      entry.candidate.version,
      decision,
      note,
      attested,
    ]);
    if (decisionRetry.current?.key !== key)
      decisionRetry.current = {
        key,
        input: {
          request_id: crypto.randomUUID(),
          item_id: entry.candidate.id,
          item_version: entry.candidate.version,
          snapshot_hash: entry.snapshot_hash,
          state_token: entry.state_token,
          decision,
          note,
          human_attestation: attested,
        },
      };
    const receipt = await reviewRequest<ReviewReceipt>("review", decisionRetry.current.input);
    setNotice(
      `Decision acknowledged in Databricks: ${receipt.decision}. Approval is not publication.`,
    );
    setNote("");
    setAttested(false);
    decisionRetry.current = null;
    await refresh();
  }
  return (
    <div className="min-h-screen bg-muted/20 text-foreground">
      <header className="border-b bg-background px-6 py-5">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              MSL · Reviewer area
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Oncology evidence review</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Canonical Databricks candidates · human decisions · explicit release publication
            </p>
          </div>
          {data && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await reviewRequest("sign_out");
                  qc.removeQueries({ queryKey: ["kbReview"] });
                  qc.removeQueries({ queryKey: ["kbReviewDetail"] });
                  setSelected(null);
                  setPreview(null);
                  await directory.refetch();
                })
              }
            >
              Sign out reviewer
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-5 p-6">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive bg-background p-4 text-destructive"
          >
            {error}{" "}
            <span className="block text-sm">
              No success is assumed. An unchanged retry reuses its request identity.
            </span>
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-lg border border-primary bg-background p-4">
            {notice}
          </div>
        )}
        {directory.isPending && <p role="status">Loading canonical research candidates…</p>}
        {directory.error && !unauthorized && (
          <section role="alert" className="rounded-lg border bg-background p-6">
            <p>{message(directory.error)}</p>
            <Button className="mt-3" onClick={() => directory.refetch()}>
              Retry canonical read
            </Button>
          </section>
        )}
        {unauthorized && (
          <form
            className="mx-auto max-w-md space-y-4 rounded-xl border bg-background p-7"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await reviewRequest("sign_in", { email, password });
                setPassword("");
                await directory.refetch();
              });
            }}
          >
            <h2 className="text-lg font-semibold">Reviewer sign-in</h2>
            <p className="text-sm text-muted-foreground">
              Use the dedicated local reviewer credentials. Doctor and hospital sessions do not
              grant review access.
            </p>
            <label className="block text-sm">
              Email
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
              />
            </label>
            <Button disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in as reviewer"}
            </Button>
          </form>
        )}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {(["pending", "approved", "rejected"] as const).map((s) => (
                <div key={s} className="min-w-32 rounded-lg border bg-background px-5 py-3">
                  <span className="text-2xl font-semibold">{data.counts[s]}</span>
                  <p className="text-sm capitalize text-muted-foreground">{s}</p>
                </div>
              ))}
              <div className="ml-auto max-w-lg text-sm text-muted-foreground">
                Signed in as <strong>{data.reviewer.id}</strong>
                <br />
                Recorded approval does not mean inclusion in the active release.
              </div>
              <Button variant="outline" disabled={busy} onClick={() => action(refresh)}>
                Refresh
              </Button>
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(300px,1fr)_minmax(400px,1.35fr)]">
              <section className="space-y-4 rounded-xl border bg-background p-5">
                <h2 className="text-lg font-semibold">Research candidates</h2>
                <Input
                  aria-label="Search candidates"
                  placeholder="Search title, drug, trial or identifier"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Review status", status, setStatus, ["pending", "approved", "rejected"]],
                    ["Cancer family", family, setFamily, CANCER_TYPES],
                    ["Specialty", specialty, setSpecialty, SPECIALTIES],
                    ["Topic", topic, setTopic, TOPICS],
                  ].map(([label, value, setter, options]) => (
                    <select
                      key={label as string}
                      aria-label={label as string}
                      className={selectClass}
                      value={value as string}
                      onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                    >
                      <option value="all">All {String(label).toLowerCase()}</option>
                      {(options as readonly string[]).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
                <div className="max-h-[650px] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs uppercase text-muted-foreground">
                        <th className="py-2">Candidate / classification</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((e) => (
                        <tr key={e.candidate.id + e.candidate.version} className="border-b">
                          <td className="py-4 pr-3">
                            <button
                              className="text-left font-medium text-primary hover:underline"
                              onClick={() => {
                                setSelected({ id: e.candidate.id, version: e.candidate.version });
                                setNote("");
                                setAttested(false);
                                setNotice("");
                                setError("");
                              }}
                            >
                              {e.candidate.title}
                            </button>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {e.candidate.sources[0]?.published_date ?? "Publication date unknown"}{" "}
                              · {e.candidate.sources[0]?.source_type}
                              <br />
                              {e.candidate.cancer_families.join(", ")} ·{" "}
                              {e.candidate.specialties.join(", ")}
                              <br />
                              {e.candidate.topics.join(", ")}
                            </p>
                          </td>
                          <td className="align-top py-4">
                            <span className="capitalize">{e.status}</span>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {e.published ? "In active release" : "Not in active release"}
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filtered.length && (
                    <p className="py-6 text-muted-foreground">No candidates match these filters.</p>
                  )}
                </div>
              </section>
              <section className="space-y-5 rounded-xl border bg-background p-6">
                {!selected && (
                  <p className="text-muted-foreground">
                    Select a candidate to inspect its exact version and original sources.
                  </p>
                )}
                {detail.isFetching && selected && (
                  <p role="status">Reading candidate from Databricks…</p>
                )}
                {detail.error && <p role="alert">{message(detail.error)}</p>}
                {entry && selected && (
                  <>
                    <h2 className="text-xl font-semibold">{entry.candidate.title}</h2>
                    <p className="break-all text-xs text-muted-foreground">
                      {entry.candidate.id}
                      <br />
                      Version {entry.candidate.version}
                      <br />
                      Snapshot {entry.snapshot_hash}
                    </p>
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      Candidate version: structurally validated extraction · Recorded decision:{" "}
                      <strong>{entry.status}</strong> ·{" "}
                      {entry.published
                        ? "Included in active release"
                        : "Not included in active release"}
                    </div>
                    <h3 className="font-semibold">Original sources</h3>
                    {entry.candidate.sources.map((s) => (
                      <div key={s.id} className="text-sm">
                        <a
                          href={s.original_url?.startsWith("https://") ? s.original_url : s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline"
                        >
                          {s.title}
                        </a>
                        <p className="text-muted-foreground">
                          Published: {s.published_date ?? "Unknown"} · Presentation:{" "}
                          {s.presentation_date ?? "Unknown"}
                          <br />
                          Retrieved: {s.retrieved_at}
                          <br />
                          {s.access} · License: {s.license}
                        </p>
                      </div>
                    ))}
                    <h3 className="font-semibold">Claims and supporting passages</h3>
                    {entry.candidate.claims.map((c) => (
                      <div key={c.id} className="space-y-2 rounded-lg border p-4 text-sm">
                        <p>{c.claim_text}</p>
                        <blockquote className="border-l-2 pl-3 text-muted-foreground">
                          {c.supporting_passage}
                        </blockquote>
                        <p className="break-all text-xs">
                          {c.location} · Source {c.source_id}@{c.source_version}
                          <br />
                          Claim {c.id}@{c.version}
                        </p>
                      </div>
                    ))}
                    <h3 className="font-semibold">Population and eligibility</h3>
                    <p className="text-sm">{entry.candidate.population.inclusion}</p>
                    <p className="text-sm">
                      <strong>Exclusions:</strong> {entry.candidate.population.exclusion}
                    </p>
                    <ul className="list-disc pl-5 text-sm">
                      {entry.candidate.population.unknowns.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                    <p className="text-sm">Denominator: {entry.candidate.population.denominator}</p>
                    <h3 className="font-semibold">Uncertainty and disclosures</h3>
                    <dl className="space-y-2 text-sm">
                      {Object.entries({
                        Maturity: entry.candidate.details.maturity ?? "Unknown / unverified",
                        Flags: entry.candidate.status_flags.join("; "),
                        Funding: entry.candidate.funding,
                        Conflicts: entry.candidate.conflicts,
                        Regulatory: `${entry.candidate.regulatory.jurisdiction}, as of ${entry.candidate.regulatory.as_of}: ${entry.candidate.regulatory.status}`,
                        Classification: [
                          ...entry.candidate.cancer_families,
                          ...entry.candidate.specialties,
                          ...entry.candidate.topics,
                        ].join("; "),
                      }).map(([key, value]) => (
                        <div key={key}>
                          <dt className="font-medium">{key}</dt>
                          <dd className="text-muted-foreground">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <ul className="list-disc pl-5 text-sm">
                      {entry.candidate.limitations.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                    <details className="text-sm">
                      <summary>Structured study details (unknowns retained)</summary>
                      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-muted p-3">
                        {JSON.stringify(entry.candidate.details, null, 2)}
                      </pre>
                    </details>
                    <h3 className="font-semibold">Review history</h3>
                    {!entry.history.length ? (
                      <p className="text-sm text-muted-foreground">No recorded human decisions.</p>
                    ) : (
                      entry.history.map((r) => (
                        <div key={r.id} className="rounded border p-3 text-sm">
                          <strong>{r.decision}</strong> · {r.reviewer} · {r.reviewed_at}
                          <p>{r.note}</p>
                          <p className="break-all text-xs text-muted-foreground">
                            Reviewed version {r.item_version}
                          </p>
                        </div>
                      ))
                    )}
                    {entry.invalidations.length > 0 && (
                      <p role="alert">
                        This version has an invalidation and cannot enter a release.
                      </p>
                    )}
                    <div className="space-y-3 border-t pt-5">
                      <label className="block text-sm font-medium">
                        Review note (at least 10 characters)
                        <textarea
                          className="mt-2 min-h-24 w-full rounded border bg-background p-3 font-normal"
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          maxLength={5000}
                        />
                      </label>
                      <label className="flex gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={attested}
                          onChange={(e) => setAttested(e.target.checked)}
                        />
                        <span>
                          I personally reviewed the exact claims, passages, population, funding,
                          limitations, regulatory status and classifications shown here. Unverified
                          details remain explicitly unknown.
                        </span>
                      </label>
                      {entry.status === "rejected" && (
                        <p className="text-sm">
                          Rejection takes precedence for this version. Remediation requires a new
                          candidate version and review.
                        </p>
                      )}
                      <div className="flex gap-3">
                        <Button
                          disabled={
                            busy ||
                            !attested ||
                            note.trim().length < 10 ||
                            entry.status === "rejected"
                          }
                          onClick={() => action(() => decide("approved"))}
                        >
                          Approve exact version
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy || !attested || note.trim().length < 10}
                          onClick={() => action(() => decide("rejected"))}
                        >
                          Reject exact version
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
            <section className="space-y-4 rounded-xl border bg-background p-6">
              <h2 className="text-lg font-semibold">Release publication</h2>
              <p className="break-all text-sm">
                Current: {data.current.version} · {data.current.item_count} items ·{" "}
                {data.current.published ? "Available to matching" : "Disabled"}
              </p>
              <p className="text-sm text-muted-foreground">
                Publication replaces the complete active release with the membership shown below. It
                does not accumulate a hidden subset or run matching, generation or email.
              </p>
              <div className="flex flex-wrap gap-3">
                <select
                  aria-label="Candidate set"
                  className={`${selectClass} max-w-full`}
                  value={activeSet}
                  onChange={(e) => {
                    setSetId(e.target.value);
                    setPreview(null);
                    setReplace(false);
                  }}
                >
                  {data.sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Source cutoff"
                  type="date"
                  className="w-44"
                  value={cutoff}
                  onChange={(e) => {
                    setCutoff(e.target.value);
                    setPreview(null);
                    setReplace(false);
                  }}
                />
                <Button
                  variant="outline"
                  disabled={busy || !activeSet}
                  onClick={() =>
                    action(async () => {
                      setPreview(
                        await reviewRequest<ReleasePreview>("preview", {
                          candidate_set_id: activeSet,
                          cutoff,
                        }),
                      );
                      setReplace(false);
                      publishRetry.current = null;
                    })
                  }
                >
                  Preview complete release
                </Button>
              </div>
              {preview && (
                <div className="space-y-4">
                  <p className="break-all text-xs text-muted-foreground">
                    Candidate set version {preview.candidate_set_version} · cutoff {preview.cutoff}
                  </p>
                  <p className="font-medium">
                    Resulting membership: {preview.items.length} items · Added{" "}
                    {preview.added.length} · Removed {preview.removed.length} · Changed{" "}
                    {preview.changed.length}
                  </p>
                  <ul className="list-disc pl-5 text-sm">
                    {preview.items.map((i) => (
                      <li key={i.id}>
                        {i.title}{" "}
                        <span className="break-all text-xs text-muted-foreground">
                          ({i.id}@{i.version})
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!preview.items.length && (
                    <p className="text-sm">
                      No approved eligible items. Publishing this preview makes an empty clinical
                      release available.
                    </p>
                  )}
                  <details open={preview.removed.length > 0}>
                    <summary className="cursor-pointer text-sm">Changes and exclusions</summary>
                    <pre className="overflow-auto whitespace-pre-wrap p-3 text-xs">
                      {JSON.stringify(
                        {
                          added: preview.added,
                          removed: preview.removed,
                          changed: preview.changed,
                          excluded: preview.excluded,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  {preview.errors.map((e) => (
                    <p role="alert" key={e}>
                      {e}
                    </p>
                  ))}
                  <label className="flex gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={replace}
                      onChange={(e) => setReplace(e.target.checked)}
                    />
                    <span>
                      I confirm this complete membership replaces the active release, including the
                      removals shown above.
                    </span>
                  </label>
                  <Button
                    disabled={
                      busy || !replace || preview.errors.length > 0 || !data.reviewer.can_publish
                    }
                    onClick={() =>
                      action(async () => {
                        const key = preview.token;
                        if (publishRetry.current?.key !== key)
                          publishRetry.current = {
                            key,
                            input: {
                              request_id: crypto.randomUUID(),
                              candidate_set_id: preview.candidate_set_id,
                              cutoff: preview.cutoff,
                              preview_token: preview.token,
                              confirm_replacement: true,
                            },
                          };
                        const receipt = await reviewRequest<PublishReceipt>(
                          "publish",
                          publishRetry.current.input,
                        );
                        setNotice(
                          `Available to matching: ${receipt.release_id} · ${receipt.item_count} items · hash ${receipt.payload_hash} · acknowledged pointer ${receipt.pointer_revision}. Matching has not been invoked.`,
                        );
                        publishRetry.current = null;
                        await refresh();
                      })
                    }
                  >
                    {busy ? "Waiting for canonical acknowledgment…" : "Publish reviewed release"}
                  </Button>
                  {!data.reviewer.can_publish && (
                    <p className="text-sm">This reviewer does not have publication permission.</p>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
