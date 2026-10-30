import { type QueryClient } from "@tanstack/react-query";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { getRubberBillReceiptSnapshots } from "@/lib/rubber-bill-receipts-idb";
import { incomeExpenseOperationalQueryKeys } from "@/lib/income-expense/query-keys";
import { isIncomeExpenseFeedPayload } from "@/lib/income-expense/contracts";
import type { IncomeExpenseOperationalFeedPage } from "@/lib/income-expense/operational-list";
import { BUSINESS_CACHE_PROTOCOL, type CacheModule, type ReceiptCheck, cacheMetadataKey, validateReceiptChecks } from "./protocol";
import { commitCacheRefresh, readCacheMetadata } from "./storage";
import { hasOpenBusinessForm, waitForBusinessForms } from "./forms";
import { businessCacheSettingsKey, isBusinessCacheSettings } from "./settings";

export type CacheState = { state: "unchecked" | "checking" | "updating" | "waiting" | "current" | "failed";
  updatedAt?: string; detail?: string };
export const EMPTY_CACHE_STATE: CacheState = { state: "unchecked" };
const ENDPOINT = "/api/lanflow/business-cache";

export async function refreshBusinessCaches(queryClient: QueryClient, owner: string, branch: string, signal: AbortSignal,
  publish: (module: CacheModule, state: CacheState) => void) {
  const modules: CacheModule[] = ["rubber", "income"];
  const keys = Object.fromEntries(modules.map(module => [module, cacheMetadataKey(module, owner, branch)]));
  const before = await Promise.all(modules.map(module => readCacheMetadata(keys[module])));
  modules.forEach((module, i) => publish(module, { state: "checking", updatedAt: before[i]?.updatedAt }));
  const response = await authFetch(`${ENDPOINT}?locationId=${encodeURIComponent(branch)}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }, { background: true });
  await assertApiResponse(response);
  const metadata: unknown = await response.json();
  if (!metadata || typeof metadata !== "object" || !("versions" in metadata)) throw new Error("อ่านเวอร์ชันแคชไม่สำเร็จ");
  const versions = metadata.versions as Record<CacheModule, number>;
  if (!("protocol" in metadata) || metadata.protocol !== BUSINESS_CACHE_PROTOCOL) {
    throw new Error("กรุณาโหลดแอปเวอร์ชันใหม่ก่อนอัปเดตแคช");
  }
  if (modules.some(module => !Number.isSafeInteger(versions?.[module]) || versions[module] < 1)) throw new Error("เวอร์ชันแคชไม่ถูกต้อง");
  if ("settings" in metadata) {
    if (!isBusinessCacheSettings(metadata.settings)) throw new Error("รอบตรวจแคชไม่ถูกต้อง");
    const incoming = metadata.settings;
    queryClient.setQueryData(businessCacheSettingsKey(owner), (current: typeof incoming | undefined) =>
      current && current.revision > incoming.revision ? current : incoming);
  }
  // Each module can succeed independently. No periodic retry is installed here.
  await Promise.all(modules.map(async (module, index) => {
    const previous = before[index];
    try {
      if (previous && previous.version > versions[module]) throw new Error("เซิร์ฟเวอร์ใช้เวอร์ชันแคชย้อนหลัง จึงเก็บข้อมูลเดิมไว้");
      if (previous && previous.version === versions[module]) {
        publish(module, { state: "current", updatedAt: previous.updatedAt }); return;
      }
      publish(module, { state: "updating", updatedAt: previous?.updatedAt });
      if (hasOpenBusinessForm()) {
        publish(module, { state: "waiting", updatedAt: previous?.updatedAt });
        await waitForBusinessForms(signal);
        publish(module, { state: "updating", updatedAt: previous?.updatedAt });
      }
      if (module === "rubber") {
        const expected = await getRubberBillReceiptSnapshots(branch);
        const checks: ReceiptCheck[] = [];
        for (let offset = 0; offset < expected.length; offset += 100) {
          const batch = expected.slice(offset, offset + 100);
          const result = await authFetch(ENDPOINT, { method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locationId: branch, ids: batch.map(row => row.billId) }) }, { background: true });
          await assertApiResponse(result);
          checks.push(...validateReceiptChecks((await result.json()).checks, batch, branch));
        }
        if (hasOpenBusinessForm()) {
          publish(module, { state: "waiting", updatedAt: previous?.updatedAt });
          await waitForBusinessForms(signal);
        }
        const updatedAt = new Date().toISOString();
        await commitCacheRefresh({ key: keys[module], version: versions[module], updatedAt }, expected, checks, branch, signal);
        await queryClient.invalidateQueries({ queryKey: ["rubberBillOperationalFeed", owner, branch], refetchType: "none" });
        publish(module, { state: "current", updatedAt });
      } else {
        const queryKey = incomeExpenseOperationalQueryKeys.feed(owner, branch, "latest", "");
        // Same key as the existing feed: in-flight requests are shared with the screen.
        await queryClient.fetchInfiniteQuery({ queryKey, initialPageParam: null as string | null, staleTime: 0,
          queryFn: async ({ pageParam, signal: querySignal }): Promise<IncomeExpenseOperationalFeedPage> => {
            const params = new URLSearchParams({ locationId: branch, mode: "latest", search: "" });
            if (pageParam) params.set("cursor", pageParam);
            const res = await authFetch(`/api/lanflow/income-expense/feed?${params}`, { signal: AbortSignal.any([signal, querySignal, AbortSignal.timeout(15_000)]) });
            await assertApiResponse(res); const data: unknown = await res.json();
            if (!isIncomeExpenseFeedPayload(data, branch, "latest", "")) throw new Error("รูปแบบข้อมูลรับ–จ่ายไม่ถูกต้อง");
            if (hasOpenBusinessForm()) {
              publish(module, { state: "waiting", updatedAt: previous?.updatedAt });
              await waitForBusinessForms(signal);
            }
            return data as IncomeExpenseOperationalFeedPage;
          }, getNextPageParam: (page: IncomeExpenseOperationalFeedPage) => page.nextCursor ?? undefined });
        // An existing in-flight query bypasses the queryFn above. Always recheck
        // the form guard before committing maintenance metadata as well.
        if (hasOpenBusinessForm()) {
          publish(module, { state: "waiting", updatedAt: previous?.updatedAt });
          await waitForBusinessForms(signal);
        }
        if (signal.aborted) return;
        const updatedAt = new Date().toISOString();
        await commitCacheRefresh({ key: keys[module], version: versions[module], updatedAt }, [], [], "", signal);
        publish(module, { state: "current", updatedAt });
      }
    } catch (error) {
      if (!signal.aborted) publish(module, { state: "failed", updatedAt: previous?.updatedAt,
        detail: error instanceof Error ? error.message : "อัปเดตแคชไม่สำเร็จ ใช้ข้อมูลเดิม" });
    }
  }));
}
