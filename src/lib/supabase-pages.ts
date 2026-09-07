type PageResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
};

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
