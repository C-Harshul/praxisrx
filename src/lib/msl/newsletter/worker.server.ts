import { randomUUID } from "node:crypto";
import { listRecords, readRecord } from "../platform/store.server";
import type { DoctorState } from "../platform/types";
import { stable } from "../kb/core";
import { currentMatchingInput } from "../matching/handoff";
import { generationContext, newsletterStillValid } from "./context.server";
import { generateNewsletterDraft, NEWSLETTER_MODEL } from "./databricks.server";
import { renderEvidence, GATE_VERSION, PROMPT_VERSION } from "./content";
import { generation, delivery, changeDoctor, hash, stableId } from "./state.server";
import {
  recipientFor,
  recipientMatches,
  sendConfigured,
  emailOrigin,
} from "../delivery/config.server";
import { unsubscribeToken } from "../delivery/subscription.server";
import { renderEmail } from "../delivery/render";
import { emailContent } from "./publication";
import type { PublishedNewsletter } from "./types";
import { validateFrozenNewsletter } from "./frozen";

const LEASE = 5 * 60_000;
export async function runNewsletterJob() {
  const records = await listRecords<DoctorState>("doctor");
  const candidate = records.find(({ state }) => {
    const jobs = state.newsletter_jobs?.jobs ?? [];
    if (jobs.some((j) => j.status === "processing" && j.lease_until > Date.now())) return false;
    return (
      jobs.some(
        (j) =>
          (j.status === "retry" && j.next_attempt_at <= Date.now()) ||
          (j.status === "processing" && j.lease_until <= Date.now()),
      ) ||
      jobs.some(
        (j) =>
          j.status === "preview" &&
          sendConfigured(recipientFor(state.doctor.id)) &&
          recipientMatches(state, recipientFor(state.doctor.id)),
      ) ||
      state.matching_runs.some(
        (r) => r.evidence_package && !jobs.some((j) => j.matching_run_id === r.id),
      )
    );
  });
  if (!candidate) return { status: "idle" };
  const existing = candidate.state.newsletter_jobs?.jobs.find(
    (j) =>
      (["retry", "processing"].includes(j.status) ||
        (j.status === "preview" &&
          sendConfigured(recipientFor(candidate.id)) &&
          recipientMatches(candidate.state, recipientFor(candidate.id)))) &&
      j.next_attempt_at <= Date.now(),
  );
  const runId =
    existing?.matching_run_id ??
    candidate.state.matching_runs.find(
      (r) =>
        r.evidence_package &&
        !candidate.state.newsletter_jobs?.jobs.some((j) => j.matching_run_id === r.id),
    )!.id;
  const context = await generationContext(candidate.id, runId);
  const jobId = stableId(`generation:${candidate.id}:${runId}`);
  const lease = randomUUID();
  const inputHash = context ? hash(context.evidence_package) : "stale";
  const claimed = await changeDoctor(candidate.id, "newsletter_claim", (state) => {
    const jobs = generation(state).jobs;
    if (jobs.some((j) => j.status === "processing" && j.lease_until > Date.now())) return false;
    let job = jobs.find((j) => j.id === jobId);
    if (!job) {
      job = {
        id: jobId,
        matching_run_id: runId,
        newsletter_id: stableId(`newsletter:${jobId}`),
        status: "queued",
        attempts: 0,
        lease: null,
        lease_until: 0,
        next_attempt_at: 0,
        created_at: new Date().toISOString(),
        completed_at: null,
        error: null,
        input_hash: inputHash,
        provenance: {
          model_endpoint: NEWSLETTER_MODEL,
          prompt_version: PROMPT_VERSION,
          schema_version: "newsletter-selection.v1",
          gate_version: GATE_VERSION,
          hosting: null,
        },
      };
      jobs.push(job);
    }
    if (!["queued", "retry", "processing", "preview"].includes(job.status)) return false;
    if (
      !context ||
      job.input_hash !== inputHash ||
      stable(currentMatchingInput(state)) !== stable(context.evidence_package.input)
    ) {
      job.status = "superseded";
      return false;
    }
    if (!context.evidence_package.result.matches.length) {
      job.status = "empty";
      job.completed_at = new Date().toISOString();
      return false;
    }
    if (!job.result && job.attempts >= 3) {
      job.status = "failed";
      job.error = "draft_attempts_exhausted";
      return false;
    }
    job.status = "processing";
    if (!job.result) job.attempts++;
    job.lease = lease;
    job.lease_until = Date.now() + LEASE;
    return true;
  });
  if (!claimed)
    return { status: context?.evidence_package.result.matches.length === 0 ? "empty" : "deferred" };
  try {
    const generated = existing?.result
      ? null
      : await generateNewsletterDraft(context!.evidence_package, fetch, async (hosting) => {
          await changeDoctor(candidate.id, "newsletter_hosting_verified", (state) => {
            const job = generation(state).jobs.find((j) => j.id === jobId)!;
            if (job.status !== "processing" || job.lease !== lease || job.lease_until < Date.now())
              throw new Error("newsletter_inputs_superseded");
            job.provenance = {
              model_endpoint: NEWSLETTER_MODEL,
              prompt_version: PROMPT_VERSION,
              schema_version: "newsletter-selection.v1",
              gate_version: GATE_VERSION,
              hosting,
            };
          });
        });
    const rendered = generated ? renderEvidence(generated.draft, context!.evidence_package) : [];
    const now = new Date().toISOString();
    const newsletterId = stableId(`newsletter:${jobId}`);
    const newsletter: PublishedNewsletter = existing?.result
      ? structuredClone(existing.result)
      : {
          id: newsletterId,
          doctor: candidate.id,
          sent_at: now,
          title: "Your reviewed evidence briefing",
          summary: `${rendered.length} reviewed research ${rendered.length === 1 ? "report" : "reports"} selected for your stated interests. Open each article for the cited findings and uncertainties.`,
          articles: rendered.map((a, position) => {
            const article = stableId(`article:${newsletterId}:${a.item_id}`);
            return {
              ...a,
              id: article,
              newsletter: newsletterId,
              kb_item_id: a.item_id,
              position,
              citations: a.citations.map((c) => ({
                ...c,
                claim_version: context!.pointer.state.manifest.membership
                  .find((m) => m.id === a.item_id)!
                  .claim_versions.find((v) => v.id === c.claim_id)!.version,
                source_version: context!.pointer.state.manifest.membership
                  .find((m) => m.id === a.item_id)!
                  .source_versions.find((v) => v.id === c.source_id)!.version,
                id: stableId(`citation:${article}:${c.number}`),
                article,
              })),
            };
          }),
          provenance: {
            schema_version: "newsletter.v1",
            gate_version: GATE_VERSION,
            prompt_version: PROMPT_VERSION,
            input_hash: inputHash,
            matching_run_id: runId,
            kb_revision: context!.evidence_package.kb_pointer_revision,
            release_version: context!.release_version,
            profile_id: context!.evidence_package.input.profile.id,
            patient_mix_id: candidate.state.matching_runs.find((r) => r.id === runId)!
              .patient_mix_id,
            hosting: generated!.hosting,
            usage: generated!.usage,
            latency_ms: generated!.latency_ms,
            review_provenance: context!.pointer.state.manifest.membership.filter((m) =>
              rendered.some((a) => a.item_id === m.id),
            ),
          },
        };
    // Re-read canonical evidence, consent/profile and item suppression after inference.
    const current = await generationContext(candidate.id, runId);
    if (!current) throw new Error("newsletter_inputs_superseded");
    validateFrozenNewsletter(newsletter, current.evidence_package);
    const recipient = recipientFor(candidate.id);
    const live = sendConfigured(recipient);
    const origin = emailOrigin();
    const unsubscribeUrl = live
      ? `${origin}/api/email/unsubscribe?token=${unsubscribeToken(candidate.id, recipient!, Date.parse(now))}`
      : `${origin}/library`;
    const preview = renderEmail(emailContent(newsletter, origin, unsubscribeUrl), !live);
    const status = await changeDoctor(candidate.id, "newsletter_completed", (state) => {
      const job = generation(state).jobs.find((j) => j.id === jobId)!;
      if (job.status !== "processing" || job.lease !== lease || job.lease_until < Date.now())
        return "superseded";
      if (stable(currentMatchingInput(state)) !== stable(current.evidence_package.input)) {
        job.status = "superseded";
        return "superseded";
      }
      job.result = newsletter;
      job.completed_at = now;
      job.error = null;
      const mail = delivery(state);
      const recipientId = recipient?.id ?? "preview";
      const key = hash([newsletterId, recipientId, "email"]);
      if (live && recipientMatches(state, recipient)) {
        newsletter.publication = { status: "published", published_at: now, matching_run_id: runId };
        if (!state.newsletters.some((n) => n.id === newsletterId))
          state.newsletters.push(newsletter);
        job.status = "published";
        delete job.result;
      } else job.status = "preview";
      const priorPreview = mail.tasks.findIndex((t) => t.id === key && t.status === "preview");
      if (priorPreview >= 0 && job.status === "published") mail.tasks.splice(priorPreview, 1);
      if (!mail.tasks.some((t) => t.id === key))
        mail.tasks.push({
          recipient_fingerprint: hash([recipient?.id, recipient?.version, recipient?.email]),
          sender_fingerprint: hash(process.env["GMAIL_SENDER"]?.toLowerCase()),
          id: key,
          newsletter_id: newsletterId,
          generation_id: jobId,
          recipient_id: recipientId,
          recipient_version: recipient?.version ?? "preview",
          idempotency_key: key,
          message_id: `<msl-${key}@${new URL(origin).hostname}>`,
          status:
            job.status === "published"
              ? mail.subscription.status === "subscribed"
                ? "queued"
                : "cancelled"
              : "preview",
          attempts: [],
          lease: null,
          lease_until: 0,
          next_attempt_at: 0,
          created_at: Date.parse(now),
          provider_id: null,
          error:
            job.status === "published" && mail.subscription.status !== "subscribed"
              ? "unsubscribed_or_suppressed"
              : null,
          render:
            job.status === "published"
              ? preview
              : renderEmail(emailContent(newsletter, origin, unsubscribeUrl), true),
          render_hash: hash(
            job.status === "published"
              ? preview
              : renderEmail(emailContent(newsletter, origin, unsubscribeUrl), true),
          ),
          reconciliation_count: 0,
          events: [],
        });
      return job.status;
    });
    // KB is a separate record: any changed pointer fences sending, without claiming distributed atomicity.
    const after = await readRecord<DoctorState>("doctor", candidate.id);
    if (status === "published" && after && !(await newsletterStillValid(after.state, newsletter)))
      await changeDoctor(candidate.id, "newsletter_publication_held", (state) => {
        const task = delivery(state).tasks.find((t) => t.newsletter_id === newsletterId);
        if (task?.status === "queued") {
          task.status = "held";
          task.error = "evidence_or_consent_changed";
        }
      });
    return { status };
  } catch (error) {
    const safe =
      error instanceof Error && error.message.startsWith("newsletter_frozen_")
        ? "newsletter_inputs_superseded"
        : error instanceof Error &&
            [
              "newsletter_inputs_superseded",
              "model_hosting_unverified",
              "newsletter_disclosure_claim_missing",
            ].includes(error.message)
          ? error.message
          : "newsletter_generation_or_publication_failed";
    await changeDoctor(candidate.id, "newsletter_attempt_failed", (state) => {
      const job = generation(state).jobs.find((j) => j.id === jobId)!;
      if (job.status !== "processing" || job.lease !== lease) return;
      job.status =
        safe === "newsletter_inputs_superseded"
          ? "superseded"
          : job.attempts >= 3
            ? "failed"
            : "retry";
      job.error = safe;
      job.next_attempt_at = Date.now() + 60_000 * job.attempts;
    });
    return { status: "deferred" };
  }
}
