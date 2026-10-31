import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Route } from "@/routes/review";
import type { ComponentType } from "react";
const ReviewPage = Route.options.component as ComponentType;
import { reviewRequest } from "../api";
import type { ReviewDirectory, ReviewEntry, ReleasePreview } from "./review-contract";
vi.mock("../api", () => ({ reviewRequest: vi.fn() }));
let client: QueryClient, directory: ReviewDirectory, entry: ReviewEntry, preview: ReleasePreview;
beforeEach(() => {
  const candidate = JSON.parse(
    readFileSync("kb/exports/synthetic-worked-example.json", "utf8"),
  ).candidate;
  entry = {
    candidate,
    snapshot_hash: "a".repeat(64),
    state_token: "b".repeat(64),
    status: "pending",
    history: [],
    published: false,
    invalidations: [],
  };
  const current = {
    version: "fixture-empty",
    revision: "revision",
    published: true,
    item_count: 0,
  };
  directory = {
    entries: [entry],
    sets: [{ id: "fixture-set", version: "c".repeat(64) }],
    counts: { pending: 1, approved: 0, rejected: 0 },
    reviewer: { id: "UNIT-TEST-reviewer", can_publish: true },
    current,
  };
  preview = {
    candidate_set_id: "fixture-set",
    candidate_set_version: "c".repeat(64),
    cutoff: "2026-10-30",
    token: "d".repeat(64),
    current,
    items: [],
    added: [],
    removed: [],
    changed: [],
    excluded: [{ id: candidate.id, reason: "No authorized approval" }],
    errors: [],
    replacement: true,
  };
  vi.mocked(reviewRequest).mockImplementation(async (action) =>
    action === "list"
      ? directory
      : action === "detail"
        ? entry
        : action === "preview"
          ? preview
          : (null as never),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});
function mount() {
  render(
    <QueryClientProvider client={client}>
      <ReviewPage />
    </QueryClientProvider>,
  );
}
it("shows canonical candidate detail and requires note plus human attestation before saving", async () => {
  mount();
  await screen.findByText("Research candidates");
  fireEvent.click(screen.getByRole("button", { name: entry.candidate.title }));
  await screen.findByText("Claims and supporting passages");
  const approve = screen.getByRole("button", { name: "Approve exact version" });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /Review note/ }), {
    target: { value: "UNIT TEST fictional review note." },
  });
  fireEvent.click(screen.getByLabelText(/I personally reviewed/));
  expect(approve).toBeEnabled();
  let resolve!: (v: unknown) => void;
  vi.mocked(reviewRequest).mockImplementation(async (action) =>
    action === "review"
      ? new Promise((r) => {
          resolve = r;
        })
      : action === "list"
        ? directory
        : (entry as never),
  );
  fireEvent.click(approve);
  await waitFor(() => expect(approve).toBeDisabled());
  expect(screen.queryByText(/Decision acknowledged/)).toBeNull();
  resolve({ status: "recorded", decision: "approved", published: false });
  await screen.findByText(/Decision acknowledged in Databricks/);
  expect(screen.getByText(/Approval is not publication/)).toBeInTheDocument();
});
it("shows errors without false success and requires explicit replacement confirmation", async () => {
  mount();
  await screen.findByText("Research candidates");
  fireEvent.click(screen.getByRole("button", { name: "Preview complete release" }));
  await screen.findByText(/No approved eligible items/);
  const publish = screen.getByRole("button", { name: "Publish reviewed release" });
  expect(publish).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I confirm this complete membership/));
  expect(publish).toBeEnabled();
  vi.mocked(reviewRequest).mockImplementation(async (action) => {
    if (action === "publish") throw new Error("Publication unconfirmed");
    return directory as never;
  });
  fireEvent.click(publish);
  await screen.findByText(/Publication unconfirmed/);
  expect(screen.queryByText(/^Available to matching:/)).toBeNull();
});
it("shows canonical read failure instead of locally substituted candidates", async () => {
  vi.mocked(reviewRequest).mockRejectedValue(new Error("Databricks unavailable"));
  mount();
  await screen.findByText("Databricks unavailable");
  expect(screen.queryByText("Research candidates")).toBeNull();
});
