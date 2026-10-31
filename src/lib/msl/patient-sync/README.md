# Patient aggregate contracts

Shared strict aggregate JSON/synthetic CSV parsing used by the hospital UI and publication service. This directory is a contract module, not a separate service or raw-patient data store. [Hospital component README](../hospital/README.md) documents schema fields, cohort definitions, input/output, canonical publication, diagram, configuration, run/test steps and revocation behavior.

`contract.ts` exports `patientUploadSchema`, `parsePatientUpload`, `aggregateSyntheticCsv`, `POPULATIONS`, `PatientUpload`, `SyncSnapshot` and the 5 MB bound; `contract.test.ts` covers deterministic parsing/suppression. Unknown/suppressed values stay null. Only strict approved aggregates reach canonical doctor state; no inference runs here. `npm test -- src/lib/msl/patient-sync` is offline.
