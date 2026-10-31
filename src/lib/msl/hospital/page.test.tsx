import { type ComponentType } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Route } from "@/routes/hospital";
import * as api from "../api";
import { createHospitalSimulation } from "./simulation.server";
import type { HospitalDirectory } from "./contract";
vi.mock("../api", () => ({
  fetchDoctor: vi.fn(),
  fetchPatientMix: vi.fn(),
  fetchGeneratedProfile: vi.fn(),
  fetchNewsletters: vi.fn(),
  fetchNewsletter: vi.fn(),
  fetchArticle: vi.fn(),
  fetchBookmarks: vi.fn(),
  fetchPatientSyncHistory: vi.fn(),
  fetchHospitalDirectory: vi.fn(),
  syncHospitalContext: vi.fn(),
  signInHospital: vi.fn(),
  signOutHospital: vi.fn(),
}));
let client: QueryClient;
let directory: HospitalDirectory;
beforeEach(() => {
  directory = createHospitalSimulation().directory();
  vi.mocked(api.fetchHospitalDirectory).mockImplementation(async () => directory);
  vi.mocked(api.syncHospitalContext).mockImplementation(async (input) => ({
    ...input.payload,
    id: input.requestId,
    version: 1,
    source_kind: input.sourceKind,
    created_at: new Date().toISOString(),
    canonical_revision: "canonical-test-revision",
    publication: {
      schema_version: "hospital-publication.v1",
      status: "published",
      workspace_id: "7474660613250664",
      workspace_url: "https://dbc-85372395-9d08.cloud.databricks.com",
      record_id: "test-doctor",
      snapshot_id: input.requestId,
      hospital_id: "test-hospital",
    },
  }));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});
function mount() {
  const Page = Route.options.component as ComponentType;
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}
it("offers a standalone hospital workspace and uploads only reviewed aggregates", async () => {
  mount();
  await screen.findByText("Demo hospital");
  expect(screen.queryByRole("link", { name: "My profile" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Use demo patient panel/ }));
  const submit = screen.getByRole("button", { name: "Sync to doctor profile" });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I have reviewed this panel/));
  fireEvent.click(submit);
  await waitFor(() => expect(api.syncHospitalContext).toHaveBeenCalledTimes(1));
  const input = vi.mocked(api.syncHospitalContext).mock.calls[0]?.[0];
  expect(input?.payload.doctor_id_code).toBe("DR-1001");
  expect(input?.payload.panel_size).toBe(180);
  expect(JSON.stringify(input)).not.toContain("patient_id");
  expect(await screen.findByText(/Snapshot 1 saved/)).toBeInTheDocument();
});
it("requires hospital staff sign in independently of doctor onboarding", async () => {
  directory = {
    mode: "connected",
    authorized: false,
    hospital_name: "Hospital portal",
    doctors: [],
  };
  mount();
  expect(
    await screen.findByRole("heading", { name: "Hospital staff sign in" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Hospital patient data file")).not.toBeInTheDocument();
});
it("blocks CSV reads until synthetic-only confirmation", async () => {
  mount();
  const input = await screen.findByLabelText("Hospital patient data file");
  const file = new File(["sensitive"], "panel.csv");
  const read = vi.fn();
  Object.defineProperty(file, "text", { value: read });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /Confirm the CSV contains only synthetic/,
  );
  expect(read).not.toHaveBeenCalled();
});

it("reports Databricks publication only after the canonical upload succeeds", async () => {
  directory.mode = "connected";
  mount();
  const input = await screen.findByLabelText("Hospital patient data file");
  const payload = {
    doctor_id_code: "DR-1001",
    synced_at: "2026-10-30T09:00:00Z",
    panel_size: 180,
    min_cell_size: 5,
    aggregates: { NSCLC: 85 },
  };
  const file = new File([JSON.stringify(payload)], "panel.json");
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(payload) });
  let complete: (value: Awaited<ReturnType<typeof api.syncHospitalContext>>) => void = () => {};
  vi.mocked(api.syncHospitalContext).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByRole("button", { name: "Publish to Databricks" });
  fireEvent.click(screen.getByLabelText(/I have reviewed this panel/));
  fireEvent.click(screen.getByRole("button", { name: "Publish to Databricks" }));
  expect(screen.queryByText(/Snapshot 1 published/)).not.toBeInTheDocument();
  const publication = {
    schema_version: "hospital-publication.v1" as const,
    status: "published" as const,
    workspace_id: "7474660613250664" as const,
    workspace_url: "https://dbc-85372395-9d08.cloud.databricks.com" as const,
    record_id: "doctor",
    snapshot_id: "snapshot",
    hospital_id: "hospital",
  };
  await waitFor(() => expect(api.syncHospitalContext).toHaveBeenCalledTimes(1));
  complete({
    ...payload,
    id: "snapshot",
    version: 1,
    created_at: payload.synced_at,
    source_kind: "aggregate_json",
    canonical_revision: "test-revision",
    publication,
  });
  expect(
    await screen.findByText(/Snapshot 1 published to Databricks workspace 7474660613250664/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Publication revision: test-revision/)).toBeInTheDocument();
});
