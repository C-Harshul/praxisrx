import type { EmailSafeContent, EmailRender } from "./types";
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
function safeUrl(url: string) {
  const value = new URL(url);
  if (value.protocol !== "https:" || value.username || value.password)
    throw new Error("email_url_invalid");
  return url;
}

/** Accept only the explicit source-based DTO; no doctor/package argument is permitted. */
export function renderEmail(dto: EmailSafeContent, preview = false): EmailRender {
  if (dto.schema_version !== "email-safe.v1" || /[\r\n]/.test(dto.subject))
    throw new Error("email_dto_invalid");
  const link = (url: string, text: string) =>
    `<a href="${escapeHtml(safeUrl(url))}">${escapeHtml(text)}</a>`;
  const content = dto.articles
    .map(
      (a) =>
        `<section style="margin:24px 0"><h2>${escapeHtml(a.title)}</h2><p>${escapeHtml(a.summary)}</p><p style="white-space:pre-line">${escapeHtml(a.body)}</p><p>${link(a.article_url, "Read the full cited article (sign in)")}</p><ol>${a.sources.map((s) => `<li value="${s.number}">${link(s.url, s.title)}</li>`).join("")}</ol></section>`,
    )
    .join("");
  const warning = preview
    ? "PREVIEW — NO EMAIL SENT. Synthetic demonstrations are not clinical evidence."
    : "";
  const text = [
    warning,
    dto.sender_name,
    dto.subject,
    dto.intro,
    ...dto.articles.flatMap((a) => [
      a.title,
      a.summary,
      a.body,
      `Full article (sign in): ${safeUrl(a.article_url)}`,
      ...a.sources.map((s) => `[${s.number}] ${s.title}: ${safeUrl(s.url)}`),
    ]),
    `Preferences: ${safeUrl(dto.preferences_url)}`,
    `Unsubscribe: ${safeUrl(dto.unsubscribe_url)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(dto.subject)}</title></head><body style="margin:0;background:#f4f6f8;color:#18232c;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:640px;margin:auto;padding:24px;background:white">${preview ? `<p role="note"><strong>${escapeHtml(warning)}</strong></p>` : ""}<p>${dto.sender_name}</p><h1>${escapeHtml(dto.subject)}</h1><p>${escapeHtml(dto.intro)}</p>${content}<footer><p>A person always decides what changes in their practice. AI reads, translates and cites. The doctor judges.</p>${link(dto.preferences_url, "Email preferences")} · ${link(dto.unsubscribe_url, "Unsubscribe")}</footer></main></body></html>`;
  if (Buffer.byteLength(html) + Buffer.byteLength(text) > 250000)
    throw new Error("email_render_too_large");
  return { subject: dto.subject, html, text, version: "email-render.v1" };
}
