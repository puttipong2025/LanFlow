import { isIsoTimestamp, isoTimestampMicros, isUuidV1ToV8 } from "@/lib/validation/primitives";

type PageResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

export function requireSupabaseExactCount(count: unknown): number {
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("ระบบไม่ตอบกลับจำนวนงานรออนุมัติ");
  }
  return count;
}

export async function readAllSupabaseRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Supabase query failed");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// The caller orders both columns descending. Pending rows can leave the
// result set between requests, so an offset would skip rows that move up.
export async function readAllSupabaseRowsByCreatedAt<T extends { created_at: string; id: string }>(
  fetchPage: (limit: number, before?: string) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const limit = 500;
  const rows: T[] = [];
  let before: string | undefined;
  let previousTime: bigint | undefined;
  let previousId = "";
  for (;;) {
    const { data, error } = await fetchPage(limit, before);
    if (error) throw new Error(error.message || "Supabase query failed");
    const page = data ?? [];
    for (const row of page) {
      if (!isIsoTimestamp(row?.created_at) || !isUuidV1ToV8(row.id)) {
        throw new Error("Invalid Supabase page cursor");
      }
      const time = isoTimestampMicros(row.created_at);
      const id = row.id.toLowerCase();
      if (previousTime !== undefined && (time > previousTime || (time === previousTime && id >= previousId))) {
        throw new Error("Supabase page cursor did not advance");
      }
      previousTime = time;
      previousId = id;
      rows.push(row);
    }
    if (page.length < limit) return rows;

    const last = page[page.length - 1];
    before = `created_at.lt.${last.created_at},and(created_at.eq.${last.created_at},id.lt.${last.id})`;
  }
}
