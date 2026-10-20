import { cn } from "@/lib/cn";
import type { HistoryFacet } from "@/lib/operator-money-history";

export function OperatorHistoryFilters({ label, options, selected, onSelect, allKey = "" }: {
  label: string;
  options: HistoryFacet[];
  selected: string;
  onSelect: (key: string) => void;
  allKey?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-balance text-sm font-semibold text-ink/70">{label}</h3>
      <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.filter((option) => option.key === allKey || option.count > 0).map((option) => {
          const active = selected === option.key;
          return (
            <button key={option.key} type="button" aria-pressed={active}
              onClick={() => onSelect(option.key)}
              className={cn("focus-ring inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold",
                active ? "bg-actionSecondary text-white hover:bg-actionSecondary/90"
                  : "border border-actionSecondary/20 bg-white text-actionSecondary hover:bg-field")}>
              {option.name}
              <span className={cn("min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs tabular-nums",
                active ? "bg-white/20 text-white" : "bg-field text-ink/70")}>{option.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
