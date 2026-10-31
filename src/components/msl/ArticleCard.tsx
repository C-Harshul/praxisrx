import { Link } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck, Users } from "lucide-react";
import { applicabilityLabel } from "@/lib/msl/rules";
import { useToggleBookmark } from "@/lib/msl/queries";
import type { Article } from "@/lib/msl/api";
import { cn } from "@/lib/utils";

export function CancerTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-primary/25 px-2.5 py-0.5 text-xs font-medium text-primary">
      {children}
    </span>
  );
}

export function ApplicabilityBadge({ percent }: { percent: number | null }) {
  const { text, inMix } = applicabilityLabel(percent);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
        inMix ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      <Users className="h-3.5 w-3.5" />
      {text}
    </span>
  );
}

export function BookmarkButton({
  articleId,
  bookmarked,
  withLabel,
}: {
  articleId: string;
  bookmarked: boolean;
  withLabel?: boolean;
}) {
  const toggle = useToggleBookmark();
  const Icon = bookmarked ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark article"}
      disabled={toggle.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate({ articleId, bookmarked });
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-md p-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        bookmarked ? "text-primary" : "text-muted-foreground hover:text-foreground",
        withLabel && "border px-3",
      )}
    >
      <Icon className={cn("h-5 w-5", bookmarked && "fill-primary-soft")} />
      {withLabel && (bookmarked ? "Bookmarked" : "Bookmark")}
    </button>
  );
}

export function ArticleCard({ article, bookmarked }: { article: Article; bookmarked: boolean }) {
  return (
    <article className="group relative rounded-xl border bg-card p-5 transition-shadow hover:border-primary/40 hover:shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-3">
          <CancerTag>{article.cancer_type}</CancerTag>
          <h3 className="text-lg font-semibold leading-snug text-foreground">
            <Link
              to="/library/articles/$id"
              params={{ id: article.id }}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
            >
              {article.title}
            </Link>
          </h3>
        </div>
        <div className="relative z-10">
          <BookmarkButton articleId={article.id} bookmarked={bookmarked} />
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{article.short_summary}</p>
      <div className="mt-4">
        <ApplicabilityBadge percent={article.applicability_percent} />
      </div>
    </article>
  );
}
