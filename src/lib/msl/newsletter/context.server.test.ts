import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  fixturePointer,
  fixturePackage,
  fixtureDoctor,
} from "../../../../scripts/fixtures/newsletter";
const mock = vi.hoisted(() => ({ read: vi.fn(), current: vi.fn() }));
vi.mock("../platform/store.server", () => ({ readRecord: mock.read }));
vi.mock("../matching/handoff.server", () => ({ readCurrentRankedPackage: mock.current }));
import { currentPointer, generationContext, newsletterStillValid } from "./context.server";
beforeEach(() => vi.resetAllMocks());
describe("canonical publication gates (offline simulation)", () => {
  it("rejects synthetic fixtures and unapproved/unpublished pointers", async () => {
    mock.read.mockResolvedValue({ revision: "fixture-kb-revision", state: fixturePointer() });
    expect(await currentPointer()).toBeNull();
    mock.read.mockResolvedValue({ state: { ...fixturePointer(), published: false } });
    expect(await currentPointer()).toBeNull();
  });
  it("defers while a canonical KB writer holds an active or unresolved publication fence",async()=>{
    const pointer={...fixturePointer(),kb_write_lock:{id:"writer",expires_at:Date.now()+60000}};pointer.manifest.kind="clinical";
    mock.read.mockResolvedValue({state:pointer});expect(await currentPointer()).toBeNull();
  });
  it("rejects payload edits with stale release hashes and missing review versions", async () => {
    const pointer = fixturePointer();
    pointer.manifest.kind = "clinical";
    pointer.payload.items[0]!.claims[0]!.claim_text = "mutated";
    mock.read.mockResolvedValue({ state: pointer });
    expect(await currentPointer()).toBeNull();
  });
  it("blocks unavailable canonical reads instead of substituting fixtures", async () => {
    mock.read.mockRejectedValue(new Error("canonical unavailable"));
    await expect(currentPointer()).rejects.toThrow("canonical unavailable");
  });
  it("detects changed aggregate or profile snapshots before publication/send", async () => {
    const state = fixtureDoctor();
    state.profiles[0]!.confirmed_at = null;
    const newsletter = {
      provenance: { matching_run_id: state.matching_runs[0]!.id },
    } as Parameters<typeof newsletterStillValid>[1];
    expect(await newsletterStillValid(state, newsletter)).toBe(false);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("recomputes the package against the canonical release rather than trusting saved claim edits", async () => {
    // Simulated clinical metadata exists only in this unit test; it is never published.
    const pointer = fixturePointer();
    pointer.manifest.kind = "clinical";
    mock.read.mockResolvedValue({ revision: "fixture-kb-revision", state: pointer });
    const pkg = structuredClone(fixturePackage);
    pkg.result.matches[0]!.evidence.claims[0]!.claim_text = "unsupplied result";
    mock.current.mockResolvedValue({ evidence_package: pkg });
    expect(await generationContext("doctor", "run")).toBeNull();
  });
});
