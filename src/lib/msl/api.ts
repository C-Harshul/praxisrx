/**
 * MSL data-access layer.
 *
 * Every read/write the UI performs goes through this module, so a future
 * backend job that writes newsletters/articles/citations into the database
 * needs no UI changes. All calls run as the signed-in doctor; row-level
 * security restricts results to their own data.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

export type Doctor = Database["public"]["Tables"]["doctors"]["Row"];
export type DoctorProfileUpdate = Pick<
  Database["public"]["Tables"]["doctors"]["Update"],
  | "full_name"
  | "years_in_practice"
  | "practice_setting"
  | "specialty"
  | "cancer_types"
  | "topics"
  | "preferred_format"
  | "frequency"
>;
export type PatientMix = Database["public"]["Tables"]["patient_mix"]["Row"];
export type Newsletter = Database["public"]["Tables"]["newsletters"]["Row"];
export type Article = Database["public"]["Tables"]["articles"]["Row"];
export type Citation = Database["public"]["Tables"]["citations"]["Row"];

export type AuditAction =
  | "onboarding_completed"
  | "profile_updated"
  | "patient_data_linked"
  | "patient_data_unlinked"
  | "bookmark_added"
  | "bookmark_removed"
  | "article_opened";

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not signed in");
  return data.user.id;
}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

/* ---------- audit ---------- */

export async function logAudit(action: AuditAction, details: Record<string, Json> = {}) {
  const doctor = await requireUserId();
  const { error } = await supabase.from("audit_log").insert({ doctor, action, details });
  fail(error);
}

/* ---------- doctor ---------- */

export async function fetchDoctor(): Promise<Doctor> {
  const id = await requireUserId();
  const { data, error } = await supabase.from("doctors").select("*").eq("id", id).maybeSingle();
  fail(error);
  if (data) return data;
  const ins = await supabase.from("doctors").insert({ id }).select("*").single();
  fail(ins.error);
  return ins.data!;
}

export async function saveDoctorProfile(update: DoctorProfileUpdate) {
  const id = await requireUserId();
  const { error } = await supabase.from("doctors").update(update).eq("id", id);
  fail(error);
}

export async function completeOnboarding(update: DoctorProfileUpdate) {
  const id = await requireUserId();
  const { error } = await supabase
    .from("doctors")
    .update({ ...update, onboarding_complete: true })
    .eq("id", id);
  fail(error);
  await logAudit("onboarding_completed");
}

export async function updateProfile(update: DoctorProfileUpdate, step: number) {
  await saveDoctorProfile(update);
  await logAudit("profile_updated", { step });
}

/* ---------- patient data ---------- */

export type LinkResult =
  | { found: false }
  | { found: true; doctor_id_code: string; synced_at: string; aggregates: Record<string, number> };

export async function linkPatientData(code: string, consent: boolean): Promise<LinkResult> {
  const { data, error } = await supabase.rpc("link_patient_data", {
    _code: code,
    _consent: consent,
  });
  fail(error);
  return data as unknown as LinkResult;
}

export async function unlinkPatientData() {
  const { error } = await supabase.rpc("unlink_patient_data");
  fail(error);
}

export async function fetchPatientMix(code: string): Promise<PatientMix | null> {
  const { data, error } = await supabase
    .from("patient_mix")
    .select("*")
    .eq("doctor_id_code", code)
    .maybeSingle();
  fail(error);
  return data;
}

/* ---------- newsletters & articles ---------- */

export type NewsletterListItem = Newsletter & { article_count: number };

export async function fetchNewsletters(): Promise<NewsletterListItem[]> {
  const { data, error } = await supabase
    .from("newsletters")
    .select("*, articles(count)")
    .order("sent_at", { ascending: false });
  fail(error);
  return (data ?? []).map(({ articles, ...n }) => ({
    ...n,
    article_count: (articles as unknown as { count: number }[])?.[0]?.count ?? 0,
  }));
}

export async function fetchNewsletter(id: string) {
  const { data, error } = await supabase
    .from("newsletters")
    .select("*, articles(*)")
    .eq("id", id)
    .order("position", { referencedTable: "articles", ascending: true })
    .maybeSingle();
  fail(error);
  return data as (Newsletter & { articles: Article[] }) | null;
}

export type ArticleDetail = Article & {
  citations: Citation[];
  newsletters: Pick<Newsletter, "id" | "title" | "sent_at"> | null;
};

export async function fetchArticle(id: string): Promise<ArticleDetail | null> {
  const { data, error } = await supabase
    .from("articles")
    .select("*, citations(*), newsletters(id, title, sent_at)")
    .eq("id", id)
    .order("number", { referencedTable: "citations", ascending: true })
    .maybeSingle();
  fail(error);
  return data as ArticleDetail | null;
}

export async function recordArticleOpened(articleId: string) {
  await logAudit("article_opened", { article: articleId });
}

/* ---------- bookmarks (audit rows are written by a database trigger) ---------- */

export type BookmarkItem = {
  created_at: string;
  article: Article & { newsletters: Pick<Newsletter, "sent_at"> | null };
};

export async function fetchBookmarks(): Promise<BookmarkItem[]> {
  const { data, error } = await supabase
    .from("bookmarks")
    .select("created_at, article:articles(*, newsletters(sent_at))")
    .order("created_at", { ascending: false });
  fail(error);
  return ((data ?? []) as unknown as BookmarkItem[]).filter((b) => b.article);
}

export async function addBookmark(articleId: string) {
  const doctor = await requireUserId();
  const { error } = await supabase.from("bookmarks").insert({ doctor, article: articleId });
  if (error && !error.message.includes("duplicate")) throw new Error(error.message);
}

export async function removeBookmark(articleId: string) {
  const doctor = await requireUserId();
  const { error } = await supabase
    .from("bookmarks")
    .delete()
    .eq("doctor", doctor)
    .eq("article", articleId);
  fail(error);
}
