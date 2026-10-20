"use client";

import { useEffect } from "react";

type Props = { page: number; total: number; disabled: boolean; onPage: (page: number) => void };

export function HistoryPagination({ page, total, disabled, onPage }: Props) {
  const last = Math.max(1, Math.ceil(total / 10));
  useEffect(() => {
    if (!disabled && page > last) onPage(last);
  }, [disabled, page, last, onPage]);
  const pages = last <= 7 ? Array.from({ length: last }, (_, i) => i + 1)
    : Array.from(new Set([1, last, ...Array.from({ length: 5 }, (_, i) => page + i - 2)]))
    .filter((value) => value >= 1 && value <= last).sort((a, b) => a - b);
  return <nav aria-label="แบ่งหน้าประวัติ" className="mt-4 flex flex-wrap justify-end gap-2">
    {pages.map((value, index) => <span key={value} className="inline-flex items-center gap-2">
      {index > 0 && value - pages[index - 1] > 1 && <span aria-hidden="true" className="text-ink/50">…</span>}
      <button type="button" aria-label={`ไปหน้าที่ ${value}`} aria-current={value === page ? "page" : undefined}
        disabled={disabled || value === page} onClick={() => onPage(value)}
        className={value === page
          ? "focus-ring rounded-lg bg-actionSecondary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-40"
          : "focus-ring rounded-lg border border-actionSecondary/25 bg-white px-3 py-2 text-sm font-semibold text-actionSecondary hover:bg-field disabled:cursor-not-allowed disabled:opacity-40"}>
        {value}
      </button>
    </span>)}
  </nav>;
}
