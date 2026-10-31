import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  options: readonly string[];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  multiple?: boolean;
  hint?: string;
};

export function ChoiceChips({ label, options, value, onChange, multiple, hint }: Props) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  function toggle(o: string) {
    if (multiple) {
      onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
    } else {
      onChange(o);
    }
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      {hint && <p className="-mt-1 text-sm text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2" role={multiple ? "group" : "radiogroup"}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => toggle(o)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "border-primary bg-primary-soft text-primary-soft-foreground"
                  : "border-input bg-background text-foreground hover:border-primary/50",
              )}
            >
              {on && <Check className="h-3.5 w-3.5" />}
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
