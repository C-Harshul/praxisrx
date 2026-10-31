import type { PublishedNewsletter } from "./types";
import type { EmailSafeContent } from "../delivery/types";

export function emailContent(
  newsletter: PublishedNewsletter,
  origin: string,
  unsubscribeUrl: string,
): EmailSafeContent {
  return {
    schema_version: "email-safe.v1",
    subject: "Your MSL evidence briefing",
    intro:
      "Reviewed research selected for your stated interests. Follow the sources and read the full articles in your library.",
    articles: newsletter.articles.map((a) => ({
      title: a.title,
      summary: a.short_summary,
      body: a.full_summary,
      article_url: `${origin}/library/articles/${encodeURIComponent(a.id)}`,
      sources: a.citations.map((c) => ({ number: c.number, title: c.title, url: c.url })),
    })),
    preferences_url: `${origin}/library`,
    unsubscribe_url: unsubscribeUrl,
    sender_name: "MSL Evidence Briefing",
  };
}
