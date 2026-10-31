import { z } from "zod";
import { requireSession } from "../platform/auth.server";
import {
  buildRelease,
  hash,
  validateCandidate,
  reviewSchema,
  invalidationSchema,
  stable,
} from "./core";
import type { Candidate, Review, Invalidation } from "./core";
import { evidenceReleaseSchema } from "../matching/contract";
import {
  KBError,
  readRecords,
  readPointer,
  insertRecords,
  commitPointer,
  withKBWrite,
} from "./store.server";
import type { Pointer, RecordValue } from "./store.server";
import type {
  ReleasePreview,
  ReviewDirectory,
  ReviewEntry,
  ReviewReceipt,
  PublishReceipt,
} from "./review-contract";
const sha = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().min(1).max(200);
const registrySchema = z.array(
  z.object({ account_id: z.string().uuid(), reviewer_id: id, can_publish: z.boolean() }).strict(),
);
export function reviewerRegistry() {
  const registry = registrySchema.parse(
    JSON.parse(process.env["KB_REVIEWER_REGISTRY_JSON"] ?? "[]"),
  );
  if (
    new Set(registry.map((r) => r.account_id)).size !== registry.length ||
    new Set(registry.map((r) => r.reviewer_id)).size !== registry.length
  )
    throw new KBError("Reviewer registry contains duplicates.", 503);
  return registry;
}
export const authorizedReviewers = () =>
  (process.env["KB_AUTHORIZED_REVIEWERS"] ?? "").split(",").filter(Boolean);
export function requireReviewer(request: Request, publish = false) {
  const session = requireSession(request, "reviewer");
  const registered = reviewerRegistry().find(
    (r) => r.account_id === session.id && authorizedReviewers().includes(r.reviewer_id),
  );
  if (!registered || (publish && !registered.can_publish))
    throw new KBError("Reviewer permission required.", 403);
  return registered;
}
const relevantKinds = new Set([
  "evidence_item",
  "document",
  "claim",
  "review",
  "invalidation",
  "candidate_set",
]);
export function fingerprint(rows: RecordValue[], p: Pointer) {
  return hash({
    records: rows.filter((r) => relevantKinds.has(r.kind)),
    pointer_revision: p.revision,
    reviewers: authorizedReviewers().sort(),
  });
}
function payloads(rows: RecordValue[], kind: string) {
  return rows.filter((r) => r.kind === kind).map((r) => r.payload);
}
function parsed(rows: RecordValue[], p: Pointer) {
  const candidates = payloads(rows, "evidence_item").map(validateCandidate);
  const reviews = payloads(rows, "review").map((r) => reviewSchema.parse(r));
  const invalidations = [
    ...payloads(rows, "invalidation").map((i) => invalidationSchema.parse(i)),
    ...(p.state.invalidations ?? []),
  ];
  for (const c of candidates) {
    for (const s of c.sources)
      if (
        !rows.some(
          (r) =>
            r.kind === "document" &&
            r.id === s.id &&
            r.version === s.version &&
            hash(r.payload) === hash(s),
        )
      )
        throw new KBError("Canonical source version is missing or inconsistent.", 503);
    for (const claim of c.claims)
      if (
        !rows.some(
          (r) =>
            r.kind === "claim" &&
            r.id === claim.id &&
            r.version === claim.version &&
            hash(r.payload) === hash(claim),
        )
      )
        throw new KBError("Canonical claim version is missing or inconsistent.", 503);
  }
  return { candidates, reviews, invalidations };
}
export async function snapshot() {
  const before = await readPointer();
  if (!before) throw new KBError("Canonical release pointer is unavailable.", 503);
  const rows = await readRecords(),
    after = await readPointer();
  if (before.state.manifest?.payload_hash !== hash(before.state.payload))
    throw new KBError("Canonical release hash failed.", 503);
  if (after?.revision !== before.revision) throw new KBError("KB changed during read. Refresh.");
  return { rows, p: before };
}
const setSchema = z.object({ members: z.array(z.object({ id, version: sha }).strict()) }).strict();
function sets(rows: RecordValue[]) {
  return rows
    .filter((r) => r.kind === "candidate_set")
    .map((r) => {
      const value = setSchema.parse(r.payload);
      if (hash(value) !== r.version || r.id !== `candidate-set-${r.version}`)
        throw new KBError("Candidate-set integrity failed.", 503);
      if (new Set(value.members.map((m) => m.id)).size !== value.members.length)
        throw new KBError("Ambiguous candidate set.", 503);
      return { ...r, value };
    });
}
function entry(
  c: Candidate,
  rows: RecordValue[],
  p: Pointer,
  rs: Review[],
  inv: Invalidation[],
): ReviewEntry {
  const history = rs
    .filter((r) => r.item_id === c.id)
    .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at) || a.id.localeCompare(b.id));
  const exact = history.filter((r) => r.item_version === c.version);
  const status = exact.some((r) => r.decision === "rejected")
    ? "rejected"
    : exact.some(
          (r) =>
            r.decision === "approved" &&
            r.snapshot_hash === hash(c) &&
            authorizedReviewers().includes(r.reviewer),
        )
      ? "approved"
      : "pending";
  const current = evidenceReleaseSchema.parse(p.state.payload);
  return {
    candidate: c,
    snapshot_hash: hash(c),
    state_token: fingerprint(rows, p),
    status,
    history,
    published:
      p.state.published && current.items.some((i) => i.id === c.id && i.version === c.version),
    invalidations: inv.filter(
      (i) => i.item_id === c.id && (!i.item_version || i.item_version === c.version),
    ),
  };
}
export async function listReview(request: Request): Promise<ReviewDirectory> {
  const reviewer = requireReviewer(request),
    { rows, p } = await snapshot(),
    { candidates, reviews, invalidations } = parsed(rows, p);
  const entries = candidates.map((c) => entry(c, rows, p, reviews, invalidations));
  return {
    entries,
    sets: sets(rows).map((s) => ({ id: s.id, version: s.version })),
    counts: {
      pending: entries.filter((e) => e.status === "pending").length,
      approved: entries.filter((e) => e.status === "approved").length,
      rejected: entries.filter((e) => e.status === "rejected").length,
    },
    reviewer: { id: reviewer.reviewer_id, can_publish: reviewer.can_publish },
    current: {
      version: p.state.version,
      revision: p.revision,
      published: p.state.published,
      item_count: evidenceReleaseSchema.parse(p.state.payload).items.length,
    },
  };
}
export async function detailReview(request: Request, itemId: string, version: string) {
  const directory = await listReview(request);
  const found = directory.entries.find(
    (e) => e.candidate.id === itemId && e.candidate.version === version,
  );
  if (!found) throw new KBError("Candidate version not found.", 404);
  return found;
}
export const decisionInput = z
  .object({
    request_id: z.string().uuid(),
    item_id: id,
    item_version: sha,
    snapshot_hash: sha,
    state_token: sha,
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().min(10).max(5000),
    human_attestation: z.literal(true),
  })
  .strict();
export type DecisionInput = z.infer<typeof decisionInput>;
function decisionRequestHash(input: DecisionInput, actor: string) {
  const { state_token, ...intent } = input;
  return hash({ ...intent, actor });
}
function recoverReview(
  rows: RecordValue[],
  input: DecisionInput,
  actor: string,
): ReviewReceipt | null {
  const found = rows.filter((r) => r.kind === "review" && r.id === `review-${input.request_id}`);
  if (!found.length) return null;
  if (found.length !== 1) throw new KBError("Duplicate review request identities.", 503);
  const r = reviewSchema.parse(found[0]!.payload),
    audit = rows.find((r) => r.kind === "audit" && r.id === `review-audit-${input.request_id}`);
  const expected = decisionRequestHash(input, actor);
  if (
    !audit ||
    z.object({ request_hash: sha }).passthrough().parse(audit.payload).request_hash !== expected ||
    r.reviewer !== actor
  )
    throw new KBError("Request identity was reused with different review content.");
  return {
    status: "recorded",
    review_id: r.id,
    item_id: r.item_id,
    item_version: r.item_version,
    decision: r.decision,
    published: false,
  };
}
/** Shared CLI/UI trusted operation; browser callers must go through requireReviewer above. */
function assertActor(actor: string, publish = false) {
  if (
    !authorizedReviewers().includes(actor) ||
    !reviewerRegistry().some((r) => r.reviewer_id === actor && (!publish || r.can_publish))
  )
    throw new KBError("Reviewer permission required.", 403);
}
export async function saveDecision(actor: string, raw: unknown): Promise<ReviewReceipt> {
  assertActor(actor);
  const input = decisionInput.parse(raw),
    existing = recoverReview(await readRecords(), input, actor);
  if (existing) return existing;
  return withKBWrite(async (locked, original) => {
    const rows = await readRecords(),
      recovered = recoverReview(rows, input, actor);
    if (recovered) return recovered;
    if (fingerprint(rows, original) !== input.state_token)
      throw new KBError("Review snapshot changed. Refresh before saving.");
    const { candidates, reviews } = parsed(rows, original),
      c = candidates.find((c) => c.id === input.item_id && c.version === input.item_version);
    if (!c || hash(c) !== input.snapshot_hash)
      throw new KBError("Candidate snapshot changed. Refresh before saving.");
    if (
      input.decision === "approved" &&
      reviews.some(
        (r) => r.item_id === c.id && r.item_version === c.version && r.decision === "rejected",
      )
    )
      throw new KBError("Rejected versions require remediation in a new candidate version.");
    const r = reviewSchema.parse({
      id: `review-${input.request_id}`,
      item_id: c.id,
      item_version: c.version,
      decision: input.decision,
      reviewer: actor,
      reviewed_at: new Date().toISOString(),
      human_attestation: input.human_attestation,
      scope: "claims-population-funding-limitations-regulatory-classification",
      note: input.note,
      snapshot_hash: hash(c),
    });
    const audit = {
      id: `review-audit-${input.request_id}`,
      action: "kb_review_recorded",
      actor,
      at: r.reviewed_at,
      request_hash: decisionRequestHash(input, actor),
      review: r,
      source_versions: c.sources.map((s) => ({
        id: s.id,
        version: s.version,
        content_hash: s.source_hash,
      })),
      claim_versions: c.claims.map((c) => ({ id: c.id, version: c.version })),
    };
    await insertRecords(
      [
        { kind: "review", id: r.id, version: hash(r), payload: r },
        { kind: "audit", id: audit.id, version: hash(audit), payload: audit },
      ],
      locked,
    );
    await commitPointer(
      {
        ...locked.state,
        kb_write_lock: null,
        audit: [
          ...locked.state.audit,
          { id: audit.id, action: audit.action, review_id: r.id, at: r.reviewed_at },
        ],
      },
      locked,
    );
    return {
      status: "recorded",
      review_id: r.id,
      item_id: c.id,
      item_version: c.version,
      decision: r.decision,
      published: false,
    };
  });
}
export async function saveReview(request: Request, raw: unknown) {
  const actor = requireReviewer(request);
  return saveDecision(actor.reviewer_id, raw);
}
export const previewInput = z
  .object({ candidate_set_id: id, cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();
export type PreviewInput = z.infer<typeof previewInput>;
export function assemblePreview(rows: RecordValue[], p: Pointer, raw: unknown) {
  const input = previewInput.parse(raw),
    { candidates, reviews, invalidations } = parsed(rows, p);
  const selected = sets(rows).find((s) => s.id === input.candidate_set_id);
  if (!selected) throw new KBError("Select a canonical candidate set.", 400);
  const cs = selected.value.members.map((m) => {
    const found = candidates.filter((c) => c.id === m.id && c.version === m.version);
    if (found.length !== 1)
      throw new KBError("Candidate set has a missing or ambiguous version.", 503);
    return found[0]!;
  });
  const excluded: { id: string; reason: string }[] = [],
    errors: string[] = [],
    eligible: Candidate[] = [];
  for (const c of cs) {
    const e = entry(c, rows, p, reviews, invalidations);
    const reason = c.synthetic
      ? "Synthetic fixtures are excluded"
      : e.invalidations.length
        ? "Evidence invalidated"
        : e.status === "rejected"
          ? "Rejected version; remediation needs a new version"
          : e.status !== "approved"
            ? "No authorized approval for this snapshot"
            : c.cancer_families.length !== 1
              ? "Multi-family evidence blocked by v1"
              : c.sources.some((s) => s.published_date && s.published_date > input.cutoff)
                ? "Source published after cutoff"
                : null;
    if (reason) excluded.push({ id: c.id, reason });
    else eligible.push(c);
  }
  let release: ReturnType<typeof buildRelease>;
  try {
    release = buildRelease(eligible, reviews, invalidations, authorizedReviewers(), input.cutoff);
  } catch {
    errors.push("Release validation failed. Resolve source/review conflicts before publication.");
    release = buildRelease([], [], [], [], input.cutoff);
  }
  const current = evidenceReleaseSchema.parse(p.state.payload),
    items = release.payload.items.map(({ id, version, title }) => ({ id, version, title }));
  const newIds = new Set(items.map((i) => i.id)),
    oldIds = new Set(current.items.map((i) => i.id));
  const added = items.filter((i) => !oldIds.has(i.id)).map((i) => i.id),
    removed = current.items.filter((i) => !newIds.has(i.id)).map((i) => i.id),
    changed = items
      .filter((i) => current.items.some((old) => old.id === i.id && old.version !== i.version))
      .map((i) => i.id);
  for (const id of removed)
    if (!excluded.some((e) => e.id === id))
      excluded.push({ id, reason: "Not in selected candidate set; replacement removes this item" });
  const preview: ReleasePreview = {
    candidate_set_id: selected.id,
    candidate_set_version: selected.version,
    cutoff: input.cutoff,
    token: hash({ state: fingerprint(rows, p), input, membership: release.manifest, errors }),
    current: {
      version: p.state.version,
      revision: p.revision,
      published: p.state.published,
      item_count: current.items.length,
    },
    items,
    added,
    removed,
    changed,
    excluded,
    errors,
    replacement: true,
  };
  return { preview, release };
}
export async function previewRelease(request: Request, raw: unknown) {
  requireReviewer(request);
  const { rows, p } = await snapshot();
  return assemblePreview(rows, p, raw).preview;
}
export const publishInput = previewInput
  .extend({
    request_id: z.string().uuid(),
    preview_token: sha,
    confirm_replacement: z.literal(true),
  })
  .strict();
export async function publishCanonical(actor: string, raw: unknown): Promise<PublishReceipt> {
  assertActor(actor, true);
  const input = publishInput.parse(raw),
    requestHash = hash({ ...input, actor }),
    eventId = `publish-${input.request_id}`;
  const recover = (p: Pointer): PublishReceipt | null => {
    const event = p.state.audit.find(
      (e) => typeof e === "object" && e !== null && "id" in e && e.id === eventId,
    );
    if (!event) return null;
    const parsed = z
      .object({ request_hash: sha, release_id: id, payload_hash: sha, item_count: z.number() })
      .passthrough()
      .parse(event);
    if (parsed.request_hash !== requestHash)
      throw new KBError("Publication request identity reused with different content.");
    if (hash(p.state.payload) !== parsed.payload_hash)
      throw new KBError("Publication hash mismatch.", 503);
    if (p.state.version !== parsed.release_id || !p.state.published)
      throw new KBError("This publication was superseded or disabled. Refresh.");
    return {
      status: "available_to_matching",
      release_id: parsed.release_id,
      payload_hash: parsed.payload_hash,
      pointer_revision: p.revision,
      item_count: parsed.item_count,
    };
  };
  const p = await readPointer();
  if (p) {
    const recovered = recover(p);
    if (recovered) return recovered;
  }
  return withKBWrite(async (locked, original) => {
    const recovered = recover(original);
    if (recovered) return recovered;
    const rows = await readRecords(),
      { preview, release } = assemblePreview(rows, original, {
        candidate_set_id: input.candidate_set_id,
        cutoff: input.cutoff,
      });
    const priorPreparation = rows.filter((r) => r.kind === "audit" && r.id === eventId);
    if (
      priorPreparation.length > 1 ||
      priorPreparation.some(
        (r) =>
          z.object({ request_hash: sha }).passthrough().parse(r.payload).request_hash !==
          requestHash,
      )
    )
      throw new KBError("Publication request identity reused with different content.");
    if (preview.token !== input.preview_token)
      throw new KBError("Release preview changed. Refresh the preview before publishing.");
    if (preview.errors.length) throw new KBError("Release validation failed.", 400);
    const event = {
      id: eventId,
      action: "kb_release_published",
      actor,
      at: new Date().toISOString(),
      request_hash: requestHash,
      release_id: release.manifest.release_id,
      payload_hash: release.manifest.payload_hash,
      item_count: release.payload.items.length,
      candidate_set_id: input.candidate_set_id,
      preview_token: input.preview_token,
    };
    await insertRecords(
      [
        {
          kind: "release",
          id: release.manifest.release_id,
          version: release.manifest.payload_hash,
          payload: release,
        },
        {
          kind: "audit",
          id: eventId,
          version: hash({ ...event, action: "kb_release_prepared" }),
          payload: { ...event, action: "kb_release_prepared" },
        },
      ],
      locked,
    );
    const acknowledged = await commitPointer(
      {
        ...locked.state,
        version: release.manifest.release_id,
        payload: evidenceReleaseSchema.parse(release.payload),
        published: true,
        kb_write_lock: null,
        manifest: { ...release.manifest, projection_status: "canonical" },
        review_provenance: release.manifest.membership,
        audit: [...locked.state.audit, event],
      },
      locked,
    );
    return {
      status: "available_to_matching",
      release_id: release.manifest.release_id,
      payload_hash: release.manifest.payload_hash,
      pointer_revision: acknowledged.revision,
      item_count: release.payload.items.length,
    };
  });
}
export async function publishReviewRelease(request: Request, raw: unknown) {
  const actor = requireReviewer(request, true);
  return publishCanonical(actor.reviewer_id, raw);
}
