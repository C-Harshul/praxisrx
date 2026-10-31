import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { hash, validateCandidate, documentSchema, buildRelease } from "../src/lib/msl/kb/core";
import { CANCER_TYPES, SPECIALTIES, TOPICS } from "../src/lib/msl/options";
const input = JSON.parse(readFileSync("kb/data/acquisitions.json", "utf8"));
const lung = [
  "42934326",
  "42628840",
  "42830869",
  "42887497",
  "42955021",
  "42918583",
  "42636548",
  "42692248",
  "42929702",
  "42734213",
  "42679738",
  "42823088",
  "42869886",
  "42424047",
  "42900351",
];
const extras = ["42802176", "42913944", "42675036", "42926136", "42901168", "42600610"];
const candidates = [...lung, ...extras].map((pmid) => {
  const d = documentSchema.parse(input.documents.find((d: any) => d.pmid === pmid));
  const t = d.title.toLowerCase(),
    family = d.family_hint;
  const sclc = family === "Lung" && !t.includes("non-small");
  const topics: (typeof TOPICS)[number][] = ["Clinical trials"];
  if (
    /immun|nivolumab|durvalumab|pembrolizumab|toripalimab|camrelizumab|atezolizumab|benmelstobart|vibostolimab|relatlimab/.test(
      t,
    )
  )
    topics.push("Immunotherapy");
  if (/egfr|alk|firmonertinib|envonalkib|anlotinib/.test(t)) topics.push("Targeted therapy");
  if (/conjugate|pelitecan|vedotin/.test(t)) topics.push("Antibody-drug conjugates");
  if (/chemotherapy|carboplatin|etoposide|paclitaxel/.test(t)) topics.push("Chemotherapy");
  const specialties: (typeof SPECIALTIES)[number][] = ["Medical oncology"];
  if (/radiotherapy|chemoradiotherapy|chemoradiation|radiation/.test(t))
    specialties.push("Radiation oncology");
  if (/surgery|surgical|perioperative|neoadjuvant|resectable|resected/.test(t))
    specialties.push("Surgical oncology");
  const populationId =
    family === "Lung"
      ? sclc
        ? "sclc"
        : /egfr/.test(t)
          ? "egfr-mutant"
          : /alk/.test(t)
            ? "alk-positive"
            : "nsclc"
      : null;
  const claim = {
    id: `claim-pmid-${pmid}-abstract`,
    version: "",
    claim_text: d.supporting_passage,
    source_id: d.id,
    source_version: d.version,
    supporting_passage: d.supporting_passage,
    location: d.location,
    effect: null,
    extraction: {
      method: "deterministic-limited-excerpt.v1",
      model: null,
      prompt_version: "no-llm.v1",
      schema_version: "kb-claim.v1",
      input_hash: d.source_hash,
    },
  };
  claim.version = hash(claim);
  const c = {
    id: `evidence-pmid-${pmid}`,
    version: "",
    title: d.title,
    cancer_families: [family],
    specialties,
    topics,
    subtypes: family === "Lung" ? [sclc ? "SCLC" : "NSCLC"] : [],
    study_ids: d.study_ids.length ? d.study_ids : [`unresolved-report:${pmid}`],
    evidence_type: /analysis|outcomes by/i.test(t)
      ? "report/subgroup or update; verify design"
      : "original research report; design pending review",
    population: {
      id: populationId,
      definition_id: `eligibility-pmid-${pmid}`,
      version: "definition.v1",
      inclusion: `Population as named in report title: ${d.title}`,
      exclusion: "Not established from retained excerpt; do not infer exclusions.",
      predicates: { cancer_family: family },
      required_fields: [
        "histology",
        "stage",
        "biomarkers",
        "treatment_history",
        "performance_status",
      ],
      denominator: "Unknown; current patient-mix aliases provide cohort relevance only.",
      unknowns: [
        "Full trial inclusion/exclusion criteria not acquired",
        "No compatible denominator or exact eligibility estimate",
      ],
    },
    details: {
      phase: t.match(/phase (?:[123]|ii?i?)(?:\b)/)?.[0] ?? null,
      histology: family === "Lung" ? (sclc ? "SCLC" : "NSCLC") : null,
      stage: null,
      biomarker: null,
      treatment_line: null,
      previous_therapies: null,
      progression_requirement: null,
      intervention: null,
      comparator: null,
      geography: null,
      sample_size: null,
      endpoints: [],
      maturity: null,
    },
    funding: "Unknown; requires verification in original funding/conflict disclosure.",
    conflicts: "Unknown; original disclosures not acquired.",
    regulatory: {
      jurisdiction: "US",
      as_of: "2026-10-30",
      status: "Not assessed; publication does not establish regulatory approval.",
      source_id: null,
    },
    limitations: [
      "Pending human clinical review; deterministic excerpt selection is not clinical verification.",
      "Limited abstract excerpt only; full text, supplementary eligibility, funding and regulatory status require review.",
      "No numeric efficacy estimates extracted; endpoints, arms, time point and maturity remain unverified.",
    ],
    status_flags: [
      "pending human review",
      "abstract-only acquisition",
      "approval status not assessed",
    ],
    synthetic: false,
    claims: [claim],
    sources: [d],
  };
  c.version = hash(c);
  return validateCandidate(c);
});
mkdirSync("kb/exports", { recursive: true });
writeFileSync("kb/data/candidates.json", JSON.stringify(candidates, null, 2) + "\n");
writeFileSync(
  "kb/exports/review-queue.json",
  JSON.stringify(
    candidates.map((c) => ({
      item_id: c.id,
      item_version: c.version,
      snapshot_hash: hash(c),
      status: "pending_review",
      reviewed_by: null,
      reviewed_at: null,
      candidate: c,
    })),
    null,
    2,
  ) + "\n",
);
const release = buildRelease(candidates, [], [], [], "2026-10-30");
writeFileSync("kb/exports/clinical-empty.json", JSON.stringify(release.payload, null, 2) + "\n");
writeFileSync(
  "kb/exports/clinical-empty.manifest.json",
  JSON.stringify(release.manifest, null, 2) + "\n",
);
writeFileSync(
  "kb/data/taxonomy.json",
  JSON.stringify(
    {
      version: "app-options.2026-10-30",
      cancer_families: CANCER_TYPES,
      specialties: SPECIALTIES,
      topics: TOPICS,
      aliases: {
        NSCLC: "Lung",
        SCLC: "Lung",
        hepatocellular: "Liver",
        pancreatic: "Pancreas",
        melanoma: "Other",
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    candidates: candidates.length,
    lung: candidates.filter((c) => c.cancer_families.includes("Lung")).length,
    families: [...new Set(candidates.flatMap((c) => c.cancer_families))],
    release_items: release.payload.items.length,
  }),
);
