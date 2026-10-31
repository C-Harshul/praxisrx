import type { Candidate, Review, Invalidation } from "./core";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type ReviewEntry = {
  candidate: Candidate;
  snapshot_hash: string;
  state_token: string;
  status: ReviewStatus;
  history: Review[];
  published: boolean;
  invalidations: Invalidation[];
};
export type ReleasePreview = {
  candidate_set_id: string;
  candidate_set_version: string;
  cutoff: string;
  token: string;
  current: { version: string; revision: string; published: boolean; item_count: number };
  items: { id: string; version: string; title: string }[];
  added: string[];
  removed: string[];
  changed: string[];
  excluded: { id: string; reason: string }[];
  errors: string[];
  replacement: true;
};
export type ReviewDirectory = {
  entries: ReviewEntry[];
  sets: { id: string; version: string }[];
  counts: Record<ReviewStatus, number>;
  reviewer: { id: string; can_publish: boolean };
  current: ReleasePreview["current"];
};
export type ReviewReceipt = {
  status: "recorded";
  review_id: string;
  item_id: string;
  item_version: string;
  decision: "approved" | "rejected";
  published: false;
};
export type PublishReceipt = {
  status: "available_to_matching";
  release_id: string;
  payload_hash: string;
  pointer_revision: string;
  item_count: number;
};
