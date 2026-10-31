import { describe, it, expect } from "vitest";
import { aggregateSyntheticCsv, parsePatientUpload, patientUploadSchema } from "./contract";
import { orderedAggregates } from "../rules";
const payload = {
  doctor_id_code: "DR-1001",
  synced_at: "2026-10-30T09:00:00Z",
  panel_size: 180,
  min_cell_size: 5,
  aggregates: { NSCLC: 85, SCLC: 15, "ALK-positive": null, "KRAS G12C": 0 },
};
const headers =
  "patient_id,doctor_id_code,age,sex,smoking_status,cancer_type,histology,stage,ecog,egfr,kras,alk,met,pd_l1_tps,prior_therapies,current_therapy,line_of_therapy,disease_status,last_visit_date,archetype";
const csv = [
  headers,
  ...Array.from(
    { length: 10 },
    (_, i) =>
      `SYN-${i},DR-1001,60,F,Never,NSCLC,Adenocarcinoma,IV,1,Wild-type,${i === 0 ? "G12C" : "Wild-type"},Negative,None,0,,"Therapy, quoted",1,Stable,2026-10-01,`,
  ),
].join("\r\n");
describe("patient context uploads", () => {
  it("accepts supplied aggregate contract and keeps zero distinct from null", () => {
    expect(parsePatientUpload(JSON.stringify(payload), "aggregate_json")).toEqual(payload);
    expect(orderedAggregates(payload.aggregates)).toContainEqual({ label: "KRAS G12C", value: 0 });
    expect(orderedAggregates(payload.aggregates).some((r) => r.label === "ALK-positive")).toBe(
      false,
    );
  });
  it("rejects records, unknown labels, string percentages and small cells", () => {
    for (const value of [
      { ...payload, patients: [] },
      { ...payload, aggregates: { name: 50 } },
      { ...payload, aggregates: { NSCLC: "85" } },
      { ...payload, aggregates: { NSCLC: 1 } },
      { ...payload, min_cell_size: 4 },
    ])
      expect(patientUploadSchema.safeParse(value).success).toBe(false);
  });
  it("locally aggregates quoted CSV, suppresses small positive cells, preserves zeros", () => {
    const result = aggregateSyntheticCsv(csv);
    expect(result.aggregates["NSCLC"]).toBe(100);
    expect(result.aggregates["KRAS G12C"]).toBeNull();
    expect(result.aggregates["ALK-positive"]).toBe(0);
    expect(JSON.stringify(result)).not.toContain("SYN-");
    expect(JSON.stringify(result)).not.toContain("Therapy");
  });
  it("rejects duplicate patients, mixed doctors, unknown categories, and malformed quoting", () => {
    for (const value of [
      csv.replace("SYN-1", "SYN-0"),
      csv.replace("DR-1001", "DR-1002"),
      csv.replace("NSCLC", "Unknown"),
      csv.replace('"Therapy, quoted"', '"unterminated'),
      csv.replace("Negative", "Unknown"),
    ])
      expect(() => aggregateSyntheticCsv(value)).toThrow();
  });
  it("never exposes patient values in parsing errors", () => {
    expect(() => parsePatientUpload('{"name":"secret"}', "aggregate_json")).toThrow(
      /Invalid aggregate JSON/,
    );
  });
});
