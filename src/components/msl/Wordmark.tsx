import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function Wordmark({ className, asLink = true }: { className?: string; asLink?: boolean }) {
  const mark = (
    <span className={cn("wordmark inline-flex items-center gap-2 text-xl", className)}>
      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
      MSL
    </span>
  );
  if (!asLink) return mark;
  return (
    <Link to="/" aria-label="MSL home" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {mark}
    </Link>
  );
}

export const TAGLINE = "Your evidence briefing, for your patients";
