import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { bookmarksQuery, newsletterQuery } from "@/lib/msl/queries";
import { ArticleCard } from "@/components/msl/ArticleCard";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/msl/States";

export const Route = createFileRoute("/_authenticated/_onboarded/library/newsletters/$id")({
  head: () => ({
    meta: [
      { title: "Newsletter — MSL" },
      { name: "description", content: "A personalised MSL research briefing with articles matched to your patients." },
      { property: "og:title", content: "Newsletter — MSL" },
      { property: "og:description", content: "A personalised MSL research briefing with articles matched to your patients." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewsletterPage,
});

function NewsletterPage() {
  const { id } = Route.useParams();
  const { data, isLoading, isError } = useQuery(newsletterQuery(id));
  const { data: bookmarks } = useQuery(bookmarksQuery);
  const marked = new Set(bookmarks?.map((b) => b.article.id));

  if (isLoading) return <LoadingBlock />;
  if (isError) return <ErrorBlock />;
  if (!data) return <EmptyState>This newsletter isn't available.</EmptyState>;

  return (
    <div>
      <Link to="/library" search={{ tab: "all" }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Library
      </Link>
      <header className="mt-6 max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {format(new Date(data.sent_at), "d MMMM yyyy")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">{data.title}</h1>
        <p className="reading mt-4 text-muted-foreground">{data.summary}</p>
      </header>
      <div className="mt-10 grid gap-4">
        {data.articles.map((a) => (
          <ArticleCard key={a.id} article={a} bookmarked={marked.has(a.id)} />
        ))}
      </div>
    </div>
  );
}
