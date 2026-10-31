# Synthetic fixtures

`synthetic-hospital-aggregate.json` is an explicitly synthetic copy of the built-in `DEMO_PATIENT_MIX` in `src/lib/msl/hospital/contract.ts`, provided for local upload/contract inspection. It contains no patient rows or real clinical measurements. Its timestamp is fixed for reproducibility; if a newer snapshot already exists, it must not replace it. Use the portal's current demo path or deliberately update the synthetic timestamp before an authorized demo publication.

The strict upload schema rejects extra fields, so the synthetic label is in this filename and documentation. It is not a canonical acknowledgment. No 180-row CSV/generator is included. KB and newsletter fixtures have their own explicit fictional labels and cannot be clinical releases. See [hospital guide](../docs/architecture/hospital-patient-sync.md).
