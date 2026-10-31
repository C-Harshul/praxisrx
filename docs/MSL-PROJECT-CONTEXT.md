> Packaging snapshot copied from the shared workspace on 31 October 2026. In the shared workspace, the parent `docs/` copy remains the coordination source. In an isolated checkout, use this copy plus [current architecture](architecture/overview.md) and [setup](demo/setup.md). Older Supabase/Gemini, proposed namespaces, delivery exclusions and unimplemented-consumer descriptions below are historical; later explicit decisions and inspected runtime supersede them.

# MSL (Medical Science Liaison): project context

This file gives a coding session the full context for the MSL hackathon project: the problem, the solution, the architecture, and what is being built right now. Read it fully before writing code.

---

## 1. The problem

Medical evidence keeps moving: new trials, guideline updates, conference late-breakers, regulatory approvals. Practising specialists, such as oncologists with full clinic days and no research staff, struggle to keep up.

Doctors don't lack access to evidence. They lack a fast, trusted way to answer two questions:

1. **Does this new evidence apply to my patients?**
2. **Is it worth changing my practice for?**

Today the gap is filled badly. Society emails and journal alerts pile up unread, conferences happen once a year, peer and pharma-rep opinion fills the gap, continuing education is picked for availability rather than relevance, and habit decides. The failure points are time, no applicability filter, and unvetted sources.

The name "MSL" comes from the pharma role of Medical Science Liaison, someone who briefs doctors on new evidence. Our pitch is "the job of an MSL, without the sponsor": we show funding sources and are not tied to any company's drugs.

## 2. The solution

A personalised, cited evidence briefing delivered as a newsletter. It shows what the new evidence says, who it covers, and whether that includes *this doctor's* patients. Every claim links to the original source.

Guiding principle (also the tagline): **"A person always decides what changes in their practice. AI reads, translates and cites. The doctor judges."**

### Demo domain

Oncology, with a **lung oncology specialist** as the primary persona. The content is new research from the ESMO 2026 Congress (Madrid, 23–27 October 2026).

## 3. Architecture (four independent async jobs)

The jobs never call each other directly. They communicate only through data stores, so nothing is synchronous end to end.

| Job | Trigger | Steps | Done by |
|---|---|---|---|
| 1. Ingestion | Continuous | Crawler + APIs monitor trusted sources and store every new item, unchanged and timestamped, in a raw data lake | Deterministic code |
| 2. Classification and review | Per new item | LLM classifies the item (cancer type etc.) and extracts claims, each with its supporting source passage. A human expert vets and cleans everything before it enters the knowledge base (KB) | LLM, then human |
| 3. Doctor profiling | On onboarding, each profile update, each patient-data sync | LLM turns onboarding answers into a profile. An opt-in patient-data sync adds a de-identified patient mix (aggregates only) | LLM + deterministic code; doctor can view and correct |
| 4. Matching and briefing | On schedule (weekly or every two weeks, per doctor) | Deterministic matcher scores KB items against the profile. LLM writes the newsletter. A deterministic citation gate blocks any uncited paragraph. Newsletter is delivered | Code → LLM → code |

Cross-cutting: an **append-only audit log** that every job writes to (who, what, when, which version).

### Design principles

- **The LLM never has the last word.** Every LLM step is followed by a human or a deterministic check.
- **Every claim is cited.** Each paragraph a doctor reads traces to a KB claim, which traces to a specific source passage.
- **Everything is auditable.** It must be possible to reconstruct what a doctor saw and why they saw it.
- **Privacy.** Patient data sync is opt-in, read-only and revocable. Only de-identified aggregates (percentages per category) reach the profile. Individual patient records never enter the KB, the profile, or any LLM prompt.

## 4. Current priority: build jobs 3 and 4 only

**Jobs 1 and 2 are out of scope for this build.** The knowledge base is a separate line of work and will be seeded by hand from curated research. Build against seeded/mock KB data in the agreed schema so the real items can drop in later without code changes.

### In scope

1. **Doctor web app**
   - Sign up / log in.
   - Onboarding questions (kept deliberately basic, see section 6).
   - Doctor ID entry, which links the doctor to their de-identified patient mix.
   - **Profile page:** stated profile plus the linked patient mix.
   - **Library page:** all past newsletters, plus a Bookmarked tab.
   - **Newsletter view:** short digest of relevant items.
   - **Article view:** full context with citations to the original research.
2. **Matching** (deterministic): select and rank KB items for each doctor.
3. **Newsletter generation** (LLM): turn the matched KB items into a consumable newsletter, with a citation gate.
4. **Audit log** writes for every action.

### Out of scope for now

**Delivery scope update:** The user now requires email alongside the in-app library, on the doctor's weekly/fortnightly preference. This supersedes the original email exclusion below. Matching owns canonically persisted ranked evidence; a separate newsletter-and-delivery worker owns validated publication, subscriptions, durable email tasks, provider outcomes and reading-independent completion. See `../docs/NEWSLETTER-DELIVERY-HANDOFF.md`.

Crawler and ingestion, LLM classification, the human review UI, deduplication, automated source-passage verification, retraction and supersession alerts, live EHR integration, CME credit, email sending (render the newsletter in the app), audio/podcast output.

### Highest-signal feature (prioritise this)

**The applicability check against the doctor's own patient mix.** For example: "SAFFRON applies to about 4% of your patients (post-osimertinib with MET alteration)." This answers the core question in the problem statement and is the one thing a generic summariser can't do. Second priority is the **citation click-through**: every paragraph links to its source.

## 5. Tech stack

- Front end started in **Lovable**: React + Tailwind + Supabase (auth, Postgres, row-level security).
- Deployment: **Vercel** (project connected via GitHub).
- Scheduled job 4: **Vercel Cron** calling a server route, or a Supabase scheduled function.
- LLM calls run server-side only. Long LLM calls can hit serverless time limits, so for the demo pre-generate newsletters and keep cached outputs as a fallback.

## 6. Doctor web app spec

### Onboarding (multi-step form with progress bar)

1. **About you:** full name, years in practice, practice setting (Academic hospital, Community cancer centre, Private practice, Other).
2. **Your specialty:** specialty (Medical, Radiation, Surgical oncology, Other); cancer types treated (Lung, Breast, Pancreas, Liver, Gastric, Colorectal, Other); topics of interest (Targeted therapy, Immunotherapy, Antibody-drug conjugates, Chemotherapy, Clinical trials, Guidelines).
3. **Your newsletter:** preferred format (Written, Audio, Both); frequency (Weekly, Every two weeks).
4. **Link your patient data:** doctor ID (e.g. `DR-1001`), explanatory privacy text, required consent checkbox. Look up the ID in `patient_mix`; show an aggregate preview on success or an inline error if not found.
5. **Review and finish.**

### Profile page

Stated details with Edit; "Linked patient mix" card (doctor ID, last sync date, aggregates as labelled percentages, "De-identified aggregates only" label); "Unlink patient data" with confirmation.

### Library page

Tabs "All newsletters" and "Bookmarked". Newsletter view: digest summary, then article cards (title, cancer type tag, two-line summary, applicability badge, bookmark icon). Article view: full summary, "Who this evidence covers", "Who it does not cover", citation markers like [1] on every paragraph linking to a Sources list (source name, title, date, URL). Empty states for both tabs.

## 7. Data model

### App tables (Supabase, row-level security: each doctor sees only their own rows)

- `doctors`: id (auth user), full_name, years_in_practice, practice_setting, specialty, cancer_types[], topics[], preferred_format, frequency, doctor_id_code, patient_data_linked, consent_given_at, onboarding_complete, created_at, updated_at
- `patient_mix`: doctor_id_code, synced_at, aggregates (JSON: label → percentage)
- `newsletters`: id, doctor, sent_at, title, summary
- `articles`: id, newsletter, kb_item, title, cancer_type, short_summary, full_summary, covers_text, not_covers_text, applicability_percent (nullable), position
- `article_paragraphs`: id, article, position, text, claim_ids[]
- `citations`: id, article, number, source (reference), claim (reference)
- `bookmarks`: doctor, article, created_at
- `audit_log` (append-only, never update or delete): id, actor, action, details (JSON), created_at

### Knowledge base tables (seeded by hand for now)

- `kb_sources`: id, source_name, title, url, published_date, source_type (journal, conference abstract, press release, guideline, regulatory)
- `kb_items`: id, title, cancer_type, drug_names[], topics[], population_key (matches a `patient_mix` aggregate label), eligibility_summary, status_flags[] (e.g. "interim analysis", "OS immature", "single-country population", "not yet approved for this use", "approved"), funding, reviewed_by, reviewed_at, version
- `kb_claims`: id, kb_item, claim_text, source, supporting_passage, location (e.g. "Results, paragraph 2")

The `population_key` vocabulary must exactly match the `patient_mix` labels. A mismatch silently breaks matching.

## 8. Job 4 spec

### Matcher (deterministic)

For each doctor, over KB items not already sent to them:

1. **Filter:** keep items whose `cancer_type` is in the doctor's `cancer_types`. Optionally keep a "Beyond your specialty" item when a drug is relevant across cancer types (e.g. daraxonrasib: approved in pancreatic cancer, also in development in lung cancer).
2. **Applicability:** `applicability_percent` = the doctor's `patient_mix` value for the item's `population_key` (null if unlinked or no key).
3. **Score:** rank by applicability, with a boost for matching topics.
4. **Output reasons**, not just a score, e.g. `{"item": "SAFFRON", "applicability_percent": 4, "reason": "population_key Post-osimertinib-MET matches 4% of patient mix", "topic_match": ["Targeted therapy"]}`. Write the reasons to the audit log so "why did I get this?" is always answerable.

### Newsletter generation (LLM)

- Input: the matched KB items with their claims (each claim has an ID), status flags and funding, plus the doctor's stated profile and aggregate patient mix. Never include patient records.
- Output: structured JSON only:

```json
{
  "newsletter_title": "...",
  "digest_summary": "...",
  "articles": [
    {
      "kb_item_id": "...",
      "title": "...",
      "short_summary": "...",
      "paragraphs": [{ "text": "...", "claim_ids": ["claim_123"] }],
      "covers_text": "...",
      "not_covers_text": "..."
    }
  ]
}
```

- Prompt rules: use only the supplied claims; every paragraph must cite at least one claim ID; state who the evidence does and doesn't cover; surface status flags (interim data, immature OS, approval status, single-country population) and funding; no patient-level treatment advice.

### Citation gate (deterministic)

Reject any paragraph with no claim IDs, or with claim IDs that aren't in the supplied set. Either regenerate or drop the paragraph, and log the failure. Then map each claim to its source to build the article's numbered citations.

### Writes

`newsletters`, `articles`, `article_paragraphs`, `citations`, and audit log entries (matcher reasons, LLM model and prompt version, gate results).

## 9. Seed data

### Doctor persona (synthetic)

**Dr. Ananya Rao**, thoracic medical oncologist, 14 years in practice, community cancer centre affiliated with an academic hospital. Treats lung cancer only (NSCLC and SCLC). About 25 patients a day, runs a weekly tumour board, no time to read conference coverage. Wants to know "what changes what I do on Monday." Interests: targeted therapy, antibody-drug conjugates, immunotherapy. Format: written, with audio for her commute. Doctor ID: `DR-1001`.

### Patient mix for DR-1001 (synthetic aggregates, about 180 active patients)

NSCLC 85%, SCLC 15%, EGFR-mutant 20%, Post-osimertinib 7%, Post-osimertinib with MET alteration 4%, KRAS G12C 12%, ALK-positive 4%, PD-L1 ≥50% 25%, PD-L1 negative 30%, Extensive-stage SCLC after first-line chemo-immunotherapy 10%, Stage IV 60%.

### Archetype patients (for testing matching logic only; never stored in the app)

1. EGFR exon 19, progressed on osimertinib, MET amplified → SAFFRON; OptiTROP-Lung04 and PANKU-Lung01 as alternatives.
2. EGFR L858R, progressed on osimertinib, no MET alteration → OptiTROP-Lung04, PANKU-Lung01, not SAFFRON.
3. KRAS G12C, progressing on sotorasib → Krascendo 1.
4. Untreated stage IV nonsquamous, PD-L1 0% → OptiTROP-Lung06.
5. Untreated, PD-L1 80% → PERSEE.
6. Extensive-stage SCLC stable after first-line chemo-durvalumab → DeLLphi-305.
7. ALK-positive, stable on alectinib → no match this cycle (shows honest "nothing new covers this group").

### KB seed items (ESMO 2026 and recent)

Item names, populations and matching keys below. **Do not write clinical numbers into code or seed data from memory.** Summaries, effect sizes and claims come from the research line with primary-source citations (NEJM, The Lancet, ESMO abstracts). Until then, use clearly marked placeholders.

| Item | Cancer type | Population (who it applies to) | population_key | Status flags to carry |
|---|---|---|---|---|
| DeLLphi-305 (tarlatamab + durvalumab maintenance) | Lung (SCLC) | Extensive-stage SCLC not progressed after first-line chemo + durvalumab | ES-SCLC after 1L chemo-IO | Not yet approved for this use |
| Krascendo 1 (divarasib vs sotorasib/adagrasib) | Lung (NSCLC) | Previously treated KRAS G12C NSCLC | KRAS G12C | Investigational |
| SAFFRON (osimertinib + savolitinib) | Lung (NSCLC) | EGFR-mutant, MET overexpressed/amplified, after osimertinib | Post-osimertinib with MET alteration | |
| OptiTROP-Lung04 (sac-TMT) | Lung (NSCLC) | EGFR-mutant after EGFR TKI progression | Post-osimertinib | |
| PANKU-Lung01 (iza-bren) | Lung (NSCLC) | EGFR-mutant after third-generation TKI | Post-osimertinib | Interim; OS immature; single-country population (China) |
| OptiTROP-Lung06 (sac-TMT + pembrolizumab) | Lung (NSCLC) | Untreated PD-L1-negative nonsquamous NSCLC | PD-L1 negative | OS immature |
| PERSEE (pembrolizumab ± chemo) | Lung (NSCLC) | Untreated PD-L1 ≥50% NSCLC | PD-L1 ≥50% | Higher toxicity with combination |
| RASolute 302 (daraxonrasib) | Pancreas | Previously treated metastatic PDAC | — | Approved; cross-specialty drug relevance to lung |
| EMERALD-3 (STRIDE + TACE ± lenvatinib) | Liver | Embolisation-eligible unresectable HCC | — | OS immature; industry funded |
| NATALEE 6-year update (adjuvant ribociclib) | Breast | HR+/HER2- stage II–III early breast cancer | — | |
| G-HOPE-001 (arcotatug tavatecan) | Gastric | Previously treated CLDN18.2-positive gastric/GEJ | — | |
| CheckMate 8HW final OS | Colorectal | MSI-H/dMMR metastatic colorectal cancer | — | |

Expected result for Dr. Rao: the seven lung items, ranked by applicability; non-lung items filtered out, except possibly daraxonrasib as a "Beyond your specialty" note.

## 10. The demo

Jobs 1–3 are pre-run on seeded data, and the audit log shows that they happened. Job 4 runs live.

1. Onboard a doctor live (or show Dr. Rao already onboarded), enter `DR-1001`, show the linked patient mix.
2. Trigger newsletter generation.
3. Open the digest: items ranked by applicability, with badges like "Applies to ~7% of your patients."
4. Open an article: who it covers, who it doesn't, status flags, funding.
5. Click a citation through to the original source.
6. Show the audit trail for that article: matcher reason, generation record, gate result.
7. Ideally, contrast with a second doctor who has a different patient mix and receives a different newsletter from the same KB.

Pre-generate and cache every newsletter before the demo in case the API or Wi-Fi fails.

## 11. Guardrails for the coding session

- Never invent clinical numbers, trial results or citations. Use placeholders until the research line supplies real, cited content.
- Never pass individual patient records to an LLM or store them in app tables. Aggregates only.
- The audit log is append-only.
- Keep the data-access layer separate, so the newsletter job and the real KB can be swapped in without UI changes.
- Prefer simple, deterministic logic for matching. The LLM only writes the newsletter.
