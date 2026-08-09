import { cn } from "@/lib/cn";

const DEFAULT_PAGE_SIZES = [10, 25, 50] as const;
const MAX_VISIBLE_PAGES = 7;

export function getPaginationPageNumbers(
  totalPages: number,
  currentPage: number,
  maxVisiblePages = MAX_VISIBLE_PAGES,
) {
  const safeTotalPages = Math.max(Math.floor(totalPages), 1);
  const safeMaxVisiblePages = Math.max(Math.floor(maxVisiblePages), 1);
  const visibleCount = Math.min(safeTotalPages, safeMaxVisiblePages);
  const safeCurrentPage = Math.min(Math.max(Math.floor(currentPage), 1), safeTotalPages);
  const halfWindow = Math.floor(visibleCount / 2);
  const startPage = Math.min(
    Math.max(safeCurrentPage - halfWindow, 1),
    safeTotalPages - visibleCount + 1,
  );

  return Array.from({ length: visibleCount }, (_, index) => startPage + index);
}

export function TablePageSizeSelect({
  pageSize,
  onPageSizeChange,
  options = DEFAULT_PAGE_SIZES,
}: {
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  options?: readonly number[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
      แสดง
      <select
        aria-label="จำนวนแถวต่อหน้า"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
        className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3 tabular-nums"
      >
        {options.map((size) => (
          <option key={size} value={size}>{size}</option>
        ))}
      </select>
      แถว
    </label>
  );
}

export function TablePagination({
  totalItems,
  page,
  pageSize,
  onPageChange,
  hasMore = false,
}: {
  totalItems: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  hasMore?: boolean;
}) {
  const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const firstVisible = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, totalItems);
  const pageNumbers = getPaginationPageNumbers(totalPages, currentPage);

  const pageButtonClass = "focus-ring h-10 min-w-10 rounded-md border px-3 text-sm font-semibold tabular-nums";

  return (
    <nav
      aria-label="แบ่งหน้าตาราง"
      className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <p className="text-sm text-ink tabular-nums" aria-live="polite">
        แสดง {firstVisible} ถึง {lastVisible} จาก {totalItems} รายการที่โหลดแล้ว
        {hasMore && <span className="text-ink/60"> · ยังมีข้อมูลเพิ่มเติม</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={cn(
            pageButtonClass,
            "border-actionSecondary bg-actionSecondary text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:border-black/10 disabled:bg-field disabled:text-ink/40",
          )}
        >
          ก่อนหน้า
        </button>
        {pageNumbers.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            aria-current={currentPage === pageNumber ? "page" : undefined}
            aria-label={`ไปหน้าที่ ${pageNumber}`}
            onClick={() => onPageChange(pageNumber)}
            className={cn(
              pageButtonClass,
              currentPage === pageNumber
                ? "border-leaf bg-leaf text-white"
                : "border-actionSecondary bg-actionSecondary text-white hover:bg-actionSecondary/90",
            )}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={cn(
            pageButtonClass,
            "border-actionSecondary bg-actionSecondary text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:border-black/10 disabled:bg-field disabled:text-ink/40",
          )}
        >
          ถัดไป
        </button>
      </div>
    </nav>
  );
}
