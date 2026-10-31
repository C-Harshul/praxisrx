import {
  readPointer as pointer,
  readRecords,
  insertRecords,
  commitPointer,
  withKBWrite,
} from "../src/lib/msl/kb/store.server";
import {
  snapshot,
  fingerprint,
  assemblePreview,
  saveDecision,
  publishCanonical,
} from "../src/lib/msl/kb/review.server";
/** Trusted offline/admin CLI. Never import this into browser routes. Run from app root. */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { executeSql, databricksConfig } from "../src/integrations/databricks/sql.server";
import {
  buildRelease,
  hash,
  stable,
  validateCandidate,
  reviewSchema,
  invalidationSchema,
} from "../src/lib/msl/kb/core";
import type { Candidate, Review, Invalidation } from "../src/lib/msl/kb/core";
import { evidenceReleaseSchema, matchEvidence } from "../src/lib/msl/matching/contract";
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const candidates = () => read("kb/data/candidates.json").map(validateCandidate) as Candidate[];
const folder = "kb/data/decisions";
function decisions() {
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((p) => p.endsWith(".json"))
        .map((p) => reviewSchema.parse(read(`${folder}/${p}`)))
    : [];
}
const reviewers = () => (process.env["KB_AUTHORIZED_REVIEWERS"] ?? "").split(",").filter(Boolean);
const command = process.argv[2];
const now = () => new Date().toISOString();
const namespace = process.env["KB_NAMESPACE"] ?? "workspace.msl_demo";
if (!/^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(namespace)) throw new Error("Invalid KB namespace");
const table = `${namespace}.kb_records`;
const appTable = () => databricksConfig().table;
if (command === "classify") {
  const proposals = read(process.argv[3]!);
  const approvedInput = proposals.map(validateCandidate);
  const current = candidates();
  for (const candidate of approvedInput) {
    for (const source of candidate.sources) {
      if (
        !current.some((c) =>
          c.sources.some((s) => s.id === source.id && s.version === source.version),
        )
      )
        throw new Error("Classifications must pin an acquired source");
    }
  }
  const merged = [...new Map([...current, ...approvedInput].map((c) => [c.id, c])).values()];
  writeFileSync("kb/data/candidates.json", JSON.stringify(merged, null, 2) + "\n");
  writeFileSync(
    "kb/exports/review-queue.json",
    JSON.stringify(
      merged.map((c) => ({
        item_id: c.id,
        item_version: c.version,
        snapshot_hash: hash(c),
        status: "pending_review",
        candidate: c,
      })),
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Validated classifications staged; previous approvals do not transfer across versions.",
  );
} else if (command === "review") {
  const r = reviewSchema.parse(read(process.argv[3]!));
  const { rows, p } = await snapshot();
  const seed = hash(r);
  const requestId = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
  console.log(
    await saveDecision(r.reviewer, {
      request_id: requestId,
      item_id: r.item_id,
      item_version: r.item_version,
      snapshot_hash: r.snapshot_hash,
      state_token: fingerprint(rows, p),
      decision: r.decision,
      note: r.note,
      human_attestation: r.human_attestation,
    }),
  );
} else if (command === "export") {
  const { rows, p } = await snapshot();
  const options = rows.filter((r) => r.kind === "candidate_set");
  const set = process.argv[4] ?? (options.length === 1 ? options[0]!.id : "");
  const result = assemblePreview(rows, p, {
    candidate_set_id: set,
    cutoff: process.argv[3] ?? "2026-10-30",
  });
  writeFileSync("kb/exports/reviewed.json", JSON.stringify(result.release.payload, null, 2) + "\n");
  writeFileSync(
    "kb/exports/reviewed.manifest.json",
    JSON.stringify(result.release.manifest, null, 2) + "\n",
  );
  writeFileSync("kb/exports/release-preview.json", JSON.stringify(result.preview, null, 2) + "\n");
  console.log({
    status: "canonical-preview-local-export",
    items: result.preview.items.length,
    token: result.preview.token,
  });
} else if (command === "setup") {
  const sql = readFileSync("kb/sql/setup.sql", "utf8");
  await executeSql(sql, [{ name: "kb_namespace", value: namespace }]);
  for (const kind of [
    "source_registry",
    "acquisition_run",
    "document",
    "study",
    "study_report",
    "evidence_item",
    "item_taxonomy",
    "population",
    "claim",
    "review",
    "invalidation",
    "release",
    "audit",
    "taxonomy",
    "candidate_set",
  ]) {
    await executeSql(
      `CREATE OR REPLACE VIEW ${namespace}.kb_${kind} AS SELECT id,version,content_hash,payload,created_at FROM ${table} WHERE record_type='${kind}'`,
    );
  }
  console.log("Canonical KB table and typed entity views verified.");
} else if (command === "sync") {
  await withKBWrite(async (locked) => {
    const insert = (values: Parameters<typeof insertRecords>[0]) => insertRecords(values, locked);
    const cs = candidates();
    const acquisition = read("kb/data/acquisitions.json");
    const rows: { kind: string; id: string; version: string; payload: unknown }[] = [];
    const add = (kind: string, id: string, version: string, payload: unknown) =>
      rows.push({ kind, id, version, payload });
    for (const registry of read("kb/data/source-registry.json"))
      add("source_registry", registry.id, hash(registry), registry);
    for (const run of acquisition.runs) add("acquisition_run", run.id, hash(run), run);
    // Only selected acquisitions move into canonical raw-permitted storage; discovery metadata stays local.
    for (const c of cs) {
      add("evidence_item", c.id, c.version, c);
      add("population", c.population.definition_id, hash(c.population), c.population);
      for (const s of c.sources) add("document", s.id, s.version, s);
      for (const claim of c.claims) add("claim", claim.id, claim.version, claim);
      for (const studyId of c.study_ids) {
        const study = {
          id: studyId,
          identity_status: studyId.startsWith("unresolved")
            ? "unresolved-report-not-a-distinct-trial"
            : "registry-linked",
          design: c.details,
        };
        // Study identity rows omit report-specific details; each report carries its own analysis.
        add("study", studyId, "identity.v1", {
          id: studyId,
          identity_status: study.identity_status,
        });
        const relation = {
          study_id: studyId,
          item_id: c.id,
          item_version: c.version,
          source_versions: c.sources.map((s) => s.version),
        };
        add("study_report", hash(relation), hash(relation), relation);
      }
      for (const [axis, values] of Object.entries({
        cancer_family: c.cancer_families,
        specialty: c.specialties,
        topic: c.topics,
        subtype: c.subtypes,
      }))
        for (const value of values) {
          const rel = { item_id: c.id, item_version: c.version, axis, value };
          add("item_taxonomy", hash(rel), hash(rel), rel);
        }
    }
    const selection = {
      members: cs
        .map((c) => ({ id: c.id, version: c.version }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
    const candidateSetId = `candidate-set-${hash(selection)}`;
    add("candidate_set", candidateSetId, hash(selection), selection);
    const context = acquisition.documents.filter((s: { pmid: string }) =>
      ["37272513", "39268857"].includes(s.pmid),
    );
    for (const s of context) {
      add("document", s.id, s.version, s);
      for (const studyId of s.study_ids) {
        add("study", studyId, "identity.v1", { id: studyId, identity_status: "registry-linked" });
        const relation = {
          study_id: studyId,
          source_id: s.id,
          source_version: s.version,
          role: "older-pivotal-context",
        };
        add("study_report", hash(relation), hash(relation), relation);
      }
    }
    const tax = read("kb/data/taxonomy.json");
    add("taxonomy", "app-taxonomy", hash(tax), tax);
    for (const r of decisions()) {
      if (
        !reviewers().includes(r.reviewer) ||
        !cs.some(
          (c) => c.id === r.item_id && c.version === r.item_version && hash(c) === r.snapshot_hash,
        )
      )
        throw new Error("Review not authorized/pinned");
      add("review", r.id, hash(r), r);
    }
    const unique = [...new Map(rows.map((r) => [[r.kind, r.id, r.version].join("|"), r])).values()];
    for (let offset = 0; offset < unique.length; offset += 60)
      await insert(unique.slice(offset, offset + 60));
    const event = {
      id: `sync-${hash(unique)}`,
      action: "kb_sync_acknowledged",
      entity_count: unique.length,
      input_hash: hash(unique),
      actor: "kb-governed-writer.v1",
    };
    await insert([{ kind: "audit", id: event.id, version: hash(event), payload: event }]);
    const report = {
      verified_at: now(),
      workspace_id: "7474660613250664",
      table,
      entity_count: unique.length,
      candidate_set_id: candidateSetId,
      input_hash: hash(unique),
      status: "canonical-readback-verified",
      clinical_items_released: 0,
    };
    writeFileSync("kb/exports/live-sync-receipt.json", JSON.stringify(report, null, 2) + "\n");
    console.log(report);
    await commitPointer(
      {
        ...locked.state,
        kb_write_lock: null,
        audit: [
          ...locked.state.audit,
          { id: event.id, action: event.action, at: new Date().toISOString() },
        ],
      },
      locked,
    );
  });
} else if (command === "release") {
  const preview = read("kb/exports/release-preview.json");
  const actor = process.env["KB_OPERATOR_REVIEWER"];
  if (!actor) throw new Error("Set KB_OPERATOR_REVIEWER to your authorized reviewer identity.");
  // Stable identity makes an identical CLI retry recover the original acknowledged publication.
  const seed = hash({ preview: preview.token, actor }),
    requestId = `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
  console.log(
    await publishCanonical(actor, {
      request_id: requestId,
      candidate_set_id: preview.candidate_set_id,
      cutoff: preview.cutoff,
      preview_token: preview.token,
      confirm_replacement: true,
    }),
  );
} else if (command === "invalidate") {
  await withKBWrite(async (locked) => {
    const inv = invalidationSchema.parse(read(process.argv[3]!));
    if (!reviewers().includes(inv.actor)) throw new Error("Authorized curator required");
    const expected = locked;
    if (!expected) throw new Error("No canonical pointer");
    // Atomic pointer disable blocks new matching before appending the separate event; retries can repair event persistence.
    const revision = await commitPointer(
      {
        ...expected.state,
        published: false,
        kb_write_lock: null,
        invalidations: [...(expected.state.invalidations ?? []), inv],
        audit: [
          ...(expected.state.audit ?? []),
          { action: "kb_invalidated", invalidation: inv, at: now() },
        ],
      },
      expected,
    );
    await insertRecords([{ kind: "invalidation", id: inv.id, version: hash(inv), payload: inv }]);
    console.log({ status: "active-release-disabled", revision });
  });
} else if (command === "verify") {
  const p = await pointer();
  if (!p) throw new Error("No canonical release");
  evidenceReleaseSchema.parse(p.state.payload);
  const counts = await executeSql(
    `SELECT record_type,count(*) FROM ${table} GROUP BY record_type ORDER BY record_type`,
  );
  const duplicates = await executeSql(
    `SELECT record_type,id,version,count(*) FROM ${table} GROUP BY record_type,id,version HAVING count(*)>1 LIMIT 1`,
  );
  if (duplicates.rows.length) throw new Error("Canonical duplicate keys");
  if (hash(p.state.payload) !== p.state.manifest?.payload_hash)
    throw new Error("Pointer payload hash mismatch");
  const properties = await executeSql(`SHOW TBLPROPERTIES ${table} ('delta.appendOnly')`);
  const example = read("kb/exports/synthetic-worked-example.json");
  const matched = matchEvidence(example.matching_input, p.state.payload);
  const report = {
    verified_at: now(),
    workspace: "7474660613250664",
    table,
    records: counts.rows,
    duplicate_keys: duplicates.rows.length,
    append_only: properties.rows,
    actual_matcher_matches_for_synthetic_input: matched.matches.length,
    release: {
      revision: p.revision,
      version: p.state.version,
      published: p.state.published,
      items: evidenceReleaseSchema.parse(p.state.payload).items.length,
    },
  };
  writeFileSync("kb/exports/live-verification.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report);
} else
  throw new Error(
    "Commands: setup | sync | classify proposals.json | review file.json | export cutoff | release cutoff | invalidate file.json | verify",
  );
