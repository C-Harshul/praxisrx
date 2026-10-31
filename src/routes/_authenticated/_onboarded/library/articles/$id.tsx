import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { articleQuery, bookmarksQuery } from "@/lib/msl/queries";
import { recordArticleOpened } from "@/lib/msl/api";
import { splitCitations } from "@/lib/msl/rules";
import { ApplicabilityBadge, BookmarkButton, CancerTag } from "@/components/msl/ArticleCard";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/msl/States";

export const Route = createFileRoute("/_authenticated/_onboarded/library/articles/$id")({
  head: () => ({
    meta: [
      { title: "Article — MSL" },
      { name: "description", content: "Research summary with coverage notes and full citations." },
      { property: "og:title", content: "Article — MSL" },
      { property: "og:description", content: "Research summary with coverage notes and full citations." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ArticlePage,
});

function jumpTo(n: number) {
  const el = document.getElementById(`source-${n}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("source-flash");
  void el.offsetWidth;
  el.classList.add("source-flash");
}

function CitedParagraphs({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-4">
      {paragraphs.map((p, i) => (
        <p key={i} className="reading text-foreground">
          {splitCitations(p).map((seg, j) =>
            seg.type === "text" ? (
              <span key={j}>{seg.value}</span>
            ) : (
              <a
                key={j}
                href={`#source-${seg.n}`}
                onClick={(e) => {
                  e.preventDefault();
                  jumpTo(seg.n);
                }}
                className="ml-0.5 align-super text-xs font-semibold text-primary hover:underline"
                aria-label={`Source ${seg.n}`}
              >
                [{seg.n}]
              </a>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

function ArticlePage() {
  const { id } = Route.useParams();
  const { data, isLoading, isError } = useQuery(articleQuery(id));
  const { data: bookmarks } = useQuery(bookmarksQuery);
  const logged = useRef<string | null>(null);

  useEffect(() => {
    if (data && logged.current !== data.id) {
      logged.current = data.id;
      recordArticleOpened(data.id).catch(() => {});
    }
  }, [data]);

  if (isLoading) return <LoadingBlock />;
  if (isError) return <ErrorBlock />;
  if (!data) return <EmptyState>This article isn't available.</EmptyState>;

  const bookmarked = !!bookmarks?.some((b) => b.article.id === data.id);

  return (
    <article className="mx-auto max-w-3xl">
      {data.newsletters ? (
        <Link
          to="/library/newsletters/$id"
          params={{ id: data.newsletters.id }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {data.newsletters.title}
        </Link>
      ) : (
        <Link to="/library" search={{ tab: "all" }} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Library
        </Link>
      )}

      <header className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CancerTag>{data.cancer_type}</CancerTag>
          <BookmarkButton articleId={data.id} bookmarked={bookmarked} withLabel />
        </div>
        <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">{data.title}</h1>
        <div className="mt-4">
          <ApplicabilityBadge percent={data.applicability_percent} />
        </div>
      </header>

      <section className="mt-10">
        <h2 className="sr-only">Summary</h2>
        <CitedParagraphs text={data.full_summary} />
      </section>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border bg-primary-soft/40 p-5">
          <h2 className="text-lg font-semibold">Who this evidence covers</h2>
          <div className="mt-3">
            <CitedParagraphs text={data.covers_text} />
          </div>
        </section>
        <section className="rounded-xl border p-5">
          <h2 className="text-lg font-semibold">Who it does not cover</h2>
          <div className="mt-3">
            <CitedParagraphs text={data.not_covers_text} />
          </div>
        </section>
      </div>

      <section className="mt-12 border-t pt-8">
        <h2 className="text-xl font-semibold">Sources</h2>
        <ol className="mt-4 space-y-2">
          {data.citations.map((c) => (
            <li key={c.id} id={`source-${c.number}`} className="flex gap-3 rounded-lg p-3 text-sm">
              <span className="w-6 shrink-0 font-semibold text-primary">[{c.number}]</span>
              <div className="min-w-0">
                <p className="text-foreground">
                  <span className="font-medium">{c.source_name}</span> · {c.title}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-muted-foreground">
                  {c.published_date && <span>{format(new Date(c.published_date), "d MMM yyyy")}</span>}
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Open source <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
