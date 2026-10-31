import { orderedAggregates } from "@/lib/msl/rules";

export function AggregateBars({ aggregates, compact }: { aggregates: unknown; compact?: boolean }) {
  const rows = orderedAggregates(aggregates as Record<string, unknown>);
  const shown = compact ? rows.slice(0, 4) : rows;
  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {shown.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-foreground">{r.label}</span>
            <span className="font-medium tabular-nums text-primary">{Math.round(r.value)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, r.value))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
