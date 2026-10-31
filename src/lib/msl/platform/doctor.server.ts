import { z } from "zod";
import { randomUUID } from "node:crypto";
import { statedProfileSchema, validateGeneratedProfile } from "../profiling/contract";
import { mutateDoctor, readRecord, audit } from "./store.server";
import { queueProfile } from "./profile-state";
import type { DoctorState } from "./types";
const updateSchema = statedProfileSchema
  .extend({ full_name: z.string().trim().min(1).max(120).nullable() })
  .partial()
  .strict();
const focusSchema = z
  .array(z.object({ cancer_type: z.string(), topic: z.string() }).strict())
  .max(6);
export async function doctorRead(id: string, action: string, itemId?: string) {
  const snapshot = await readRecord<DoctorState>("doctor", id);
  if (!snapshot || snapshot.state.schema_version !== "msl-app-state.v1")
    throw new Error("Doctor is not provisioned in Databricks.");
  const state = snapshot.state;
  switch (action) {
    case "newsletter_status": {
      const { newsletterRead } = await import("../newsletter/api.server");
      return newsletterRead(id);
    }
    case "doctor":
      return state.doctor;
    case "profile":
      return state.profiles.at(-1) ?? null;
    case "patient_mix":
      return state.doctor.patient_data_linked && state.doctor.consent_given_at
        ? state.patient_mix
        : null;
    case "newsletters":
      return state.newsletters.map(({ articles, ...n }) => ({
        ...n,
        article_count: articles.length,
      }));
    case "newsletter":
      return state.newsletters.find((n) => n.id === itemId) ?? null;
    case "article": {
      const n = state.newsletters.find((n) => n.articles.some((a) => a.id === itemId));
      return n
        ? {
            ...n.articles.find((a) => a.id === itemId),
            newsletters: { id: n.id, title: n.title, sent_at: n.sent_at },
          }
        : null;
    }
    case "bookmarks":
      return state.bookmarks.flatMap((b) => {
        const n = state.newsletters.find((n) => n.articles.some((a) => a.id === b.article));
        return n
          ? [
              {
                created_at: b.created_at,
                article: {
                  ...n.articles.find((a) => a.id === b.article),
                  newsletters: { sent_at: n.sent_at },
                },
              },
            ]
          : [];
      });
    default:
      throw new Error("Unsupported read.");
  }
}
export async function doctorWrite(id: string, action: string, raw: unknown) {
  if (["email_subscription", "newsletter_retry", "email_retry"].includes(action)) {
    const { newsletterWrite } = await import("../newsletter/api.server");
    return newsletterWrite(id, action, raw);
  }
  return mutateDoctor(id, (state) => {
    switch (action) {
      case "save_profile":
      case "complete_onboarding":
      case "update_profile": {
        const input = z
          .object({ update: updateSchema, step: z.number().int().min(1).max(5).optional() })
          .strict()
          .parse(raw);
        Object.assign(state.doctor, input.update);
        if (action === "complete_onboarding") {
          if (!state.doctor.full_name?.trim()) throw new Error("Name is required.");
          state.doctor.onboarding_complete = true;
        }
        state.doctor.updated_at = new Date().toISOString();
        queueProfile(state);
        audit(state, id, action, {
          step: input.step ?? null,
          profile_id: state.profiles.at(-1)?.id ?? null,
        });
        return null;
      }
      case "link": {
        const input = z
          .object({ code: z.string().trim().max(40), consent: z.literal(true) })
          .strict()
          .parse(raw);
        if (input.code.toUpperCase() !== state.assigned_code) return { found: false };
        const changed = !state.doctor.patient_data_linked;
        if (!changed && state.doctor.consent_given_at)
          return {
            found: true,
            doctor_id_code: state.assigned_code,
            synced_at: state.patient_mix?.synced_at ?? state.doctor.consent_given_at,
            aggregates: state.patient_mix?.aggregates ?? {},
          };
        state.doctor.doctor_id_code = state.assigned_code;
        state.doctor.patient_data_linked = true;
        state.doctor.consent_given_at = new Date().toISOString();
        // Relinking never reactivates prior uploads.
        if (changed) state.patient_mix = null;
        queueProfile(state);
        audit(state, id, "patient_data_linked");
        return {
          found: true,
          doctor_id_code: state.assigned_code,
          synced_at: state.patient_mix?.synced_at ?? state.doctor.consent_given_at,
          aggregates: state.patient_mix?.aggregates ?? {},
        };
      }
      case "unlink":
        state.doctor.doctor_id_code = null;
        state.doctor.patient_data_linked = false;
        state.doctor.consent_given_at = null;
        state.patient_mix = null;
        queueProfile(state);
        audit(state, id, "patient_data_unlinked");
        return null;
      case "confirm_profile": {
        const input = z.object({ id: z.string().uuid(), focus: focusSchema }).strict().parse(raw);
        const job = state.profiles.at(-1);
        if (!job || job.id !== input.id || job.status !== "succeeded" || !job.output)
          throw new Error("Profile is no longer current.");
        validateGeneratedProfile(job.output, job.input);
        if (
          input.focus.some(
            (f) =>
              !job.output!.suggested_focus.some(
                (original) => original.cancer_type === f.cancer_type && original.topic === f.topic,
              ),
          )
        )
          throw new Error("Unsupported focus selection.");
        if (job.confirmed_at) return null;
        job.reviewed_focus = input.focus as typeof job.reviewed_focus;
        job.confirmed_at = new Date().toISOString();
        audit(state, id, "profiling_confirmed", { job_id: job.id });
        return null;
      }
      case "retry_profile": {
        const latest = state.profiles.at(-1);
        if (
          latest &&
          (latest.status !== "failed" || Date.now() - Date.parse(latest.created_at) < 60000)
        )
          throw new Error("Only failed profiles can be retried after one minute.");
        queueProfile(state);
        audit(state, id, "profiling_queued", { job_id: state.profiles.at(-1)?.id });
        return null;
      }
      case "bookmark_add":
      case "bookmark_remove":
      case "article_opened": {
        const input = z.object({ id: z.string().uuid() }).strict().parse(raw);
        if (!state.newsletters.some((n) => n.articles.some((a) => a.id === input.id)))
          throw new Error("Article not available.");
        if (action === "bookmark_add" && !state.bookmarks.some((b) => b.article === input.id))
          state.bookmarks.push({ article: input.id, created_at: new Date().toISOString() });
        if (action === "bookmark_remove")
          state.bookmarks = state.bookmarks.filter((b) => b.article !== input.id);
        audit(state, id, action, { article: input.id });
        return null;
      }
      case "audit": {
        const input = z
          .object({
            action: z.enum(["article_opened", "profile_updated", "onboarding_completed"]),
            details: z.record(z.unknown()),
          })
          .strict()
          .parse(raw);
        audit(state, id, input.action, input.details);
        return null;
      }
      default:
        throw new Error("Unsupported write.");
    }
  });
}
