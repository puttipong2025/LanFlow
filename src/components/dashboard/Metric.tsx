export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
      <p className="text-sm font-semibold text-ink/60">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-sm text-ink/60">{detail}</p>
    </section>
  );
}
