import { z } from "zod";
import { readRecord } from "../platform/store.server";
import { readCurrentRankedPackage } from "../matching/handoff.server";
import { currentMatchingInput } from "../matching/handoff";
import { evidenceReleaseSchema, matchEvidence } from "../matching/contract";
import { hash, stable } from "../kb/core";
import type { DoctorState } from "../platform/types";
import type { PublishedNewsletter } from "./types";
import { validateFrozenNewsletter } from "./frozen";

const version = z.string().min(1);
const memberSchema = z.object({
  id: version,
  version,
  review_id: version,
  review_hash: version,
  source_versions: z.array(z.object({ id: version, version, content_hash: version })),
  claim_versions: z.array(z.object({ id: version, version })),
});
export const pointerSchema = z
  .object({
    version,
    published: z.literal(true),
    kb_write_lock: z.object({id:z.string(),expires_at:z.number()}).nullable().optional(),
    payload: evidenceReleaseSchema,
    manifest: z
      .object({
        kind: z.literal("clinical"),
        payload_hash: version,
        membership: z.array(memberSchema),
      })
      .passthrough(),
  })
  .passthrough();
export async function currentPointer() {
  const record = await readRecord<unknown>("kb_release", "published");
  if (!record) return null;
  const parsed = pointerSchema.safeParse(record.state);
  if (!parsed.success || parsed.data.kb_write_lock != null || hash(parsed.data.payload) !== parsed.data.manifest.payload_hash)
    return null;
  for (const item of parsed.data.payload.items) {
    const members = parsed.data.manifest.membership.filter(
      (m) => m.id === item.id && m.version === item.version,
    );
    if (members.length !== 1) return null;
    const member = members[0]!;
    if (
      item.claims.some((c) => member.claim_versions.filter((v) => v.id === c.id).length !== 1) ||
      item.sources.some((s) => member.source_versions.filter((v) => v.id === s.id).length !== 1)
    )
      return null;
  }
  return { ...record, state: parsed.data };
}
export async function generationContext(doctor: string, run: string) {
  const context = await readCurrentRankedPackage(doctor, run);
  if (!context) return null;
  const pointer = await currentPointer();
  if (!pointer || pointer.revision !== context.evidence_package.kb_pointer_revision) return null;
  const recomputed = matchEvidence(context.evidence_package.input, pointer.state.payload);
  if (stable(recomputed) !== stable(context.evidence_package.result)) return null;
  return { ...context, pointer };
}
/** Post-publication check deliberately ignores suppression changes caused by this publication. */
export async function newsletterStillValid(state: DoctorState, newsletter: PublishedNewsletter) {
  const run = state.matching_runs.find((r) => r.id === newsletter.provenance.matching_run_id);
  const pkg = run?.evidence_package;
  const input = currentMatchingInput(state);
  if (
    !pkg ||
    !input ||
    stable({ ...input, delivered_item_ids: [] }) !==
      stable({ ...pkg.input, delivered_item_ids: [] })
  )
    return false;
  const mix =
    state.doctor.patient_data_linked && state.doctor.consent_given_at ? state.patient_mix : null;
  if (
    (mix?.id ?? null) !== run.patient_mix_id ||
    (mix?.version ?? null) !== pkg.patient_mix_version
  )
    return false;
  const pointer = await currentPointer();
  try {
    validateFrozenNewsletter(newsletter, pkg);
  } catch {
    return false;
  }
  return (
    !!pointer &&
    pointer.revision === newsletter.provenance.kb_revision &&
    pointer.state.version === newsletter.provenance.release_version
  );
}
