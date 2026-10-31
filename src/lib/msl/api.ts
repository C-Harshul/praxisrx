/** Browser data-access boundary. All active reads/writes go through the app server to Databricks. */
import { appRequest, loginApp, logoutApp } from "./platform/browser";
import type {
  Doctor,
  DoctorProfileUpdate,
  Newsletter,
  Article,
  Citation,
  ProfileJob,
} from "./platform/types";
import type { SyncSnapshot } from "./patient-sync/contract";
export type { Doctor, DoctorProfileUpdate, Newsletter, Article, Citation } from "./platform/types";
export type PatientMix = SyncSnapshot;
export type AuditAction =
  | "onboarding_completed"
  | "profile_updated"
  | "patient_data_linked"
  | "patient_data_unlinked"
  | "bookmark_added"
  | "bookmark_removed"
  | "article_opened";
export const logAudit = (action: AuditAction, details: Record<string, unknown> = {}) =>
  appRequest("audit", { action, details });
export const fetchDoctor = () => appRequest<Doctor>("doctor");
export const fetchNewsletterStatus = () =>
  appRequest<Awaited<ReturnType<typeof import("./newsletter/api.server").newsletterRead>>>(
    "newsletter_status",
  );
export const setEmailSubscription = (subscribed: boolean) =>
  appRequest("email_subscription", { subscribed });
export const retryNewsletter = (id: string) => appRequest("newsletter_retry", { id });
export const retryEmail = (id: string) => appRequest("email_retry", { id });
export const saveDoctorProfile = (update: DoctorProfileUpdate) =>
  appRequest("save_profile", { update });
export const completeOnboarding = (update: DoctorProfileUpdate) =>
  appRequest("complete_onboarding", { update });
export const updateProfile = (update: DoctorProfileUpdate, step: number) =>
  appRequest("update_profile", { update, step });
export type LinkResult =
  | { found: false }
  | {
      found: true;
      doctor_id_code: string;
      synced_at: string;
      aggregates: Record<string, number | null>;
    };
export const linkPatientData = (code: string, consent: boolean) =>
  appRequest<LinkResult>("link", { code, consent });
export const unlinkPatientData = () => appRequest("unlink", {});
export async function fetchPatientMix(code: string): Promise<PatientMix | null> {
  const mix = await appRequest<PatientMix | null>("patient_mix");
  return mix?.doctor_id_code === code ? mix : null;
}
export type NewsletterListItem = Newsletter & { article_count: number };
export const fetchNewsletters = () => appRequest<NewsletterListItem[]>("newsletters");
export const fetchNewsletter = (id: string) =>
  appRequest<(Newsletter & { articles: Article[] }) | null>("newsletter", undefined, "doctor", id);
export type ArticleDetail = Article & {
  citations: Citation[];
  newsletters: Pick<Newsletter, "id" | "title" | "sent_at"> | null;
};
export const fetchArticle = (id: string) =>
  appRequest<ArticleDetail | null>("article", undefined, "doctor", id);
export const recordArticleOpened = (id: string) => appRequest("article_opened", { id });
export type BookmarkItem = {
  created_at: string;
  article: Article & { newsletters: Pick<Newsletter, "sent_at"> | null };
};
export const fetchBookmarks = () => appRequest<BookmarkItem[]>("bookmarks");
export const addBookmark = (id: string) => appRequest("bookmark_add", { id });
export const removeBookmark = (id: string) => appRequest("bookmark_remove", { id });
export const fetchGeneratedProfile = () => appRequest<ProfileJob | null>("profile");
export const confirmGeneratedProfile = (input: {
  id: string;
  focus: { cancer_type: string; topic: string }[];
}) => appRequest("confirm_profile", input);
export const retryGeneratedProfile = () => appRequest("retry_profile", {});
async function hospitalRequest<T>(method: "GET" | "POST", input?: unknown): Promise<T> {
  const response = await fetch("/api/hospital", {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(method === "POST"
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Databricks hospital request failed.");
  return result;
}
export const fetchHospitalDirectory = () =>
  hospitalRequest<import("./hospital/contract").HospitalDirectory>("GET");
export const syncHospitalContext = (input: import("./hospital/contract").HospitalSyncInput) =>
  hospitalRequest<import("./hospital/contract").HospitalSyncReceipt>("POST", input);
export const signInHospital = (email: string, password: string) =>
  loginApp(email, password, "hospital");
export const signOutHospital = () => logoutApp("hospital");

/** Isolated reviewer endpoint; never shares doctor/staff role claims or sessions. */
export async function reviewRequest<T>(action: string, input: unknown = null): Promise<T> {
  const response = await fetch("/api/review", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error ?? "Review connection unavailable.") as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }
  return result as T;
}
