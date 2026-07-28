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
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink/60">{detail}</p>
      <p className="mt-2 inline-flex rounded-full bg-field px-2 py-1 text-xs text-ink/55">
        สูตร: {formula}
      </p>
      {children}
    </section>
  );
}
