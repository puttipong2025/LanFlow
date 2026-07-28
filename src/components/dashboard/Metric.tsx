import type { ReactNode } from "react";

export function Metric({
  label,
  value,
  detail,
  formula,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  formula: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-mint/80 bg-white p-5 shadow-panel">
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-pretty text-sm text-ink/60">{detail}</p>
      <p className="mt-3 inline-flex rounded-full bg-mint/45 px-2.5 py-1 text-xs text-ink/55">
        สูตร: {formula}
      </p>
      {children}
    </section>
  );
}
