import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hash, buildRelease, reviewSchema } from "./core";
import type { Candidate } from "./core";
import type { Pointer, RecordValue } from "./store.server";
const db = vi.hoisted(() => ({
  rows: [] as RecordValue[],
  p: null as Pointer | null,
  failRead: false,
  failInsert: false,
  failCommit: false,
  busy: false,
  onInsert: null as null | (() => void),
  inserts: 0,
}));
vi.mock("./store.server", async () => {
  const original = await vi.importActual<typeof import("./store.server")>("./store.server");
  return {
    ...original,
    readRecords: vi.fn(async () => {
      if (db.failRead) throw new Error("offline");
      return structuredClone(db.rows);
    }),
    readPointer: vi.fn(async () => structuredClone(db.p)),
    insertRecords: vi.fn(async (values: RecordValue[]) => {
      if (db.failInsert) throw new Error("write unavailable");
      db.inserts++;
      for (const v of values) {
        const old = db.rows.find(
          (r) => r.kind === v.kind && r.id === v.id && r.version === v.version,
        );
        if (!old) db.rows.push(structuredClone(v));
      }
      db.rows.sort((a, b) => (a.kind + a.id + a.version).localeCompare(b.kind + b.id + b.version));
      db.onInsert?.();
    }),
    commitPointer: vi.fn(async (next: Pointer["state"], expected: Pointer) => {
      if (db.failCommit) throw new Error("unconfirmed");
      if (db.p?.revision !== expected.revision)
        throw new original.KBError("Canonical KB changed. Refresh before retrying.");
      db.p = { revision: randomUUID(), state: structuredClone(next) };
      return structuredClone(db.p);
    }),
    withKBWrite: vi.fn(async (work: (locked: Pointer, original: Pointer) => Promise<unknown>) => {
      if (db.busy)
        throw new original.KBError("Another KB write is in progress. Refresh and retry.");
      db.busy = true;
      try {
        const original = structuredClone(db.p!);
        return await work(original, original);
      } finally {
        db.busy = false;
      }
    }),
  };
});
import { hashPassword, signIn } from "../platform/auth.server";
import {
  listReview,
  detailReview,
  saveReview,
  previewRelease,
  publishReviewRelease,
  fingerprint,
} from "./review.server";
import { handleReviewRequest } from "./http.server";
const origin = "http://localhost:8081",
  account = "00000000-0000-4000-8000-000000000031",
  actor = "unit-test-reviewer";
let cookie = "",
  candidate: Candidate,
  setId = "";
const req = (cookieValue = cookie, suppliedOrigin = origin) =>
  new Request(origin + "/api/review", {
    method: "POST",
    headers: { origin: suppliedOrigin, cookie: cookieValue },
  });
const add = (kind: string, id: string, version: string, payload: unknown) =>
  db.rows.push({ kind, id, version, payload });
const decision = () => ({
  request_id: randomUUID(),
  item_id: candidate.id,
  item_version: candidate.version,
  snapshot_hash: hash(candidate),
  state_token: fingerprint(db.rows, db.p!),
  decision: "approved",
  note: "UNIT TEST ONLY: inspected the fictional fixture.",
  human_attestation: true,
});
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("APP_SESSION_SECRET", "test-only-secret".repeat(4));
  const password_hash = await hashPassword("unit-test-password");
  vi.stubEnv(
    "APP_ACCOUNTS_JSON",
    JSON.stringify([
      { id: account, email: "reviewer@example.invalid", role: "reviewer", password_hash },
      {
        id: "00000000-0000-4000-8000-000000000032",
        email: "doctor@example.invalid",
        role: "doctor",
        password_hash,
      },
      {
        id: "00000000-0000-4000-8000-000000000033",
        email: "staff@example.invalid",
        role: "hospital",
        password_hash,
      },
    ]),
  );
  vi.stubEnv("KB_AUTHORIZED_REVIEWERS", actor);
  vi.stubEnv(
    "KB_REVIEWER_REGISTRY_JSON",
    JSON.stringify([{ account_id: account, reviewer_id: actor, can_publish: true }]),
  );
  cookie = (
    await signIn(req(""), {
      email: "reviewer@example.invalid",
      password: "unit-test-password",
      role: "reviewer",
    })
  ).cookie;
  candidate = JSON.parse(
    readFileSync("kb/exports/synthetic-worked-example.json", "utf8"),
  ).candidate;
  // Isolated mock storage only: exercise clinical-shape gating without authoring real reviews.
  candidate.synthetic = false;
  candidate.version = "";
  candidate.version = hash(candidate);
  const release = buildRelease([], [], [], [], "2026-10-30");
  db.p = {
    revision: randomUUID(),
    state: {
      version: release.manifest.release_id,
      payload: release.payload,
      published: true,
      manifest: release.manifest,
      audit: [],
    },
  };
  db.rows = [];
  db.failRead = false;
  db.failInsert = false;
  db.failCommit = false;
  db.busy = false;
  db.onInsert = null;
  db.inserts = 0;
  add("evidence_item", candidate.id, candidate.version, candidate);
  for (const s of candidate.sources) add("document", s.id, s.version, s);
  for (const c of candidate.claims) add("claim", c.id, c.version, c);
  const selection = { members: [{ id: candidate.id, version: candidate.version }] };
  setId = `candidate-set-${hash(selection)}`;
  add("candidate_set", setId, hash(selection), selection);
});
afterEach(() => vi.unstubAllEnvs());
describe("canonical reviewer services (isolated fixture storage)", () => {
  it("denies anonymous, doctor, staff and unregistered reviewer sessions on every operation", async () => {
    for (const role of ["doctor", "hospital"] as const) {
      const email = role === "doctor" ? "doctor@example.invalid" : "staff@example.invalid";
      const session = await signIn(req(""), { email, password: "unit-test-password", role });
      await expect(listReview(req(session.cookie))).rejects.toThrow("Not signed in");
      await expect(saveReview(req(session.cookie), decision())).rejects.toThrow("Not signed in");
      await expect(publishReviewRelease(req(session.cookie), {})).rejects.toThrow("Not signed in");
    }
    await expect(listReview(req(""))).rejects.toThrow();
    vi.stubEnv("KB_REVIEWER_REGISTRY_JSON", "[]");
    await expect(listReview(req())).rejects.toThrow("permission");
  });
  it("reads canonical list/detail and fails without local fixture fallback", async () => {
    expect((await listReview(req())).counts).toEqual({ pending: 1, approved: 0, rejected: 0 });
    expect((await detailReview(req(), candidate.id, candidate.version)).candidate.version).toBe(
      candidate.version,
    );
    db.failRead = true;
    await expect(listReview(req())).rejects.toThrow("offline");
  });
  it("records exact human attestation and audit but does not publish; retries are idempotent", async () => {
    const input = decision();
    const result = await saveReview(req(), input);
    expect(result).toMatchObject({ status: "recorded", published: false });
    const stored = reviewSchema.parse(db.rows.find((r) => r.kind === "review")!.payload);
    expect(stored).toMatchObject({
      reviewer: actor,
      item_version: candidate.version,
      snapshot_hash: hash(candidate),
    });
    expect(db.rows.some((r) => r.kind === "audit")).toBe(true);
    expect((db.p!.state.payload as { items: unknown[] }).items).toHaveLength(0);
    expect(await saveReview(req(), input)).toEqual(result);
    expect(db.inserts).toBe(1);
    await expect(
      saveReview(req(), { ...input, note: "Changed duplicate request content." }),
    ).rejects.toThrow("reused");
  });
  it("rejects stale pages and changed candidates instead of reusing approval", async () => {
    const input = decision();
    candidate.funding = "changed fixture disclosure";
    candidate.version = "";
    candidate.version = hash(candidate);
    add("evidence_item", candidate.id, candidate.version, candidate);
    await expect(saveReview(req(), input)).rejects.toThrow("snapshot changed");
    expect(db.rows.filter((r) => r.kind === "review")).toHaveLength(0);
  });
  it("keeps rejection precedence and prevents approval of the same rejected version", async () => {
    await saveReview(req(), { ...decision(), decision: "rejected" });
    expect((await listReview(req())).counts.rejected).toBe(1);
    await expect(saveReview(req(), decision())).rejects.toThrow("new candidate version");
    expect(
      (await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" })).items,
    ).toHaveLength(0);
  });
  it("pins preview membership, publishes strict matcher evidence and recovers identical retries", async () => {
    await saveReview(req(), decision());
    const preview = await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" });
    expect(preview.items).toHaveLength(1);
    expect(preview.added).toEqual([candidate.id]);
    const input = {
      request_id: randomUUID(),
      candidate_set_id: setId,
      cutoff: preview.cutoff,
      preview_token: preview.token,
      confirm_replacement: true,
    };
    const published = await publishReviewRelease(req(), input);
    expect(published).toMatchObject({ status: "available_to_matching", item_count: 1 });
    expect((await listReview(req())).entries[0]!.published).toBe(true);
    expect(await publishReviewRelease(req(), input)).toEqual(published);
  });
  it("invalidates previews after concurrent review/state changes and retains prior release on failed writes", async () => {
    const preview = await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" });
    const input = {
      request_id: randomUUID(),
      candidate_set_id: setId,
      cutoff: preview.cutoff,
      preview_token: preview.token,
      confirm_replacement: true,
    };
    await saveReview(req(), decision());
    await expect(publishReviewRelease(req(), input)).rejects.toThrow("preview changed");
    const fresh = await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" });
    const old = structuredClone(db.p!.state.payload);
    db.failInsert = true;
    await expect(
      publishReviewRelease(req(), { ...input, preview_token: fresh.token }),
    ).rejects.toThrow();
    expect(db.p!.state.payload).toEqual(old);
  });
  it("excludes unapproved, invalidated and synthetic evidence with explicit reasons", async () => {
    expect(
      (await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" })).excluded[0]!
        .reason,
    ).toContain("No authorized approval");
    await saveReview(req(), decision());
    add("invalidation", "unit-test-invalidation", "v1", {
      id: "unit-test-invalidation",
      item_id: candidate.id,
      item_version: candidate.version,
      kind: "retracted",
      reason: "Unit-test fictional invalidation",
      actor,
      created_at: new Date().toISOString(),
    });
    const preview = await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" });
    expect(preview.items).toHaveLength(0);
    expect(preview.excluded[0]!.reason).toContain("invalidated");
  });
  it("rejects busy writers, stale CAS and unacknowledged publication", async () => {
    db.busy = true;
    await expect(saveReview(req(), decision())).rejects.toThrow("in progress");
    db.busy = false;
    await saveReview(req(), decision());
    const preview = await previewRelease(req(), { candidate_set_id: setId, cutoff: "2026-10-30" });
    db.onInsert = () => {
      db.p!.revision = randomUUID();
    };
    await expect(
      publishReviewRelease(req(), {
        request_id: randomUUID(),
        candidate_set_id: setId,
        cutoff: preview.cutoff,
        preview_token: preview.token,
        confirm_replacement: true,
      }),
    ).rejects.toThrow("changed");
    expect((db.p!.state.payload as { items: unknown[] }).items).toHaveLength(0);
  });
  it("handles the real HTTP sign-in body without reusing its consumed request stream", async () => {
    const request = new Request(origin + "/api/review", {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({
        action: "sign_in",
        input: { email: "reviewer@example.invalid", password: "unit-test-password" },
      }),
    });
    const response = await handleReviewRequest(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("msl_reviewer_session=");
  });
  it("recovers review requests after an ambiguous post-write acknowledgment with a refreshed token", async () => {
    const input = decision();
    db.failCommit = true;
    await expect(saveReview(req(), input)).rejects.toThrow("unconfirmed");
    db.failCommit = false;
    db.p!.revision = randomUUID();
    const result = await saveReview(req(), { ...input, state_token: fingerprint(db.rows, db.p!) });
    expect(result.status).toBe("recorded");
    expect(db.rows.filter((r) => r.kind === "review")).toHaveLength(1);
  });
  it("protects the HTTP boundary from cross-origin writes, editable actors and overbroad roles", async () => {
    const post = (body: unknown, foreign = false) =>
      new Request(origin + "/api/review", {
        method: "POST",
        headers: {
          origin: foreign ? "https://foreign.invalid" : origin,
          cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (await handleReviewRequest(post({ action: "review", input: decision() }, true))).status,
    ).toBe(403);
    expect(
      (
        await handleReviewRequest(
          post({ action: "review", input: { ...decision(), reviewer: "forged" } }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleReviewRequest(
          post({
            action: "sign_in",
            input: {
              email: "reviewer@example.invalid",
              password: "unit-test-password",
              role: "doctor",
            },
          }),
        )
      ).status,
    ).toBe(400);
    vi.stubEnv(
      "KB_REVIEWER_REGISTRY_JSON",
      JSON.stringify([{ account_id: account, reviewer_id: actor, can_publish: false }]),
    );
    expect((await handleReviewRequest(post({ action: "publish", input: {} }))).status).toBe(403);
  });
});
