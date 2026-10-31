import { z } from "zod";
import {
  CANCER_TYPES,
  TOPICS,
  SPECIALTIES,
  PRACTICE_SETTINGS,
  FORMATS,
  FREQUENCIES,
} from "../options";

export const PROFILE_SCHEMA_VERSION = "doctor-profile.v1";
export const PROFILE_PROMPT_VERSION = "doctor-profiler.v1";

// Identifiers, patient data and names are deliberately excluded from the model input.
export const statedProfileSchema = z
  .object({
    years_in_practice: z.number().int().min(0).max(80).nullable(),
    practice_setting: z.enum(PRACTICE_SETTINGS).nullable(),
    specialty: z.enum(SPECIALTIES).nullable(),
    cancer_types: z.array(z.enum(CANCER_TYPES)).max(CANCER_TYPES.length),
    topics: z.array(z.enum(TOPICS)).max(TOPICS.length),
    preferred_format: z.enum(FORMATS).nullable(),
    frequency: z.enum(FREQUENCIES).nullable(),
  })
  .strict();
export type StatedProfile = z.infer<typeof statedProfileSchema>;

const focusSchema = z
  .object({
    cancer_type: z.enum(CANCER_TYPES),
    topic: z.enum(TOPICS),
  })
  .strict();
export const generatedProfileSchema = z
  .object({
    stated: statedProfileSchema,
    suggested_focus: z.array(focusSchema).max(6),
  })
  .strict();
export type GeneratedProfile = z.infer<typeof generatedProfileSchema>;

/** Pick trusted fields explicitly; never serialize an entire doctor row into a prompt. */
export function pickStatedProfile(row: Record<string, unknown>): StatedProfile {
  return statedProfileSchema.parse(
    Object.fromEntries(Object.keys(statedProfileSchema.shape).map((key) => [key, row[key]])),
  );
}

/** Deterministic gate: the model cannot add, omit, or alter any stated preference. */
export function validateGeneratedProfile(value: unknown, input: StatedProfile): GeneratedProfile {
  const output = generatedProfileSchema.parse(value);
  for (const key of Object.keys(statedProfileSchema.shape) as (keyof StatedProfile)[]) {
    if (JSON.stringify(output.stated[key]) !== JSON.stringify(input[key])) {
      throw new Error("profile_changed_stated_answer");
    }
  }
  const seen = new Set<string>();
  for (const focus of output.suggested_focus) {
    if (!input.cancer_types.includes(focus.cancer_type) || !input.topics.includes(focus.topic)) {
      throw new Error("profile_unsupported_focus");
    }
    const key = `${focus.cancer_type}:${focus.topic}`;
    if (seen.has(key)) throw new Error("profile_duplicate_focus");
    seen.add(key);
  }
  return output;
}

// JSON Schema is intentionally limited to the model endpoint's supported basic types and enums.
const nullableEnum = (values: readonly string[]) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
});
export const profileJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    stated: {
      type: "object",
      additionalProperties: false,
      properties: {
        years_in_practice: {
          anyOf: [{ type: "integer", minimum: 0, maximum: 80 }, { type: "null" }],
        },
        practice_setting: nullableEnum(PRACTICE_SETTINGS),
        specialty: nullableEnum(SPECIALTIES),
        cancer_types: { type: "array", items: { type: "string", enum: CANCER_TYPES } },
        topics: { type: "array", items: { type: "string", enum: TOPICS } },
        preferred_format: nullableEnum(FORMATS),
        frequency: nullableEnum(FREQUENCIES),
      },
      required: Object.keys(statedProfileSchema.shape),
    },
    suggested_focus: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          cancer_type: { type: "string", enum: CANCER_TYPES },
          topic: { type: "string", enum: TOPICS },
        },
        required: ["cancer_type", "topic"],
      },
    },
  },
  required: ["stated", "suggested_focus"],
};
