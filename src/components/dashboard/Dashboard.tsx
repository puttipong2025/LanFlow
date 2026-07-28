"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import type { Location } from "@/types";
import type {
  DashboardManagerConfig,
  DashboardRow,
} from "@/types/dashboard";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  useDashboardMoneyFeed,
  useDashboardSnapshot,
} from "@/hooks/useDashboardOverview";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { Metric } from "./Metric";

const KIND_LABELS: Record<string, string> = {
  income: "รายรับ",
  expense: "รายจ่าย",
  transfer_in: "เงินโอนเข้า",
  transfer_out: "เงินโอนออก",
  rubber_bill: "บิลยาง",
  rubber_export: "ส่งออกยาง",
};

function formatOccurredAt(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function perKg(value: number | null) {
  return value == null ? "ไม่มีข้อมูล" : `${formatNumber(value)} บาท/กก.`;
}

function rowKind(row: DashboardRow) {
  return KIND_LABELS[row.kind] ?? (row.direction === "income" ? "รายรับ" : "รายจ่าย");
}

export function Dashboard({
  selectedLocation,
  online,
  canManageDashboard,
}: {
  selectedLocation: Location;
  online: boolean;
  canManageDashboard: boolean;
}) {
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null]);
  const [managerConfig, setManagerConfig] =
    useState<DashboardManagerConfig | null>(null);
  const [managerBusy, setManagerBusy] = useState<"save" | "refresh" | null>(
    null,
  );
  const cursor = cursorHistory[cursorHistory.length - 1];
  const snapshot = useDashboardSnapshot(selectedLocation.id, online);
  const feed = useDashboardMoneyFeed(selectedLocation.id, online, cursor);

  useEffect(() => {
    setCursorHistory([null]);
  }, [selectedLocation.id]);

  useEffect(() => {
    if (!online || !canManageDashboard) {
      setManagerConfig(null);
      return;
    }
    let active = true;
    const params = new URLSearchParams({ locationId: selectedLocation.id });
    void authFetch(`/api/lanflow/dashboard/config?${params}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        await assertApiResponse(response);
        return response.json() as Promise<DashboardManagerConfig>;
      })
      .then((config) => {
        if (active) setManagerConfig(config);
      })
      .catch(() => {
        if (active) setManagerConfig(null);
      });
    return () => {
      active = false;
    };
  }, [canManageDashboard, online, selectedLocation.id]);

  async function saveRefreshInterval() {
    if (!managerConfig) return;
    setManagerBusy("save");
    try {
      const params = new URLSearchParams({ locationId: selectedLocation.id });
      const response = await authFetch(
        `/api/lanflow/dashboard/config?${params}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            locationId: selectedLocation.id,
            intervalMinutes: managerConfig.intervalMinutes,
            purchaseAverageMin: managerConfig.thresholds.purchaseAverageMin,
            netCashMin: managerConfig.thresholds.netCashMin,
            stockItems: managerConfig.thresholds.stockItems.map((item) => ({
              productId: item.productId,
              minimumBalance: item.minimumBalance,
            })),
          }),
        },
      );
      await assertApiResponse(response);
      setManagerConfig(await response.json());
      toast.success("บันทึกรอบคำนวณ Dashboard แล้ว");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "บันทึกรอบคำนวณไม่สำเร็จ",
      );
    } finally {
      setManagerBusy(null);
    }
  }

  async function requestRefresh() {
    setManagerBusy("refresh");
    try {
      const response = await authFetch("/api/lanflow/dashboard/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationId: selectedLocation.id }),
      });
      await assertApiResponse(response);
      await snapshot.refetch();
      toast.success("เข้าคิวคำนวณ Dashboard ใหม่แล้ว");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "สั่งคำนวณใหม่ไม่สำเร็จ",
      );
    } finally {
      setManagerBusy(null);
    }
  }

  if (!online) {
    return (
      <section className="rounded-md border border-amber/30 bg-white p-6 text-center shadow-panel">
        <h2 className="text-lg font-bold text-ink">ภาพรวม · {selectedLocation.name}</h2>
        <p className="mt-2 text-sm font-semibold text-amber">
          ต้องออนไลน์เพื่อดูภาพรวมล่าสุด
        </p>
      </section>
    );
  }

  if (snapshot.isLoading && !snapshot.data) {
    return (
      <section className="rounded-md border border-black/10 bg-white p-6 text-center shadow-panel">
        <p className="text-sm font-semibold text-ink/60">กำลังโหลดภาพรวม...</p>
      </section>
    );
  }

  if (snapshot.isError || !snapshot.data) {
    return (
      <section className="rounded-md border border-danger/20 bg-white p-6 text-center shadow-panel">
        <p className="text-sm font-semibold text-danger">โหลดข้อมูลภาพรวมไม่สำเร็จ</p>
        <button
          type="button"
          onClick={() => snapshot.refetch()}
          className="focus-ring mt-3 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white"
        >
          ลองใหม่
        </button>
      </section>
    );
  }

  const summary = snapshot.data.summary;
  const rows = feed.data?.rows ?? [];
  const nextCursor = feed.data?.nextCursor ?? null;
  const visibleRows = feed.isPlaceholderData ? [] : rows;
  if (!summary) {
    return (
      <section className="rounded-md border border-black/10 bg-white p-6 text-center shadow-panel">
        <LoaderCircle className="mx-auto animate-spin text-leaf" size={22} />
        <h2 className="mt-3 text-lg font-bold text-ink">
          กำลังเตรียม Dashboard · {selectedLocation.name}
        </h2>
        <p className="mt-1 text-sm text-ink/55">
          ระบบจะเก็บผลสำเร็จล่าสุดไว้หนึ่งชุดต่อสาขา
        </p>
      </section>
    );
  }
  const waterLossValue = summary.waterLoss7Days.percent == null
    ? "—"
    : `${formatNumber(summary.waterLoss7Days.weight)} กก.`;
  const waterLossDetail = summary.waterLoss7Days.percent == null
    ? "ไม่มีรายการส่งออก"
    : `${formatNumber(summary.waterLoss7Days.percent)}% · ${summary.waterLoss7Days.exportCount} เที่ยว`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">ภาพรวม · {selectedLocation.name}</h1>
        <p className="mt-1 text-sm text-ink/55">
          ผลคำนวณล่าสุด{" "}
          {snapshot.data.calculatedAt
            ? formatOccurredAt(snapshot.data.calculatedAt)
            : "ยังไม่เคยคำนวณ"}
          {snapshot.data.status !== "ready"
            ? ` · สถานะ ${snapshot.data.status}`
            : ""}
        </p>
      </div>

      {canManageDashboard && managerConfig && (
        <section className="flex flex-wrap items-end gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel">
          <label className="text-sm font-semibold text-ink">
            รอบคำนวณกลางทั้งระบบ (นาที)
            <input
              type="number"
              min={10}
              max={1440}
              step={1}
              value={managerConfig.intervalMinutes}
              onChange={(event) =>
                setManagerConfig((current) =>
                  current
                    ? {
                        ...current,
                        intervalMinutes: Number(event.target.value),
                      }
                    : current,
                )
              }
              className="focus-ring mt-1 block h-10 w-40 rounded-md border border-black/15 px-3"
            />
          </label>
          <button
            type="button"
            onClick={saveRefreshInterval}
            disabled={managerBusy !== null}
            className="focus-ring flex h-10 items-center gap-2 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {managerBusy === "save" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            บันทึกรอบ
          </button>
          <button
            type="button"
            onClick={requestRefresh}
            disabled={
              managerBusy !== null ||
              snapshot.data.status === "queued" ||
              snapshot.data.status === "running"
            }
            className="focus-ring flex h-10 items-center gap-2 rounded-md bg-commit px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {managerBusy === "refresh" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            คำนวณสาขานี้ใหม่
          </button>
          <p className="text-xs text-ink/50">
            ต่ำสุด 10 นาที · ปุ่มนี้เข้าคิวทันทีและไม่สร้างประวัติผล
          </p>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="ซื้อยางวันนี้"
          value={formatCurrency(summary.purchaseToday.paidTotal)}
          detail={`${summary.purchaseToday.billCount} บิล · ${formatNumber(summary.purchaseToday.netWeight)} กก.`}
          formula="Σ ยอดที่ต้องจ่ายของบิลวันนี้"
        />
        <Metric
          label="ยอดซื้อเฉลี่ย 7 วัน"
          value={formatCurrency(summary.purchase7Days.dailyAverage)}
          detail={`รวม ${formatCurrency(summary.purchase7Days.paidTotal)}`}
          formula="Σ ยอดซื้อ 7 วัน ÷ 7"
        />
        <Metric
          label="ต้นทุนซื้อเฉลี่ย 7 วัน"
          value={perKg(summary.purchase7Days.averageCostPerKg)}
          detail={`${formatNumber(summary.purchase7Days.netWeight)} กก.`}
          formula="Σ ยอดซื้อ 7 วัน ÷ Σ น้ำหนักซื้อ 7 วัน"
        />
        <Metric
          label="รับ–จ่ายสุทธิสะสม"
          value={formatCurrency(summary.netCashFlow)}
          detail="เฉพาะรายการที่เกิดขึ้นจริง"
          formula="Σ รายรับจริง − Σ รายจ่ายจริง"
        />
        <Metric
          label="ภาระดำเนินงานต่อยอดซื้อสะสม"
          value={
            summary.operatingBurdenPercent == null
              ? "—"
              : `${formatNumber(summary.operatingBurdenPercent)}%`
          }
          detail={`${formatCurrency(summary.operatingExpenseAccumulated)} ÷ ${formatCurrency(summary.payablePurchaseAccumulated)} · ยิ่งต่ำยิ่งดี`}
          formula="รายจ่ายดำเนินงานสะสม ÷ ยอดซื้อยางที่ต้องจ่ายสะสม × 100"
        />
        <Metric
          label="น้ำหนักยางคงเหลือ"
          value={`${formatNumber(summary.rubberInventoryWeight)} กก.`}
          detail="น้ำหนักซื้อสุทธิ − น้ำหนักต้นทางที่ส่งออก"
          formula="Σ น้ำหนักซื้อ − Σ น้ำหนักต้นทางที่ส่งออก"
        />
        <Metric
          label="น้ำหาย 7 วัน"
          value={waterLossValue}
          detail={waterLossDetail}
          formula="Σ (น้ำหนักต้นทาง − น้ำหนักจริง) 7 วัน"
        />
        <Metric
          label="สต็อกสินค้า"
          value={`${summary.stock.inStockCount} ชนิด`}
          detail={`หมด ${summary.stock.outOfStockCount} ชนิด`}
          formula="ยอดคงเหลือ = Σ รับเข้า − Σ จ่ายออก"
        >
          <div className="mt-3 max-h-28 space-y-1 overflow-y-auto border-t border-black/5 pt-2 text-sm">
            {summary.stock.items.length === 0 ? (
              <p className="text-ink/50">ยังไม่มีสินค้า</p>
            ) : summary.stock.items.map((item) => (
              <div key={item.productId} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink/70">{item.name}</span>
                <span className={item.balance <= 0 ? "font-semibold text-clay" : "font-semibold text-ink"}>
                  {formatNumber(item.balance)} {item.unit}
                </span>
              </div>
            ))}
          </div>
        </Metric>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">รายการเงินล่าสุด</h2>
            <p className="text-sm text-ink/50">หน้า {cursorHistory.length} · 10 รายการต่อหน้า</p>
          </div>
          {feed.isFetching && <span className="text-xs font-semibold text-ink/50">กำลังโหลด...</span>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2 pr-3">วันเวลา</th>
                <th className="pr-3">ประเภท</th>
                <th className="pr-3">เลขรายการ</th>
                <th className="pr-3">รายละเอียด</th>
                <th className="pr-3 text-right">จำนวนเงิน</th>
                <th>ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody>
              {feed.isLoading || feed.isPlaceholderData ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink/50">กำลังโหลดรายการ...</td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-ink/50">ยังไม่มีรายการเงิน</td>
                </tr>
              ) : visibleRows.map((row) => (
                <tr key={row.id} className="border-b border-black/5">
                  <td className="whitespace-nowrap py-3 pr-3">{formatOccurredAt(row.occurredAt)}</td>
                  <td className="pr-3">
                    <span className="rounded-full bg-field px-2 py-1 text-xs font-semibold">
                      {rowKind(row)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap pr-3 font-semibold">{row.number}</td>
                  <td className="max-w-[360px] pr-3">{row.title}</td>
                  <td className={`whitespace-nowrap pr-3 text-right font-semibold ${row.direction === "income" ? "text-leaf" : "text-clay"}`}>
                    {row.direction === "income" ? "+" : "-"}{formatCurrency(row.amount)}
                  </td>
                  <td className="whitespace-nowrap">{row.createdByName || "ระบบ"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={cursorHistory.length === 1 || feed.isFetching}
            onClick={() => setCursorHistory((history) => history.slice(0, -1))}
            className="focus-ring rounded-md border border-black/10 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            ย้อนกลับ
          </button>
          <button
            type="button"
            disabled={!nextCursor || feed.isFetching}
            onClick={() => nextCursor && setCursorHistory((history) => [...history, nextCursor])}
            className="focus-ring rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            หน้าถัดไป
          </button>
        </div>
      </section>
    </div>
  );
}
