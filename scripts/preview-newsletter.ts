import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fixturePackage, fixtureDraft } from "./fixtures/newsletter";
import { generateNewsletterDraft } from "../src/lib/msl/newsletter/databricks.server";
import { renderEvidence } from "../src/lib/msl/newsletter/content";
import { emailContent } from "../src/lib/msl/newsletter/publication";
import { renderEmail } from "../src/lib/msl/delivery/render";
import type { PublishedNewsletter } from "../src/lib/msl/newsletter/types";

const live = process.argv.includes("--live-model");
const generated = live ? await generateNewsletterDraft(fixturePackage) : null;
const articles = renderEvidence(generated?.draft ?? fixtureDraft, fixturePackage);
const newsletter = {
  articles: articles.map((a) => ({ ...a, id: "synthetic-preview" })),
} as unknown as PublishedNewsletter;
const render = renderEmail(
  emailContent(newsletter, "https://example.invalid", "https://example.invalid/unsubscribe"),
  true,
);
const dir = resolve(process.env["NEWSLETTER_PREVIEW_DIR"] ?? "artifacts/newsletter-preview");
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/preview.html`, render.html);
await writeFile(`${dir}/preview.txt`, render.text);
const metadata = {
  mode: live
    ? "synthetic fixture with verified live Databricks inference"
    : "offline deterministic synthetic fixture",
  clinical_publication: false,
  provider_calls: 0,
  email_sent: false,
  hosting: generated?.hosting ?? null,
  usage: generated?.usage ?? null,
  latency_ms: generated?.latency_ms ?? null,
};
await writeFile(`${dir}/verification.json`, JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ directory: dir, ...metadata }, null, 2));
