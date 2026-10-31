import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bookmark, ChevronRight, Inbox } from "lucide-react";
import { bookmarksQuery, newslettersQuery } from "@/lib/msl/queries";
import { ArticleCard } from "@/components/msl/ArticleCard";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/msl/States";
import { cn } from "@/lib/utils";
import { NewsletterDelivery } from "@/components/msl/NewsletterDelivery";

export const Route = createFileRoute("/_authenticated/_onboarded/library/")({
  validateSearch: (s: Record<string, unknown>): { tab?: "all" | "bookmarked" } =>
    s["tab"] === "bookmarked" ? { tab: "bookmarked" } : {},
  head: () => ({
    meta: [
      { title: "Library — MSL" },
      { name: "description", content: "Your MSL newsletters and bookmarked research articles." },
      { property: "og:title", content: "Library — MSL" },
      {
        property: "og:description",
        content: "Your MSL newsletters and bookmarked research articles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const tab = Route.useSearch().tab ?? "all";
  const navigate = useNavigate({ from: "/library/" });
  const tabs = [
    { id: "all", label: "All newsletters" },
    { id: "bookmarked", label: "Bookmarked" },
  ] as const;

  return (
    <div>
      <h1 className="text-3xl font-semibold sm:text-4xl">Library</h1>
      <NewsletterDelivery />
      <div className="mt-8 flex gap-6 border-b" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => navigate({ search: t.id === "all" ? {} : { tab: t.id } })}
            className={cn(
              "-mb-px border-b-2 pb-3 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-8">{tab === "all" ? <AllNewsletters /> : <Bookmarked />}</div>
    </div>
  );
}

function AllNewsletters() {
  const { data, isLoading, isError } = useQuery(newslettersQuery);
  if (isLoading) return <LoadingBlock />;
  if (isError) return <ErrorBlock />;
  if (!data?.length)
    return (
      <EmptyState icon={<Inbox className="h-8 w-8" />}>
        No published newsletters yet. Preparation requires a confirmed profile and reviewed
        evidence. Preview and delivery status appear above.
      </EmptyState>
    );
  return (
    <ul className="divide-y rounded-xl border">
      {data.map((n) => (
        <li key={n.id}>
          <Link
            to="/library/newsletters/$id"
            params={{ id: n.id }}
            className="flex items-center gap-4 px-5 py-5 transition-colors hover:bg-muted/60 sm:px-6"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {format(new Date(n.sent_at), "d MMMM yyyy")}
              </p>
              <p className="mt-1 font-display text-lg font-semibold text-foreground">{n.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {n.article_count} {n.article_count === 1 ? "article" : "articles"}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Bookmarked() {
  const { data, isLoading, isError } = useQuery(bookmarksQuery);
  if (isLoading) return <LoadingBlock />;
  if (isError) return <ErrorBlock />;
  if (!data?.length)
    return <EmptyState icon={<Bookmark className="h-8 w-8" />}>No bookmarks yet.</EmptyState>;
  return (
    <div className="grid gap-4">
      {data.map((b) => (
        <ArticleCard key={b.article.id} article={b.article} bookmarked />
      ))}
    </div>
  );
}
