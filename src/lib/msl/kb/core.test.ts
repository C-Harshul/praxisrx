import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Candidate } from "./core";
import { buildRelease, hash, validateCandidate, groupReports } from "./core";
import { evidenceReleaseSchema, matchEvidence } from "../matching/contract";
const real: Candidate[] = JSON.parse(readFileSync("kb/data/candidates.json", "utf8"));
const example = JSON.parse(readFileSync("kb/exports/synthetic-worked-example.json", "utf8"));
const c = example.candidate,
  r = example.simulated_review;
const cutoff = "2026-10-30",
  reviewers = [r.reviewer];
const seal = <T extends { version: string }>(v: T): T => {
  v.version = "";
  v.version = hash(v);
  return v;
};
describe("KB governed release", () => {
  it("validates all retained acquisitions and leaves unreviewed research outside the clinical release", () => {
    real.forEach(validateCandidate);
    expect(buildRelease(real, [], [], [], cutoff).payload.items).toEqual([]);
    expect(real.filter((c: Candidate) => c.cancer_families.includes("Lung"))).toHaveLength(15);
    expect(new Set(real.flatMap((c: Candidate) => c.cancer_families)).size).toBe(7);
  });
  it("uses the actual strict matcher schema and retains cohort-only semantics", () => {
    const release = buildRelease([c], [r], [], reviewers, cutoff, true);
    evidenceReleaseSchema.parse(release.payload);
    expect(matchEvidence(example.matching_input, release.payload).matches[0]).toMatchObject({
      cohort_percent: 60,
      applicability_percent: null,
    });
    expect(() => evidenceReleaseSchema.parse({ ...release.payload, manifest: {} })).toThrow();
  });
  it("requires exact human-reviewed snapshots and authorized reviewers", () => {
    expect(buildRelease([c], [r], [], [], cutoff, true).payload.items).toHaveLength(0);
    const changed = seal({ ...structuredClone(c), funding: "changed disclosure" });
    expect(buildRelease([changed], [r], [], reviewers, cutoff, true).payload.items).toHaveLength(0);
    expect(
      buildRelease([c], [{ ...r, snapshot_hash: hash("wrong") }], [], reviewers, cutoff, true)
        .payload.items,
    ).toHaveLength(0);
    expect(() =>
      buildRelease([c], [{ ...r, human_attestation: false }], [], reviewers, cutoff, true),
    ).toThrow();
  });
  it("blocks synthetic evidence from clinical publication", () => {
    expect(() => buildRelease([c], [r], [], reviewers, cutoff)).toThrow(/Synthetic/);
  });
  it("excludes retracted, withdrawn, corrected and superseded evidence and preserves historical bytes", () => {
    const previous = buildRelease([c], [r], [], reviewers, cutoff, true);
    const before = hash(previous);
    for (const kind of ["retracted", "withdrawn", "correction", "superseded"]) {
      const inv = {
        id: kind,
        item_id: c.id,
        item_version: c.version,
        kind,
        reason: "test correction",
        actor: r.reviewer,
        created_at: r.reviewed_at,
      };
      expect(buildRelease([c], [r], [inv], reviewers, cutoff, true).payload.items).toHaveLength(0);
    }
    expect(hash(previous)).toBe(before);
  });
  it("detects altered sources, claims, duplicate IDs and broken referential integrity", () => {
    const changed = structuredClone(c);
    changed.sources[0].supporting_passage = "altered";
    seal(changed);
    expect(() => validateCandidate(changed)).toThrow(/Source version/);
    const bad = structuredClone(c);
    bad.claims[0].source_id = "missing";
    seal(bad.claims[0]);
    seal(bad);
    expect(() => validateCandidate(bad)).toThrow(/Source\/passage/);
    expect(() => buildRelease([c, c], [r], [], reviewers, cutoff, true)).toThrow(/one version/);
  });
  it("blocks implicit multi-family projection and uncoordinated population identifiers", () => {
    const multi = seal({ ...structuredClone(c), cancer_families: ["Lung", "Breast"] });
    const approval = { ...r, item_version: multi.version, snapshot_hash: hash(multi) };
    expect(() => buildRelease([multi], [approval], [], reviewers, cutoff, true)).toThrow(
      /Multi-family/,
    );
    const bad = structuredClone(c);
    bad.population.id = "invented";
    seal(bad);
    expect(() => validateCandidate(bad)).toThrow(/Uncoordinated/);
  });
  it("makes release identity deterministic and changes identity with review provenance", () => {
    expect(buildRelease([c], [r], [], reviewers, cutoff, true)).toEqual(
      buildRelease([c], [r], [], reviewers, cutoff, true),
    );
    const changed = buildRelease([c], [{ ...r, id: "new-review" }], [], reviewers, cutoff, true);
    expect(changed.manifest.release_id).not.toEqual(example.release.manifest.release_id);
  });
  it("keeps rejected versions out even if an approval is supplied", () => {
    expect(
      buildRelease(
        [c],
        [r, { ...r, id: "rejected", decision: "rejected" }],
        [],
        reviewers,
        cutoff,
        true,
      ).payload.items,
    ).toHaveLength(0);
  });
  it("groups linked reports without counting unresolved reports as verified trials", () => {
    const s = real[0]!.sources[0]!;
    const docs = [s, { ...s, id: "second-report" }, s, { ...s, id: "unresolved", study_ids: [] }];
    const groups = groupReports(docs);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.verified_registry_identifier)?.reports).toHaveLength(2);
    expect(groups.filter((g) => g.verified_registry_identifier)).toHaveLength(1);
  });
  it("deduplicates delivery by stable evidence identity", () => {
    const input = { ...example.matching_input, delivered_item_ids: [c.id] };
    expect(matchEvidence(input, example.release.payload).matches).toHaveLength(0);
  });
});
